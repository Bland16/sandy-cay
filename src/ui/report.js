// report.js — the Wrap report's view model (SPEC §7.1 / R-7).
//
// Pure: takes a Schedule and a week, returns data. No DOM, no React, so the
// awkward cases (an empty week, an untrained model, a week with no baseline)
// are testable without rendering anything.
//
// P-1 governs every line here. This is the app's most dangerous surface: a
// weekly report is exactly where a scheduler starts scolding. So:
//   - Accomplished leads. Skipped is a COUNT, never a list (§7.1).
//   - Nothing is scored, ranked against a target, or given a percentage of
//     "success". Fill ratio is physics; completion is not a grade.
//   - Every suggestion carries a graceful exit of equal weight, and "let it go"
//     is a real, mechanical action — not a dismiss that reappears next week.

import {
  getWeekLoad, getTagBreakdown, getSatisfactionMatrix, getBreakCompression,
  snapshot, snapshotDiff, isoWeekKey, addDays, dateKey, weekStart as weekStartOf,
  driftCheck, starvationCheck, skipStreakCheck, pinnedRatioNote, durationFitSuggestion,
  splitPeriod, endRecurrence,
} from '../core/index.js';
import { fmtDur } from './format.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "July 13 – 19, 2026" — collapses the month when a week doesn't cross one. */
export function weekRangeLabel(ws) {
  const end = addDays(ws, 6);
  const y = end.getFullYear();
  if (ws.getMonth() === end.getMonth()) {
    return `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${end.getDate()}, ${y}`;
  }
  const startY = ws.getFullYear() !== y ? `, ${ws.getFullYear()}` : '';
  return `${MONTHS[ws.getMonth()]} ${ws.getDate()}${startY} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${y}`;
}

/** Minutes → "6h" / "6h 30m" / "45m", for prose rather than table cells. */
function hours(min) {
  return fmtDur(min);
}

/** The last N week-starts ending at `ws`, most-recent-first (skip-streak input). */
function recentWeeks(ws, n) {
  return Array.from({ length: n }, (_, i) => addDays(ws, -7 * i));
}

// ---- section 1: what happened ------------------------------------------------

function buildAccomplished(sched, ws, weekTasks) {
  // Project parents are bookkeeping records with zero duration (projects.js) —
  // they are not things that happened, so they never appear as items.
  const real = weekTasks.filter((t) => !t.chunking);

  const completed = real.filter((t) => t.completion === 'done' || t.completion === 'partial');
  const focusedMin = completed.reduce((n, t) => n + t.getDuration(), 0);

  const rated = real.filter((t) => t.satisfaction && typeof t.satisfaction.overall === 'number');
  const shellSum = rated.reduce((n, t) => n + t.satisfaction.overall, 0);

  // Project progress is a LIFETIME figure ("Thesis: 6h of 10h done"), so it
  // counts every chunk ever finished, not just this week's.
  const projects = sched.tasks
    .filter((t) => t.chunking)
    .map((parent) => {
      const children = sched.tasks.filter((t) => t.parentId === parent.id);
      const doneMin = children
        .filter((c) => c.completion === 'done' || c.completion === 'partial')
        .reduce((n, c) => n + c.getDuration(), 0);
      const thisWeek = weekTasks.filter((t) => t.parentId === parent.id).length;
      return {
        id: parent.id,
        title: parent.title,
        doneMin,
        totalMin: parent.chunking.totalMinutes,
        thisWeek,
      };
    })
    .filter((p) => p.totalMin > 0);

  return {
    items: completed
      .slice()
      .sort((a, b) => a.startTime - b.startTime)
      .map((t) => ({
        id: t.id,
        title: t.title,
        tags: [...t.tags],
        durationMin: t.getDuration(),
        partial: t.completion === 'partial',
        shells: t.satisfaction && typeof t.satisfaction.overall === 'number' ? t.satisfaction.overall : null,
      })),
    completedCount: completed.filter((t) => t.completion === 'done').length,
    partialCount: completed.filter((t) => t.completion === 'partial').length,
    // A count. Never a list — §7.1 is explicit, and an itemised list of what you
    // didn't do is the definition of the thing P-1 forbids.
    skippedCount: real.filter((t) => t.completion === 'skipped').length,
    focusedMin,
    projects,
    ratedCount: rated.length,
    avgShells: rated.length > 0 ? shellSum / rated.length : null,
  };
}

// ---- section 2: statistics ---------------------------------------------------

/** Planned-vs-actual, or null when this week has no baseline. Null is the
 *  honest answer for every week that predates the snapshot wiring — the section
 *  disappears rather than reporting a week that "went exactly to plan" because
 *  there was no plan to diff. */
function buildPlanDiff(sched, ws) {
  const planned = sched.plannedSnapshot(ws);
  if (!planned || Object.keys(planned).length === 0) return null;

  const actual = snapshot(sched, ws);
  const diff = snapshotDiff(planned, actual);
  const totalDriftMin = diff.moved.reduce((n, m) => n + Math.abs(m.deltaMin), 0);

  const biggest = diff.moved
    .slice()
    .sort((a, b) => Math.abs(b.deltaMin) - Math.abs(a.deltaMin))[0] || null;
  const titleOf = (id) => {
    const t = sched.tasks.find((x) => x.id === id) || sched.getTasksForWeek(ws).find((x) => x.id === id);
    return t ? t.title : 'a task';
  };

  // Which days survived intact — "Tuesday went exactly to plan" (6J).
  const movedIds = new Set(diff.moved.map((m) => m.id));
  const intactDays = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(ws, i);
    const key = dateKey(date);
    const dayPlanned = Object.keys(planned).filter((id) => dateKey(new Date(planned[id].start)) === key);
    if (dayPlanned.length > 0 && dayPlanned.every((id) => !movedIds.has(id))) intactDays.push(i);
  }

  return {
    movedCount: diff.moved.length,
    intactCount: diff.intactCount,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    totalDriftMin,
    intactDays,
    biggest: biggest ? { title: titleOf(biggest.id), deltaMin: biggest.deltaMin } : null,
  };
}

// ---- section 3: suggestions --------------------------------------------------

/**
 * Every suggestion is mechanically derived and explainable (§7.2), and every one
 * offers an exit of equal weight. `apply` and `dismiss` are both real mutations:
 * a "Let it go" that merely hides the card would surface the same nag next week,
 * which is worse than saying nothing.
 */
function buildSuggestions(sched, ws, weekLoad, weekTasks) {
  const out = [];
  const config = sched.config;

  for (const task of sched.tasks) {
    if (task.recurrence) {
      // 6B — the pattern has drifted; offer to make the drift the pattern.
      const d = driftCheck(task, config);
      if (d.drift) {
        const mins = Math.round(Math.abs(d.median));
        out.push({
          id: `drift:${task.id}`,
          kind: 'drift',
          taskId: task.id,
          headline: `${task.title} keeps moving ${d.direction}`,
          detail: `${d.count} of the last ${config.detectors.driftN} sessions started about ${hours(mins)} ${d.direction} than the pattern says.`,
          actions: [
            { kind: 'apply', label: `Make that the pattern` },
            { kind: 'dismiss', label: 'Leave it as it is' },
          ],
          meta: { direction: d.direction, medianMin: Math.round(d.median) },
        });
      }

      // 6L — skipped for weeks. Both exits are real: change it, or end it via
      // effectiveUntil (§7.2 names that mutation explicitly).
      const streak = skipStreakCheck(sched, task, recentWeeks(ws, config.detectors.skipStreak + 1), config);
      if (streak.flag) {
        out.push({
          id: `skip:${task.id}`,
          kind: 'skip-streak',
          taskId: task.id,
          headline: `${task.title} hasn't happened in ${streak.streak} weeks`,
          detail: 'It may have run its course, or it may just be in the wrong slot. Both are fine.',
          actions: [
            { kind: 'open', label: 'Change the pattern' },
            { kind: 'letgo', label: 'Let it go' },
          ],
          meta: { streak: streak.streak },
        });
      }
    }

    // 6D — starvation: this keeps losing to everything else.
    const st = starvationCheck(task, config);
    if (st.starving && !task.pinned && !task.chunking && task.completion !== 'skipped') {
      out.push({
        id: `starve:${task.id}`,
        kind: 'starvation',
        taskId: task.id,
        headline: `${task.title} keeps getting pushed`,
        detail: `Moved or carried ${st.count} times. Pinning it gives it right of way next week.`,
        actions: [
          { kind: 'apply', label: 'Pin it next week' },
          { kind: 'letgo', label: 'Let it go' },
        ],
        meta: { count: st.count },
      });
    }
  }

  // 6K — duration fit, per tag. Qualitative by design: no time tracking.
  const tags = [...new Set(weekTasks.flatMap((t) => t.tags))].sort();
  for (const tag of tags) {
    const fit = durationFitSuggestion(sched.tasks, tag);
    if (fit.suggest) {
      out.push({
        id: `fit:${tag}`,
        kind: 'duration-fit',
        headline: `${tag} blocks may want to be ${fit.direction}`,
        detail: `Most rated ${tag} sessions said the length didn't fit. Worth trying ${fit.direction} next time.`,
        observationOnly: true,
        meta: { tag, direction: fit.direction },
      });
    }
  }

  // 6I — pinned ratio. An observation with no action attached, deliberately:
  // there is no cap, and "you pinned too much" is not a diagnosis the app gets
  // to make. It just says what's true and stops talking.
  const pin = pinnedRatioNote(weekLoad, config);
  if (pin.note) {
    out.push({
      id: `pinned-ratio:${dateKey(ws)}`,
      kind: 'pinned-ratio',
      headline: `${Math.round(pin.ratio * 100)}% of this week was pinned`,
      detail: 'Pinned time is time the scheduler leaves alone — that may be exactly what you wanted.',
      observationOnly: true,
      meta: { ratio: pin.ratio },
    });
  }

  // An answered suggestion never returns. Filtering here rather than at each
  // detector keeps the rule in one place and impossible to forget.
  return out.filter((s) => !sched.isSuggestionDismissed(s.id));
}

/**
 * Perform a suggestion's action. Returns a short past-tense line for the toast,
 * or null when the caller has to handle it (the 'open' kind routes to the task
 * panel, which is the App's business, not the engine's).
 *
 * Every path records the suggestion as answered — including "let it go", which
 * is the whole point: the app asked, you answered, it stops asking.
 */
export function applySuggestion(sched, suggestion, actionKind, now = new Date()) {
  const task = suggestion.taskId ? sched.tasks.find((t) => t.id === suggestion.taskId) : null;
  const nextWeek = addDays(weekStartOf(now), 7);

  if (actionKind === 'open') return null; // App opens the task panel; not answered yet.

  if (actionKind !== 'dismiss' && task) {
    if (suggestion.kind === 'drift' && actionKind === 'apply') {
      // 4B period split, "from now on" — the drift becomes the pattern from
      // next week, leaving every past session exactly as it was lived.
      const delta = suggestion.meta.medianMin;
      const active = task.recurrence.periods.find((p) => !p.effectiveUntil) || task.recurrence.periods[0];
      const shifted = active.windows.map((w) => ({
        day: w.day,
        start: shiftHHMM(w.start, delta),
        end: shiftHHMM(w.end, delta),
      }));
      splitPeriod(task, nextWeek, shifted);
    } else if (suggestion.kind === 'starvation' && actionKind === 'apply') {
      task.pinned = true;
    } else if (suggestion.kind === 'starvation' && actionKind === 'letgo') {
      // Released, not deleted — §3.6's "Let them go" marks skipped, and the
      // card stays where it was so nothing vanishes on you.
      task.completion = 'skipped';
    } else if (suggestion.kind === 'skip-streak' && actionKind === 'letgo') {
      endRecurrence(task, nextWeek); // §7.2 names effectiveUntil as the mechanism
    }
  }

  sched.dismissSuggestion(suggestion.id, now);
  sched._touch();

  switch (`${suggestion.kind}:${actionKind}`) {
    case 'drift:apply': return 'Pattern updated from next week';
    case 'starvation:apply': return 'Pinned — it gets right of way next week';
    case 'starvation:letgo': return 'Let go — guilt-free';
    case 'skip-streak:letgo': return 'Pattern ended — it stops after this week';
    default: return 'Noted — this won’t come up again';
  }
}

/** 'HH:MM' + minutes → 'HH:MM', clamped inside the day. */
function shiftHHMM(hhmm, deltaMin) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + deltaMin));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Fresh model insight in plain language, or null below the cold-start floor.
 *  §5: the model is meaningless under 10 ratings, so it says nothing rather
 *  than dressing up noise as self-knowledge. */
function buildInsight(sched) {
  const { learning, config } = sched;
  if (!learning.trained || learning.sampleCount < config.coldStartRatings) {
    return {
      cold: true,
      sampleCount: learning.sampleCount,
      needed: config.coldStartRatings,
    };
  }
  // Top 3 is editorial, not a page-fitting cap: §7.1 asks for "fresh model
  // insights in plain language", and the 30th-strongest weight is noise wearing
  // a sentence. The full vector is inspectable in the Cabana.
  const top = learning.inspect()
    .filter((w) => Math.abs(w.weight) > 0.01)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);
  return { cold: false, sampleCount: learning.sampleCount, top };
}

// ---- assembly ----------------------------------------------------------------

/**
 * Deadline buffer — how close to the wire the week's deadlined work ran. PHYSICS,
 * not a verdict (P-1, design/RECONCILIATION.md): every number is a fact already in
 * the schedule — the deadline you set and when the task actually sat — never a read
 * of what you skipped or a word like "procrastinating". Just facts, and not obscured.
 * Buffer = deadline − the task's scheduled end (a completed task sits where it ran).
 */
function buildDeadlineBuffer(sched, weekTasks) {
  const thresholdHours = (sched.config.detectors && sched.config.detectors.deadlineBufferHours) ?? 24;
  const done = weekTasks.filter((t) => !t.chunking && t.deadline && (t.completion === 'done' || t.completion === 'partial'));
  const rows = done.map((t) => ({
    title: t.title,
    bufferHours: (t.deadline.getTime() - t.endTime.getTime()) / 3600000,
    bucket: sched.bucketForTask ? sched.bucketForTask(t) : null,
  }));
  if (rows.length === 0) return { count: 0 };

  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const byBucketMap = new Map();
  for (const r of rows) {
    const label = r.bucket ? r.bucket.label : 'No bucket';
    (byBucketMap.get(label) || byBucketMap.set(label, []).get(label)).push(r.bufferHours);
  }
  const byBucket = [...byBucketMap.entries()]
    .map(([label, bufs]) => ({ label, count: bufs.length, medianBufferHours: median(bufs) }))
    .sort((a, b) => a.medianBufferHours - b.medianBufferHours);
  const tightest = rows.reduce((m, r) => (r.bufferHours < m.bufferHours ? r : m));

  return {
    count: rows.length,
    closeCount: rows.filter((r) => r.bufferHours < thresholdHours).length,
    thresholdHours,
    tightest: { title: tightest.title, bufferHours: tightest.bufferHours },
    byBucket,
    closestBucket: byBucket.length >= 2 ? byBucket[0] : null,
  };
}

export function buildWrapReport(sched, weekStartDate) {
  const ws = weekStartOf(weekStartDate);
  const weekTasks = sched.getTasksForWeek(ws);
  const weekLoad = getWeekLoad(sched, ws);

  const accomplished = buildAccomplished(sched, ws, weekTasks);
  const real = weekTasks.filter((t) => !t.chunking);

  return {
    weekStart: ws,
    weekKey: isoWeekKey(ws),
    range: weekRangeLabel(ws),
    accomplished,
    stats: {
      load: weekLoad,
      tags: getTagBreakdown(sched, ws),
      matrix: getSatisfactionMatrix(sched, ws),
      breaks: getBreakCompression(sched, ws),
      plan: buildPlanDiff(sched, ws),
      deadlines: buildDeadlineBuffer(sched, weekTasks),
    },
    insight: buildInsight(sched),
    suggestions: buildSuggestions(sched, ws, weekLoad, weekTasks),
    // A week with nothing in it is a legitimate week, and it gets a page that
    // says so plainly instead of a grid of zeroes and NaNs.
    isEmpty: real.length === 0,
    taskCount: real.length,
  };
}
