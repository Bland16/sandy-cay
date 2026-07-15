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

  it('blockDay:true creates a full-day protected blocker', () => {
    s.addFlexible({ title: 'Study', startTime: D(1, 10), endTime: D(1, 11) });
    const res = s.evacuateDay(D(1, 0), { blockDay: true });
    const blocker = s.tasks.find((t) => t.title === 'Out sick');
    expect(blocker).toBeTruthy();
    expect(blocker.tags).toContain('rest');
    expect(res.relocated.length).toBe(1);
  });
});

describe('5C — blockRange', () => {
  it('emits one protected blocker per day and evacuates flexibles', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const flex = s.addFlexible({ title: 'Errand', startTime: D(5, 10), endTime: D(5, 11) });
    const blockers = s.blockRange(D(5, 0), D(6, 0), 'Friend visiting');
    expect(blockers.length).toBe(2); // Sat + Sun
    expect(blockers.every((b) => b.tags.includes('rest'))).toBe(true);
    // Flexible on Saturday evacuated off the blocked range.
    expect([5, 6]).not.toContain(flex.getDayIndex(MON));
  });
});
