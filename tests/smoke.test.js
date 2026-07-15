import { describe, it, expect, beforeEach } from 'vitest';
import { Task, Zone, Schedule, seed, resetIds, defaultConfig } from '../src/core/index.js';

const D = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi, 0, 0);

describe('smoke', () => {
  beforeEach(() => resetIds());

  it('constructs a Task with defaults (7A cascade)', () => {
    const t = new Task({ title: 'Call plumber' });
    expect(t.type).toBe('flexible');
    expect(t.priority).toBe(3);
    expect(t.getDuration()).toBe(60);
    expect(t.placedBy).toBe('auto');
    expect(t.pinned).toBe(false);
  });

  it('seeds a schedule and autoSchedules without unexpected warnings', () => {
    const s = seed(D(2026, 6, 13)); // Monday 2026-07-13
    const res = s.autoSchedule({ now: D(2026, 6, 13, 0, 0) });
    expect(res.warnings.length).toBe(0);
  });

  it('round-trips a Schedule through JSON', () => {
    const s = seed(D(2026, 6, 13));
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    const back = Schedule.fromJSON(json);
    expect(back.tasks.length).toBe(s.tasks.length);
    expect(back.toJSON().schemaVersion).toBe(1);
  });
});
