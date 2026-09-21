// E-1 — `learnedCapacity` is the 70th percentile over rated days, behind two
// gates, replacing `Math.max` over tolerated days (design/PLAN-AUDIT-2.md E-1,
// chosen by the user 2026-09-20).
//
// ⚠️ THE EXISTING ENERGY TESTS CANNOT SEE THIS CHANGE. They calibrate on three
// IDENTICAL days, and max([6,6,6]) === p70([6,6,6]) === 6. Every one of them
// stayed green through the swap. This file exists because a change nothing can
// fail on is a change nothing is protecting.
//
// Each expectation below was run against `Math.max` and watched to fail.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Schedule, learnedCapacity } from '../src/core/index.js';

const D = (d, h, mi = 0) => new Date(2026, 6, d, h, mi, 0, 0);

// ⚠️ SPREAD ACROSS THREE ISO WEEKS. `energyCalibration` gates on ratings in at
// least `calibrationWeeks` (3) distinct weeks, so five consecutive days earn
// nothing and `learnedCapacity` returns null for every axis — which is correct,
// and makes a fixture that ignores it look like a broken estimator.
const W = [1, 2, 8, 9, 15]; // Wed/Thu of week 1, Wed/Thu of week 2, Wed of week 3

// Pinned: calibration only counts ratings inside `evidenceWindowDays`, so a
// fixture measured against the real clock rots the day the gap passes 56.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 6, 20, 6, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

const wide = (extra = {}) => ({
  windows: { monFri: { start: '06:00', end: '23:00' }, sat: { start: '06:00', end: '23:00' }, sun: { start: '06:00', end: '23:00' } },
  ...extra,
});

/**
 * A schedule whose rated days have the given mental dips, in hours of +2/hr
 * work. `rating` is the energy facet for that day; `unmarked` leaves N of the
 * day's work blocks without a completion.
 */
function schedOf(days) {
  const s = new Schedule({ config: { ...wide() } });
  s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
  days.forEach(({ day, hours, energy = 0, unmarked = 0 }) => {
    for (let i = 0; i < hours; i += 1) {
      const w = s.addFixed({ title: `w${day}-${i}`, tags: ['work'], startTime: D(day, 7 + i), endTime: D(day, 8 + i) });
      if (i >= unmarked) w.completion = 'done';
    }
    const r = s.addFixed({ title: `r${day}`, tags: ['x'], startTime: D(day, 5), endTime: D(day, 6) });
    r.completion = 'done';
    r.satisfaction = { overall: 3, energy };
  });
  return s;
}

const NOW = () => new Date(2026, 6, 20, 6, 0, 0);

describe('E-1 — capacity is a quantile, not a maximum', () => {
  it('one outlier day does NOT set the ceiling', () => {
    // Dips of 2, 2, 2, 2, 10 (h × 2/hr). `max` publishes 10 — the physical axis
    // on the real save was exactly this shape, 7.31 against four observations
    // between 2.50 and 3.13. p70 lands in the body of the distribution.
    const s = schedOf([
      { day: W[0], hours: 1 }, { day: W[1], hours: 1 }, { day: W[2], hours: 1 },
      { day: W[3], hours: 1 }, { day: W[4], hours: 5 },
    ]);
    const cap = learnedCapacity(s, NOW());
    expect(cap.mental).toBeLessThan(10);   // was exactly 10 under Math.max
    expect(cap.mental).toBeCloseTo(2.0, 5); // p70 of [2,2,2,2,10]
  });

  it('the ceiling can move DOWN when tolerance drops — Math.max never could', () => {
    const heavy = schedOf([
      { day: W[0], hours: 5 }, { day: W[1], hours: 5 }, { day: W[2], hours: 5 }, { day: W[4], hours: 5 },
    ]);
    const lighter = schedOf([
      { day: W[0], hours: 5 }, { day: W[1], hours: 1 }, { day: W[2], hours: 1 }, { day: W[4], hours: 1 },
    ]);
    const a = learnedCapacity(heavy, NOW()).mental;
    const b = learnedCapacity(lighter, NOW()).mental;
    expect(b).toBeLessThan(a);
    // Under Math.max both would publish 10 — the single heaviest day survives
    // every later light one, which is the ratchet the quantile removes.
  });

  it('GATE 1 — a day rated badly may not raise the ceiling', () => {
    const withBadHeavyDay = schedOf([
      { day: W[0], hours: 1 }, { day: W[1], hours: 1 }, { day: W[2], hours: 1 },
      { day: W[4], hours: 10, energy: -1 }, // brutal, and it felt brutal
    ]);
    const cap = learnedCapacity(withBadHeavyDay, NOW());
    // The 20-hour dip is excluded entirely — "it was probably too much".
    expect(cap.mental).toBeCloseTo(2.0, 5);
  });

  // ⚠️ THIS ISOLATES GATE 2 FROM RULE (e), and the first draft did not. Rule (e)
  // already gives a half-tracked day a SMALLER dip (its unmarked hours are not
  // charged), so "tracked scores higher than untracked" passes with the gate
  // switched off and proves nothing about the gate. Caught by reverting.
  //
  // What gate 2 does that rule (e) does not is DROP THE DAY ENTIRELY. So the
  // fixture below gives the badly-tracked day enough MARKED work that its
  // reduced dip would still move the quantile if it were counted.
  it('GATE 2 — a day with more than one unmarked task is dropped, not merely discounted', () => {
    const s = schedOf([
      { day: W[0], hours: 1 },                    // dip 2
      { day: W[2], hours: 1 },                    // dip 2
      { day: W[4], hours: 6, unmarked: 2 },       // 4 marked hours -> dip 8
    ]);
    // Gate 2 on:  pool is [2, 2]        -> p70 = 2
    // Gate 2 off: pool is [2, 2, 8]     -> p70 = 4.4
    expect(learnedCapacity(s, NOW()).mental).toBeCloseTo(2.0, 5);
  });

  it('GATE 2 forgives exactly one unmarked task', () => {
    const one = schedOf([
      { day: W[0], hours: 1 }, { day: W[2], hours: 1 }, { day: W[4], hours: 6, unmarked: 1 },
    ]);
    const two = schedOf([
      { day: W[0], hours: 1 }, { day: W[2], hours: 1 }, { day: W[4], hours: 6, unmarked: 2 },
    ]);
    // One forgiven: the day counts, on its five marked hours -> dip 10, so the
    // quantile rises above the two light days. Two: the day is gone.
    expect(learnedCapacity(one, NOW()).mental).toBeGreaterThan(2.0);
    expect(learnedCapacity(two, NOW()).mental).toBeCloseTo(2.0, 5);
  });

  it('still returns null for an axis with no evidence — P-2 is untouched', () => {
    const s = schedOf([{ day: W[0], hours: 3 }, { day: W[2], hours: 3 }, { day: W[4], hours: 3 }]);
    const cap = learnedCapacity(s, NOW());
    expect(cap.mental).toBeGreaterThan(0);
    expect(cap.physical).toBeNull();
    expect(cap.social).toBeNull();
    expect(cap.creative).toBeNull();
  });

  it('needs at least two evidence days on an axis', () => {
    // Three rated days, so calibration's three-week gate opens — but only ONE
    // of them spends anything on mental. Calibration is global; evidence is
    // per-axis, and one day is not a distribution.
    const s = schedOf([
      { day: W[0], hours: 3 }, { day: W[2], hours: 0 }, { day: W[4], hours: 0 },
    ]);
    expect(learnedCapacity(s, NOW()).mental).toBeNull();

    // A second spending day earns it.
    const s2 = schedOf([
      { day: W[0], hours: 3 }, { day: W[2], hours: 3 }, { day: W[4], hours: 0 },
    ]);
    expect(learnedCapacity(s2, NOW()).mental).toBeGreaterThan(0);
  });
});
