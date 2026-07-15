import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const D = (offset, h, mi = 0) => new Date(2026, 6, 13 + offset, h, mi, 0, 0);

describe('1C — findFreeSlots availability query', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('returns all slots of ≥ duration inside a time-of-day window over a range', () => {
    // Tuesday has a task 12:00–12:30 inside the lunch window.
    s.addFixed({ title: 'Busy', startTime: D(1, 12), endTime: D(1, 12, 30) });
    const slots = s.findFreeSlots({
      from: D(0, 0),
      to: D(2, 0),
      durationMin: 60,
      window: { start: '11:30', end: '13:30' },
      respectBreaks: false,
    });
    expect(slots.length).toBeGreaterThan(0);
    // Every slot lies inside the 11:30–13:30 window.
    for (const slot of slots) {
      const startMin = slot.start.getHours() * 60 + slot.start.getMinutes();
      const endMin = slot.end.getHours() * 60 + slot.end.getMinutes();
      expect(startMin).toBeGreaterThanOrEqual(11 * 60 + 30);
      expect(endMin).toBeLessThanOrEqual(13 * 60 + 30);
    }
    // Tuesday's busy block is respected: no slot overlaps 12:00–12:30.
    const tueSlots = slots.filter((sl) => sl.start.getDate() === D(1, 0).getDate());
    for (const sl of tueSlots) {
      expect(sl.start.getTime() >= D(1, 12, 30).getTime() || sl.end.getTime() <= D(1, 12).getTime()).toBe(true);
    }
  });

  it('findFreeSlot returns the first slot or null', () => {
    const first = s.findFreeSlot({ from: D(0, 0), to: D(1, 0), durationMin: 60, respectBreaks: false });
    expect(first).not.toBe(null);
    expect(first.start).toBeInstanceOf(Date);
  });

  it('respects break padding when respectBreaks is true', () => {
    s.addFixed({ title: 'Anchor', startTime: D(0, 9), endTime: D(0, 10) });
    const padded = s.findFreeSlots({ from: D(0, 0), to: D(0, 23, 59), durationMin: 60, respectBreaks: true });
    // The slot immediately after the anchor must start ≥ 30 min later (default break).
    const after = padded.find((sl) => sl.start.getTime() >= D(0, 10).getTime());
    if (after) expect(after.start.getTime()).toBeGreaterThanOrEqual(D(0, 10, 30).getTime());
  });
});
