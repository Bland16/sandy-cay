// @vitest-environment jsdom
// "Every weekday" in the Repeats frequency (SPEC §4.3 editor).
//
// Reported plainly: "I have lunch every weekday at noon on the dot." Saying that
// used to take five window rows, each new one resetting to mon 09:00–10:00 — so
// the day and both times were re-entered four times over.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import {
  Schedule, Task, Zone, defaultConfig, dateKey, addDays,
  lastRunDay, untilAfterLastRun, toRRULE, fromRRULE,
} from '../src/core/index.js';
import { expandRecurrence } from '../src/core/recurrence.js';
import {
  isWeekdayPattern, toWeekdayWindows, buildRecurrence, emptyRecurrence, WEEKDAY_KEYS,
} from '../src/ui/recurrenceModel.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const MON_13 = new Date(2026, 6, 13, 0, 0, 0, 0); // the week the user adds it in
const MON_06 = new Date(2026, 6, 6, 0, 0, 0, 0);  // the week before
const MON_27 = new Date(2026, 6, 27, 0, 0, 0, 0); // a fortnight later

describe('weekday pattern model', () => {
  const noon = () => WEEKDAY_KEYS.map((day) => ({ day, start: '12:00', end: '13:00' }));

  it('recognises Mon–Fri at one time', () => {
    expect(isWeekdayPattern(noon())).toBe(true);
  });

  it('is not fooled by five windows that aren’t the five weekdays', () => {
    const withSat = [...noon().slice(0, 4), { day: 'sat', start: '12:00', end: '13:00' }];
    expect(isWeekdayPattern(withSat)).toBe(false);
  });

  it('stops describing itself as "weekdays" once one day differs', () => {
    const tweaked = noon();
    tweaked[1] = { day: 'tue', start: '13:00', end: '14:00' };
    // Derived, not stored — so there is no flag left claiming otherwise.
    expect(isWeekdayPattern(tweaked)).toBe(false);
  });

  it('rejects a partial week', () => {
    expect(isWeekdayPattern(noon().slice(0, 3))).toBe(false);
    expect(isWeekdayPattern([])).toBe(false);
  });

  it('keeps the time already chosen when filling the week', () => {
    const out = toWeekdayWindows([{ day: 'wed', start: '12:00', end: '13:00' }]);
    expect(out).toHaveLength(5);
    expect(out.map((w) => w.day)).toEqual(WEEKDAY_KEYS);
    expect(out.every((w) => w.start === '12:00' && w.end === '13:00')).toBe(true);
  });

  it('builds an engine pattern of five weekday windows, every week', () => {
    const rec = buildRecurrence(
      { ...emptyRecurrence(), enabled: true, windows: toWeekdayWindows([{ day: 'mon', start: '12:00', end: '13:00' }]) },
      new Date(2026, 6, 13),
    );
    expect(rec.periods[0].windows).toHaveLength(5);
    expect(rec.periods[0].interval).toBe(1);
    expect(rec.periods[0].windows.map((w) => w.day)).toEqual(WEEKDAY_KEYS);
  });
});

describe('a new pattern is bounded — it does not go all the way back', () => {
  const lunch = (temporary = null) => ({
    ...emptyRecurrence(),
    enabled: true,
    windows: toWeekdayWindows([{ day: 'mon', start: '12:00', end: '13:00' }]),
    temporary,
  });
  /** Occurrences of `task` in the week starting `ws`. */
  const occs = (task, ws) => expandRecurrence(task, ws);

  it('starts in the week it was added, not at the dawn of time', () => {
    const rec = buildRecurrence(lunch(), MON_13);
    // effectiveFrom used to be null — "active forever" — so lunch invented on
    // the 13th was also true every weekday of every week already gone.
    expect(rec.periods[0].effectiveFrom).not.toBeNull();
    expect(dateKey(rec.periods[0].effectiveFrom)).toBe('2026-07-13');

    const t = new Task({ title: 'Lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    expect(occs(t, MON_13)).toHaveLength(5);
    expect(occs(t, MON_06)).toHaveLength(0); // the week before: no lunch
  });

  it('honours an explicit start date', () => {
    const rec = buildRecurrence(lunch({ from: '2026-07-13', until: '' }), MON_06);
    expect(dateKey(rec.periods[0].effectiveFrom)).toBe('2026-07-13');
    const t = new Task({ title: 'Lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    expect(occs(t, MON_06)).toHaveLength(0);
    expect(occs(t, MON_13)).toHaveLength(5);
  });

  it('a bounded run is ONE period, not a sandwich around an unbounded past', () => {
    const rec = buildRecurrence(lunch({ from: '2026-07-13', until: '2026-07-24' }), MON_13);
    // It used to emit a base period (effectiveFrom: null) plus a "temporary"
    // one with IDENTICAL windows — which is the 4E shape for changing a live
    // routine and meaningless for a new one. All it achieved was reopening the
    // unbounded past.
    expect(rec.periods).toHaveLength(1);
    expect(dateKey(rec.periods[0].effectiveFrom)).toBe('2026-07-13');
    expect(dateKey(rec.periods[0].effectiveUntil)).toBe('2026-07-25'); // half-open: last run is the 24th

    const t = new Task({ title: 'Lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    expect(occs(t, MON_06)).toHaveLength(0);  // before the run
    expect(occs(t, MON_13)).toHaveLength(5);  // in it
    expect(occs(t, MON_27)).toHaveLength(0);  // after it
  });

  it('the last day you pick is a day it RUNS', () => {
    const rec = buildRecurrence(lunch({ from: '2026-07-13', until: '2026-07-15' }), MON_13);
    const t = new Task({ title: 'Lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    // "Last day: Wed the 15th" means lunch happens ON the 15th. The engine's
    // bound is half-open, so the edge converts (untilAfterLastRun) — the user
    // never meets the exclusive bound.
    expect(occs(t, MON_13).map((o) => o.occurrenceDate)).toEqual(['2026-07-13', '2026-07-14', '2026-07-15']);
    expect(dateKey(rec.periods[0].effectiveUntil)).toBe('2026-07-16'); // half-open, internally
  });

  it('a summer job ending Fri the 24th runs on the 24th and not the 27th', () => {
    const rec = buildRecurrence(lunch({ from: '2026-07-13', until: '2026-07-24' }), MON_13);
    const t = new Task({ title: 'Work lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    expect(occs(t, addDays(MON_13, 7)).map((o) => o.occurrenceDate)).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24',
    ]);
    expect(occs(t, MON_27)).toHaveLength(0);
  });

  it('parity counts from where the pattern starts', () => {
    const rec = buildRecurrence({ ...lunch({ from: '2026-07-13', until: '' }), interval: 2 }, MON_06);
    // "every 2nd week from the 13th" means the 13th and the 27th — not a parity
    // inherited from whichever week happened to be on screen.
    expect(dateKey(rec.anchorDate)).toBe('2026-07-13');
    const t = new Task({ title: 'Lunch', startTime: new Date(2026, 6, 13, 12), endTime: new Date(2026, 6, 13, 13), recurrence: rec });
    expect(occs(t, MON_13).length).toBe(5);
    expect(occs(t, addDays(MON_13, 7)).length).toBe(0); // the off week
    expect(occs(t, MON_27).length).toBe(5);
  });
});

describe('inclusive edges over a half-open core', () => {
  it('lastRunDay and untilAfterLastRun are inverses', () => {
    const last = new Date(2026, 6, 24);
    expect(dateKey(lastRunDay(untilAfterLastRun(last)))).toBe('2026-07-24');
    expect(lastRunDay(null)).toBeNull();
    expect(untilAfterLastRun(null)).toBeNull();
  });

  it('the zone editor shows the last day it runs, not the day it stops', () => {
    // Stored half-open: stops ON the 25th. Shown to a person: runs THROUGH the 24th.
    const z = new Zone({ label: 'Work', windows: [], effectiveUntil: new Date(2026, 6, 25) });
    expect(dateKey(lastRunDay(z.effectiveUntil))).toBe('2026-07-24');
    expect(z.activeOn(new Date(2026, 6, 24))).toBe(true);
    expect(z.activeOn(new Date(2026, 6, 25))).toBe(false);
  });

  it('RRULE UNTIL is inclusive on the wire, and round-trips', () => {
    // RFC 5545 UNTIL is inclusive; ours is exclusive. Handing the raw bound to
    // Google claimed an extra day of work.
    const t = new Task({
      title: 'Work lunch',
      startTime: new Date(2026, 6, 13, 12),
      endTime: new Date(2026, 6, 13, 13),
      recurrence: {
        periods: [{
          windows: [{ day: 'mon', start: '12:00', end: '13:00' }],
          interval: 1,
          effectiveFrom: MON_13,
          effectiveUntil: new Date(2026, 6, 25), // stops on the 25th → last run the 24th
        }],
        anchorDate: MON_13,
        exceptions: [],
      },
    });
    expect(toRRULE(t)).toContain('UNTIL=20260724');

    const back = fromRRULE('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260724', new Date(2026, 6, 13, 12), new Date(2026, 6, 13, 13));
    expect(dateKey(back.periods[0].effectiveUntil)).toBe('2026-07-25'); // exclusive again, no day lost
  });
});

describe('a bounded zone is not painted outside its run', () => {
  const workZone = (s) => s.addZone({
    label: 'Work',
    matchTags: ['work'],
    windows: WEEKDAY_KEYS.map((day) => ({ day, start: '09:00', end: '18:30' })),
    exclusive: true,
    effectiveFrom: MON_13,
    effectiveUntil: untilAfterLastRun(new Date(2026, 6, 24)), // last day worked: Fri the 24th
  });

  it('the engine and the grid agree about when a zone is in force', () => {
    const s = new Schedule({ config: defaultConfig });
    const z = workZone(s);
    // The engine always knew (placement.js checks activeOn)...
    expect(z.activeOn(MON_06)).toBe(false);
    expect(z.activeOn(MON_13)).toBe(true);
    expect(z.activeOn(MON_27)).toBe(false);
  });

  it('paints zone bands in the weeks it runs, and none outside them', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 6, 15, 10) }); // Wed of the run
    const s = new Schedule({ config: defaultConfig });
    workZone(s);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));

    render(<App />);
    // In force this week: five weekday bands.
    expect(document.querySelectorAll('.zone')).toHaveLength(5);

    // Step back a week — before the zone starts. zoneBands took no date at all,
    // so it used to draw every zone into every week: reserved time showing in
    // weeks the scheduler correctly saw as free.
    fireEvent.click(screen.getByLabelText(/previous week/i));
    expect(document.querySelectorAll('.zone')).toHaveLength(0);

    // Forward past the end (this week → +1 is the last, +2 is after it stops).
    fireEvent.click(screen.getByLabelText(/next week/i));
    fireEvent.click(screen.getByLabelText(/next week/i));
    fireEvent.click(screen.getByLabelText(/next week/i));
    expect(document.querySelectorAll('.zone')).toHaveLength(0);
  });
});

describe('the Repeats frequency control', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  it('turns "lunch at noon, every weekday" into one choice', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');

    fireEvent.change(within(panel).getByPlaceholderText(/call plumber/i), { target: { value: 'Lunch' } });
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));

    // One row, set to noon...
    fireEvent.change(within(panel).getByLabelText('Start'), { target: { value: '12:00' } });
    fireEvent.change(within(panel).getByLabelText('End'), { target: { value: '13:00' } });
    // ...then one selection instead of four more rows.
    fireEvent.change(within(panel).getByLabelText('Repeat frequency'), { target: { value: 'weekday' } });

    fireEvent.click(within(panel).getByText(/add to the week/i));

    act(() => { vi.advanceTimersByTime(2500); });
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const lunch = saved.tasks.find((t) => t.title === 'Lunch');
    expect(lunch).toBeTruthy();

    const windows = lunch.recurrence.periods[0].windows;
    expect(windows.map((w) => w.day)).toEqual(WEEKDAY_KEYS);
    // Noon on the dot, on every one of them.
    expect(windows.every((w) => w.start === '12:00' && w.end === '13:00')).toBe(true);
    expect(lunch.recurrence.periods[0].interval).toBe(1);
  });

  it('reads the pattern back, so a saved weekday task reopens as "every weekday"', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));
    fireEvent.change(within(panel).getByLabelText('Repeat frequency'), { target: { value: 'weekday' } });

    expect(within(panel).getByLabelText('Repeat frequency').value).toBe('weekday');
    // Five rows are really there — the preset writes windows, it doesn't hide them.
    expect(within(panel).getAllByLabelText('Day')).toHaveLength(5);
  });

  it('an interval still applies on top: every 2nd week, Mon–Fri', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));

    const freq = within(panel).getByLabelText('Repeat frequency');
    fireEvent.change(freq, { target: { value: 'weekday' } });
    fireEvent.change(freq, { target: { value: '2' } });

    // The five weekday rows survive; only the cadence changed.
    expect(within(panel).getAllByLabelText('Day')).toHaveLength(5);
    expect(freq.value).toBe('2');
  });
});
