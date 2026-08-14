// gapActions.js — the engine-facing half of the 3C / 3D gap offer (SPEC §3.8,
// §3.9). Pure JS, no DOM, so the candidate rules are unit-testable. The React
// half is GapToast.jsx + App.jsx.
//
// A "gap" is a freed interval { start, end } — a deleted task's slot, a skipped
// occurrence's slot, or the remainder of a task finished early. §3.8 offers
// three fates and imposes none:
//   Leave open — the default; nothing here runs.
//   Backfill   — a scoped placement pass over THIS gap, candidate order
//                (1) schedulingWarning → (2) urgent-deadline → (3) auto-placed
//                flexibles from later that week, only if it improves their score.
//                User-placed tasks are never candidates (§3.8, explicit).
//   Protect    — a rest blocker filling the gap.
//
// Boundary note (USE-CASE 3C): this never suggests *what* to do. It re-runs the
// engine's own placement rules over existing tasks, when explicitly asked.

import {
  addDays,
  addMinutes,
  dayStart,
  minutesBetween,
  weekStart as weekStartOf,
  expandRecurrence,
  findBestSlot,
  freeCapacityBefore,
  intervalsOf,
} from '../core/index.js';

/** Minutes a gap offers. */
export function gapMinutes(gap) {
  return Math.max(0, minutesBetween(gap.start, gap.end));
}

/** §3.8's threshold: only a gap worth reclaiming gets an offer. */
export function worthOffering(sched, gap) {
  return gapMinutes(gap) >= sched.config.backfillOfferThreshold;
}

/**
 * Occupied intervals for a scoped pass: every real task except `exclude`, plus
 * every recurrence occurrence in the weeks the range touches (occurrences are
 * anchors — §4.4 — and a parent is a pattern record, not a thing in the day).
 */
function occupiedExcluding(sched, exclude, from, to) {
  const reals = intervalsOf(
    sched.tasks.filter(
      (t) => !t.chunking && !t.recurrence && t.id !== (exclude && exclude.id),
    ),
  );
  const occs = [];
  const seen = new Set();
  const endMs = to.getTime();
  for (let ws = weekStartOf(from), guard = 0; ws.getTime() <= endMs && guard < 8; guard += 1) {
    for (const t of sched.tasks) {
      if (!t.recurrence) continue;
      for (const occ of expandRecurrence(t, ws)) {
        if (seen.has(occ.id)) continue;
        seen.add(occ.id);
        occs.push({ start: occ.startTime, end: occ.endTime, task: occ });
      }
    }
    ws = addDays(ws, 7);
  }
  return reals.concat(occs);
}

/**
 * Ask the engine for a slot INSIDE the gap, for tasks we are deliberately
 * offering the gap to (tiers 1 and 2).
 *
 * The scoping trick: bound the gap with two synthetic walls so the only free
 * space findBestSlot can see on that day IS the gap. Everything the engine
 * cares about still applies — computeWindows enforces deadline > zone > general
 * windows, so a gap the task isn't allowed to occupy returns null rather than a
 * forced placement.
 *
 * `ignoreBreaks` is deliberate: the walls are synthetic, and the gap is exactly
 * the hole a task of this size just vacated — padding against a wall that isn't
 * a task would shrink a 60-minute gap below a 60-minute task.
 */
export function fitInGap(sched, task, gap, occupied) {
  const walls = [
    { start: addDays(gap.start, -1), end: gap.start },
    { start: gap.end, end: addDays(gap.end, 1) },
  ];
  const best = findBestSlot(sched, task, {
    from: gap.start,
    to: gap.start, // one day: findBestSlot's loop is dayStart(from)…dayStart(to)
    occupied: occupied.concat(walls),
    origin: task.startTime,
    ignoreBreaks: true,
  });
  if (!best) return null;
  if (best.slot.start.getTime() < gap.start.getTime()) return null;
  if (best.slot.end.getTime() > gap.end.getTime()) return null;
  return best.slot;
}

/** Tasks the engine is allowed to move at all, in the gap's week. */
function movablePool(sched, gap) {
  const ws = weekStartOf(gap.start);
  const weekEnd = addDays(ws, 7);
  return sched.tasks.filter(
    (t) =>
      !t.chunking &&
      !t.recurrence &&
      t.type === 'flexible' &&
      !t.pinned &&
      !t.hasProtectedTag(sched.config.protectedTags) &&
      // §3.8, explicit: a hand-placed task is never dragged into a gap by a
      // machine. Where you put it is a decision, not a default.
      t.placedBy !== 'user' &&
      t.completion === null &&
      t.getDuration() <= gapMinutes(gap) &&
      t.startTime.getTime() >= gap.start.getTime() &&
      t.startTime.getTime() < weekEnd.getTime() &&
      // Already inside the gap (e.g. the truncated task itself) — nothing to do.
      !(t.startTime.getTime() >= gap.start.getTime() && t.endTime.getTime() <= gap.end.getTime()),
  );
}

/** §2.4's urgency test, reused verbatim rather than re-derived. */
function isUrgent(sched, task, occupied, from) {
  if (!task.deadline) return false;
  const slack = freeCapacityBefore(sched, task.deadline, occupied, from) - task.getDuration();
  return slack < task.getDuration() * sched.config.urgencyFactor;
}

function slackOf(sched, task, occupied, from) {
  if (!task.deadline) return Infinity;
  return freeCapacityBefore(sched, task.deadline, occupied, from) - task.getDuration();
}

/**
 * The ordered candidate list for a gap, without moving anything.
 * @returns Array<{ task, tier: 1|2|3, slot }>
 */
export function backfillCandidates(sched, gap) {
  const ws = weekStartOf(gap.start);
  const weekEnd = addDays(ws, 7);
  const pool = movablePool(sched, gap);
  if (pool.length === 0) return [];

  const out = [];

  // Tier 1 — tasks the engine already flagged as not fitting (§3.8 order).
  // Longest first: a warned task takes the gap it can actually use.
  const warned = pool
    .filter((t) => t.schedulingWarning)
    .sort((a, b) => b.getDuration() - a.getDuration() || a.title.localeCompare(b.title));
  for (const t of warned) {
    const occ = occupiedExcluding(sched, t, gap.start, gap.end);
    const slot = fitInGap(sched, t, gap, occ);
    if (slot) out.push({ task: t, tier: 1, slot });
  }

  // Tier 2 — deadline tasks whose slack is under the urgency threshold (§2.4).
  const urgent = pool
    .filter((t) => !t.schedulingWarning)
    .map((t) => ({
      t,
      occ: occupiedExcluding(sched, t, gap.start, gap.end),
    }))
    .filter(({ t, occ }) => isUrgent(sched, t, occ, gap.start))
    .sort((a, b) => slackOf(sched, a.t, a.occ, gap.start) - slackOf(sched, b.t, b.occ, gap.start));
  for (const { t, occ } of urgent) {
    const slot = fitInGap(sched, t, gap, occ);
    if (slot) out.push({ task: t, tier: 2, slot });
  }

  // Tier 3 — auto-placed flexibles from LATER that week, only if the move
  // improves their score.
  //
  // The test is the engine's own: give findBestSlot the whole rest of the week
  // with this task lifted out — so its CURRENT slot is free and competing — and
  // see where it lands. If the scored search picks the gap over everywhere else
  // including where it already sits, then the gap is an improvement, by
  // definition. No score arithmetic is re-implemented here.
  const later = pool.filter(
    (t) =>
      !t.schedulingWarning &&
      t.startTime.getTime() >= gap.end.getTime() &&
      !out.some((c) => c.task.id === t.id),
  );
  for (const t of later) {
    const occ = occupiedExcluding(sched, t, gap.start, weekEnd);
    const best = findBestSlot(sched, t, {
      from: gap.start,
      to: weekEnd,
      occupied: occ,
      origin: t.startTime,
    });
    if (!best) continue;
    if (best.slot.start.getTime() < gap.start.getTime()) continue;
    if (best.slot.end.getTime() > gap.end.getTime()) continue;
    out.push({ task: t, tier: 3, slot: best.slot });
  }

  return out;
}

/**
 * Backfill: move the best candidate into the gap. One task, not a cascade —
 * the offer is about this gap.
 * @returns { task, tier, slot } | null
 */
export function backfillGap(sched, gap) {
  const pick = backfillCandidates(sched, gap)[0];
  if (!pick) return null;
  pick.task.placeAt(pick.slot.start);
  // The engine found this slot through computeWindows, so the constraints it
  // was parked in violation of no longer apply: deadline, zone and window are
  // all satisfied where it now sits.
  pick.task.placedBy = 'auto';
  pick.task.schedulingWarning = false;
  pick.task.schedulingInfo = null;
  return pick;
}

/** Protect: a rest blocker filling the gap (§3.8). */
export function protectGap(sched, gap) {
  return sched.addFixed({
    title: 'Recovery time',
    tags: ['rest'],
    startTime: new Date(gap.start.getTime()),
    endTime: new Date(gap.end.getTime()),
    placedBy: 'user',
  });
}

/**
 * §7.3's one suggestion: block some recovery time. Not tied to a freed gap —
 * it finds the first opening this week and protects it, so the notice's action
 * is the same mechanical Protect the toast offers.
 * @returns Task | null
 */
export function protectSomeRecovery(sched, weekStart, from) {
  const search = {
    from: from && from.getTime() > weekStart.getTime() ? from : weekStart,
    to: addDays(weekStart, 6),
    durationMin: sched.config.defaultDuration,
  };
  const slot =
    sched.findFreeSlot(search) ||
    // A packed week may have no break-padded opening left — that is precisely
    // when the notice fires. Ask again without the padding rather than shrug.
    sched.findFreeSlot({ ...search, respectBreaks: false });
  if (!slot) return null;
  return protectGap(sched, { start: slot.start, end: slot.end });
}

/** A day's anchored tasks — exactly evacuateDay's own `needsReview` set (§3.4). */
export function needsReviewFor(sched, date) {
  const d = dayStart(date);
  const next = addDays(d, 1);
  return sched.tasks.filter(
    (t) =>
      !t.chunking &&
      !t.recurrence &&
      t.startTime.getTime() >= d.getTime() &&
      t.startTime.getTime() < next.getTime() &&
      t.isAnchored(sched.config.protectedTags),
  );
}

/** A day's movable tasks — exactly evacuateDay's own `movable` set (§3.4). */
export function movableFor(sched, date) {
  const d = dayStart(date);
  const next = addDays(d, 1);
  return sched.tasks.filter(
    (t) =>
      !t.chunking &&
      !t.recurrence &&
      t.startTime.getTime() >= d.getTime() &&
      t.startTime.getTime() < next.getTime() &&
      t.type === 'flexible' &&
      !t.pinned &&
      !t.hasProtectedTag(sched.config.protectedTags),
  );
}

/** Recurring sessions on a day. evacuateDay never touches these (§4.4) — the
 *  panel says so rather than letting the count silently disagree. */
export function occurrencesFor(sched, date) {
  const d = dayStart(date);
  const next = addDays(d, 1);
  return sched
    .getTasksForWeek(weekStartOf(date))
    .filter(
      (t) =>
        t.isOccurrence &&
        t.startTime.getTime() >= d.getTime() &&
        t.startTime.getTime() < next.getTime(),
    );
}

// ---- Clear Day row resolutions (§3.4 / OD-7) ----------------------------

/** "Next same weekday" — same time-of-day, seven days on. */
export function nextSameWeekday(task) {
  const target = addDays(task.startTime, 7);
  return { start: target, end: addMinutes(target, task.getDuration()) };
}

/** "Next free slot" — the engine's scored forward-only search, the same one
 *  evacuateDay gives its flexibles. */
export function nextFreeSlot(sched, task, date) {
  const from = dayStart(addDays(date, 1));
  const to = addDays(from, sched.config.maxPlacementLookahead);
  const occupied = occupiedExcluding(sched, task, from, to);
  const best = findBestSlot(sched, task, { from, to, occupied, origin: task.startTime });
  return best ? best.slot : null;
}
