import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Bucket, Activity, resetIds, defaultLoadForRole, normalizeLoad, LOAD_AXES } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const D = (d, h) => new Date(2026, 6, d, h, 0, 0, 0);
const wide = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });

describe('load basis', () => {
  beforeEach(() => resetIds());

  it('normalizeLoad fills all four axes and clamps to -2..2', () => {
    const l = normalizeLoad({ mental: 9, physical: -9 });
    expect(l).toEqual({ mental: 2, physical: -2, social: 0, creative: 0 });
    expect(Object.keys(l).sort()).toEqual([...LOAD_AXES].sort());
  });

  it('a bucket takes its role default load, overridable', () => {
    expect(new Bucket({ label: 'Work', role: 'work' }).load).toEqual({ mental: 2, physical: 0, social: 0, creative: 0 });
    expect(new Bucket({ label: 'Rest', role: 'rest' }).load).toEqual({ mental: -2, physical: -1, social: 0, creative: 0 });
    const custom = new Bucket({ label: 'X', role: 'work', load: { mental: 1, creative: 2 } });
    expect(custom.load).toEqual({ mental: 1, physical: 0, social: 0, creative: 2 });
  });

  it('bucket + activity load round-trip through JSON (activity override is nullable)', () => {
    const b = new Bucket({ label: 'Rest', role: 'rest' });
    expect(Bucket.fromJSON(JSON.parse(JSON.stringify(b.toJSON())))).toEqual(b);
    const plain = new Activity({ label: 'Read' });
    expect(plain.load).toBeNull();
    const heavy = new Activity({ label: 'Sketch', load: { creative: 2, mental: 1 } });
    expect(Activity.fromJSON(JSON.parse(JSON.stringify(heavy.toJSON())))).toEqual(heavy);
  });

  it('a pre-load save (bucket with no load key) loads with the role default', () => {
    const b = Bucket.fromJSON({ label: 'Health', role: 'health', tags: ['gym'] });
    expect(b.load).toEqual(defaultLoadForRole('health'));
  });
});

describe('energy budget accountant', () => {
  beforeEach(() => resetIds());

  const workRestSched = () => {
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', role: 'work', tags: ['work'] }); // mental +2
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] }); // mental -2, physical -1
    return s;
  };

  it('sums net load per axis and flags overdraft', () => {
    const s = workRestSched();
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) });
    const b = s.energyBudget(D(15, 12));
    expect(b.mental.net).toBe(10); // 5 × +2
    expect(b.mental.capacity).toBe(8);
    expect(b.mental.over).toBe(true); // 10 > 8
    expect(b.mental.remaining).toBe(-2);
  });

  it('restorative tasks lower net demand back under capacity', () => {
    const s = workRestSched();
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) });
    s.addFixed({ title: 'R1', tags: ['rest'], startTime: D(15, 18), endTime: D(15, 19) });
    s.addFixed({ title: 'R2', tags: ['rest'], startTime: D(15, 19), endTime: D(15, 20) });
    const b = s.energyBudget(D(15, 12));
    expect(b.mental.net).toBe(6); // 10 − 2×2
    expect(b.mental.over).toBe(false);
    expect(b.physical.net).toBe(-2); // two rests, −1 each; a surplus
  });

  it('an untagged/unbucketed task contributes zero load', () => {
    const s = workRestSched();
    s.addFixed({ title: 'Mystery', tags: ['nope'], startTime: D(15, 9), endTime: D(15, 10) });
    const b = s.energyBudget(D(15, 12));
    for (const a of LOAD_AXES) expect(b[a].net).toBe(0);
  });
});
