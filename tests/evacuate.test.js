import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const D = (offset, h, mi = 0) => {
  const d = new Date(MON.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(h, mi, 0, 0);
  return d;
};

describe('3A — evacuateDay (Clear Day)', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('relocates flexibles forward-only and surfaces anchors for review', () => {
    const flex = s.addFlexible({ title: 'Study', startTime: D(1, 10), endTime: D(1, 11) });
    const gym = s.addFixed({ title: 'Gym', startTime: D(1, 12), endTime: D(1, 13) });
    gym.pinned = true;
    const res = s.evacuateDay(D(1, 0), { blockDay: false });
    expect(res.needsReview.map((t) => t.id)).toContain(gym.id);
    expect(res.relocated.map((t) => t.id)).toContain(flex.id);
    // Forward-only: relocated to a later day.
    expect(flex.getDayIndex(MON)).toBeGreaterThan(1);
  });

  it('blockDay:true marks the DAY blocked — it does not add a task (D-6)', () => {
    s.addFlexible({ title: 'Study', startTime: D(1, 10), endTime: D(1, 11) });
    const before = s.tasks.length;
    const res = s.evacuateDay(D(1, 0), { blockDay: true });
    // Blocking used to mean a 15-hour protected card drawn over the day's real
    // contents, which also refused the user's own hand. It is a property of the
    // day now.
    expect(s.isDayBlocked(D(1, 0))).toBe(true);
    expect(s.tasks.length).toBe(before);
    expect(s.tasks.some((t) => t.title === 'Out sick')).toBe(false);
    expect(res.relocated.length).toBe(1);
  });
});

describe('5C — blockRange', () => {
  it('marks every day in the range and evacuates flexibles off it', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const flex = s.addFlexible({ title: 'Errand', startTime: D(5, 10), endTime: D(5, 11) });
    const blocked = s.blockRange(D(5, 0), D(6, 0), 'Friend visiting');
    expect(blocked.length).toBe(2); // Sat + Sun
    expect(s.isDayBlocked(D(5, 0))).toBe(true);
    expect(s.isDayBlocked(D(6, 0))).toBe(true);
    // ...and it adds no tasks: a blocked day has no title, because it is not a
    // thing ON the day. If you want the day named, that is a day NOTE.
    expect(s.tasks.some((t) => t.title === 'Friend visiting')).toBe(false);
    // Flexible on Saturday evacuated off the blocked range.
    expect([5, 6]).not.toContain(flex.getDayIndex(MON));
  });
});
