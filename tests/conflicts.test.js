import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { chooseConflictStrategy, strategyCosts } from '../src/core/conflicts.js';
import { defaultConfig } from '../src/core/config.js';

const D = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi, 0, 0);
const cfg = defaultConfig;

describe('OD-8 — chooseConflictStrategy quartet (§3.2)', () => {
  it('OD-8: +15min resize into a padded day → ripple (breaks absorb it)', () => {
    const dayState = { downstreamCount: 3, spareBreakMin: 45, tailRoomMin: 120, taskMin: 60, displaceMoveMin: 60 };
    expect(chooseConflictStrategy('resize', 15, dayState, cfg)).toBe('ripple');
  });

  it('OD-8: +4h resize → displace (rippling would evacuate half the evening)', () => {
    const dayState = { downstreamCount: 4, spareBreakMin: 15, tailRoomMin: 30, taskMin: 60, displaceMoveMin: 90 };
    expect(chooseConflictStrategy('resize', 240, dayState, cfg)).toBe('displace');
  });

  it('OD-8: 15min drop into a tight cluster → ripple wins despite drop bias', () => {
    const dayState = { downstreamCount: 3, spareBreakMin: 5, tailRoomMin: 15, taskMin: 60, displaceMoveMin: 180 };
    expect(chooseConflictStrategy('drop', 15, dayState, cfg)).toBe('ripple');
  });

  it('OD-8: 2h drop mid-afternoon → displace', () => {
    const dayState = { downstreamCount: 3, spareBreakMin: 20, tailRoomMin: 60, taskMin: 60, displaceMoveMin: 60 };
    expect(chooseConflictStrategy('drop', 120, dayState, cfg)).toBe('displace');
  });

  it('exposes computed costs for the inline chooser', () => {
    const dayState = { downstreamCount: 3, spareBreakMin: 45, tailRoomMin: 120, taskMin: 60, displaceMoveMin: 60 };
    const costs = strategyCosts('resize', 15, dayState, cfg);
    expect(costs.ripple).toBe(0);
    expect(costs.displace).toBeGreaterThan(0);
  });
});

describe('1E — displacement via resolveDropConflicts', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('drop onto a flexible task evicts + re-places it (priority ignored, R-1)', () => {
    const study = s.addFlexible({ title: 'Study', tags: ['x'], priority: 5, startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    const lunch = new Task({ title: 'Lunch', type: 'fixed', priority: 1, startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    s.tasks.push(lunch);
    const res = s.resolveDropConflicts(lunch);
    expect(res.rejected).toBeUndefined();
    expect(res.displaced.map((t) => t.id)).toContain(study.id);
    // study no longer overlaps lunch
    expect(study.overlaps(lunch)).toBe(false);
    expect(study.history.displacedCount).toBe(1);
  });

  it('drop onto a pinned task is rejected (snap-back)', () => {
    const gym = s.addFixed({ title: 'Gym', startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    gym.pinned = true;
    const lunch = new Task({ title: 'Lunch', type: 'fixed', startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    s.tasks.push(lunch);
    const res = s.resolveDropConflicts(lunch);
    expect(res.rejected).toBe(true);
    expect(res.snapBack).toBe(true);
    expect(res.reason).toMatch(/pinned/i);
  });

  it('drop onto a fixed task is rejected (7B)', () => {
    const dentist = s.addFixed({ title: 'Dentist', startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    expect(dentist.type).toBe('fixed');
    const lunch = new Task({ title: 'Lunch', type: 'flexible', startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 13, 0) });
    s.tasks.push(lunch);
    const res = s.resolveDropConflicts(lunch);
    expect(res.rejected).toBe(true);
  });

  it('drop onto a protected-tag task is rejected (2B)', () => {
    const movie = s.addFlexible({ title: 'Movie', tags: ['rest'], startTime: D(2026, 6, 14, 12, 0), endTime: D(2026, 6, 14, 14, 0) });
    const lunch = new Task({ title: 'Lunch', type: 'flexible', startTime: D(2026, 6, 14, 12, 30), endTime: D(2026, 6, 14, 13, 30) });
    s.tasks.push(lunch);
    const res = s.resolveDropConflicts(lunch);
    expect(res.rejected).toBe(true);
    expect(movie.startTime.getHours()).toBe(12);
  });
});

describe('displacement never double-books (F1 regression)', () => {
  beforeEach(() => resetIds());

  it('two evicted tasks land in different slots, not on top of each other', () => {
    // intervalsOf snapshots Date OBJECTS; placeTask assigns fresh ones. Building
    // the occupied set once, before the loop, left every later evictee blind to
    // where the previous one just landed.
    const s = new Schedule({ config: defaultConfig });
    const a = s.addFlexible({ title: 'Alpha', startTime: D(2026, 6, 14, 14), endTime: D(2026, 6, 14, 15) });
    const b = s.addFlexible({ title: 'Bravo', startTime: D(2026, 6, 14, 15), endTime: D(2026, 6, 14, 16) });
    const dropped = s.addFixed({ title: 'Block', startTime: D(2026, 6, 14, 9), endTime: D(2026, 6, 14, 11) });
    dropped.moveTo(D(2026, 6, 14, 14)); // a 2h block across BOTH

    const res = s.resolveDropConflicts(dropped);

    expect(res.displaced.length).toBe(2);
    expect(a.overlaps(b)).toBe(false); // the actual bug: both landed on 14:30
    expect(a.overlaps(dropped)).toBe(false);
    expect(b.overlaps(dropped)).toBe(false);
  });
});
