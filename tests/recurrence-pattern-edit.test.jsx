// @vitest-environment jsdom
// Editing a recurring task's pattern — the six ways it used to fail.
//
// All six were found by audit on 2026-08-14 and all reproduced on the deployed
// site, so none of them was recent work. Each test below fails if its fix is
// reverted; the shared root of the first two is that `applyPattern` decided
// where to split FROM THE CLOCK, and both it and `modelFromTask` identified
// "the current period" as the one with no `effectiveUntil` rather than the
// period governing the session the user actually opened.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

const NOW = new Date(2026, 7, 14, 10, 0, 0, 0); // Fri 14 Aug 2026 is "today"
beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
  vi.useFakeTimers({ toFake: ['Date'] }); // real timers: the save is debounced
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const thisWeek = () => weekStartOf(NOW);
const on = (ws, o, h, m = 0) => { const d = addDays(ws, o); d.setHours(h, m, 0, 0); return d; };

const persist = (s) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));

/** Every card on the grid, as "Mon 17:00–19:00". */
const cards = () => [...document.querySelectorAll('.day .card')].map((c) => {
  const i = Number(c.closest('[data-dropzone]').dataset.dayIndex);
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]} ${c.getAttribute('aria-label')?.split(' · ')[1]}`;
});

const gotoWeeks = (n) => {
  for (let i = 0; i < n; i += 1) fireEvent.click(document.querySelector('[aria-label="Next week"]'));
};

/** Open the first card and set every time row, optionally changing the scope. */
const editTimes = (start, end, scope) => {
  fireEvent.click(document.querySelector('.day .card'));
  const panel = document.querySelector('.panel');
  if (scope) fireEvent.click(within(panel).getByText(scope));
  within(panel).queryAllByLabelText('Start').forEach((i) => fireEvent.change(i, { target: { value: start } }));
  within(panel).queryAllByLabelText('End').forEach((i) => fireEvent.change(i, { target: { value: end } }));
  fireEvent.click(within(panel).getByText(/Update pattern/));
  return panel;
};

/** Weekly Monday 17:00–19:00, running since June. */
const weeklyMonday = (extraPeriods = []) => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({
    title: 'Gym', tags: ['gym'],
    startTime: on(thisWeek(), 0, 17), endTime: on(thisWeek(), 0, 19),
    recurrence: {
      periods: [
        { windows: [{ day: 'mon', start: '17:00', end: '19:00' }], interval: 1, effectiveFrom: new Date(2026, 5, 1), effectiveUntil: null },
        ...extraPeriods,
      ],
      anchorDate: new Date(2026, 5, 1),
      exceptions: [],
    },
  });
  s.markWeekSeen(NOW);
  persist(s);
  return s;
};

describe('1 — the session you opened actually moves', () => {
  it('moves a card that sits EARLIER in the week than today', () => {
    // Today is Friday; the Gym is on Monday. "From now on" used to split at the
    // clock, so Monday kept the old period and nothing visibly happened —
    // while the toast said "Pattern updated".
    weeklyMonday();
    render(<App />);
    expect(cards()).toEqual(['Mon 17:00–19:00']);
    editTimes('06:15', '07:15');
    expect(cards()).toEqual(['Mon 06:15–07:15']);
  });

  it('still carries forward to later weeks', () => {
    weeklyMonday();
    render(<App />);
    editTimes('06:15', '07:15');
    gotoWeeks(2);
    expect(cards()).toEqual(['Mon 06:15–07:15']);
  });
});

describe('2 — a temporary change cannot leave a stale period governing the future', () => {
  /** Exactly what `temporaryChange` builds: base · temp · reopened tail. */
  const withSandwich = () => {
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({
      title: 'Gym', tags: ['gym'],
      startTime: on(thisWeek(), 0, 17), endTime: on(thisWeek(), 0, 19),
      recurrence: {
        periods: [
          { windows: [{ day: 'mon', start: '17:00', end: '19:00' }], interval: 1, effectiveFrom: new Date(2026, 5, 1), effectiveUntil: new Date(2026, 7, 24) },
          { windows: [{ day: 'mon', start: '12:00', end: '13:00' }], interval: 1, effectiveFrom: new Date(2026, 7, 24), effectiveUntil: new Date(2026, 8, 8) },
          // The reopened tail — open-ended, and EARLIER in the array than
          // anything a later edit pushes on.
          { windows: [{ day: 'mon', start: '17:00', end: '19:00' }], interval: 1, effectiveFrom: new Date(2026, 8, 8), effectiveUntil: null },
        ],
        anchorDate: new Date(2026, 5, 1),
        exceptions: [],
      },
    });
    s.markWeekSeen(NOW);
    persist(s);
  };

  it('the future runs at the new time, not at the stale tail', () => {
    withSandwich();
    render(<App />);
    editTimes('06:15', '07:15');
    // The tail sat earlier in the array than the period the edit pushed on, and
    // `emit` is first-wins, so it beat the new one for ever: every future week
    // kept 17:00 however many times you edited.
    gotoWeeks(6);
    expect(cards()).toEqual(['Mon 06:15–07:15']);
  });

  it('the editor shows the time that governs the day you opened', () => {
    withSandwich();
    render(<App />);
    gotoWeeks(3); // into the temporary window — Mon 31 Aug runs at 12:00
    expect(cards()).toEqual(['Mon 12:00–13:00']);
    fireEvent.click(document.querySelector('.day .card'));
    const panel = document.querySelector('.panel');
    // It used to show 17:00 here — a third time, governing neither this day nor
    // the one on screen.
    expect(within(panel).queryAllByLabelText('Start')[0].value).toBe('12:00');
  });
});

describe('3 / 4 — a monthly pattern keeps its date and its interval', () => {
  /**
   * Every 3rd month on the 15th, at 17:00 — and the parent task's own
   * `startTime` is the 1st. That disagreement IS the bug: `windowsForOption`
   * rebuilds a monthly window's `monthDay` from the anchor it is handed, so an
   * anchor of "1 June" turned "the 15th" into "the 1st" on any edit.
   */
  const monthlyFirst = () => {
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({
      title: 'Physio',
      startTime: new Date(2026, 5, 1, 17, 0), endTime: new Date(2026, 5, 1, 19, 0),
      recurrence: {
        periods: [{ freq: 'monthly', windows: [{ monthDay: 15, start: '17:00', end: '19:00' }], interval: 3, effectiveFrom: new Date(2026, 5, 1), effectiveUntil: null }],
        anchorDate: new Date(2026, 5, 15),
        exceptions: [],
      },
    });
    s.markWeekSeen(NOW);
    persist(s);
  };

  it('changing the TIME does not move it to another day', () => {
    monthlyFirst();
    render(<App />);
    gotoWeeks(5); // the week containing Tue 15 Sep
    expect(cards()).toEqual(['Tue 17:00–19:00']);

    editTimes('06:15', '07:15', 'including past');
    // It used to vanish from this week entirely and reappear on the 1st: the
    // window was rebuilt from the parent's stale `startTime`.
    expect(cards()).toEqual(['Tue 06:15–07:15']);
  });

  it('does not silently become "every month"', () => {
    monthlyFirst();
    render(<App />);
    gotoWeeks(5);
    editTimes('06:15', '07:15', 'including past');

    // Thu 15 Oct is one month on — with the interval reset to 1 a session
    // appeared there. Every 3rd month means the next one is December.
    gotoWeeks(4); // week of Mon 12 Oct, which holds Thu 15 Oct
    expect(cards()).toEqual([]);
  });
});

describe('5 — a temporary change runs on the day named as its last', () => {
  it('includes the last day, rather than handing it back to the old pattern', () => {
    weeklyMonday();
    render(<App />);
    fireEvent.click(document.querySelector('.day .card'));
    const panel = document.querySelector('.panel');

    fireEvent.click(within(panel).getByLabelText('Temporary change'));
    // Mon 24 Aug through Mon 7 Sep, inclusive — 7 Sep is the last day it runs.
    fireEvent.change(within(panel).getByLabelText(/first day/i), { target: { value: '2026-08-24' } });
    fireEvent.change(within(panel).getByLabelText(/last day/i), { target: { value: '2026-09-07' } });
    within(panel).queryAllByLabelText('Start').forEach((i) => fireEvent.change(i, { target: { value: '06:15' } }));
    within(panel).queryAllByLabelText('End').forEach((i) => fireEvent.change(i, { target: { value: '07:15' } }));
    fireEvent.click(within(panel).getByText(/Update pattern/));

    // The model's dates are INCLUSIVE and the engine's bound is exclusive
    // (sharp edge #11). `buildRecurrence` converts; this path did not, so the
    // day the user named as the last one fell outside and ran at the old time.
    gotoWeeks(2); expect(cards()).toEqual(['Mon 06:15–07:15']); // 24 Aug
    gotoWeeks(1); expect(cards()).toEqual(['Mon 06:15–07:15']); // 31 Aug
    gotoWeeks(1); expect(cards()).toEqual(['Mon 06:15–07:15']); //  7 Sep — the last day
    gotoWeeks(1); expect(cards()).toEqual(['Mon 17:00–19:00']); // 14 Sep — back to base
  });
});

describe('6 — the editor names the pattern it is holding', () => {
  it('a "last Monday" pattern does not render as "every week"', () => {
    const s = new Schedule({ config: defaultConfig });
    // Mon 31 Aug 2026 IS the last Monday of August.
    s.addFixed({
      title: 'Payroll',
      startTime: new Date(2026, 5, 1, 17, 0), endTime: new Date(2026, 5, 1, 19, 0),
      recurrence: {
        periods: [{ freq: 'monthly', windows: [{ day: 'mon', nth: -1, start: '17:00', end: '19:00' }], interval: 1, effectiveFrom: new Date(2026, 5, 1), effectiveUntil: null }],
        anchorDate: new Date(2026, 5, 1),
        exceptions: [],
      },
    });
    s.markWeekSeen(NOW);
    persist(s);

    render(<App />);
    gotoWeeks(3); // week of Mon 31 Aug — genuinely the last Monday of August
    fireEvent.click(document.querySelector('.day .card'));
    const panel = document.querySelector('.panel');
    // The select used to read "every week", with weekly day rows and a weekly
    // preview, while `applyPattern` still acted monthly.
    expect(within(panel).getByLabelText('Repeat frequency').value).toBe('month');
  });
});
