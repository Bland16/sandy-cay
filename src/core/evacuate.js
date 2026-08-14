// evacuate.js — evacuateDay (SPEC §3.4) and blockRange (SPEC §3.5).

import { sameDay, dayStart, addDays, dateKey } from './time.js';
import { intervalsOf, placeTask, recurrenceIntervals } from './placement.js';

// `createBlocker` lived here and is GONE (D-6). It built a full-day protected
// task to mean "this day is unavailable", which drew a 15-hour card over the
// day's real contents and — because `isHardBlocker` treats a protected task as
// a wall — refused the user's own hand as well as the scheduler's. Blocking is
// now a property of the day (`schedule.blockedDays`).
//
// D-6 kept it alive on paper for §3.9's "protect this gap", but that case never
// used it: `gapActions.js#protectGap` builds its own "Recovery time" via
// addFixed, and rightly, because a protected gap IS a genuine appointment with
// a start and an end. So nothing called this, and a second way to say "blocked"
// is exactly the drifting-duplicate debt this project keeps paying down.

/**
 * Clear a day: flexibles relocate forward-only via scoring; pinned/fixed/
 * protected are surfaced for a human decision.
 * @returns { relocated: Task[], needsReview: Task[], warned: Task[] }
 */
export function evacuateDay(schedule, date, { blockDay = false } = {}) {
  const protectedTags = schedule.config.protectedTags;
  const dayTasks = schedule.tasks.filter(
    (t) => !t.chunking && !t.recurrence && sameDay(t.startTime, date),
  );
  const movable = dayTasks.filter((t) => t.type === 'flexible' && !t.pinned && !t.hasProtectedTag(protectedTags));
  const needsReview = dayTasks.filter((t) => t.isAnchored(protectedTags));

  const relocated = [];
  const warned = [];
  const from = dayStart(addDays(date, 1)); // forward-only — you're sick now
  const to = addDays(from, schedule.config.maxPlacementLookahead);

  for (const t of movable) {
    const occupied = intervalsOf(
      schedule.tasks.filter((o) => o !== t && !o.chunking && !o.recurrence),
    ).concat(recurrenceIntervals(schedule, from, to)); // occurrences are anchors (§4.4)
    const res = placeTask(schedule, t, { from, to, occupied, origin: t.startTime });
    t.placedBy = 'auto';
    relocated.push(t);
    if (res.warning) warned.push(t);
  }

  // Blocking is a STATE of the day now, not a 15-hour task sitting on it
  // (D-6). The old shape drew a full-height card over the day's real contents
  // and — because `isHardBlocker` treats a protected task as a wall — refused
  // your own hand as well as the scheduler's. Blocking the day says only the
  // first of those.
  if (blockDay) markBlocked(schedule, date);

  return { relocated, needsReview, warned };
}

/** Add a day to `schedule.blockedDays`, tolerating a bare test double. */
function markBlocked(schedule, date) {
  if (typeof schedule.blockDay === 'function') return schedule.blockDay(date);
  if (!Array.isArray(schedule.blockedDays)) schedule.blockedDays = [];
  const k = dateKey(date);
  if (!schedule.blockedDays.includes(k)) schedule.blockedDays.push(k);
  return true;
}

/**
 * Block every day in [fromDate, toDate]: mark each one blocked and evacuate the
 * existing flexibles forward.
 *
 * `label` is accepted and ignored, kept so the call sites don't all change at
 * once. A blocked day has no title because it is not a thing on the day — if
 * you want the day to say "Thanksgiving", that is a day NOTE, and the two are
 * deliberately one click apart (§3).
 *
 * @returns string[] the day keys newly blocked
 */
export function blockRange(schedule, fromDate, toDate) {
  const blocked = [];
  let d = dayStart(fromDate);
  const last = dayStart(toDate);
  while (d.getTime() <= last.getTime()) {
    evacuateDay(schedule, d, { blockDay: false });
    markBlocked(schedule, d);
    blocked.push(dateKey(d));
    d = addDays(d, 1);
  }
  return blocked;
}
