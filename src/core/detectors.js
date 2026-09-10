// detectors.js — report/Cabana-only diagnostics (SPEC §7.2) + the one grid-side
// physics notice, overpack (§7.3). Detectors observe; they never nag (P-1).

import {
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

/**
 * Drift: ≥driftHits of the last driftN OCCURRENCES started ≥driftMin minutes off
 * the pattern, in the same direction (SPEC §7.2, 6B).
 *
 * ⚠️ THE DENOMINATOR WAS THE MOVES, NOT THE SESSIONS — the same defect that
 * made "exercise blocks may want to be shorter" fire on three complaints out of
 * twenty. This built its sample from `recurrence.exceptions` filtered to
 * `action === 'move'`, so ONLY sessions the user had dragged could enter it.
 * Twenty sessions of which four were moved gave a sample of four, all four
 * counted as drift, and `4 >= driftHits` fired — while the sixteen that started
 * exactly where the pattern said were invisible to the arithmetic. A session
 * that ran on time is evidence ABOUT the pattern, and it was being discarded for
 * being unremarkable.
 *
 * Occurrences are the sample now, and one that was never moved carries a delta
 * of ZERO rather than being absent. That also bounds the finding in TIME: it
 * reads the last `driftN` occurrences out of the weeks handed in, so four moves
 * from last year can no longer produce a finding about this month.
 *
 * `total` is returned because a sentence has to be able to state its own
 * evidence. The report printed "N of the last {config.driftN}" — the CONSTANT,
 * not the sample — so with four moves on record it asserted a fifth session that
 * did not exist.
 *
 * ⚠️ A session relocated to another DATE is still measured against its own
 * pattern window's time of day. Drift is a claim about the CLOCK ("you keep
 * starting this later"), so that is the right comparison; which day it landed on
 * is `skipStreakCheck`'s business, not this one's.
 */
export function driftCheck(schedule, task, weekStarts, config) {
  const { driftN, driftHits, driftMin } = config.detectors;
  if (!task.recurrence) return { drift: false, total: 0 };

  // Keyed by occurrence identity, so one session cannot be counted twice when
  // two of the supplied weeks overlap it.
  const seen = new Map();
  for (const ws of weekStarts) {
    for (const occ of schedule._expand(task, ws)) {
      const at = occ.startTime;
      const ps = patternStartMin(task, dayKeyOf(at), at);
      if (ps == null) continue;
      const actual = at.getHours() * 60 + at.getMinutes();
      seen.set(occ.id, { at: at.getTime(), delta: actual - ps });
    }
  }
  const deltas = [...seen.values()].sort((a, b) => a.at - b.at);

  const recent = deltas.slice(-driftN);
  const total = recent.length;
  const later = recent.filter((d) => d.delta >= driftMin).length;
  const earlier = recent.filter((d) => d.delta <= -driftMin).length;
  const sorted = recent.map((d) => d.delta).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  if (later >= driftHits) return { drift: true, direction: 'later', median, count: later, total };
  if (earlier >= driftHits) return { drift: true, direction: 'earlier', median, count: earlier, total };
  return { drift: false, median, total };
}

/** Starvation: displacedCount + carriedCount ≥ threshold (SPEC §7.2, 6D). */
export function starvationCheck(task, config) {
  const total = (task.history.displacedCount || 0) + (task.history.carriedCount || 0);
  return { starving: total >= config.detectors.starvation, count: total };
}

/**
 * Skip-streak: a recurring task EXPLICITLY skipped for ≥skipStreak consecutive
 * weeks (SPEC §7.2, 6L). weekStarts: week-start Dates, most-recent-first.
 *
 * ⚠️ AN UNRATED SESSION IS NOT A SESSION THAT DID NOT HAPPEN. This counted a
 * week when every occurrence was `skipped` OR CARRIED NO RATING — and the
 * report prints the result as a statement of fact: "Gym hasn't happened in 3
 * weeks", with "Let it go" beside it. Rating is optional everywhere else in this
 * app; here its absence was read as absence of the event, so three sessions the
 * user went to and simply never opened the panel for produced the identical
 * sentence to three they skipped. Telling someone their gym has not happened,
 * when it has, is the plainest P-1 breach available.
 *
 * The three states are not two:
 *
 *   `skipped`          it did not happen.        Evidence. Extends the streak.
 *   `done` / `partial` it happened.              Evidence. Ends the streak.
 *   no record at all   WE DO NOT KNOW.           Not evidence of absence.
 *
 * An unknown ends the streak, because a claim needs something behind it and
 * silence is the honest output when nothing is. That does make the detector
 * quiet for someone who never marks anything — correctly so: it cannot tell
 * them what it does not know, and the offer to end a pattern must rest on
 * something true. SPEC §7.2 asks only for "≥3 weeks"; "unrated counts as
 * skipped" was a choice made here, not in the plan.
 */
export function skipStreakCheck(schedule, task, weekStarts, config) {
  if (!task.recurrence) return { streak: 0, flag: false };
  let streak = 0;
  for (const ws of weekStarts) {
    const occs = expandFor(schedule, task, ws);
    if (occs.length === 0) break; // no occurrence that week — streak stops
    const allSkipped = occs.every((occ) => {
      const od = task.occurrenceData[occ.occurrenceDate];
      return !!od && od.completion === 'skipped';
    });
    if (allSkipped) streak += 1;
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
export function durationFitSuggestion(tasks, tag, config = null) {
  const det = (config && config.detectors) || {};
  const floor = det.durationFitMin ?? 6;
  const contentAt = det.durationFitContentAt ?? 4;
  const answered = tasks.filter(
    (t) => t.tags.includes(tag)
      && t.satisfaction
      && Number.isFinite(t.satisfaction.durationFit),
  );
  // ⚠️ THE FLOOR WAS 3, BESIDE A 60% BAR. Two out of three cleared it, and that
  // is precisely what shipped — "break 2 of 3", "exercise 3 of 4", "social 3 of
  // 5", every one of them reported as unfounded. The ratio was never the
  // problem. There was almost nothing behind it.
  if (answered.length < floor) return { suggest: false };

  // ⚠️ AND IT DOES NOT SECOND-GUESS SOMETHING YOU ARE ENJOYING (user's call,
  // 2026-09-10). The reported case: three of four exercise sessions said the
  // block ran long, while every one was rated 4–5 shells and usually energizing.
  // "Ran long" beside a five-shell rating is an observation about the clock, not
  // a complaint about the activity — and telling someone to cut short the thing
  // they rate highest is the shape of advice P-1 exists to prevent.
  //
  // Measured over the SESSIONS THAT ANSWERED, not every rating for the tag: the
  // question is whether the blocks being judged were good ones.
  const overalls = answered
    .map((t) => t.satisfaction.overall)
    .filter((v) => Number.isFinite(v));
  if (overalls.length) {
    const mean = overalls.reduce((n, v) => n + v, 0) / overalls.length;
    if (mean >= contentAt) return { suggest: false, content: true, meanOverall: mean };
  }

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
