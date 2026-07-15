import { describe, it, expect, beforeEach } from 'vitest';
import { Task, resetIds } from '../src/core/index.js';

const D = (h, mi = 0) => new Date(2026, 6, 13, h, mi, 0, 0);

describe('§1.1 Task defaults & guards (7A)', () => {
  beforeEach(() => resetIds());

  it('7A: title-only cascade → flexible, priority 3, 60min, placedBy auto', () => {
    const t = new Task({ title: 'Call plumber' });
    expect(t.type).toBe('flexible');
    expect(t.priority).toBe(3);
    expect(t.getDuration()).toBe(60);
    expect(t.deadline).toBe(null);
    expect(t.recurrence).toBe(null);
    expect(t.placedBy).toBe('auto');
  });

  it('requires a title', () => {
    expect(() => new Task({})).toThrow();
    expect(() => new Task({ title: '' })).toThrow();
  });

  it('guards end <= start (swap) and equal (+defaultDuration)', () => {
    const swapped = new Task({ title: 'x', startTime: D(10), endTime: D(9) });
    expect(swapped.startTime.getHours()).toBe(9);
    expect(swapped.endTime.getHours()).toBe(10);
    const equal = new Task({ title: 'y', startTime: D(10), endTime: D(10) });
    expect(equal.getDuration()).toBe(60);
  });

  it('clamps priority to 1–5', () => {
    expect(new Task({ title: 'a', priority: 9 }).priority).toBe(5);
    expect(new Task({ title: 'a', priority: 0 }).priority).toBe(1);
  });

  it('seconds are always zeroed', () => {
    const t = new Task({ title: 'x', startTime: new Date(2026, 6, 13, 9, 30, 45, 500) });
    expect(t.startTime.getSeconds()).toBe(0);
    expect(t.startTime.getMilliseconds()).toBe(0);
  });
});

describe('§1.1 Task methods', () => {
  beforeEach(() => resetIds());

  it('moveTo preserves duration and marks placedBy user', () => {
    const t = new Task({ title: 'x', startTime: D(9), endTime: D(10, 30) });
    t.moveTo(D(14));
    expect(t.getDuration()).toBe(90);
    expect(t.startTime.getHours()).toBe(14);
    expect(t.placedBy).toBe('user');
    expect(t.history.moveCount).toBe(1);
  });

  it('bump preserves time-of-day', () => {
    const t = new Task({ title: 'x', startTime: D(9), endTime: D(10) });
    t.bump(new Date(2026, 6, 14));
    expect(t.startTime.getHours()).toBe(9);
    expect(t.getDayIndex(new Date(2026, 6, 13))).toBe(1);
  });

  it('overlaps detects interval overlap', () => {
    const a = new Task({ title: 'a', startTime: D(9), endTime: D(11) });
    const b = new Task({ title: 'b', startTime: D(10), endTime: D(12) });
    const c = new Task({ title: 'c', startTime: D(11), endTime: D(12) });
    expect(a.overlaps(b)).toBe(true);
    expect(a.overlaps(c)).toBe(false); // touching, not overlapping
  });
});

describe('§7C clone vs duplicate', () => {
  beforeEach(() => resetIds());

  it('clone keeps the same id', () => {
    const t = new Task({ title: 'x', startTime: D(9), endTime: D(10) });
    const c = t.clone();
    expect(c.id).toBe(t.id);
  });

  it('duplicate: new id, resets completion/satisfaction/history/placedBy, drops recurrence', () => {
    const t = new Task({
      title: 'Gym',
      startTime: D(9),
      endTime: D(10),
      placedBy: 'user',
      completion: 'done',
      satisfaction: { overall: 5, timingFit: 0, durationFit: 0, energy: 0 },
      recurrence: { periods: [{ windows: [{ day: 'mon', start: '09:00', end: '10:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }], anchorDate: D(9), exceptions: [] },
    });
    t.history.moveCount = 4;
    const dup = t.duplicate();
    expect(dup.id).not.toBe(t.id);
    expect(dup.completion).toBe(null);
    expect(dup.satisfaction).toBe(null);
    expect(dup.history.moveCount).toBe(0);
    expect(dup.placedBy).toBe('auto');
    expect(dup.recurrence).toBe(null);
  });
});
