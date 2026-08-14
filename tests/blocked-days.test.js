// Blocked days (design/DAY-NOTES.md D-6) — a STATE of the day, not a task on it.
//
// The correction this locks, in the user's own words: "Would I want homework
// scheduled on Christmas? No. Should I be able to schedule my own brunch on that
// date, and do something if I feel like it? Yes."
//
//   automatic placement  →  stays out
//   your own hand        →  lands
//   What-To-Do           →  still answers (opening the picker IS asking)
//
// The old shape got the first right and the other two wrong: a full-window
// protected blocker left no legal room AND `isHardBlocker` refused a manual drop.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, defaultConfig, resetIds, dateKey, addDays,
  weekStart as weekStartOf, rippleShift,
} from '../src/core/index.js';
import { computeWindows } from '../src/core/placement.js';

const MON = weekStartOf(new Date(2026, 10, 23)); // Mon 23 Nov 2026
const D = (offset, h, m = 0) => {
  const d = addDays(MON, offset);
  d.setHours(h, m, 0, 0);
  return d;
};

const seed = () => { resetIds(); return new Schedule({ config: defaultConfig }); };

describe('the model', () => {
  it('blocks and unblocks a day, and is idempotent', () => {
    const s = seed();
    expect(s.isDayBlocked(D(3, 0))).toBe(false);
    expect(s.blockDay(D(3, 0))).toBe(true);
    expect(s.blockDay(D(3, 0))).toBe(false); // already blocked
    expect(s.isDayBlocked(D(3, 0))).toBe(true);
    expect(s.unblockDay(D(3, 0))).toBe(true);
    expect(s.isDayBlocked(D(3, 0))).toBe(false);
  });

  it('adds no task — a blocked day is not a thing ON the day', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    expect(s.tasks).toHaveLength(0);
  });

  it('survives a round trip, and an old save loads unblocked', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.isDayBlocked(D(3, 0))).toBe(true);
    // Additive: absent on every save written before this (sharp edge #15).
    const old = Schedule.fromJSON({ tasks: [], config: defaultConfig });
    expect(old.blockedDays).toEqual([]);
    expect(old.isDayBlocked(D(3, 0))).toBe(false);
  });
});

describe('automatic placement stays out', () => {
  it('leaves a blocked day with no legal window at all', () => {
    const s = seed();
    const t = new Task({ title: 'Homework', type: 'flexible', durationMin: 60 });
    expect(computeWindows(s, t, D(3, 0)).length).toBeGreaterThan(0);
    s.blockDay(D(3, 0));
    expect(computeWindows(s, t, D(3, 0))).toEqual([]);
  });

  it('autoSchedule places nothing there, and the day either side is fine', () => {
    const s = seed();
    s.blockDay(D(3, 0)); // Thursday
    for (let i = 0; i < 6; i += 1) {
      s.addFlexible({ title: `Task ${i}`, durationMin: 90 });
    }
    s.autoSchedule({ weekStart: MON });
    const onBlocked = s.tasks.filter((t) => t.startTime && dateKey(t.startTime) === dateKey(D(3, 0)));
    expect(onBlocked).toEqual([]);
    // ...and the work went somewhere rather than vanishing.
    expect(s.tasks.filter((t) => t.startTime).length).toBeGreaterThan(0);
  });

  it('a deadline does NOT buy its way in — this is not a zone', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    const t = new Task({ title: 'Due Thursday', type: 'flexible', durationMin: 60 });
    // ignoreZone is the deadline > zone escape hatch; a day you blocked yourself
    // is not a constraint to optimise around.
    expect(computeWindows(s, t, D(3, 0), { ignoreZone: true })).toEqual([]);
  });
});

describe('your own hand still lands', () => {
  it('a manual drop onto a blocked day is accepted', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    const t = s.addFixed({ title: 'Christmas brunch', startTime: D(0, 9), endTime: D(0, 10) });
    // The old blocker made this `{rejected: true}` — nothing to collide with now.
    const res = s.resolveDropConflicts(t, D(3, 11), D(3, 12));
    expect(res.rejected).toBeFalsy();
    s.updateTask(t.id, { startTime: D(3, 11), endTime: D(3, 12) });
    expect(dateKey(s.tasks.find((x) => x.id === t.id).startTime)).toBe(dateKey(D(3, 0)));
  });

  it('What-To-Do still answers on a blocked day — asking is asking', () => {
    const s = seed();
    s.addFlexible({ title: 'Something', startTime: D(3, 10), endTime: D(3, 11) });
    s.blockDay(D(3, 0));
    const out = s.whatToDo(D(3, 9));
    expect(Array.isArray(out) ? out : out.suggestions).toBeTruthy();
  });
});

describe('ripple and a blocked day — what is actually true', () => {
  // The handoff instructed a blocked-day check inside ripple's plain-shift
  // branch. Two probes said otherwise, and these lock what they found.

  it('a plain shift cannot reach another day at all, so it cannot reach a blocked one', () => {
    const s = seed();
    const pivot = s.addFixed({ title: 'Pivot', startTime: D(2, 9), endTime: D(2, 10) });
    const sameDayTask = s.addFlexible({ title: 'SameDay', startTime: D(2, 10), endTime: D(2, 11) });
    const nextDayTask = s.addFlexible({ title: 'NextDay', startTime: D(3, 10), endTime: D(3, 11) });

    const r = s.rippleShift(pivot, 60);

    // `downstream` is sameDay(pivot) and `limit` is capped at that day's window
    // end, so the chain is structurally confined to one day.
    expect(r.shifted.map((t) => t.title)).toEqual(['SameDay']);
    expect(dateKey(sameDayTask.startTime)).toBe(dateKey(D(2, 0)));
    expect(dateKey(nextDayTask.startTime)).toBe(dateKey(D(3, 0))); // untouched
  });

  it('does NOT evacuate work you hand-placed on a blocked day', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    // Christmas: you blocked it, then put brunch and board games on it yourself.
    const brunch = s.addFixed({ title: 'Brunch', startTime: D(3, 10), endTime: D(3, 11) });
    const games = s.addFlexible({ title: 'Board games', startTime: D(3, 11), endTime: D(3, 12) });

    s.rippleShift(brunch, 30);

    // Guarding the shift branch on blocked days sent this to Friday 08:00 —
    // which is exactly what D-6 abolishes: blocked means the scheduler stays
    // out, NOT that you may not go there. Your hand outranks your own rule.
    expect(games.startTime).toBeTruthy();
    expect(dateKey(games.startTime)).toBe(dateKey(D(3, 0)));
  });

  it('still refuses to place OVERFLOW onto a blocked day', () => {
    const s = seed();
    s.blockDay(D(3, 0));
    const pivot = s.addFixed({ title: 'Pivot', startTime: D(2, 9), endTime: D(2, 10) });
    const tail = s.addFlexible({ title: 'Tail', startTime: D(2, 17), endTime: D(2, 18) });

    s.rippleShift(pivot, 240); // far past the day window → overflow → placeTask

    // The overflow branch routes through placeTask, so computeWindows applies
    // and the blocked day is not an option.
    if (tail.startTime) expect(dateKey(tail.startTime)).not.toBe(dateKey(D(3, 0)));
  });
});
