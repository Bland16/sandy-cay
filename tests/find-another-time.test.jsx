// @vitest-environment jsdom
// "Find another time" — reported 2026-08-30: "doesn't work / populate the task
// on the selected time."
//
// TWO defects, either of which alone makes the button useless, and the second
// is the one that matches the words exactly.
//
//  1. It searched `from: weekStart` — Monday 00:00 — and shows only the first
//     SIX results. From Tuesday onward the list led with hours already lived;
//     by the reported Sunday every one of the six had passed. Clamping `from`
//     to now then exposes the other half of the same range bug: `to` is the end
//     of the VIEWED week, which on a Sunday is tonight.
//
//  2. `placeAt` wrote `startTime`/`endTime` through `upd`, and `upd` targets
//     `editable` — which for a recurring session is its PARENT PATTERN. An
//     occurrence is materialized from `recurrence.periods[].windows`, so that
//     wrote a field nothing renders and the session did not move. The panel
//     still said "Moved to a new slot".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

// Sunday 30 Aug 2026, 21:30 — the day and hour in the report. Its week starts
// Mon 24 Aug, so "the viewed week" is six days spent and ninety minutes left.
const NOW = new Date(2026, 7, 30, 21, 30, 0, 0);

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.innerWidth = 1440;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const thisWeek = () => weekStartOf(NOW);
const on = (ws, o, h, m = 0) => { const d = addDays(ws, o); d.setHours(h, m, 0, 0); return d; };
const persist = (s) => {
  window.localStorage.setItem('sandycay.session', 'guest');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

/** Open the first card on the grid and press "Find another time". */
const openAndFind = () => {
  fireEvent.click(document.querySelector('.day .card'));
  const panel = document.querySelector('.panel');
  fireEvent.click(within(panel).getByText(/Find another time/));
  return panel;
};

/** The offered openings, as their rendered text ("Tue 08:00–09:00"). */
const offered = (panel) => [...panel.querySelectorAll('.slotlist .slot')].map((el) => el.textContent);

/**
 * Every card on the grid, as "Sun 21:30–22:30".
 *
 * ⚠️ READ THE GRID, NOT `localStorage`. The save is debounced and these tests
 * fake only `Date`, so storage still holds the pre-click state when the click
 * returns — an assertion against it fails whether the fix is present or not,
 * which is the worst kind of green.
 */
const cards = () => [...document.querySelectorAll('.day .card')].map((c) => {
  const i = Number(c.closest('[data-dropzone]').dataset.dayIndex);
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]} ${c.getAttribute('aria-label').split(' · ')[1]}`;
});

const nextWeek = () => fireEvent.click(document.querySelector('[aria-label="Next week"]'));

/** A weekly Monday 22:00–23:00 pattern. */
const weeklyMonday = () => {
  const s = new Schedule({ config: defaultConfig });
  const MON = thisWeek();
  s.addFixed({
    title: 'Lab Safety Training',
    startTime: on(MON, 0, 22),
    endTime: on(MON, 0, 23),
    recurrence: {
      periods: [{
        windows: [{ day: 'mon', start: '22:00', end: '23:00' }],
        interval: 1,
        effectiveFrom: null,
        effectiveUntil: null,
      }],
      anchorDate: MON,
      exceptions: [],
    },
  });
  s.markWeekSeen(NOW);
  persist(s);
  return s;
};

describe('Find another time offers times you can actually take', () => {
  it('offers nothing that has already happened', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'Gym with Tamara', startTime: on(thisWeek(), 6, 18), endTime: on(thisWeek(), 6, 19, 45) });
    s.markWeekSeen(NOW);
    persist(s);
    render(<App />);

    const rows = offered(openAndFind());
    expect(rows.length).toBeGreaterThan(0);
    // Every row names a weekday. Before the fix all six were Mon–Sat of a week
    // already spent; the only reachable days from Sunday 21:30 are Sun–Wed.
    for (const row of rows) expect(row).toMatch(/^(Sun|Mon|Tue|Wed)/);
  });

  it('does not confine the search to the ninety minutes left in a Sunday', () => {
    // `to` had the same defect `from` did. With the viewed week ending tonight,
    // the horizon floor is the only thing that leaves anything to offer.
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'Gym with Tamara', startTime: on(thisWeek(), 6, 18), endTime: on(thisWeek(), 6, 19, 45) });
    // Fill what is left of tonight, so anything offered must come from a later day.
    s.addFixed({ title: 'Begin Lab Safety Training', startTime: on(thisWeek(), 6, 21), endTime: on(thisWeek(), 6, 23) });
    s.markWeekSeen(NOW);
    persist(s);
    render(<App />);

    const rows = offered(openAndFind());
    // Nothing at all survives if `to` stays at the end of the viewed week:
    // tonight is filled to close, so the search has no room left in it.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => /^(Mon|Tue|Wed)/.test(r))).toBe(true);
    // …and those Mon/Tue/Wed rows are the ones AHEAD, not the spent week's —
    // which is what fails if `from` goes back to the Monday.
    for (const row of rows) expect(row).toMatch(/^(Sun|Mon|Tue|Wed)/);
  });
});

describe('picking a slot moves the thing you were looking at', () => {
  it('relocates a recurring SESSION instead of writing its pattern', () => {
    weeklyMonday();
    render(<App />);
    expect(cards()).toEqual(['Mon 22:00–23:00']);

    const panel = openAndFind();
    const rows = panel.querySelectorAll('.slotlist .slot');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('21:30');
    fireEvent.click(rows[0]);

    // ⚠️ The whole complaint. Before the fix `placeAt` wrote startTime/endTime
    // onto the PARENT, `expandRecurrence` went on reading the pattern's windows,
    // and the card never moved — while the panel said "Moved to a new slot".
    expect(cards()).toEqual(['Sun 21:30–22:30']);
  });

  it('leaves the pattern itself alone — only this session moved', () => {
    weeklyMonday();
    render(<App />);

    const panel = openAndFind();
    fireEvent.click(panel.querySelectorAll('.slotlist .slot')[0]);
    expect(cards()).toEqual(['Sun 21:30–22:30']);

    // A relocation is a per-session exception (§4.2), so next week's Monday is
    // exactly where the pattern says. This is the half that must NOT be "fixed"
    // by editing the windows instead.
    nextWeek();
    expect(cards()).toEqual(['Mon 22:00–23:00']);
  });
});
