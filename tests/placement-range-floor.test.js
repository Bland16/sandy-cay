// A new task's search range is a CEILING, never a floor below the engine's own
// horizon (`config.maxPlacementLookahead`).
//
// Reported 2026-08-30 from the live app, with a screenshot: a flexible task
// added on the Sunday, deadline the following Thursday, landed at the tail end
// of that Sunday — a day already wall-to-wall — sitting ON TOP of two existing
// tasks, neither of which moved.
//
// Nothing in the placement ladder was wrong. `AddTaskPanel` bounds a new
// flexible task to the VIEWED WEEK (`from … addDays(weekStart, 6)`), which on a
// Sunday is `now … today`. Every rung of `placeTask` then fails for want of
// anywhere legal to go, and the last-resort park stacks the task at `from` to
// keep it visible. The deadline was four days out and the Monday was empty; the
// search simply never looked past midnight, because `to` said not to.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, defaultConfig, resetIds, addDays, weekStart as weekStartOf,
} from '../src/core/index.js';

const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

/** Sunday 30 Aug 2026 — the day in the report. Its week starts Mon 24 Aug, so
 *  "the viewed week" ends on the Sunday itself. */
const SUN = new Date(2026, 7, 30);

function fill(s, d, fromH, toH) {
  const out = [];
  for (let h = fromH; h < toH; h += 1) {
    const t = new Task({
      title: `${d.toDateString()} ${h}`, type: 'fixed', pinned: true,
      startTime: at(d, h), endTime: at(d, h + 1),
    });
    s.tasks.push(t); out.push(t);
  }
  return out;
}

describe('the viewed week is not a floor on the search range', () => {
  it('does not stack a deadlined task on top of a full Sunday', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const packed = fill(s, SUN, 10, 23); // Sunday opens at 10:00 and is full to close

    const added = s.addFlexible({
      title: 'Begin Lab Safety Training',
      durationMin: 60,
      deadline: addDays(SUN, 4), // Thursday
      from: at(SUN, 21, 30), // using the app on the Sunday evening
      to: addDays(weekStartOf(SUN), 6), // the panel's default: end of the viewed week = today
    });

    // The whole complaint, as an assertion.
    expect(packed.some((t) => overlaps(added, t))).toBe(false);
    expect(added.startTime.getTime()).toBeGreaterThan(at(SUN, 23, 59).getTime());
    expect(added.schedulingWarning).toBe(false);
  });

  it('picks the least-full day in the horizon, not the day you are standing in', () => {
    // "today is definitely not the least stress day" — with the range fixed,
    // `balance` can finally see a day that is not today.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    fill(s, SUN, 10, 23); // today — full
    fill(s, addDays(SUN, 1), 8, 18); // Monday — full to 18:00
    fill(s, addDays(SUN, 2), 9, 11); // Tuesday — nearly empty
    fill(s, addDays(SUN, 3), 8, 20); // Wednesday — full

    const added = s.addFlexible({
      title: 'Email professors',
      durationMin: 30,
      deadline: addDays(SUN, 8),
      from: at(SUN, 21, 30),
      to: addDays(weekStartOf(SUN), 6),
    });

    expect(added.startTime.toDateString()).toBe(addDays(SUN, 2).toDateString());
  });

  it('leaves a range WIDER than the horizon exactly as the caller asked', () => {
    // The floor may only ever widen. Added on the Monday, "this week" is six
    // days — well past the 3-day horizon — and must not be clipped back to it.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const MON = addDays(SUN, 1);
    // Everything inside the horizon is full, so the only room left is Friday.
    for (let d = 0; d <= 3; d += 1) fill(s, addDays(MON, d), 8, 23);

    const added = s.addFlexible({
      title: 'Somewhere this week',
      durationMin: 60,
      from: at(MON, 9, 0),
      to: addDays(MON, 6),
    });

    expect(added.startTime.toDateString()).toBe(addDays(MON, 4).toDateString());
    expect(added.schedulingWarning).toBe(false);
  });

  it('still clips to a deadline nearer than the horizon', () => {
    // ⚠️ THE OBVIOUS WRONG FIX is to widen the range and stop there. The floor
    // is applied BEFORE `placeTask` clips to the deadline, so a task due
    // tomorrow must not be handed the extra days — that would place work after
    // its own deadline, which is the one thing the range was already right about.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    fill(s, SUN, 10, 23);

    const deadline = at(addDays(SUN, 1), 12, 0); // Monday noon
    const added = s.addFlexible({
      title: 'Due tomorrow lunchtime',
      durationMin: 60,
      deadline,
      from: at(SUN, 21, 30),
      to: addDays(weekStartOf(SUN), 6),
    });

    expect(added.endTime.getTime()).toBeLessThanOrEqual(deadline.getTime());
  });

  it('a distant deadline buys the horizon and no more', () => {
    // The other half of the same trap: extending the range to the DEADLINE
    // would let a task due in six months wander off to whichever empty day
    // scored best, because past day 3 `proximity` is identically 0 and only
    // `balance` still discriminates. The floor is the horizon, not the deadline.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    fill(s, SUN, 10, 23);

    const added = s.addFlexible({
      title: 'Due in six months',
      durationMin: 60,
      deadline: addDays(SUN, 180),
      from: at(SUN, 21, 30),
      to: addDays(weekStartOf(SUN), 6),
    });

    expect(added.startTime.getTime())
      .toBeLessThanOrEqual(addDays(at(SUN, 21, 30), defaultConfig.maxPlacementLookahead).getTime());
  });
});
