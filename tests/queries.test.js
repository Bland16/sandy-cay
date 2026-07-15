import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { snapshotDiff, getBreakCompression, getSatisfactionMatrix, dayGaps } from '../src/core/queries.js';
import { isoWeek, isoWeekKey } from '../src/core/time.js';
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

describe('§7.1 report queries — break compression', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('dayGaps measures only the gaps BETWEEN tasks', () => {
    s.addFixed({ title: 'A', startTime: D(0, 9), endTime: D(0, 10) });
    s.addFixed({ title: 'B', startTime: D(0, 10, 30), endTime: D(0, 11) });
    s.addFixed({ title: 'C', startTime: D(0, 12), endTime: D(0, 13) });
    // 30 between A and B, 60 between B and C. The run-up to 09:00 and the tail
    // after 13:00 are the day's edges, not breaks.
    expect(dayGaps(s, D(0, 0), MON)).toEqual([30, 60]);
  });

  it('dayGaps clamps overlapping tasks to 0 rather than going negative', () => {
    s.addFixed({ title: 'A', startTime: D(0, 9), endTime: D(0, 11) });
    s.addFixed({ title: 'B', startTime: D(0, 10), endTime: D(0, 12) });
    expect(dayGaps(s, D(0, 0), MON)).toEqual([0]);
  });

  it('getBreakCompression averages gaps per day and counts tight ones', () => {
    s.addFixed({ title: 'A', startTime: D(0, 9), endTime: D(0, 10) });
    s.addFixed({ title: 'B', startTime: D(0, 10, 5), endTime: D(0, 11) }); // 5 min — at the floor
    s.addFixed({ title: 'C', startTime: D(0, 11, 5), endTime: D(0, 12) }); // 5 min — at the floor
    const bc = getBreakCompression(s, MON);
    expect(bc.perDay[0].gapCount).toBe(2);
    expect(bc.perDay[0].avgBreak).toBe(5);
    expect(bc.perDay[0].minBreak).toBe(5);
    expect(bc.tightGaps).toBe(2); // both <= breaks.minimum (5)
    expect(bc.tiers.minimum).toBe(defaultConfig.breaks.minimum);
  });

  it('a day with one task has avgBreak null, NOT 0 — no breaks taken is not zero breaks', () => {
    s.addFixed({ title: 'Only', startTime: D(0, 9), endTime: D(0, 10) });
    const bc = getBreakCompression(s, MON);
    expect(bc.perDay[0].gapCount).toBe(0);
    expect(bc.perDay[0].avgBreak).toBeNull();
    expect(bc.perDay[0].minBreak).toBeNull();
  });

  it('an empty week yields nulls and no NaN', () => {
    const bc = getBreakCompression(s, MON);
    expect(bc.gapCount).toBe(0);
    expect(bc.avgBreak).toBeNull();
    expect(bc.tightGaps).toBe(0);
    expect(bc.perDay).toHaveLength(7);
    expect(bc.perDay.every((d) => d.avgBreak === null)).toBe(true);
    expect(JSON.stringify(bc)).not.toContain('null,"minBreak":NaN');
  });
});

describe('§7.1 report queries — satisfaction matrix', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  const rate = (t, overall) => { t.satisfaction = { overall, timingFit: 0, durationFit: 0, energy: 0 }; };

  it('buckets ratings by tag × time-of-day, counting multi-tag tasks toward each', () => {
    rate(s.addFixed({ title: 'AM study', tags: ['study', 'work'], startTime: D(0, 9), endTime: D(0, 10) }), 5);
    rate(s.addFixed({ title: 'PM study', tags: ['study'], startTime: D(1, 15), endTime: D(1, 16) }), 2);
    const m = getSatisfactionMatrix(s, MON);
    const study = m.rows.find((r) => r.tag === 'study');
    const morning = study.cells.find((c) => c.bucket === 'morning');   // 08–11
    const afternoon = study.cells.find((c) => c.bucket === 'afternoon'); // 14–17
    expect(morning.avg).toBe(5);
    expect(afternoon.avg).toBe(2);
    expect(study.avg).toBeCloseTo(3.5, 5);
    expect(study.count).toBe(2);
    // 'work' rode along on the 09:00 task only.
    expect(m.rows.find((r) => r.tag === 'work').count).toBe(1);
    expect(m.ratedCount).toBe(3); // 2 study + 1 work — per-tag, matching §6F
  });

  it('unrated buckets are null, not 0 — unknown is not bad', () => {
    rate(s.addFixed({ title: 'Morning', tags: ['study'], startTime: D(0, 9), endTime: D(0, 10) }), 4);
    const m = getSatisfactionMatrix(s, MON);
    const study = m.rows.find((r) => r.tag === 'study');
    expect(study.cells.find((c) => c.bucket === 'night').avg).toBeNull();
    expect(study.cells.find((c) => c.bucket === 'night').count).toBe(0);
  });

  it('unrated and empty weeks produce no rows and no NaN', () => {
    s.addFixed({ title: 'Never rated', tags: ['study'], startTime: D(0, 9), endTime: D(0, 10) });
    const rated = getSatisfactionMatrix(s, MON);
    expect(rated.rows).toEqual([]);
    expect(rated.ratedCount).toBe(0);

    const empty = getSatisfactionMatrix(new Schedule({ config: defaultConfig }), MON);
    expect(empty.rows).toEqual([]);
    expect(empty.buckets).toHaveLength(6);
  });
});

describe('§7.1 — ISO week stamp for the report filename', () => {
  it('numbers an ordinary mid-year week', () => {
    expect(isoWeek(MON)).toEqual({ year: 2026, week: 29 });
    expect(isoWeekKey(MON)).toBe('2026-W29');
  });

  it('pads single-digit weeks so filenames sort', () => {
    expect(isoWeekKey(new Date(2026, 0, 8))).toBe('2026-W02');
  });

  it('uses the ISO week-numbering year, not the calendar year', () => {
    // 2027-01-01 is a Friday — it belongs to the week that started 2026-12-28,
    // which is 2026-W53. Naming it 2027-W01 would sort it a year wrong.
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53');
    // ...and the Monday of that same week agrees.
    expect(isoWeekKey(new Date(2026, 11, 28))).toBe('2026-W53');
  });

  it('rolls into W01 when the week belongs to the next year', () => {
    // 2025-12-29 is a Monday whose Thursday (Jan 1 2026) lands in 2026 → W01.
    expect(isoWeekKey(new Date(2025, 11, 29))).toBe('2026-W01');
  });

  it('every day of one week shares a stamp', () => {
    const keys = new Set();
    for (let i = 0; i < 7; i += 1) keys.add(isoWeekKey(new Date(2026, 6, 13 + i)));
    expect([...keys]).toEqual(['2026-W29']);
  });
});
