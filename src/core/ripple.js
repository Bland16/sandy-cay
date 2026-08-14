// ripple.js — rippleShift three-stage absorption (SPEC §3.3, case 3B):
// (1) compress downstream breaks to config.breaks.minimum,
// (2) shift movable tasks by the residual,
// (3) overflow (past the day window or a wall) evacuates forward via scoring.
// Fixed/pinned/protected downstream tasks are walls; the wall and everything
// after it stay put.

import { sameDay, addMinutes, minutesBetween, addDays, atTime, dayStart, dayKeyOf } from './time.js';
import { dayWindowBounds, intervalsOf, placeTask, recurrenceIntervals } from './placement.js';

/**
 * Would a task occupying [start, end) intrude on an exclusive zone it doesn't
 * belong to? Mirrors computeWindows' exclusive-hole rule (§1.2): a zone that
 * claims the task routes it IN, so matching tasks are free to sit inside; an
 * exclusive zone reserves its hours against everyone else. Only zones in force
 * on that day count (§1.2 effectiveFrom/effectiveUntil).
 */
function entersExclusiveZone(schedule, task, start, end) {
  const key = dayKeyOf(start);
  const base = dayStart(start);
  for (const z of schedule.zones) {
    if (!z.exclusive || z.matches(task) || !z.activeOn(start)) continue;
    for (const w of z.windowsForDay(key)) {
      const ws = atTime(base, w.start);
      const we = atTime(base, w.end);
      if (start.getTime() < we.getTime() && ws.getTime() < end.getTime()) return true;
    }
  }
  return false;
}

export function rippleShift(schedule, pivotTask, deltaMin) {
  const config = schedule.config;
  const protectedTags = config.protectedTags;
  const pivotEnd = pivotTask.endTime;

  // Downstream same-day tasks (start ≥ pivot end), sorted.
  const downstream = schedule.tasks
    .filter(
      (t) =>
        t !== pivotTask &&
        !t.chunking &&
        !t.recurrence &&
        sameDay(t.startTime, pivotTask.startTime) &&
        t.startTime.getTime() >= pivotEnd.getTime(),
    )
    .sort((a, b) => a.startTime - b.startTime);

  // First wall stops propagation.
  const firstWallIdx = downstream.findIndex((t) => t.isAnchored(protectedTags));
  const affected = firstWallIdx >= 0 ? downstream.slice(0, firstWallIdx) : downstream;
  const wall = firstWallIdx >= 0 ? downstream[firstWallIdx] : null;
  const dayEnd = dayWindowBounds(config, pivotTask.startTime).end;
  const limit = wall ? new Date(Math.min(wall.startTime.getTime(), dayEnd.getTime())) : dayEnd;

  // Stages 1–3, cascaded. Each gap absorbs what it can, in order.
  //
  // Slack lives BETWEEN tasks: the first task can only borrow from the first
  // gap. Pooling the whole chain's slack and shifting everyone by one residual
  // under-shifts the head of the chain and leaves it overlapping the pivot —
  // a silent overlap, which §0 forbids. 3B's "60-min delay with 45 min spare
  // shifts tasks by 15" describes the END of the chain: each gap gives up its
  // 15, so t1 +45, t2 +30, t3 +15, and 45 total is absorbed.
  const minGap = config.breaks.minimum;
  let cursor = addMinutes(pivotEnd, deltaMin); // where the pivot really ends now
  let prevOriginalEnd = pivotEnd;
  let absorbedByBreaks = 0;
  const shifted = [];
  const evacuated = [];

  for (const t of affected) {
    const originalGap = Math.max(0, minutesBetween(prevOriginalEnd, t.startTime));
    const keepGap = Math.min(originalGap, minGap); // never invent a break that wasn't there
    const earliest = addMinutes(cursor, keepGap);
    // Ripple only ever pushes later — a task already clear of the chain stays put.
    const newStart = t.startTime.getTime() >= earliest.getTime() ? t.startTime : earliest;
    const shift = minutesBetween(t.startTime, newStart);
    const newEnd = addMinutes(newStart, t.getDuration());
    prevOriginalEnd = t.endTime;

    // §2.2 is a hard rule: a deadline task may only occupy slots ending ≤ its
    // deadline. A plain shift has no deadline awareness, so rippling could push
    // work past its due date for free and say nothing. Treat that like any other
    // overflow — hand it to placeTask, which honours deadlines and parks with a
    // warning if nothing fits (visible beats invisible).
    const breaksDeadline = t.deadline && newEnd.getTime() > t.deadline.getTime();

    // §2.2 binds ripple too: an exclusive zone reserves its hours for the work
    // it claims, so a plain shift must not nudge a non-matching task into one.
    // The overflow branch already routes around zones (it calls placeTask); the
    // shift branch is pure arithmetic and used to slide a flexible straight into
    // reserved time, silently. Treat it exactly like a broken deadline — hand it
    // to placeTask, which honours the zone. The check lives in the engine on
    // purpose; a fourth UI copy of zone geometry would drift (sharp edges
    // #14/#17). Matching tasks are unaffected — the zone is theirs to sit in.
    const entersZone = entersExclusiveZone(schedule, t, newStart, newEnd);

    // ⚠️ There is deliberately NO blocked-day check here, and the handoff's
    // instruction to add one ("blocked days must join that check or a ripple
    // will slide work onto Christmas") is wrong. Two probes, both above the
    // level of argument:
    //
    //   1. It cannot happen. `downstream` is `sameDay(t, pivotTask)` and
    //      `limit` is capped at that day's window end, so a plain shift never
    //      leaves the pivot's own day. Anything that would has already gone to
    //      the overflow branch below — which calls placeTask, hence
    //      computeWindows, hence honours blocked days. Probed: a next-day task
    //      is never even a candidate for the chain.
    //   2. Adding it does harm. The only case where such a check could fire is
    //      a task ALREADY on a blocked day — which means the user put it there
    //      by hand. Probed with the guard in place: Christmas brunch grows, and
    //      "Board games" is evacuated off Christmas to Friday 08:00. That is
    //      precisely the behaviour D-6 exists to abolish ("blocked means the
    //      scheduler stays out, not that you may not go here") and R-1's manual
    //      autonomy. The zone case is different because a zone is a rule about
    //      HOURS you may not have written for this task; a blocked day is a
    //      rule you wrote about a day, and your own hand outranks it.
    if (shift > 0 && (newEnd.getTime() > limit.getTime() || breaksDeadline || entersZone)) {
      // Overflow (past the wall, the day window, its deadline, or into a zone) → evacuate.
      const from = new Date(pivotEnd.getTime()); // forward-only from the pivot
      const to = addDays(from, config.maxPlacementLookahead);
      const occupied = intervalsOf(
        schedule.tasks.filter((o) => o !== t && !o.chunking && !o.recurrence),
      ).concat(recurrenceIntervals(schedule, from, to)); // occurrences are anchors (§4.4)
      t.history.rippleCount += 1;
      placeTask(schedule, t, { from, to, occupied, origin: t.startTime });
      t.placedBy = 'auto';
      evacuated.push(t);
      continue; // it left the chain — the cursor doesn't advance
    }

    absorbedByBreaks += Math.max(0, originalGap - minutesBetween(cursor, newStart));
    if (shift > 0) {
      t.placeAt(newStart);
      t.history.rippleCount += 1;
      shifted.push(t);
    }
    cursor = newEnd;
  }

  return { shifted, evacuated, absorbedByBreaks };
}
