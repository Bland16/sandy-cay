// The sleep safeguard (config.sleep.minHoursBeforeNextDay) and the widened
// 23:00 windows. Physics, not preference: it clips the legal window.
import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/Schedule.js';
import { computeWindows, sleepCutoff } from '../src/core/placement.js';

const D = (d, h, mi = 0) => new Date(2026, 8, d, h, mi, 0, 0); // Sep 2026
const MON = D(7, 0);

const lastEnd = (wins) => wins.reduce((m, w) => (m && m > w.end ? m : w.end), null);

describe('config.windows widened to 23:00', () => {
  it('makes the evening legal for automatic placement', () => {
    const s = new Schedule({});
    expect(s.config.windows.monFri.end).toBe('23:00');
    const wins = computeWindows(s, { tags: [], deadline: null }, MON);
    expect(lastEnd(wins).getHours()).toBe(23);
  });
});

describe('sleep guard', () => {
  it('does nothing when tomorrow is empty', () => {
    const s = new Schedule({});
    expect(sleepCutoff(s, MON)).toBeNull();
  });

  it('does not bite when tomorrow starts at 09:00 (23:00 window is the binding limit)', () => {
    const s = new Schedule({});
    s.addFixed({ title: 'Class', startTime: D(8, 9, 0), endTime: D(8, 10, 0) });
    // 09:00 − 8h = 01:00 next day, which is later than the 23:00 window end.
    const cutoff = sleepCutoff(s, MON);
    expect(cutoff.getDate()).toBe(8);
    expect(cutoff.getHours()).toBe(1);
    expect(lastEnd(computeWindows(s, { tags: [], deadline: null }, MON)).getHours()).toBe(23);
  });

  it('pulls tonight back when tomorrow starts early', () => {
    const s = new Schedule({});
    s.addFixed({ title: 'Early start', startTime: D(8, 6, 0), endTime: D(8, 7, 0) });
    const cutoff = sleepCutoff(s, MON);
    expect(cutoff.getDate()).toBe(7);
    expect(cutoff.getHours()).toBe(22); // 06:00 − 8h
    expect(lastEnd(computeWindows(s, { tags: [], deadline: null }, MON)).getHours()).toBe(22);
  });

  it('sees a RECURRING occurrence tomorrow, not just stored tasks', () => {
    const s = new Schedule({});
    s.addFixed({
      title: 'Weekly early lab',
      startTime: D(8, 6, 30), endTime: D(8, 8, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'tue', start: '06:30', end: '08:00' }], interval: 1, effectiveFrom: MON }],
        anchorDate: MON,
        exceptions: [],
      },
    });
    const cutoff = sleepCutoff(s, MON);
    expect(cutoff).not.toBeNull();
    expect(cutoff.getHours()).toBe(22);
    expect(cutoff.getMinutes()).toBe(30);
  });

  it('clips a zone too — a zone does not outrank the night before a 06:00 start', () => {
    const s = new Schedule({});
    s.addZone({
      label: 'Homework', matchTags: ['homework'], exclusive: false,
      windows: [{ day: 'mon', start: '20:00', end: '23:00' }],
    });
    s.addFixed({ title: 'Early start', startTime: D(8, 6, 0), endTime: D(8, 7, 0) });
    const wins = computeWindows(s, { tags: ['homework'], deadline: null }, MON);
    expect(lastEnd(wins).getHours()).toBe(22);
  });

  it('is off when configured to 0, and the full window returns', () => {
    const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
    s.addFixed({ title: 'Early start', startTime: D(8, 6, 0), endTime: D(8, 7, 0) });
    expect(sleepCutoff(s, MON)).toBeNull();
    expect(lastEnd(computeWindows(s, { tags: [], deadline: null }, MON)).getHours()).toBe(23);
  });

  it('places automatic work before the cutoff rather than after it', () => {
    const s = new Schedule({});
    s.addFixed({ title: 'Early start', startTime: D(8, 6, 0), endTime: D(8, 7, 0) });
    // Fill Monday up to 21:00 so the only late room is the guarded strip.
    s.addFixed({ title: 'All day', startTime: D(7, 8, 0), endTime: D(7, 21, 0) });
    const t = s.addFlexible({ title: 'Homework', durationMin: 60 }, { from: D(7, 8, 0) });
    const endsMonday = t.startTime.getDate() === 7;
    if (endsMonday) expect(t.endTime.getTime()).toBeLessThanOrEqual(D(7, 22, 0).getTime());
  });
});
