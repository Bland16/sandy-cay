// interaction.js — the engine-facing half of drag/resize (M2.1).
//
// Pure JS, no DOM: everything here is "given the schedule and a proposed new
// span, what does the engine say?". The pointer/geometry half lives in
// useCardInteraction.js. Split this way so the physics is unit-testable.
//
// Contracts honoured here:
//   §3.1 resolveDropConflicts — the engine decides reject-vs-displace; we never
//        re-implement its verdict, we only pre-classify blockers to know whether
//        a chooser is even possible (a rejection must not displace anything).
//   §3.2 chooseConflictStrategy — dayState is computed from the real day, using
//        the same arithmetic rippleShift itself uses (see affectedChain).
//   §3.3 rippleShift — called with the pivot's *pre-change* end, because the
//        engine defines "downstream" as start >= pivot.endTime.
//   §2.4 autoSchedule is never called from a drag.

import {
  sameDay,
  addDays,
  minutesBetween,
  dayStart,
  weekStart as weekStartOf,
  expandRecurrence,
  findBestSlot,
  dayWindowBounds,
  intervalsOf,
} from '../core/index.js';

export const SNAP_MIN = 15; // OD-1 / §3.1 — 15-minute snap for drops and resizes
export const MIN_DURATION_MIN = 15; // OD-1 — the wave/sand borders can't cross

/** Snap a minute-of-day to the 15-minute grid. */
export function snapTo(min, snap = SNAP_MIN) {
  return Math.round(min / snap) * snap;
}

/** A date at `minutes` past midnight on `day`. */
export function atMinutes(day, minutes) {
  const d = new Date(day.getTime());
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

/**
 * Every task that would overlap [start, end) — real tasks plus materialized
 * recurrence occurrences, minus `task` itself. Mirrors the blocker scan inside
 * resolveDropConflicts so our pre-classification matches the engine's verdict.
 */
export function findBlockers(sched, task, start, end) {
  if (end.getTime() <= start.getTime()) return [];
  const ws = weekStartOf(start);
  const out = [];
  const hits = (t) => t.startTime.getTime() < end.getTime() && start.getTime() < t.endTime.getTime();
  for (const t of sched.tasks) {
    if (t.chunking) continue; // bookkeeping parent, not a grid object
    if (t.id === task.id) continue;
    if (t.recurrence) {
      for (const occ of expandRecurrence(t, ws)) if (hits(occ)) out.push(occ);
    } else if (hits(t)) {
      out.push(t);
    }
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

/** 7B: fixed / pinned / protected reject the drop. Occurrences are anchors too
 *  (§4.4), so they belong on this side of the classification — but the engine
 *  does NOT simply reject them: resolveDropConflicts answers an occurrence with
 *  `{ occurrenceMenu: true }`, and the caller opens the 4C menu. What "hard"
 *  buys us either way is that the chooser is skipped and the engine's verdict
 *  is asked for before anything is displaced. */
export function isHardBlocker(sched, t) {
  return t.isOccurrence === true || t.isAnchored(sched.config.protectedTags);
}

/** The word §3.1's toast uses for a blocker. */
export function blockerKind(sched, t) {
  if (t.isOccurrence) return 'recurring';
  if (t.pinned) return 'pinned';
  if (t.type === 'fixed') return 'fixed';
  if (t.hasProtectedTag(sched.config.protectedTags)) return 'protected';
  return 'flexible';
}

/**
 * The chain rippleShift would actually touch, computed identically to the
 * engine: same-day movable tasks starting at/after `effEnd`, cut at the first
 * wall (fixed/pinned/protected).
 */
export function affectedChain(sched, pivot, effEnd) {
  const protectedTags = sched.config.protectedTags;
  const down = sched.tasks
    .filter(
      (t) =>
        t !== pivot &&
        t.id !== pivot.id &&
        !t.chunking &&
        !t.recurrence &&
        sameDay(t.startTime, pivot.startTime) &&
        t.startTime.getTime() >= effEnd.getTime(),
    )
    .sort((a, b) => a.startTime - b.startTime);
  const wallIdx = down.findIndex((t) => t.isAnchored(protectedTags));
  return {
    affected: wallIdx >= 0 ? down.slice(0, wallIdx) : down,
    wall: wallIdx >= 0 ? down[wallIdx] : null,
  };
}

/**
 * displaceMoveMin — the score-loss proxy §3.2 asks for: how far the evicted
 * task(s) would actually travel. Asked of the engine (findBestSlot with the
 * same from/to/occupied resolveDropConflicts would use), never guessed.
 */
export function estimateDisplaceMoveMin(sched, pivot, blockers) {
  const movable = blockers.filter((t) => !isHardBlocker(sched, t));
  if (!movable.length) return 0;
  const ws = weekStartOf(pivot.startTime);
  const occurrences = intervalsOf(
    sched.tasks.filter((t) => t.recurrence).flatMap((t) => expandRecurrence(t, ws)),
  );
  let total = 0;
  for (const target of movable) {
    const occupied = intervalsOf(
      sched.tasks.filter(
        (t) => !t.chunking && !t.recurrence && t.id !== target.id && t.id !== pivot.id,
      ),
    )
      .concat(occurrences)
      .concat([{ start: pivot.startTime, end: pivot.endTime, task: pivot }]);
    const from = dayStart(target.startTime);
    const to = addDays(from, sched.config.maxPlacementLookahead);
    const best = findBestSlot(sched, target, { from, to, occupied, origin: target.startTime });
    // No slot at all is the worst case displacement can offer: the whole horizon.
    total += best
      ? Math.abs(minutesBetween(target.startTime, best.slot.start))
      : sched.config.maxPlacementLookahead * 24 * 60;
  }
  return Math.round(total);
}

/**
 * The explicit dayState contract chooseConflictStrategy expects (§3.2), read off
 * the real day. `effEnd` is the point the ripple would start from.
 */
export function buildDayState(sched, pivot, effEnd, blockers = []) {
  const cfg = sched.config;
  const { affected, wall } = affectedChain(sched, pivot, effEnd);

  // spareBreakMin — stage 1 of rippleShift, same arithmetic.
  let spareBreakMin = 0;
  let prevEnd = effEnd;
  for (const t of affected) {
    spareBreakMin += Math.max(0, minutesBetween(prevEnd, t.startTime) - cfg.breaks.minimum);
    prevEnd = t.endTime;
  }

  // tailRoomMin — free minutes between the chain's tail and the day end (or wall).
  const dayEnd = dayWindowBounds(cfg, pivot.startTime).end;
  const limit = wall
    ? new Date(Math.min(wall.startTime.getTime(), dayEnd.getTime()))
    : dayEnd;
  const tailRoomMin = Math.max(0, minutesBetween(prevEnd, limit));

  // taskMin — typical downstream duration, used for the evacuation count.
  const taskMin = affected.length
    ? Math.round(affected.reduce((s, t) => s + t.getDuration(), 0) / affected.length)
    : cfg.defaultDuration;

  return {
    downstreamCount: affected.length,
    spareBreakMin,
    tailRoomMin,
    taskMin: taskMin || cfg.defaultDuration,
    displaceMoveMin: estimateDisplaceMoveMin(sched, pivot, blockers),
  };
}

/**
 * Ripple, expressed the way the engine wants it. rippleShift defines downstream
 * as `start >= pivot.endTime`, so the tasks a drop/resize just landed on top of
 * are invisible to it once the change is applied. We therefore hand it the
 * pivot's *effective* pre-change end for the duration of the call, then restore.
 *
 * The trailing resolveDropConflicts is an integrity pass, not a second strategy:
 * rippleShift's break absorption is aggregate (it shifts the whole chain by one
 * residual), so an over-absorbed chain can leave the pivot still overlapping.
 * When that happens the leftovers are evicted by the engine rather than left as
 * a silent overlap. On a clean ripple it finds nothing and no-ops.
 */
export function commitRipple(sched, pivot, effEnd, deltaMin) {
  const savedEnd = pivot.endTime;
  let res;
  try {
    pivot.endTime = new Date(effEnd.getTime());
    res = sched.rippleShift(pivot, deltaMin);
  } finally {
    pivot.endTime = savedEnd;
  }
  const cleanup = sched.resolveDropConflicts(pivot);
  return { ...res, cleanup };
}

/** Displace — §3.1 nearest-slot eviction, straight from the engine. */
export function commitDisplace(sched, pivot) {
  return sched.resolveDropConflicts(pivot);
}

/**
 * Where a recurring session could go instead, when a one-off is dropped on it
 * (§4C: "the occurrence relocates via scored placement, same-day preferred").
 *
 * Same-day preference is not a special case here — it falls out of the score's
 * proximity term, measured from the session's own start. `dropped` is already
 * sitting in the slot by the time this runs, so it is part of `occupied` and
 * the session cannot be handed back the ground it just lost.
 *
 * @returns {{start: Date, end: Date}} | null — null means "nowhere to move it",
 *          which the menu shows rather than inventing a slot.
 */
export function proposeOccurrenceSlot(sched, occ) {
  const from = dayStart(occ.startTime);
  const to = addDays(from, sched.config.maxPlacementLookahead);
  const reals = intervalsOf(sched.tasks.filter((t) => !t.chunking && !t.recurrence));
  const occs = [];
  const seen = new Set();
  // The lookahead can cross a week boundary; expand every week it touches.
  for (let ws = weekStartOf(from); ws.getTime() <= to.getTime(); ws = addDays(ws, 7)) {
    for (const t of sched.tasks) {
      if (!t.recurrence) continue;
      for (const o of expandRecurrence(t, ws)) {
        if (o.id === occ.id || seen.has(o.id)) continue;
        seen.add(o.id);
        occs.push({ start: o.startTime, end: o.endTime, task: o });
      }
    }
  }
  const best = findBestSlot(sched, occ, {
    from,
    to,
    occupied: reals.concat(occs),
    origin: occ.startTime,
  });
  return best ? best.slot : null;
}

/** Snapshot / restore for snap-back (Esc, or a rejected drop). */
export function snapshotSpan(task) {
  return {
    startTime: new Date(task.startTime.getTime()),
    endTime: new Date(task.endTime.getTime()),
    placedBy: task.placedBy,
    moveCount: task.history.moveCount,
  };
}

export function restoreSpan(task, snap) {
  task.startTime = new Date(snap.startTime.getTime());
  task.endTime = new Date(snap.endTime.getTime());
  task.placedBy = snap.placedBy;
  task.history.moveCount = snap.moveCount;
  return task;
}
