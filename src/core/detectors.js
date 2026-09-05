// detectors.js — report/Cabana-only diagnostics (SPEC §7.2) + the one grid-side
// physics notice, overpack (§7.3). Detectors observe; they never nag (P-1).

import {
  dateFromKey,
  dayKeyOf,
  hhmmToMinutes,
  addDays,
} from './time.js';
import { dayGaps } from './queries.js';

/** Pattern start (minutes-since-midnight) for a task's window on a day key. */
function patternStartMin(task, dayKeyStr, date) {
  if (!task.recurrence) return null;
  for (const period of task.recurrence.periods) {
    const from = period.effectiveFrom;
    const until = period.effectiveUntil;
    const t = date.getTime();
    if (from && t < from.getTime()) continue;
    if (until && t >= until.getTime()) continue;
    const w = period.windows.find((win) => win.day === dayKeyStr);
    if (w) return hhmmToMinutes(w.start);
  }
  // Fallback: first period window matching the day.
  for (const period of task.recurrence.periods) {
    const w = period.windows.find((win) => win.day === dayKeyStr);
    if (w) return hhmmToMinutes(w.start);
  }
  return null;
}

/** Drift: ≥driftHits of the last driftN occurrences moved the same direction by
 *  ≥driftMin minutes (SPEC §7.2, 6B). */
export function driftCheck(task, config) {
  const { driftN, driftHits, driftMin } = config.detectors;
  if (!task.recurrence) return { drift: false };
  const deltas = (task.recurrence.exceptions || [])
    .filter((e) => e.action === 'move' && e.start)
    .map((e) => {
      const date = dateFromKey(e.date);
      const ps = patternStartMin(task, dayKeyOf(date), date);
      if (ps == null) return null;
      return { date, delta: hhmmToMinutes(e.start) - ps };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  const recent = deltas.slice(-driftN);
  const later = recent.filter((d) => d.delta >= driftMin).length;
  const earlier = recent.filter((d) => d.delta <= -driftMin).length;
  const sorted = recent.map((d) => d.delta).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  if (later >= driftHits) return { drift: true, direction: 'later', median, count: later };
  if (earlier >= driftHits) return { drift: true, direction: 'earlier', median, count: earlier };
  return { drift: false, median };
}

/** Starvation: displacedCount + carriedCount ≥ threshold (SPEC §7.2, 6D). */
export function starvationCheck(task, config) {
  const total = (task.history.displacedCount || 0) + (task.history.carriedCount || 0);
  return { starving: total >= config.detectors.starvation, count: total };
}

/** Skip-streak: a recurring task whose occurrences were skipped/unrated for
 *  ≥skipStreak consecutive weeks (SPEC §7.2, 6L).
 *  weekStarts: array of week-start Dates, most-recent-first. */
export function skipStreakCheck(schedule, task, weekStarts, config) {
  if (!task.recurrence) return { streak: 0, flag: false };
  let streak = 0;
  for (const ws of weekStarts) {
    const occs = expandFor(schedule, task, ws);
    if (occs.length === 0) break; // no occurrence that week — streak stops
    const allSkippedOrUnrated = occs.every((occ) => {
      const od = task.occurrenceData[occ.occurrenceDate];
      if (od && od.completion === 'skipped') return true;
      if (!od || !od.satisfaction) return true; // unrated
      return false;
    });
    if (allSkippedOrUnrated) streak += 1;
    else break;
  }
  return { streak, flag: streak >= config.detectors.skipStreak };
}

function expandFor(schedule, task, ws) {
  // Local import avoidance: reuse schedule's expansion of THIS task only.
  return schedule._expand(task, ws);
}

/** pinnedRatio observation (SPEC §7.2, 6I). */
export function pinnedRatioNote(weekLoad, config) {
  return {
    ratio: weekLoad.pinnedRatio,
    note: weekLoad.pinnedRatio > config.detectors.pinnedRatioNote,
  };
}

/** Overpack: ≥overpackDays days whose average break ≤ minimum × factor
 *  (SPEC §7.3, 6H). Physics notice — allowed on the grid. */
export function overpackCheck(schedule, weekStartDate, config) {
  const factor = config.detectors.overpackBreakFactor ?? 1.5;
  const threshold = config.breaks.minimum * factor;
  let packedDays = 0;
  const perDay = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStartDate, i);
    // Shared with the report's break-compression stats (§7.1) so the grid
    // notice and the report can never disagree about the same day.
    const gaps = dayGaps(schedule, date, weekStartDate);
    const avgBreak = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    perDay.push({ date: dayKeyOf(date), avgBreak });
    if (avgBreak !== null && avgBreak <= threshold) packedDays += 1;
  }
  return { overpacked: packedDays >= config.detectors.overpackDays, packedDays, perDay, threshold };
}

/**
 * Duration-fit qualitative suggestion (SPEC §7.2, 6K) — no time tracking.
 * If ≥60% of the sessions that ANSWERED the duration question report the same
 * non-zero `durationFit`, suggest adjusting block length.
 *
 * ⚠️ THE DENOMINATOR IS EVERYONE WHO ANSWERED, INCLUDING "JUST RIGHT".
 *
 * This filtered to `durationFit !== 0` and then took 60% OF THAT — so every
 * session the user had explicitly called the right length was excluded from the
 * denominator, and the ratio was computed among the complaints alone. Three
 * "too long" out of twenty sessions became 3/3 = 100%, comfortably over the
 * threshold, and the report told a user their exercise blocks should be shorter
 * when 85% of them had said the length was fine and the mean rating was 4.85.
 *
 * `durationFit: 0` is an ANSWER — the task panel's own word for it is "just
 * right" — not an absence. Dropping it inverted the finding.
 *
 * Returns the counts as well, so the sentence can state its own evidence
 * instead of asserting "most sessions said..." and being wrong about it.
 */
export function durationFitSuggestion(tasks, tag) {
  const answered = tasks.filter(
    (t) => t.tags.includes(tag)
      && t.satisfaction
      && typeof t.satisfaction.durationFit === 'number',
  );
  if (answered.length < 3) return { suggest: false };
  const tooLong = answered.filter((t) => t.satisfaction.durationFit === 1).length;
  const tooShort = answered.filter((t) => t.satisfaction.durationFit === -1).length;
  const total = answered.length;
  if (tooLong / total >= 0.6) {
    return { suggest: true, direction: 'shorter', tag, count: tooLong, total };
  }
  if (tooShort / total >= 0.6) {
    return { suggest: true, direction: 'longer', tag, count: tooShort, total };
  }
  return { suggest: false };
}
