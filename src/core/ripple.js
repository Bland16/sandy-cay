// ripple.js — rippleShift three-stage absorption (SPEC §3.3, case 3B):
// (1) compress downstream breaks to config.breaks.minimum,
// (2) shift movable tasks by the residual,
// (3) overflow (past the day window or a wall) evacuates forward via scoring.
// Fixed/pinned/protected downstream tasks are walls; the wall and everything
// after it stay put.

import { sameDay, addMinutes, minutesBetween, addDays } from './time.js';
import { dayWindowBounds, intervalsOf, placeTask, recurrenceIntervals } from './placement.js';

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

    if (shift > 0 && (newEnd.getTime() > limit.getTime() || breaksDeadline)) {
      // Overflow (past the wall, the day window, or its deadline) → evacuate.
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
