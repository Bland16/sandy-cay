// routines.js — R-B, the routine ENGINE (design/ROUTINES.md).
//
// Three verbs: instantiate a run, re-flow it when a touchpoint moves, and
// suggest a start. Deleting as a group already lives on `Schedule`
// (`removeRoutineInstance`), because it is a collection operation.
//
// ════════════════════════════════════════════════════════════════════════════
// WHY THIS IS SMALL, and why it must stay small
// ════════════════════════════════════════════════════════════════════════════
//
// §"The core insight": the engine ALREADY routes flexible work around anchors.
// So a routine is a chain of small anchored touchpoints with gaps between them,
// and the gaps are ordinary free time the placer already fills. There is no
// "fill the wait" scheduler to write, and writing one would be the mistake:
// dinner and the gym get flexed into the wait by the machinery that exists.
//
// What is genuinely new is ONE primitive — a sequenced group with min-gaps —
// and that is `reflowRoutine` below. Everything else is bookkeeping.
//
// ⚠️ TOUCHPOINTS ARE FIXED ANCHORS, not flexible tasks. `type: 'fixed'` is
// load-bearing: an active touchpoint IS an appointment with the machine, and if
// it were flexible the placer would feel free to move it and the chain's whole
// meaning — "switch the laundry 45 minutes after you loaded it" — would
// evaporate on the next re-optimise.

import { RoutineInstance } from './RoutineInstance.js';
import { Task } from './Task.js';
import { addMinutes, dayStart, addDays } from './time.js';
import { computeWindows, intervalsOf, recurrenceIntervals, subtractIntervals } from './placement.js';

/** Everything already occupying the day, anchors included (sharp edge #3). */
function occupiedBetween(schedule, from, to) {
  return intervalsOf(schedule.tasks.filter((t) => !t.chunking && !t.recurrence))
    .concat(recurrenceIntervals(schedule, from, to));
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Lay a run's touchpoints down from `startTime`.
 *
 * Returns `{ instance, touchpoints, clashes }`. `clashes` names any touchpoint
 * that landed on top of something — it does NOT refuse.
 *
 * ⚠️ IT NEVER REFUSES, and that is Decision 3 read honestly. "An active
 * touchpoint lands like any drop: flexibles route around it, conflicts
 * ripple/displace/warn." A drop is the user's hand, and R-1 says the hand wins
 * — so this reports what it collided with and lets the caller decide, exactly
 * as a manual drop does. Refusing to start your laundry because dinner is in
 * the way is the app overruling you about your own evening.
 */
export function instantiateRoutine(schedule, activity, startTime, opts = {}) {
  const instance = schedule.addRoutineInstance(
    RoutineInstance.fromActivity(activity, startTime, opts.adjust || {}),
  );
  const occupied = occupiedBetween(
    schedule,
    dayStart(startTime),
    addMinutes(startTime, instance.spanMin + 1),
  );

  const touchpoints = [];
  const clashes = [];
  for (const o of instance.offsets()) {
    const start = addMinutes(startTime, o.offsetMin);
    const end = addMinutes(start, o.durationMin);
    const hit = occupied.filter((iv) => overlaps(start, end, iv.start, iv.end));
    const t = new Task({
      // ⚠️ THE STEP'S OWN NAME, not "Laundry — load" (the user's call,
      // 2026-08-17). On the grid a card has room for a few words, and prefixing
      // every touchpoint with the routine spends them all saying the same thing
      // three times over — "Laundry — l…", "Laundry — s…". Which routine it
      // belongs to is carried by `routineId`, and shown by the wait band that
      // links the chain rather than by repeating it in every label.
      title: o.label || instance.label,
      tags: [...(activity.tags || [])],
      // FIXED, not flexible. See the header: a touchpoint is an appointment
      // with a machine, and a placer free to move it dissolves the chain.
      type: 'fixed',
      priority: activity.priority ?? 3,
      startTime: start,
      endTime: end,
      activityId: activity.id,
      routineId: instance.id,
      stepIndex: o.stepIndex,
      ...(activity.load ? { load: activity.load } : {}),
    });
    schedule._uniqueId(t);
    schedule.tasks.push(t);
    occupied.push({ start, end, task: t });
    touchpoints.push(t);
    if (hit.length) clashes.push({ task: t, with: hit.map((iv) => iv.task).filter(Boolean) });
  }
  schedule._touch();
  return { instance, touchpoints, clashes };
}

/**
 * Re-flow a chain after one touchpoint has moved. THE one new primitive.
 *
 * `movedStepIndex` is the step the hand moved (or null to re-flow from the
 * head). Everything BEFORE it is left exactly where it is; everything after is
 * pushed forward far enough to honour each intervening wait's FLOOR.
 *
 * ⚠️ MIN-GAPS ARE ONE-DIRECTIONAL, and this is R-1 and Decision 1 together:
 *
 *   - later is always fine — "you can switch later than 45m if you're busy,
 *     the dry just starts later"
 *   - EARLIER IS PHYSICS — the machine is not finished, so a following
 *     touchpoint is never pulled back to meet a moved one
 *
 * So a touchpoint dragged LATER drags the rest with it; one dragged EARLIER
 * moves alone, and the chain simply has a longer wait in front of it. The
 * second case is the one a naive "recompute all offsets" implementation gets
 * wrong: it would drag the whole chain backwards and switch the laundry before
 * the wash had finished.
 *
 * Returns `{ moved, warnings }`. `warnings` states any wait now running past
 * its `maxWaitMin` — the cold-waffles case. It is a STATEMENT, never a refusal
 * (R-1): "you may always put the shower there and eat cold waffles."
 */
export function reflowRoutine(schedule, routineId, opts = {}) {
  const instance = schedule.routineInstances.find((r) => r.id === routineId);
  if (!instance) return { moved: [], warnings: [] };
  const chain = schedule.touchpointsFor(routineId);
  if (!chain.length) return { moved: [], warnings: [] };

  const offsets = instance.offsets();
  const offsetFor = new Map(offsets.map((o) => [o.stepIndex, o]));
  const pivot = opts.movedStepIndex ?? chain[0].stepIndex;
  const pivotAt = chain.findIndex((t) => t.stepIndex === pivot);
  const from = pivotAt < 0 ? 0 : pivotAt;

  const moved = [];
  const warnings = [];
  for (let i = from + 1; i < chain.length; i += 1) {
    const prev = chain[i - 1];
    const cur = chain[i];
    const prevOff = offsetFor.get(prev.stepIndex);
    const curOff = offsetFor.get(cur.stepIndex);
    if (!prevOff || !curOff) continue;
    // The wait between them, as programmed: the distance between their offsets
    // minus however long the earlier touchpoint itself runs.
    const gapMin = curOff.offsetMin - (prevOff.offsetMin + prevOff.durationMin);
    const earliest = addMinutes(prev.endTime, gapMin);

    if (cur.startTime.getTime() < earliest.getTime()) {
      const dur = cur.getDuration();
      cur.startTime = earliest;
      cur.endTime = addMinutes(earliest, dur);
      moved.push(cur);
    }
  }

  // ⚠️ WARNINGS SCAN THE WHOLE CHAIN, not just the part that was pushed.
  //
  // They used to be collected inside the loop above, which starts AFTER the
  // pivot — so dragging a touchpoint later checked the waits behind it and
  // missed the one it had actually stretched. Dragging "switch" from 09:47 to
  // 11:00 grows the WASH, the wait BEFORE it, and that overrun went unreported.
  // Found by its own test.
  //
  // A warning is a statement about the chain as it now stands, not about the
  // move, so the right scope is every pair. Re-read the chain, because the push
  // above has moved things.
  const after = schedule.touchpointsFor(routineId);
  for (let i = 1; i < after.length; i += 1) {
    const prev = after[i - 1];
    const cur = after[i];
    if (!prev.endTime || !cur.startTime) continue;
    const wait = instance.steps.find((s, si) => s.kind === 'passive'
      && si > prev.stepIndex && si < cur.stepIndex && s.maxWaitMin !== null);
    if (!wait) continue;
    // Whatever the gap actually is now — it may be far larger, because the hand
    // is free to leave it so, and R-1 says the hand wins.
    const actualGap = Math.round((cur.startTime.getTime() - prev.endTime.getTime()) / 60000);
    if (actualGap > wait.maxWaitMin) {
      warnings.push({
        stepIndex: cur.stepIndex,
        label: wait.label,
        waitedMin: actualGap,
        maxWaitMin: wait.maxWaitMin,
      });
    }
  }
  if (moved.length) schedule._touch();
  return { moved, warnings };
}

/**
 * The WAITS of every routine, as real intervals, for a date range.
 *
 * ⚠️ DERIVED FROM THE TOUCHPOINTS ON THE GRID, not from the stored offsets. The
 * gap between two touchpoints is whatever it actually is — including after you
 * dragged one — so a band can never claim a wait the grid does not have. That is
 * the hybrid doing its job: the program says what was intended, the tasks say
 * where things are, and the band is drawn from the tasks.
 *
 * ⚠️ ONE implementation, in core, because THREE surfaces want it (week grid, day
 * view, weekend drawer). `zoneBands` is the cautionary tale — reimplemented per
 * surface, it painted zones into weeks the scheduler correctly saw as free
 * (sharp edge #14).
 *
 * `overrun` is TRUE when the gap has grown past the wait's `maxWaitMin`. It is a
 * STATEMENT, never a constraint (R-1): the band is drawn either way, and a task
 * may always be placed inside it.
 *
 * @returns {Array<{routineId, label, from, to, minWaitMin, maxWaitMin, overrun}>}
 */
export function routineWaits(schedule, from, to) {
  const out = [];
  for (const inst of schedule.routineInstances || []) {
    const chain = schedule.touchpointsFor(inst.id);
    for (let i = 1; i < chain.length; i += 1) {
      const prev = chain[i - 1];
      const cur = chain[i];
      if (!prev.endTime || !cur.startTime) continue;
      if (cur.startTime <= prev.endTime) continue; // dragged over it — no wait left
      if (to && prev.endTime >= to) continue;
      if (from && cur.startTime <= from) continue;
      // The programmed wait sitting between these two steps, if any.
      const step = inst.steps.find((st, si) => st.kind === 'passive'
        && si > prev.stepIndex && si < cur.stepIndex);
      if (!step) continue;
      const gapMin = Math.round((cur.startTime.getTime() - prev.endTime.getTime()) / 60000);
      out.push({
        routineId: inst.id,
        label: step.label || 'wait',
        from: new Date(prev.endTime.getTime()),
        to: new Date(cur.startTime.getTime()),
        minWaitMin: step.durationMin,
        maxWaitMin: step.maxWaitMin,
        overrun: step.maxWaitMin != null && gapMin > step.maxWaitMin,
      });
    }
  }
  return out;
}

/**
 * The best start for a routine — Decision 3's "the engine can also SUGGEST".
 *
 * Walks forward from `from` and returns the first moment where every ACTIVE
 * touchpoint lands in open time. The waits deliberately are NOT required to be
 * free: being free during them is the entire point, and demanding an empty
 * two-hour stretch for a laundry would refuse almost every real evening.
 *
 * ⚠️ That is also what makes concurrency free (§"Concurrency falls out"): run
 * the dishwasher while the oven preheats and the two waits simply overlap. Only
 * the tiny touchpoints are anchors, and they only have to miss each other.
 *
 * Returns null if nothing fits inside `withinDays` — a suggestion may honestly
 * have none, and inventing one would be worse than saying so.
 */
export function suggestRoutineStart(schedule, activity, from, opts = {}) {
  const withinDays = opts.withinDays ?? 3;
  const stepMin = opts.stepMin ?? 15;
  const probe = RoutineInstance.fromActivity(activity, from, opts.adjust || {});
  const offsets = probe.offsets();
  if (!offsets.length) return null;

  const until = addDays(dayStart(from), withinDays + 1);
  const occupied = occupiedBetween(schedule, dayStart(from), until);

  for (let d = 0; d <= withinDays; d += 1) {
    const day = addDays(dayStart(from), d);
    // `computeWindows` is the door — it already subtracts zones, blocked days
    // and the sleep guard, so a run that starts inside one is a run the rest of
    // the app agrees is legal.
    const windows = computeWindows(schedule, { tags: activity.tags || [] }, day);
    const free = subtractIntervals(windows, occupied.filter(
      (iv) => iv.end > day && iv.start < addDays(day, 1),
    ));
    for (const run of free) {
      let cursor = run.start.getTime() < from.getTime() ? new Date(from.getTime()) : new Date(run.start.getTime());
      while (cursor.getTime() < run.end.getTime()) {
        const ok = offsets.every((o) => {
          const s = addMinutes(cursor, o.offsetMin);
          const e = addMinutes(s, o.durationMin);
          return !occupied.some((iv) => overlaps(s, e, iv.start, iv.end));
        });
        if (ok) return new Date(cursor.getTime());
        cursor = addMinutes(cursor, stepMin);
      }
    }
  }
  return null;
}
