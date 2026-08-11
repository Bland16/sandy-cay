// The finish-early preference (WEEKLY-PLANNING §4.4).
//
// A deadline was only ever a HARD CAP on the search window — nothing could be
// placed past it, and nothing preferred earlier either, so a task due Friday
// 17:00 could legitimately land finishing 16:59. Meanwhile
// report.js#buildDeadlineBuffer has been measuring `deadline − scheduled end`
// and flagging anything under 24h as close to the wire: the app REPORTED on a
// quality it never OPTIMISED for. `buffer` closes that loop.
//
// It is a weight, not a rule. That is what makes the "obvious exceptions" — an
// overburdened week, a two-day deadline — need no special-case logic: they
// simply cannot score well on it and the other terms win.
import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { bufferScore, normalizeWeights, score } from '../src/core/scoring.js';
import { defaultConfig } from '../src/core/config.js';

const D = (dd, h, mi = 0) => new Date(2026, 8, dd, h, mi, 0, 0); // September 2026
const DEADLINE = D(18, 17); // Fri 18 Sep 17:00

describe('bufferScore — one fifth of the TASK, not of the runway', () => {
  it('is met once there is duration/5 to spare, and stays met beyond that', () => {
    // A 5h task wants 1h spare. More than that is not "better" — the term is
    // bounded so it cannot dominate a tight week.
    expect(bufferScore(D(18, 16), DEADLINE, 300)).toBe(1);      // exactly 1h spare
    expect(bufferScore(D(18, 15), DEADLINE, 300)).toBe(1);      // 2h spare
    expect(bufferScore(D(17, 17), DEADLINE, 300)).toBe(1);      // a day spare
  });

  it('falls away as the finish approaches the wire', () => {
    expect(bufferScore(D(18, 16, 30), DEADLINE, 300)).toBeCloseTo(0.5, 5); // 30m of a 60m target
    expect(bufferScore(D(18, 16, 59), DEADLINE, 300)).toBeLessThan(0.02);  // 1 minute spare
    expect(bufferScore(DEADLINE, DEADLINE, 300)).toBe(0);                  // finishing exactly at it
  });

  it('scales the target with the size of the job — it is an overrun allowance', () => {
    // "If this runs 20% over, do I still make it?" A big job needs more slack;
    // a small one needs almost none.
    expect(bufferScore(D(18, 16), DEADLINE, 300)).toBe(1);        // 5h task, 1h spare → met
    expect(bufferScore(D(18, 16), DEADLINE, 1200)).toBeCloseTo(0.25, 5); // 20h task wants 4h
    expect(bufferScore(D(18, 16, 54), DEADLINE, 30)).toBe(1);     // 30m task wants only 6m
  });

  it('is a CONSTANT for a task with no deadline, so it cannot change a ranking', () => {
    expect(bufferScore(D(14, 9), null, 300)).toBe(1);
    expect(bufferScore(D(19, 9), null, 300)).toBe(1);
  });

  it('never goes negative when a slot somehow ends past the deadline', () => {
    expect(bufferScore(D(19, 9), DEADLINE, 300)).toBe(0);
  });
});

describe('the weight sits alongside the others', () => {
  it('renormalizes to sum 1 with buffer included', () => {
    const w = normalizeWeights(defaultConfig.weights);
    const sum = w.proximity + w.balance + w.stability + w.preference + w.buffer;
    expect(sum).toBeCloseTo(1, 10);
    expect(w.buffer).toBeGreaterThan(0.2); // "a strong preference", per the user
  });

  it('an all-zero weight set still degrades to something usable', () => {
    const w = normalizeWeights({});
    expect(w.proximity + w.balance + w.stability + w.preference + w.buffer).toBeCloseTo(1, 10);
  });

  it('DISCRIMINATES between two slots identical on every other axis', () => {
    // This is the test that proves the term does work rather than proximity
    // quietly taking the credit: every other input is held equal.
    const common = {
      origin: D(14, 8),
      lookaheadHorizonMin: 60 * 24 * 7,
      dayFillAfter: 0.3,
      stability: 0,
      modelScore: 0.5,
      bufferDurationMin: 300,
      deadline: DEADLINE,
      weights: normalizeWeights(defaultConfig.weights),
      slotStart: D(18, 12), // SAME start for both, so proximity is identical
    };
    const comfortable = score({ ...common, slotEnd: D(18, 16) });     // 1h spare
    const atTheWire = score({ ...common, slotEnd: D(18, 16, 59) });   // 1 minute spare
    expect(comfortable).toBeGreaterThan(atTheWire);
  });
});

describe('end to end', () => {
  const weekFrom = D(14, 0); // Mon 14 Sep
  const weekTo = D(20, 0);

  /** Place one flexible task under a given buffer weight. */
  const placeWith = (bufferWeight, taskData) => {
    const s = new Schedule({
      config: { ...defaultConfig, weights: { ...defaultConfig.weights, buffer: bufferWeight } },
    });
    return s.addFlexible({ durationMin: 120, from: weekFrom, to: weekTo, ...taskData });
  };

  it('a task with NO deadline is placed identically with the weight on or off', () => {
    // The guarantee that this change cannot disturb the majority of tasks,
    // which have no deadline at all.
    const off = placeWith(0, { title: 'Reading' });
    const on = placeWith(0.4, { title: 'Reading' });
    expect(on.startTime.getTime()).toBe(off.startTime.getTime());
  });

  it('a deadlined task is never placed past its deadline (the cap still rules)', () => {
    const t = placeWith(0.4, { title: 'Essay', deadline: DEADLINE });
    expect(t.endTime.getTime()).toBeLessThanOrEqual(DEADLINE.getTime());
  });

  it('leaves at least the target slack when the week can afford it', () => {
    const t = placeWith(0.4, { title: 'Essay', deadline: DEADLINE });
    const slackMin = (DEADLINE.getTime() - t.endTime.getTime()) / 60000;
    expect(slackMin).toBeGreaterThanOrEqual(120 / 5); // 24 min for a 2h task
  });

  it('still places when the week CANNOT afford the buffer — a preference yields', () => {
    // The "obvious exceptions" case, and the reason this is a weight: a task
    // whose deadline is two hours away simply cannot have its 24 minutes, and
    // must still be placed rather than refused.
    const s = new Schedule({ config: defaultConfig });
    const tight = D(14, 10); // deadline at 10:00 with the day opening at 08:00
    const t = s.addFlexible({
      title: 'Right now', durationMin: 120, from: D(14, 8), to: D(14, 23), deadline: tight,
    });
    expect(t.startTime).toBeTruthy();
    expect(t.endTime.getTime()).toBeLessThanOrEqual(tight.getTime());
  });
});
