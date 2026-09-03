// The finish-early preference (WEEKLY-PLANNING §4.4).
//
// A deadline was only ever a HARD CAP on the search window — nothing could be
// placed past it, and nothing preferred earlier either, so a task due Friday
// 17:00 could legitimately land finishing 16:59. Meanwhile
// report.js#buildDeadlineBuffer has been measuring `deadline − scheduled end`
// and flagging anything under 24h as close to the wire: the app REPORTED on a
// quality it never OPTIMISED for. `buffer` closes that loop.
//
// CORRECTED 2026-08-12: the target is one fifth of the RUNWAY (plan-time →
// deadline), not one fifth of the task's own length. "Due at the end of the
// week" should mean "be done by Friday", which is a fact about the runway; a
// 2-hour task and a 20-minute one due the same Friday deserve the same aim.
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
const MONDAY = D(14, 9);    // Mon 14 Sep 09:00 — plan time. Runway = 4d 8h = 6240 min.
const FIFTH = 6240 / 5;     // 1248 min = 20h 48m → aim to finish by Thu 18 Sep 20:12
                            // (i.e. Thursday evening, for a Friday-afternoon deadline)

describe('bufferScore — one fifth of the RUNWAY, not of the task', () => {
  it('is met once a fifth of the runway is clear, and stays met beyond that', () => {
    // Planning on Monday for a Friday 17:00 deadline: be done by Thursday.
    expect(bufferScore(D(17, 20, 12), DEADLINE, MONDAY)).toBeCloseTo(1, 5); // exactly a fifth clear
    expect(bufferScore(D(17, 12), DEADLINE, MONDAY)).toBe(1);               // Thursday midday
    expect(bufferScore(D(15, 9), DEADLINE, MONDAY)).toBe(1);                // Tuesday — well clear
  });

  it('falls away as the finish approaches the wire', () => {
    const half = new Date(DEADLINE.getTime() - (FIFTH / 2) * 60000);
    expect(bufferScore(half, DEADLINE, MONDAY)).toBeCloseTo(0.5, 5);
    expect(bufferScore(D(18, 16, 59), DEADLINE, MONDAY)).toBeLessThan(0.01); // 1 minute spare
    expect(bufferScore(DEADLINE, DEADLINE, MONDAY)).toBe(0);                 // finishing exactly at it
  });

  it('does NOT scale with the size of the job — the runway is the whole story', () => {
    // This is the correction. Two tasks due the same Friday aim at the same
    // moment whatever their length, because "how much notice you got" is what
    // decides how early is early, not "how big the job is".
    const thursdayEvening = D(17, 20, 12);
    expect(bufferScore(thursdayEvening, DEADLINE, MONDAY)).toBeCloseTo(1, 5);
    // Under the old task-length rule a 20-minute errand wanted 4 minutes and a
    // 20-hour job wanted 4 hours; now neither length appears in the maths at all.
  });

  it('gives a longer runway a proportionally larger target', () => {
    // Twenty days' notice on the same deadline wants four days clear, where a
    // Monday plan for the same Friday wanted twenty-one hours.
    const longNotice = D(-2, 17);    // 29 Aug 17:00 → runway 20 days → target 4 days
    expect(bufferScore(D(14, 17), DEADLINE, longNotice)).toBe(1);          // exactly 4 days clear
    expect(bufferScore(D(15, 17), DEADLINE, longNotice)).toBeCloseTo(0.75, 5); // 3 days clear
    expect(bufferScore(D(17, 17), DEADLINE, longNotice)).toBeCloseTo(0.25, 5); // 1 day clear
    // …while that last slot, judged against a Monday runway, is comfortably met.
    expect(bufferScore(D(17, 17), DEADLINE, MONDAY)).toBe(1);
  });

  it('SATURATES, which is what makes it different from proximity', () => {
    // The argument the original spec got wrong. proximity keeps preferring
    // earlier forever; buffer is satisfied at the target and then stops caring,
    // leaving the other weights free to pick among the earlier slots.
    expect(bufferScore(D(17, 20, 12), DEADLINE, MONDAY)).toBeCloseTo(1, 5);
    expect(bufferScore(D(14, 10), DEADLINE, MONDAY)).toBe(1); // four days earlier — no better
  });

  it('is a CONSTANT for a task with no deadline, so it cannot change a ranking', () => {
    expect(bufferScore(D(14, 9), null, MONDAY)).toBe(1);
    expect(bufferScore(D(19, 9), null, MONDAY)).toBe(1);
  });

  it('is neutral for OVERDUE work, where there is no runway left to divide', () => {
    // Deadline already behind the planning moment: the target would be negative.
    // Scoring must not skew — placement's step-4 parking is what handles this.
    expect(bufferScore(D(19, 9), DEADLINE, D(19, 8))).toBe(1);
    expect(bufferScore(D(19, 9), DEADLINE, DEADLINE)).toBe(1);
  });

  it('is neutral when no runway start is supplied at all', () => {
    expect(bufferScore(D(18, 16), DEADLINE, null)).toBe(1);
  });

  it('never goes negative when a slot somehow ends past the deadline', () => {
    expect(bufferScore(D(19, 9), DEADLINE, MONDAY)).toBe(0);
  });
});

describe('the weight sits alongside the others', () => {
  const total = (w) => w.proximity + w.balance + w.stability + w.preference + w.buffer + w.energy;

  it('renormalizes to sum 1 with buffer included', () => {
    const w = normalizeWeights(defaultConfig.weights);
    expect(total(w)).toBeCloseTo(1, 10);
    expect(w.buffer).toBeGreaterThan(0.2); // "a strong preference", per the user
  });

  // ⚠️ THIS IS A CEILING ON `energy`, and it is the user's, not an arbitrary
  // one. Every weight is renormalised against the sum, so adding to any term
  // takes from all the others. Holding buffer above 0.2 — the user's own "a
  // strong preference" — means `energy` cannot exceed about 0.35 without
  // quietly overruling a decision they already made.
  it('a heavier energy weight would erode the buffer preference', () => {
    const at = (e) => normalizeWeights({ ...defaultConfig.weights, energy: e }).buffer;
    expect(at(0.25)).toBeGreaterThan(0.2);
    expect(at(0.8)).toBeLessThan(0.2); // for the record, and as a tripwire
  });

  it('an all-zero weight set still degrades to something usable', () => {
    expect(total(normalizeWeights({}))).toBeCloseTo(1, 10);
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
      runwayStart: MONDAY,
      deadline: DEADLINE,
      weights: normalizeWeights(defaultConfig.weights),
      slotStart: D(18, 12), // SAME start for both, so proximity is identical
    };
    const comfortable = score({ ...common, slotEnd: D(18, 14) });     // 3h spare
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

  it('leaves at least a fifth of the runway spare when the week can afford it', () => {
    const t = placeWith(0.4, { title: 'Essay', deadline: DEADLINE });
    const runwayMin = (DEADLINE.getTime() - weekFrom.getTime()) / 60000;
    const slackMin = (DEADLINE.getTime() - t.endTime.getTime()) / 60000;
    expect(slackMin).toBeGreaterThanOrEqual(runwayMin / 5);
  });

  it('still places when the week CANNOT afford the buffer — a preference yields', () => {
    // The "obvious exceptions" case, and the reason this is a weight: a task
    // whose deadline is two hours away simply cannot have its fifth of runway,
    // and must still be placed rather than refused.
    const s = new Schedule({ config: defaultConfig });
    const tight = D(14, 10); // deadline at 10:00 with the day opening at 08:00
    const t = s.addFlexible({
      title: 'Right now', durationMin: 120, from: D(14, 8), to: D(14, 23), deadline: tight,
    });
    expect(t.startTime).toBeTruthy();
    expect(t.endTime.getTime()).toBeLessThanOrEqual(tight.getTime());
  });
});
