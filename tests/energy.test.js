import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Bucket, Activity, Task, resetIds, normalizeLoad, loadForTask, learnedCapacity, LOAD_AXES } from '../src/core/index.js';
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

  it('a bucket defaults to neutral load (no fabricated role numbers), user-set', () => {
    expect(new Bucket({ label: 'Work' }).load).toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
    expect(new Bucket({ label: 'Rest' }).load).toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
    const custom = new Bucket({ label: 'X', load: { mental: 1, creative: 2 } });
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

  it('a pre-load save (bucket with no load key) loads as neutral', () => {
    const b = Bucket.fromJSON({ label: 'Health', tags: ['gym'] });
    expect(b.load).toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
  });
});

describe('energy battery (order-aware reserve)', () => {
  beforeEach(() => resetIds());

  const calibrate = (s) => {
    for (const d of [1, 8, 15]) {
      const t = s.addFixed({ title: `r${d}`, tags: ['x'], startTime: D(d, 5), endTime: D(d, 6) });
      t.completion = 'done'; t.satisfaction = { overall: 3, energy: 0 };
    }
  };
  const workRestSched = () => {
    const s = new Schedule({ config: wide() });
    // Load is a per-hour RATE now, user-authored (no role defaults).
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: -1 } });
    return s;
  };

  it('drains the reserve in time order and flags the deepest dip (once calibrated)', () => {
    const s = workRestSched();
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) }); // 5h straight
    calibrate(s);
    const b = s.energyBudget(D(15, 12));
    expect(b.mental.net).toBe(10); // total spend: 5h × +2/hr
    expect(b.mental.low).toBe(-10); // reserve bottoms at −10 (drained straight through)
    expect(b.mental.capacity).toBe(8);
    expect(b.mental.over).toBe(true); // −low 10 > cap 8
    expect(b.mental.remaining).toBe(-2); // 8 + (−10)
  });

  it('rest BETWEEN blocks keeps the reserve shallow; rest AFTER does not (the point of the battery)', () => {
    // Same totals (4h work, 2h rest), different order.
    const inter = workRestSched();
    inter.addFixed({ title: 'W1', tags: ['work'], startTime: D(15, 8), endTime: D(15, 10) }); // −4
    inter.addFixed({ title: 'R', tags: ['rest'], startTime: D(15, 10), endTime: D(15, 12) }); // repays → 0
    inter.addFixed({ title: 'W2', tags: ['work'], startTime: D(15, 12), endTime: D(15, 14) }); // −4
    const back = workRestSched();
    back.addFixed({ title: 'W', tags: ['work'], startTime: D(15, 8), endTime: D(15, 12) }); // −8
    back.addFixed({ title: 'R', tags: ['rest'], startTime: D(15, 12), endTime: D(15, 14) }); // too late

    const a = inter.energyBudget(D(15, 15)).mental;
    const c = back.energyBudget(D(15, 15)).mental;
    expect(a.net).toBe(c.net); // identical totals (+4 each)
    expect(a.low).toBe(-4); // interleaved dips only to −4
    expect(c.low).toBe(-8); // back-loaded bottoms at −8
    expect(a.low).toBeGreaterThan(c.low); // shallower is better
  });

  it('an untagged/unbucketed task contributes zero load', () => {
    const s = workRestSched();
    s.addFixed({ title: 'Mystery', tags: ['nope'], startTime: D(15, 9), endTime: D(15, 10) });
    const b = s.energyBudget(D(15, 12));
    for (const a of LOAD_AXES) { expect(b[a].net).toBe(0); expect(b[a].low).toBe(0); }
  });
});

describe('load derives from ALL a task\'s tags (tag-averaging, strong offset)', () => {
  beforeEach(() => resetIds());
  const threeBuckets = () => {
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    s.addBucket({ label: 'Health', tags: ['gym'], load: { mental: -1, physical: 2 } });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2 } });
    return s;
  };

  it('averages positive and negative contributions per axis across matching buckets', () => {
    const s = threeBuckets();
    const l = loadForTask(s, new Task({ title: 'Gym after work', tags: ['work', 'gym'] }));
    expect(l.mental).toBe(1); // avg-pos[2] + avg-neg[-1]
    expect(l.physical).toBe(2); // avg-pos[2]
  });

  it('a restorative tag offsets a demanding one (the trivia case → net ~0)', () => {
    const s = threeBuckets();
    const l = loadForTask(s, new Task({ title: 'Trivia', tags: ['work', 'rest'] }));
    expect(l.mental).toBe(0); // avg-pos[2] + avg-neg[-2]
  });

  it('no matching bucket → zero; an explicit override wins over derivation', () => {
    const s = threeBuckets();
    for (const a of LOAD_AXES) expect(loadForTask(s, new Task({ title: 'X', tags: ['none'] }))[a]).toBe(0);
    expect(loadForTask(s, new Task({ title: 'Y', tags: ['work'], load: { mental: -2 } })).mental).toBe(-2);
  });
});

describe('energy calibration gate (no fabricated ceiling until learned)', () => {
  beforeEach(() => resetIds());

  const rateEnergy = (s, d) => {
    const t = s.addFixed({ title: `r${d}`, tags: ['x'], startTime: D(d, 6), endTime: D(d, 7) });
    t.completion = 'done';
    t.satisfaction = { overall: 3, energy: 0 };
  };

  it('is uncalibrated until energy ratings span calibrationWeeks distinct weeks', () => {
    const s = new Schedule({ config: wide() });
    expect(s.energyCalibration().calibrated).toBe(false);
    rateEnergy(s, 15); rateEnergy(s, 16); // both the same ISO week
    expect(s.energyCalibration().weeksRated).toBe(1);
    expect(s.energyCalibration().calibrated).toBe(false);
    rateEnergy(s, 8); rateEnergy(s, 1); // two more distinct weeks → 3
    const cal = s.energyCalibration();
    expect(cal.weeksRated).toBe(3);
    expect(cal.calibrated).toBe(true);
  });
});

describe('learned capacity (from your own ratings, not fabricated)', () => {
  beforeEach(() => resetIds());
  const sched = () => { const s = new Schedule({ config: wide() }); s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } }); return s; };
  const workDay = (s, day, hours, energy) => {
    for (let h = 0; h < hours; h += 1) {
      const t = s.addFixed({ title: `w${day}-${h}`, tags: ['work'], startTime: D(day, 8 + h), endTime: D(day, 9 + h) });
      t.completion = 'done'; t.satisfaction = { overall: 3, energy };
    }
  };

  it('is null until calibrated', () => {
    expect(learnedCapacity(sched())).toBeNull();
  });

  it('learns capacity from the deepest dip on days you rated non-drained', () => {
    const s = sched();
    workDay(s, 1, 3, 0); // three weeks of 3h work you felt fine about → mental dips to 6
    workDay(s, 8, 3, 0);
    workDay(s, 15, 3, 0);
    expect(learnedCapacity(s).mental).toBe(6); // the tolerated dip, not the prior 8
  });

  it('excludes drained days — a day you rated negative does not raise capacity', () => {
    const s = sched();
    workDay(s, 1, 3, 0);
    workDay(s, 8, 3, 0);
    workDay(s, 15, 3, 0); // 3 OK days at dip 6
    workDay(s, 2, 5, -1); // a drained day dipping to 10 — not evidence of tolerance
    expect(learnedCapacity(s).mental).toBe(6); // still 6, not 10
  });
});

describe('per-activity load override', () => {
  beforeEach(() => resetIds());

  it('flows to the placed task and overrides the bucket in the budget', () => {
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } }); // bucket default: mental +2, creative 0
    const a = s.addActivity({ bucketId: s.buckets[0].id, label: 'Design', tags: ['work'], durationMin: 60, durationMax: 60, load: { mental: 1, creative: 2 } });
    const { task } = s.placeActivity(a, D(15, 10), 60);

    expect(task.load).toEqual({ mental: 1, physical: 0, social: 0, creative: 2 });
    const b = s.energyBudget(D(15, 12));
    expect(b.creative.net).toBe(2); // the override, not the bucket's 0
    expect(b.mental.net).toBe(1); // the override, not the bucket's +2
  });

  it('an activity without an override derives its energy from its tags (not pinned)', () => {
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    const a = s.addActivity({ bucketId: s.buckets[0].id, label: 'Email', tags: ['work'], durationMin: 30, durationMax: 30 });
    expect(a.load).toBeNull();
    const { task } = s.placeActivity(a, D(15, 10), 30);
    expect(task.load).toBeNull(); // not pinned — the placed task derives from its tags
    const b = s.energyBudget(D(15, 12));
    expect(b.mental.net).toBe(1); // 30 min × +2/hr, derived from the 'work' bucket
  });
});
