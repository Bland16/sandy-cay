// conflicts.js — drop-conflict resolution (SPEC §3.1) and the magnitude-aware
// ripple/displace chooser (SPEC §3.2, OD-8).

import { weekStart as weekStartOf, addDays, dayStart } from './time.js';
import { placeTask, intervalsOf } from './placement.js';
import { expandRecurrence } from './recurrence.js';

/**
 * Resolve conflicts created by dropping/placing `droppedTask`.
 * R-1: the dropped task wins by the user's action; priority is NOT compared.
 * @returns { displaced: Task[], warned: Task[], rejected?: bool, snapBack?: bool,
 *            reason?: string, occurrenceMenu?: bool, occurrence?: Task,
 *            options?: string[] }
 */
export function resolveDropConflicts(schedule, droppedTask, opts = {}) {
  const protectedTags = schedule.config.protectedTags;
  const ws = weekStartOf(droppedTask.startTime);

  // Blocking tasks: real tasks + recurrence occurrences for the week, minus the
  // dropped task itself.
  const blockers = [];
  for (const t of schedule.tasks) {
    if (t === droppedTask || t.id === droppedTask.id) continue;
    if (t.chunking) continue;
    if (t.recurrence) {
      for (const occ of expandRecurrence(t, ws)) {
        if (occ.overlaps(droppedTask)) blockers.push(occ);
      }
    } else if (t.overlaps(droppedTask)) {
      blockers.push(t);
    }
  }

  const displaced = [];
  const warned = [];

  for (const target of blockers) {
    // Recurring occurrence target → occurrence menu, no silent default (§3.1/4C).
    if (target.isOccurrence) {
      return { displaced, warned, occurrenceMenu: true, occurrence: target, options: ['move', 'skip', 'cancel'] };
    }
    // Pinned / fixed / protected → reject the drop (snap-back).
    if (target.isAnchored(protectedTags)) {
      const kind = target.pinned ? 'pinned' : target.type === 'fixed' ? 'fixed' : 'protected';
      return { displaced, warned, rejected: true, snapBack: true, reason: `Conflicts with ${kind}: ${target.title}` };
    }
  }

  // No rejection → evict every flexible/unpinned overlap and re-place it.
  for (const target of blockers) {
    if (target.isAnchored(protectedTags)) continue;
    // Rebuilt EVERY pass, deliberately. intervalsOf snapshots the Date objects,
    // and placeTask assigns fresh ones when it re-places a task — so a snapshot
    // taken before this loop still describes the slot the previous evictee just
    // vacated, and every later evictee is placed blind on top of it. evacuate.js
    // and carryOver.js already recompute inside their loops; this must too.
    const others = intervalsOf(
      schedule.tasks.filter((t) => t !== droppedTask && !t.chunking && !t.recurrence),
    ).concat(
      schedule.tasks.filter((t) => t.recurrence).flatMap((t) => intervalsOf(expandRecurrence(t, ws))),
    );
    // occupied = everyone except the evicted target, including the dropped task.
    const occupied = others
      .filter((iv) => iv.task !== target && iv.task.id !== target.id)
      .concat([{ start: droppedTask.startTime, end: droppedTask.endTime, task: droppedTask }]);
    const from = opts.from ? new Date(opts.from) : dayStart(target.startTime);
    const to = opts.to ? new Date(opts.to) : addDays(from, schedule.config.maxPlacementLookahead);
    target.history.displacedCount += 1;
    const res = placeTask(schedule, target, { from, to, occupied, origin: target.startTime });
    target.placedBy = 'auto';
    displaced.push(target);
    if (res.warning) warned.push(target);
  }

  return { displaced, warned };
}

/**
 * Decide ripple vs displace (OD-8). Cause sets the bias, magnitude can flip it.
 *
 * dayState = {
 *   downstreamCount,   // movable tasks downstream of the pivot
 *   spareBreakMin,     // compressible break padding downstream (above minimum)
 *   tailRoomMin,       // free minutes between last downstream task and day end
 *   taskMin,           // typical downstream task duration (for evac count)
 *   displaceMoveMin,   // estimated minutes the evicted task(s) travel (score-loss proxy)
 *   evacuationPenalty  // optional override of config.evacuationPenalty
 * }
 */
export function strategyCosts(cause, deltaMin, dayState, config) {
  const penalty = dayState.evacuationPenalty ?? config.evacuationPenalty;
  const bias = config.strategyBias ?? 0.8;
  const downstreamCount = dayState.downstreamCount ?? 0;
  const taskMin = dayState.taskMin ?? 60;

  const residual = Math.max(0, deltaMin - (dayState.spareBreakMin ?? 0));
  const overflow = Math.max(0, residual - (dayState.tailRoomMin ?? 0));
  const evac = overflow > 0 ? Math.ceil(overflow / taskMin) : 0;
  const shiftMin = residual * downstreamCount;
  let ripple = shiftMin + evac * penalty;
  let displace = dayState.displaceMoveMin ?? 0;

  if (cause === 'resize') ripple *= bias;
  else if (cause === 'drop') displace *= bias;

  return { ripple, displace };
}

export function chooseConflictStrategy(cause, deltaMin, dayState, config) {
  const { ripple, displace } = strategyCosts(cause, deltaMin, dayState, config);
  return ripple <= displace ? 'ripple' : 'displace';
}
