// rollover.js — the "week closes" moment (R-7 / SPEC §7.1).
//
// R-7 describes rollover as one moment bundling retrain + carryOver + the Wrap
// report. It is deliberately NOT all three here: carryOver relocates a real
// person's unfinished work, and doing that unasked while they were away is the
// exact surprise P-1 exists to prevent. §3.6 already gives carryOver a consented
// home (the past-week banner's equal-weight "Carry forward / Let them go"), and
// that stays its only trigger. Rollover retrains and OFFERS the report; the user
// decides the rest.
//
// Detection is pure: `now` is always injected, never read from the wall clock,
// so the whole flow is testable (sharp edge #8).

import { weekStart as weekStartOf, dateKey, dateFromKey, addDays } from './time.js';

/**
 * Has a week closed since the user was last here?
 *
 * Returns `closedWeek` = the week the user was LAST SEEN in, not literally
 * "now minus one week". In the ordinary case (used it last week, opens it on
 * Monday) those are the same week. They differ only when the user has been away,
 * and then last-seen is the better answer: a report about the fortnight you were
 * on holiday is an empty page, while a report about the last week you actually
 * lived is worth reading. One offer, whatever the gap.
 *
 * @returns {{ rolled: boolean, firstRun: boolean, closedWeek: Date|null, weeksAway: number }}
 */
export function checkRollover(schedule, now) {
  const current = weekStartOf(now);
  const lastKey = schedule.lastSeenWeek;

  // First-ever run: there is no closed week, only a starting point. Recording it
  // is all that happens — a wrap report on a week the user never used is the
  // "empty week with dignity" case at its very worst.
  if (!lastKey) return { rolled: false, firstRun: true, closedWeek: null, weeksAway: 0 };

  const last = dateFromKey(lastKey);
  if (current.getTime() <= last.getTime()) {
    // Same week, or the user is browsing a past week — not a rollover.
    return { rolled: false, firstRun: false, closedWeek: null, weeksAway: 0 };
  }

  const weeksAway = Math.round((current.getTime() - last.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return { rolled: true, firstRun: false, closedWeek: last, weeksAway };
}

/**
 * Close the week: retrain, then record. Order matters — R-7 is explicit that the
 * model trains BEFORE the report renders, so the report's insights are the
 * freshest ones rather than last week's.
 *
 * Recording `lastSeenWeek` is unconditional and happens even when nothing else
 * does: an un-recorded rollover re-fires on every reload, which would turn a
 * gentle weekly offer into a nag.
 *
 * @returns {{ closedWeek: Date|null, sampleCount: number }}
 */
export function commitRollover(schedule, now) {
  const { closedWeek } = checkRollover(schedule, now);
  const sampleCount = schedule.retrain();
  schedule.markWeekSeen(now);
  return { closedWeek, sampleCount };
}

/** The Monday after a given week — used to label "the week that just closed". */
export function weekAfter(weekStartDate) {
  return addDays(weekStartOf(weekStartDate), 7);
}

/** dateKey of the week containing `date`. */
export function weekKeyOf(date) {
  return dateKey(weekStartOf(date));
}
