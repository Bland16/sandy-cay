import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { driftCheck, starvationCheck, skipStreakCheck, pinnedRatioNote, overpackCheck } from '../src/core/detectors.js';
import { defaultConfig } from '../src/core/config.js';
import { addDays, dateKey } from '../src/core/time.js';

const W0 = new Date(2026, 6, 13, 0, 0, 0, 0);

describe('§7.2/7.3 detectors', () => {
  beforeEach(() => resetIds());

  it('drift: ≥4 of last 5 occurrences moved same direction ≥30min', () => {
    const t = new Task({
      title: 'Gym',
      type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    // 5 weeks all moved to 10:00 (+120 min).
    for (let i = 0; i < 5; i += 1) {
      t.recurrence.exceptions.push({ date: dateKey(addDays(W0, i * 7)), action: 'move', start: '10:00', end: '11:00' });
    }
    const res = driftCheck(t, defaultConfig);
    expect(res.drift).toBe(true);
    expect(res.direction).toBe('later');
    expect(res.median).toBe(120);
  });

  it('starvation: displaced + carried ≥ 3', () => {
    const t = new Task({ title: 'Guitar', startTime: W0, endTime: addDays(W0, 0) });
    t.history.displacedCount = 2;
    t.history.carriedCount = 1;
    expect(starvationCheck(t, defaultConfig).starving).toBe(true);
    expect(starvationCheck(t, defaultConfig).count).toBe(3);
  });

  it('skip-streak: ≥3 consecutive weeks EXPLICITLY skipped', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = new Task({
      title: 'Gym',
      type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    // Mark 3 weeks skipped in occurrenceData.
    for (let i = 0; i < 3; i += 1) {
      t.occurrenceData[dateKey(addDays(W0, i * 7))] = { completion: 'skipped' };
    }
    s.tasks.push(t);
    const weekStarts = [addDays(W0, 14), addDays(W0, 7), W0]; // most recent first
    const res = skipStreakCheck(s, t, weekStarts, defaultConfig);
    expect(res.streak).toBe(3);
    expect(res.flag).toBe(true);
  });

  /** The same gym, with whatever `occurrenceData` you hand it. */
  const gym = (data) => {
    const t = new Task({
      title: 'Gym', type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    for (let i = 0; i < 3; i += 1) {
      const d = data(i);
      if (d) t.occurrenceData[dateKey(addDays(W0, i * 7))] = d;
    }
    return t;
  };
  const weeks = [addDays(W0, 14), addDays(W0, 7), W0]; // most recent first
  const streakOf = (t) => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(t);
    return skipStreakCheck(s, t, weeks, defaultConfig);
  };

  // ⚠️ AN UNRATED SESSION IS NOT A SESSION THAT DID NOT HAPPEN. This counted a
  // week when every occurrence was skipped OR CARRIED NO RATING, and the report
  // prints the result as fact — "Gym hasn't happened in 3 weeks" — with "Let it
  // go" beside it. Rating is optional everywhere else in this app; here its
  // absence was read as absence of the event.
  it('does not call a session you went to and never rated a session you skipped', () => {
    const res = streakOf(gym(() => ({ completion: 'done' })));
    expect(res.streak).toBe(0);
    expect(res.flag).toBe(false);
  });

  it('treats a partial the same way — it happened', () => {
    expect(streakOf(gym(() => ({ completion: 'partial' }))).flag).toBe(false);
  });

  // The third state, and the one the old rule collapsed into "skipped": no
  // record at all means WE DO NOT KNOW, which is not evidence of absence. The
  // detector goes quiet rather than asserting something it cannot support.
  it('says nothing about weeks it has no record of', () => {
    const res = streakOf(gym(() => null));
    expect(res.streak).toBe(0);
    expect(res.flag).toBe(false);
  });

  // …and a real skip still counts, or the fix has simply disabled the detector.
  it('still counts weeks that were actually skipped, and stops at the one that was not', () => {
    expect(streakOf(gym(() => ({ completion: 'skipped' }))).streak).toBe(3);
    // most-recent-first: skipped, skipped, then a week you turned up for.
    const mixed = gym((i) => (i === 0 ? { completion: 'done' } : { completion: 'skipped' }));
    const res = streakOf(mixed);
    expect(res.streak).toBe(2);
    expect(res.flag).toBe(false);
  });

  it('pinnedRatio note fires above 0.5', () => {
    expect(pinnedRatioNote({ pinnedRatio: 0.62 }, defaultConfig).note).toBe(true);
    expect(pinnedRatioNote({ pinnedRatio: 0.4 }, defaultConfig).note).toBe(false);
  });

  it('overpack: ≥3 days avg break ≤ minimum × 1.5', () => {
    const s = new Schedule({ config: defaultConfig });
    // Build 3 days each with two back-to-back tasks (0-min break).
    for (let d = 0; d < 3; d += 1) {
      s.addFixed({ title: `a${d}`, startTime: new Date(2026, 6, 13 + d, 9, 0), endTime: new Date(2026, 6, 13 + d, 11, 0) });
      s.addFixed({ title: `b${d}`, startTime: new Date(2026, 6, 13 + d, 11, 0), endTime: new Date(2026, 6, 13 + d, 13, 0) });
    }
    const res = overpackCheck(s, W0, defaultConfig);
    expect(res.overpacked).toBe(true);
    expect(res.packedDays).toBeGreaterThanOrEqual(3);
  });
});
