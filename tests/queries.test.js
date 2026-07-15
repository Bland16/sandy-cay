import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { snapshotDiff } from '../src/core/queries.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const D = (offset, h, mi = 0) => new Date(2026, 6, 13 + offset, h, mi, 0, 0);

describe('§5D/6F/6J queries', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('getWeekLoad computes sums, fillRatio, perDay and pinnedRatio', () => {
    s.addFixed({ title: 'A', startTime: D(0, 9), endTime: D(0, 11) }); // 120 min Mon
    const pinned = s.addFixed({ title: 'B', startTime: D(1, 9), endTime: D(1, 10) }); // 60 min Tue
    pinned.pinned = true;
    const load = s.getWeekLoad(MON);
    expect(load.scheduledMin).toBe(180);
    expect(load.perDay[0].scheduledMin).toBe(120);
    expect(load.perDay[1].scheduledMin).toBe(60);
    // Mon-Fri 600 each, Sat 840, Sun 240 → capacity total.
    expect(load.capacityMin).toBe(600 * 5 + 840 + 240);
    expect(load.pinnedRatio).toBeCloseTo(60 / 180, 5);
  });

  it('getTagBreakdown counts multi-tag tasks toward each tag', () => {
    const t = s.addFixed({ title: 'Study+work', tags: ['study', 'work'], startTime: D(0, 9), endTime: D(0, 10) });
    t.completion = 'done';
    t.satisfaction = { overall: 4, timingFit: 0, durationFit: 0, energy: 0 };
    const breakdown = s.getTagBreakdown(MON);
    const study = breakdown.find((r) => r.tag === 'study');
    const work = breakdown.find((r) => r.tag === 'work');
    expect(study.scheduledMin).toBe(60);
    expect(work.scheduledMin).toBe(60); // counted toward BOTH
    expect(study.completedMin).toBe(60);
    expect(study.avgShells).toBe(4);
  });

  it('snapshot + diff detects moves', () => {
    const t = s.addFixed({ title: 'Move me', startTime: D(0, 9), endTime: D(0, 10) });
    const before = s.snapshot(MON);
    t.moveTo(D(0, 11));
    const after = s.snapshot(MON);
    const diff = snapshotDiff(before, after);
    expect(diff.moved.find((m) => m.id === t.id).deltaMin).toBe(120);
  });
});
