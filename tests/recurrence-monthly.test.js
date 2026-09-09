// DATES-AND-RECURRENCE P2 — monthly by position, monthly by date, and yearly.
//
// The rule that runs through all of it: a month that does not HAVE the
// requested day is SKIPPED, never clamped. Clamping "the 31st" to the 30th
// invents a session on a date nobody chose, and RFC 5545 skips too. "Last day"
// and "last <weekday>" are separate, always-fire options because of this.
import { describe, it, expect } from 'vitest';
import { Task } from '../src/core/Task.js';
import { expandRecurrence, splitPeriod, addException } from '../src/core/recurrence.js';
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

// ---------------------------------------------------------------------------
// "Every day", and the twice-a-day gap it sits next to (2026-08-11).
// ---------------------------------------------------------------------------
describe('every day', () => {
  it('is seven weekly windows, and expands to seven occurrences', () => {
    const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(run({ windows: DAYS.map((day) => ({ day, ...T })) }, new Date(2026, 8, 7), 1))
      .toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
        '2026-09-11', '2026-09-12', '2026-09-13']);
  });

  it('supports two sessions on the same day — meds at 08:00 and 20:00', () => {
    // Both windows used to collide on the identity `taskId@YYYY-MM-DD` and the
    // evening one was dropped in silence. Sessions are now numbered within
    // their day: the first keeps the bare key, later ones get `#2`.
    const got = run({
      windows: [
        { day: 'mon', start: '08:00', end: '08:15' },
        { day: 'mon', start: '20:00', end: '20:15' },
      ],
    }, new Date(2026, 8, 7), 1);
    expect(got).toEqual(['2026-09-07', '2026-09-07']);
  });
});

// ---------------------------------------------------------------------------
// Occurrence identity: one session = one identity, several sessions a day.
//
// A date used to carry exactly one occurrence, keyed `taskId@YYYY-MM-DD`, and
// anything else landing on it was silently dropped by emit()'s dedupe. That one
// limitation blocked TWO features: twice-a-day patterns, and "one extra gym
// this week" on a day the pattern already fills — the likeliest day to want one.
//
// The scheme: first session of a day keeps the BARE key, so every save written
// before this is byte-identical and every existing exception still matches.
// Later sessions get `#2`, `#3`, numbered by the window's DECLARED time so a
// move cannot renumber them and carry their lived data to a different session.
// An extra session gets its own namespace, `#add`.
// ---------------------------------------------------------------------------
describe('occurrence identity', () => {
  const twiceDaily = () => new Task({
    title: 'Meds', type: 'fixed',
    recurrence: {
      periods: [{
        interval: 1,
        windows: [
          { day: 'mon', start: '08:00', end: '08:15' },
          { day: 'mon', start: '20:00', end: '20:15' },
        ],
        effectiveFrom: new Date(2026, 8, 7), effectiveUntil: null,
      }],
      anchorDate: new Date(2026, 8, 7), exceptions: [],
    },
  });
  const MON = weekStart(new Date(2026, 8, 7));

  it('gives the first session of a day the BARE key, for back-compatibility', () => {
    const occ = expandRecurrence(twiceDaily(), MON);
    expect(occ[0].occurrenceDate).toBe('2026-09-07');
    expect(occ[1].occurrenceDate).toBe('2026-09-07#2');
    expect(occ[0].id.endsWith('@2026-09-07')).toBe(true);
  });

  // ⚠️ THE ORDINAL WAS A POSITION IN A SORTED LIST, AND A POSITION IS NOT AN
  // IDENTITY. `occurrenceData` is keyed by these strings, so renumbering hands
  // one session's lived data to another. The case above proves a MOVE does not
  // renumber; adding and removing windows did. Measured on an evening dose that
  // had been taken and rated, when a morning dose was added:
  //
  //   BEFORE   2026-09-09    @ 21:00  completion=done  satisfaction={overall:4}
  //   AFTER    2026-09-09    @ 09:00  completion=done  satisfaction={overall:4}
  //            2026-09-09#2  @ 21:00  completion=null  satisfaction=null
  //
  // A 09:00 session that never happened, marked done and carrying the evening's
  // rating; the evening that did happen, blank.
  it('does not hand a session\'s rating to a NEW one added earlier in the day', () => {
    const t = new Task({
      title: 'Meds', type: 'fixed',
      recurrence: {
        periods: [{
          interval: 1,
          windows: [{ day: 'mon', start: '20:00', end: '20:15' }],
          effectiveFrom: new Date(2026, 8, 7), effectiveUntil: null,
        }],
        anchorDate: new Date(2026, 8, 7), exceptions: [],
      },
    });
    t.occurrenceData = { '2026-09-07': { completion: 'done', satisfaction: { overall: 4 } } };
    expect(expandRecurrence(t, MON)[0].satisfaction).toEqual({ overall: 4 });

    // Appended exactly as the editor appends one: a plain window, no ordinal.
    t.recurrence.periods[0].windows.push({ day: 'mon', start: '08:00', end: '08:15' });
    const occ = expandRecurrence(t, MON).sort((a, b) => a.startTime - b.startTime);

    const morning = occ.find((o) => o.startTime.getHours() === 8);
    const evening = occ.find((o) => o.startTime.getHours() === 20);
    expect(evening.occurrenceDate).toBe('2026-09-07');       // unmoved
    expect(evening.satisfaction).toEqual({ overall: 4 });    // and it kept it
    expect(morning.occurrenceDate).toBe('2026-09-07#2');
    expect(morning.satisfaction).toBeNull();                 // it never happened
    expect(morning.completion).toBeNull();
  });

  // The same failure in reverse: deleting the morning dose used to promote the
  // evening one to the bare key, where it inherited the MORNING's history.
  it('does not hand a deleted session\'s rating to the one that outlives it', () => {
    const t = twiceDaily();
    expandRecurrence(t, MON); // the numbering is assigned on first read
    t.occurrenceData = {
      '2026-09-07': { completion: 'done', satisfaction: { overall: 5 } },   // 08:00
      '2026-09-07#2': { completion: 'done', satisfaction: { overall: 2 } }, // 20:00
    };
    t.recurrence.periods[0].windows = t.recurrence.periods[0].windows
      .filter((w) => w.start !== '08:00');

    const occ = expandRecurrence(t, MON);
    expect(occ).toHaveLength(1);
    expect(occ[0].startTime.getHours()).toBe(20);
    expect(occ[0].occurrenceDate).toBe('2026-09-07#2');   // still its own key
    expect(occ[0].satisfaction).toEqual({ overall: 2 });  // still its own rating
  });

  // ⚠️ THE UPGRADE MUST MOVE NOTHING. Every save in existence was keyed by the
  // old sorted-position rule, so a stored `#2` has to go on meaning the session
  // it means today. The backfill reproduces those numbers exactly and only then
  // freezes them.
  it('a save written before ordinals were stable keeps every key it had', () => {
    const t = twiceDaily();
    for (const w of t.recurrence.periods[0].windows) expect(w.seq).toBeUndefined();
    t.occurrenceData = {
      '2026-09-07': { completion: 'done', satisfaction: { overall: 5 } },
      '2026-09-07#2': { completion: 'done', satisfaction: { overall: 2 } },
    };

    const occ = expandRecurrence(t, MON).sort((a, b) => a.startTime - b.startTime);
    expect(occ[0].startTime.getHours()).toBe(8);
    expect(occ[0].occurrenceDate).toBe('2026-09-07');
    expect(occ[0].satisfaction).toEqual({ overall: 5 });
    expect(occ[1].occurrenceDate).toBe('2026-09-07#2');
    expect(occ[1].satisfaction).toEqual({ overall: 2 });
  });

  // Sharp edge #15: the ordinal is only an identity if it SURVIVES A SAVE.
  it('carries the ordinal through a round trip', () => {
    const t = twiceDaily();
    expandRecurrence(t, MON);
    const seqs = t.recurrence.periods[0].windows.map((w) => [w.start, w.seq]);
    expect(seqs).toEqual([['08:00', 1], ['20:00', 2]]);

    const back = Task.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
    expect(back.recurrence.periods[0].windows.map((w) => [w.start, w.seq])).toEqual(seqs);
  });

  it('numbers by the DECLARED time, so a move does not renumber the sessions', () => {
    // Move the morning dose to the evening. It must keep `#1`'s bare key —
    // otherwise its ratings would jump to the other session.
    const t = twiceDaily();
    addException(t, '2026-09-07', 'move', { start: '21:00', end: '21:15' });
    const occ = expandRecurrence(t, MON);
    const moved = occ.find((o) => o.occurrenceDate === '2026-09-07');
    expect(moved).toBeTruthy();
    expect(moved.startTime.getHours()).toBe(21); // moved…
    expect(occ.find((o) => o.occurrenceDate === '2026-09-07#2')).toBeTruthy(); // …other intact
  });

  it('skips ONE session of a day, not the whole day', () => {
    const t = twiceDaily();
    addException(t, '2026-09-07#2', 'skip'); // just the evening dose
    const occ = expandRecurrence(t, MON);
    expect(occ.map((o) => o.occurrenceDate)).toEqual(['2026-09-07']);
    expect(occ[0].startTime.getHours()).toBe(8);
  });

  it('a bare-date skip still works on a once-daily pattern, exactly as before', () => {
    const t = new Task({
      title: 'Gym', type: 'fixed',
      recurrence: {
        periods: [{ interval: 1, windows: [{ day: 'mon', start: '07:00', end: '08:00' }],
          effectiveFrom: new Date(2026, 8, 7), effectiveUntil: null }],
        anchorDate: new Date(2026, 8, 7), exceptions: [],
      },
    });
    addException(t, '2026-09-07', 'skip');
    expect(expandRecurrence(t, MON)).toHaveLength(0);
  });

  it('an EXTRA session lands on a day the pattern already fills', () => {
    // The other bug this unblocks: "one more gym this week", on the day the
    // routine already runs. It used to be dropped without a word.
    const t = new Task({
      title: 'Gym', type: 'fixed',
      recurrence: {
        periods: [{ interval: 1, windows: [{ day: 'mon', start: '07:00', end: '08:00' }],
          effectiveFrom: new Date(2026, 8, 7), effectiveUntil: null }],
        anchorDate: new Date(2026, 8, 7), exceptions: [],
      },
    });
    addException(t, '2026-09-07', 'add', { start: '18:00', end: '19:00' });
    const occ = expandRecurrence(t, MON);
    expect(occ).toHaveLength(2);
    expect(occ.map((o) => o.startTime.getHours())).toEqual([7, 18]);
    expect(occ[1].occurrenceDate).toBe('2026-09-07#add'); // its own namespace
  });

  it('keeps each session\'s lived data separate', () => {
    const t = twiceDaily();
    t.occurrenceData = {
      '2026-09-07': { completion: 'done', satisfaction: { overall: 5 } },
      '2026-09-07#2': { completion: 'skipped' },
    };
    const occ = expandRecurrence(t, MON);
    expect(occ[0].completion).toBe('done');
    expect(occ[0].satisfaction.overall).toBe(5);
    expect(occ[1].completion).toBe('skipped');
  });
});
