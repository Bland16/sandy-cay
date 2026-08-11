// DATES-AND-RECURRENCE P2 — monthly by position, monthly by date, and yearly.
//
// The rule that runs through all of it: a month that does not HAVE the
// requested day is SKIPPED, never clamped. Clamping "the 31st" to the 30th
// invents a session on a date nobody chose, and RFC 5545 skips too. "Last day"
// and "last <weekday>" are separate, always-fire options because of this.
import { describe, it, expect } from 'vitest';
import { Task } from '../src/core/Task.js';
import { expandRecurrence, splitPeriod } from '../src/core/recurrence.js';
import { weekStart, addDays, dateKey } from '../src/core/time.js';

const T = { start: '09:00', end: '10:00' };

/** Every date a pattern lands on across `weeks` weeks from `from`. */
function run(period, from, weeks, anchor) {
  const task = new Task({
    title: 'X',
    type: 'fixed',
    recurrence: {
      periods: [{ interval: 1, effectiveFrom: from, effectiveUntil: null, ...period }],
      anchorDate: anchor || from,
      exceptions: [],
    },
  });
  const out = [];
  let ws = weekStart(from);
  for (let i = 0; i < weeks; i++) {
    for (const o of expandRecurrence(task, ws)) out.push(dateKey(o.startTime));
    ws = addDays(ws, 7);
  }
  return out;
}

describe('monthly by position — "the first Tuesday"', () => {
  it('walks the month, not the week', () => {
    expect(run({ freq: 'monthly', windows: [{ day: 'tue', nth: 1, ...T }] }, new Date(2026, 8, 1), 18))
      .toEqual(['2026-09-01', '2026-10-06', '2026-11-03', '2026-12-01']);
  });

  it('handles a month that STARTS on the target weekday', () => {
    // 1 Oct 2026 is a Thursday, so the first Thursday is the 1st — not the 8th.
    // Assuming a month can't start on the target day is the classic off-by-one.
    expect(run({ freq: 'monthly', windows: [{ day: 'thu', nth: 1, ...T }] }, new Date(2026, 9, 1), 14))
      .toEqual(['2026-10-01', '2026-11-05', '2026-12-03']);
  });

  it('"the third Tuesday" is a different date each month', () => {
    expect(run({ freq: 'monthly', windows: [{ day: 'tue', nth: 3, ...T }] }, new Date(2026, 8, 1), 18))
      .toEqual(['2026-09-15', '2026-10-20', '2026-11-17', '2026-12-15']);
  });

  it('the LAST Tuesday always fires; a FIFTH one does not', () => {
    expect(run({ freq: 'monthly', windows: [{ day: 'tue', nth: -1, ...T }] }, new Date(2026, 8, 1), 18))
      .toEqual(['2026-09-29', '2026-10-27', '2026-11-24', '2026-12-29']);

    // Only July, October and January have five Fridays in this stretch —
    // August, September, November and December are all skipped.
    expect(run({ freq: 'monthly', windows: [{ day: 'fri', nth: 5, ...T }] }, new Date(2026, 6, 1), 40))
      .toEqual(['2026-07-31', '2026-10-30', '2027-01-29']);
  });
});

describe('monthly by date — "the 15th"', () => {
  it('keeps the date and lets the weekday drift', () => {
    expect(run({ freq: 'monthly', windows: [{ monthDay: 15, ...T }] }, new Date(2026, 8, 1), 18))
      .toEqual(['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']);
  });

  it('SKIPS months without a 31st rather than clamping to the 30th', () => {
    const got = run({ freq: 'monthly', windows: [{ monthDay: 31, ...T }] }, new Date(2026, 9, 1), 30);
    expect(got).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']);
    expect(got.some((d) => d.startsWith('2026-11'))).toBe(false); // November has 30
    expect(got.some((d) => d.startsWith('2027-02'))).toBe(false); // February has 28
  });

  it('"the last day" fires in every month, whatever its length', () => {
    expect(run({ freq: 'monthly', windows: [{ monthDay: -1, ...T }] }, new Date(2026, 9, 1), 22))
      .toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('is found in a week that STRADDLES two months', () => {
    // Mon 30 Nov – Sun 6 Dec holds 1 December. Checking only the week's own
    // month is how a straddled session silently disappears.
    const got = run({ freq: 'monthly', windows: [{ monthDay: 1, ...T }] }, new Date(2026, 10, 1), 14);
    expect(got).toContain('2026-12-01');
    expect(got).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('yearly', () => {
  it('repeats on the same calendar day each year', () => {
    expect(run({ freq: 'yearly', windows: [{ month: 9, monthDay: 3, ...T }] }, new Date(2026, 8, 1), 210))
      .toEqual(['2026-09-03', '2027-09-03', '2028-09-03', '2029-09-03', '2030-09-03']);
  });

  it('29 February runs only in leap years', () => {
    expect(run({ freq: 'yearly', windows: [{ month: 2, monthDay: 29, ...T }] }, new Date(2028, 1, 1), 480))
      .toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });
});

describe('interval parity counts in the pattern\'s own unit', () => {
  it('every 2nd MONTH means months, not weeks', () => {
    expect(run({ freq: 'monthly', interval: 2, windows: [{ day: 'tue', nth: 1, ...T }] }, new Date(2026, 8, 1), 30))
      .toEqual(['2026-09-01', '2026-11-03', '2027-01-05', '2027-03-02']);
  });

  it('every 3rd month, by date', () => {
    expect(run({ freq: 'monthly', interval: 3, windows: [{ monthDay: 10, ...T }] }, new Date(2026, 8, 1), 40))
      .toEqual(['2026-09-10', '2026-12-10', '2027-03-10']);
  });
});

describe('back-compat: a save written before P2', () => {
  it('has no freq key at all, and expands exactly as weekly', () => {
    expect(run({ windows: [{ day: 'tue', ...T }] }, new Date(2026, 8, 1), 5))
      .toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });

  it('keeps its weekly interval parity', () => {
    expect(run({ interval: 2, windows: [{ day: 'tue', ...T }] }, new Date(2026, 8, 1), 8))
      .toEqual(['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']);
  });
});

describe('freq survives the round trip', () => {
  it('is not dropped by the reviver or the serializer', () => {
    // It WAS dropped by both, and expanded as weekly with no error — the same
    // shape of bug as the footlocker import losing `snapshots` (sharp edge #15).
    const rec = {
      periods: [{ freq: 'monthly', interval: 1, windows: [{ day: 'tue', nth: 1, ...T }], effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
      anchorDate: new Date(2026, 8, 1),
      exceptions: [],
    };
    const task = new Task({ title: 'Club', type: 'fixed', recurrence: rec });
    expect(task.recurrence.periods[0].freq).toBe('monthly');

    const round = new Task(JSON.parse(JSON.stringify(task.toJSON())));
    expect(round.recurrence.periods[0].freq).toBe('monthly');
    expect(round.recurrence.periods[0].windows[0].nth).toBe(1);
    // And it still expands monthly after the trip, not weekly.
    expect(expandRecurrence(round, weekStart(new Date(2026, 9, 6))).map((o) => dateKey(o.startTime)))
      .toEqual(['2026-10-06']);
  });

  it('a weekly period still serializes with NO freq key, so old saves are byte-identical', () => {
    const task = new Task({
      title: 'Gym',
      type: 'fixed',
      recurrence: {
        periods: [{ interval: 1, windows: [{ day: 'tue', ...T }], effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
        anchorDate: new Date(2026, 8, 1),
        exceptions: [],
      },
    });
    expect('freq' in task.toJSON().recurrence.periods[0]).toBe(false);
  });
});

describe('editing a monthly pattern does not silently make it weekly', () => {
  it('splitPeriod inherits the frequency it is changing', () => {
    const task = new Task({
      title: 'Club',
      type: 'fixed',
      recurrence: {
        periods: [{ freq: 'monthly', interval: 1, windows: [{ day: 'tue', nth: 1, ...T }], effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
        anchorDate: new Date(2026, 8, 1),
        exceptions: [],
      },
    });
    splitPeriod(task, new Date(2026, 9, 1), [{ day: 'tue', nth: 1, start: '19:00', end: '20:00' }]);
    const active = task.recurrence.periods.find((p) => !p.effectiveUntil);
    expect(active.freq).toBe('monthly');
    expect(expandRecurrence(task, weekStart(new Date(2026, 10, 3))).map((o) => dateKey(o.startTime)))
      .toEqual(['2026-11-03']);
  });
});
