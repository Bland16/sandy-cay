// The starter tag vocabulary a new schedule begins with.
//
// This sits deliberately close to two locked decisions, so the tests state
// where the line is:
//
//   Sharp edge #10 — "the app ships EMPTY, don't reintroduce demo data".
//   That protects against demo TASKS: a showroom week you must clear out
//   before your own life fits. Buckets are vocabulary, not content — no tasks,
//   no times, nothing to delete.
//
//   P-2 / Bucket.js — load is "user-authored, never a fabricated per-role
//   guess". What P-2 forbids inventing is CAPACITY, what you can handle, and
//   that is still learned from ratings and still null until calibrated. Load is
//   the other half — what a thing costs — and a starter set is a first draft of
//   it, fully editable.
//
// Without any buckets the energy model is INERT: every task's load computes to
// zero, so the battery, deepest-dip, reserve-aware suggestions and card tints
// all silently do nothing. A real user was found in exactly that state after
// weeks of use — sixteen tags, zero buckets — with no sign the feature existed.
import { describe, it, expect } from 'vitest';
import { Schedule, seedStarterBuckets, STARTER_BUCKETS } from '../src/core/index.js';
import { loadForTask, LOAD_AXES, learnedCapacity } from '../src/core/energy.js';

const withStarters = () => {
  const s = new Schedule({});
  seedStarterBuckets(s);
  return s;
};

describe('the starter set itself', () => {
  it('every bucket carries a load — a neutral one would do nothing at all', () => {
    // The reversal this set exists for: loadForTask averages the buckets a
    // task's tags touch, so an all-neutral starter set still computes to an
    // all-zero vector and the energy model stays switched off.
    for (const b of STARTER_BUCKETS) {
      expect(LOAD_AXES.some((a) => b.load[a] !== 0)).toBe(true);
    }
  });

  it('keeps every load inside the [-2, 2] the engine clamps to', () => {
    for (const b of STARTER_BUCKETS) {
      for (const axis of LOAD_AXES) {
        expect(b.load[axis]).toBeGreaterThanOrEqual(-2);
        expect(b.load[axis]).toBeLessThanOrEqual(2);
      }
    }
  });

  it('uses no tag in two buckets — an ambiguous tag would average oddly', () => {
    const seen = new Set();
    for (const b of STARTER_BUCKETS) {
      for (const t of b.tags) {
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  it('spans demanding, mixed and restorative — not all one character', () => {
    const net = (b) => LOAD_AXES.reduce((a, x) => a + b.load[x], 0);
    expect(STARTER_BUCKETS.some((b) => net(b) > 0)).toBe(true);  // costs
    expect(STARTER_BUCKETS.some((b) => net(b) < 0)).toBe(true);  // restores
  });
});

describe('what it actually makes the engine do', () => {
  it('turns the energy model ON — a tagged task carries a real load', () => {
    const s = withStarters();
    const load = loadForTask(s, { tags: ['study'] });
    expect(load.mental).toBeGreaterThan(0);
    // Without buckets this is the all-zero vector the feature was stuck at.
    expect(LOAD_AXES.some((a) => load[a] !== 0)).toBe(true);
  });

  it('an untagged task still costs nothing — no load is invented', () => {
    expect(loadForTask(withStarters(), { tags: [] }))
      .toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
  });

  it('a tag nobody claims costs nothing either', () => {
    expect(loadForTask(withStarters(), { tags: ['important immovables'] }))
      .toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
  });

  it('separates the gym from an appointment — the case a four-axis model is FOR', () => {
    const s = withStarters();
    const gym = loadForTask(s, { tags: ['gym'] });
    const appt = loadForTask(s, { tags: ['appointment'] });
    // Both would be "health". They are opposite on the mental axis: exercise
    // costs the body and pays the head back; an appointment costs the head and
    // pays nothing.
    expect(gym.mental).toBeLessThan(0);
    expect(appt.mental).toBeGreaterThan(0);
    expect(gym.physical).toBeGreaterThan(0);
  });

  it('is calibrated so the costliest thing fills a default day in four hours', () => {
    const s = withStarters();
    const study = loadForTask(s, { tags: ['study'] });
    const hoursToFill = s.config.energy.capacity.mental / study.mental;
    expect(hoursToFill).toBeGreaterThanOrEqual(3);
    expect(hoursToFill).toBeLessThanOrEqual(5);
  });
});

describe('what it does NOT do', () => {
  it('ships no tasks — "the app ships empty" is about content, and holds', () => {
    const s = withStarters();
    expect(s.tasks).toHaveLength(0);
    expect(s.zones).toHaveLength(0);
    expect(s.activities).toHaveLength(0);
  });

  it('does not invent a capacity — that is still learned, and still null', () => {
    // The honesty rule P-2 protects: the app may not state what you can handle
    // until your own ratings say so. A starter load vector is not a claim
    // about you; a capacity ceiling would be.
    expect(learnedCapacity(withStarters())).toBeNull();
  });
});
