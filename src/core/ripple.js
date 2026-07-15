// ripple.js — rippleShift three-stage absorption (SPEC §3.3, case 3B):
// (1) compress downstream breaks to config.breaks.minimum,
// (2) shift movable tasks by the residual,
// (3) overflow (past the day window or a wall) evacuates forward via scoring.
// Fixed/pinned/protected downstream tasks are walls; the wall and everything
// after it stay put.

import { sameDay, addMinutes, minutesBetween, addDays } from './time.js';
import { dayWindowBounds, intervalsOf, placeTask } from './placement.js';

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

  // Stage 1: compressible break slack before the wall.
  let compressible = 0;
  let prevEnd = pivotEnd;
  for (const t of affected) {
    const gap = minutesBetween(prevEnd, t.startTime);
    compressible += Math.max(0, gap - config.breaks.minimum);
    prevEnd = t.endTime;
  }
  const absorbedByBreaks = Math.min(deltaMin, compressible);
  const residual = deltaMin - absorbedByBreaks;

  // Stages 2 & 3.
  const shifted = [];
  const evacuated = [];
  for (const t of affected) {
    const newStart = addMinutes(t.startTime, residual);
    const newEnd = addMinutes(newStart, t.getDuration());
    if (residual > 0 && newEnd.getTime() > limit.getTime()) {
      // Overflow → evacuate forward via scored placement.
      const occupied = intervalsOf(
        schedule.tasks.filter((o) => o !== t && !o.chunking && !o.recurrence),
      );
      const from = new Date(pivotEnd.getTime()); // forward-only from the pivot
      const to = addDays(from, config.maxPlacementLookahead);
      t.history.rippleCount += 1;
      placeTask(schedule, t, { from, to, occupied, origin: t.startTime });
      t.placedBy = 'auto';
      evacuated.push(t);
    } else if (residual > 0) {
      t.placeAt(newStart);
      t.history.rippleCount += 1;
      shifted.push(t);
    }
  }

  return { shifted, evacuated, absorbedByBreaks };
}
