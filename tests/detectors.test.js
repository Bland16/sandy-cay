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

  it('skip-streak: ≥3 consecutive weeks skipped/unrated', () => {
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
