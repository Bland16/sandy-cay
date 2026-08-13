// An occurrence exception's times must survive a save whichever accepted form
// they were written in. A Date used to be shallow-copied to a full ISO string
// that nothing revived, and resolveTime then read it as 'HH:MM' — so the session
// did not land at the wrong time, it VANISHED.
import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/Schedule.js';
import { recurrenceToJSON } from '../src/core/recurrenceSerde.js';

const MON = new Date(2026, 8, 7, 0, 0, 0, 0);
const D = (d, h, mi = 0) => new Date(2026, 8, d, h, mi, 0, 0);

const build = (exception) => {
  const s = new Schedule({});
  s.addFixed({
    title: 'Gym', tags: ['gym'],
    startTime: D(8, 7, 0), endTime: D(8, 8, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'tue', start: '07:00', end: '08:00' }], interval: 1, effectiveFrom: MON }],
      anchorDate: MON,
      exceptions: [exception],
    },
  });
  return s;
};
const times = (s) => s.getTasksForWeek(MON)
  .filter((t) => t.isOccurrence)
  .map((t) => `${t.startTime.toTimeString().slice(0, 5)}-${t.endTime.toTimeString().slice(0, 5)}`);
const roundTrip = (s) => Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));

describe('exception times survive a save', () => {
  it("'HH:MM' round-trips (the form the UI writes)", () => {
    const s = build({ date: '2026-09-08', action: 'move', start: '11:00', end: '12:00' });
    expect(times(s)).toEqual(['11:00-12:00']);
    expect(times(roundTrip(s))).toEqual(['11:00-12:00']);
  });

  it('THE REGRESSION: a Date round-trips instead of deleting the session', () => {
    const s = build({ date: '2026-09-08', action: 'move', start: D(8, 11, 0), end: D(8, 12, 0) });
    expect(times(s)).toEqual(['11:00-12:00']);
    expect(times(roundTrip(s))).toEqual(['11:00-12:00']); // was [] — the session vanished
  });

  it('serialises a Date exception as HH:MM, not as an ISO timestamp', () => {
    const rec = {
      periods: [{ windows: [], interval: 1, effectiveFrom: MON, effectiveUntil: null }],
      anchorDate: MON,
      exceptions: [{ date: '2026-09-08', action: 'move', start: D(8, 11, 0), end: D(8, 12, 30) }],
    };
    const ex = recurrenceToJSON(rec).exceptions[0];
    expect(ex.start).toBe('11:00');
    expect(ex.end).toBe('12:30');
  });

  it('leaves a skip exception (no times) untouched', () => {
    const s = build({ date: '2026-09-08', action: 'skip' });
    expect(times(s)).toEqual([]);
    expect(times(roundTrip(s))).toEqual([]);
  });

  it('an ADD exception with Dates also survives', () => {
    const s = build({ date: '2026-09-08', action: 'add', start: D(8, 18, 0), end: D(8, 19, 0) });
    expect(times(s).sort()).toEqual(['07:00-08:00', '18:00-19:00']);
    expect(times(roundTrip(s)).sort()).toEqual(['07:00-08:00', '18:00-19:00']);
  });
});
