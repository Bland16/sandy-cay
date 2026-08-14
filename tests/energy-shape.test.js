// spendRestore — the week's spend and restore, kept apart (design/energy-radar-mockups.html).
//
// The case for the whole feature is the last test here: two weeks with an
// IDENTICAL net that are obviously not the same week. Net alone calls them both
// steady, and that is what this exists to fix.
import { describe, it, expect } from 'vitest';
import { Schedule, Task, Bucket, defaultConfig, resetIds, spendRestore, LOAD_AXES } from '../src/core/index.js';

const at = (d, hh) => new Date(2026, 10, d, hh, 0, 0, 0);

/** A schedule whose buckets carry real load, since load comes from tags. */
const seed = () => {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.buckets.push(new Bucket({
    label: 'Study', tags: ['study'],
    load: { mental: 2, physical: 0, social: 0, creative: 1 },
  }));
  s.buckets.push(new Bucket({
    label: 'Rest', tags: ['rest'],
    load: { mental: -2, physical: 0, social: 0, creative: -1 },
  }));
  return s;
};

const add = (s, tags, day, from, to) => {
  const t = new Task({ title: tags.join('+'), tags, type: 'fixed', startTime: at(day, from), endTime: at(day, to) });
  s.tasks.push(t);
  return t;
};

describe('spendRestore', () => {
  it('weights by hours, exactly as the reserve walk does', () => {
    const s = seed();
    add(s, ['study'], 23, 9, 12); // 3h at mental +2 → 6
    const r = spendRestore(s, s.tasks);
    expect(r.axes.mental.spend).toBeCloseTo(6, 6);
    expect(r.axes.mental.restore).toBeCloseTo(0, 6);
    expect(r.axes.creative.spend).toBeCloseTo(3, 6); // 3h at +1
  });

  it('keeps restore out of spend rather than netting them', () => {
    const s = seed();
    add(s, ['study'], 23, 9, 12); // +6 mental
    add(s, ['rest'], 23, 13, 15); // 2h at −2 → 4 restored
    const r = spendRestore(s, s.tasks);
    expect(r.axes.mental.spend).toBeCloseTo(6, 6);
    expect(r.axes.mental.restore).toBeCloseTo(4, 6);
    expect(r.axes.mental.net).toBeCloseTo(2, 6);
  });

  it('net always equals spend minus restore, on every axis and in total', () => {
    const s = seed();
    add(s, ['study'], 23, 9, 12);
    add(s, ['rest'], 24, 13, 16);
    const r = spendRestore(s, s.tasks);
    for (const a of LOAD_AXES) {
      expect(r.axes[a].net).toBeCloseTo(r.axes[a].spend - r.axes[a].restore, 6);
    }
    expect(r.totals.net).toBeCloseTo(r.totals.spend - r.totals.restore, 6);
  });

  it('ignores chunk parents and skipped work, as the rest of the model does', () => {
    const s = seed();
    const skipped = add(s, ['study'], 23, 9, 12);
    skipped.completion = 'skipped';
    const parent = add(s, ['study'], 24, 9, 12);
    parent.chunking = { totalMinutes: 180 };
    expect(spendRestore(s, s.tasks).any).toBe(false);
  });

  it('says when there is nothing to weigh, rather than drawing an empty shape', () => {
    const s = seed();
    add(s, ['untagged-by-any-bucket'], 23, 9, 12);
    const r = spendRestore(s, s.tasks);
    // Zeros because no bucket claims the tag — NOT because the week was quiet.
    expect(r.any).toBe(false);
    expect(r.totals.spend).toBe(0);
  });

  it('distinguishes a busy balanced week from an empty one — identical net', () => {
    const busy = seed();
    add(busy, ['study'], 23, 9, 12);   // +6 mental
    add(busy, ['rest'], 23, 13, 16);   // −6 mental
    const empty = seed();

    const b = spendRestore(busy, busy.tasks);
    const e = spendRestore(empty, empty.tasks);

    // Net cannot tell them apart...
    expect(b.axes.mental.net).toBeCloseTo(0, 6);
    expect(e.axes.mental.net).toBeCloseTo(0, 6);
    // ...and the split can. This is the entire reason the chart exists.
    expect(b.axes.mental.spend).toBeCloseTo(6, 6);
    expect(e.axes.mental.spend).toBe(0);
    expect(b.any).toBe(true);
    expect(e.any).toBe(false);
  });
});
