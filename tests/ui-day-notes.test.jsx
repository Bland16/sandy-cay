// @vitest-environment jsdom
// Day notes have a surface (design/DAY-NOTES.md §4, HANDOFF item 1).
//
// The data has been live since session 6 and was rendered NOWHERE — a user with
// 21 real notes (Thanksgiving, both finals periods, every add/drop deadline) saw
// none of them. These tests prove each surface actually draws them.
//
// D-5's rule is the one worth locking: ONE `notesForDate` call site in ONE
// component, dropped into each header. `zoneBands` had to be added to WeekGrid
// and DayView separately and drifted (sharp edge #14); the weekend drawer is a
// third real grid (#17). So the drawer case below is not redundant with the week
// case — it is the check that the third surface came free instead of being
// forgotten.
//
// Fixed week: Mon 23 Nov 2026 → Sun 29 Nov. Thanksgiving 2026 really is Thu 26.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

/** Drive matchMedia by width, as ui-responsive.test.jsx does. */
function setWidth(px) {
  window.innerWidth = px;
  window.matchMedia = (query) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: (!min || px >= Number(min[1])) && (!max || px <= Number(max[1])),
      media: query,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    };
  };
}

const PHONE = 390;
const TABLET = 900;
const DESKTOP = 1440;

const NOW = new Date(2026, 10, 25, 10, 0, 0, 0); // Wed 25 Nov 2026

const seedNotes = () => {
  const s = new Schedule({ config: defaultConfig });
  // Multi-day: must draw on ALL THREE days it covers, not just the 25th.
  s.addDayNote({
    label: 'Thanksgiving', kind: 'holiday', from: '2026-11-25', to: '2026-11-27',
    source: 'US Holidays',
  });
  // A second note on one of those days, so the header has to count rather than
  // silently drop one.
  s.addDayNote({ label: 'Add/drop deadline', kind: 'note', from: '2026-11-26', to: '2026-11-26' });
  // A weekend note — the drawer is the surface most likely to be forgotten.
  s.addDayNote({ label: 'Make-a-thon', kind: 'note', from: '2026-11-28', to: '2026-11-29' });
  // A birthday: the year-less case, stored as the same yearly period shape tasks
  // use (D-3 chose reuse over a notes-only repeat vocabulary).
  s.addDayNote({
    label: "Mum's birthday", kind: 'note',
    recurrence: {
      periods: [{ freq: 'yearly', windows: [{ month: 11, monthDay: 24 }], interval: 1 }],
      anchorDate: '2026-11-24T00:00:00.000Z',
      exceptions: [],
    },
  });
  s.markWeekSeen(NOW); // no rollover banner in the way
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
};

/** The day header cell for a given column, by its weekday name. */
const headFor = (root, dn) =>
  [...root.querySelectorAll('.dayhead')].find((h) => within(h).queryByText(dn));

beforeEach(() => {
  window.localStorage.clear();
  setWidth(DESKTOP);
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the week grid header (§4)', () => {
  it('draws a multi-day note on EVERY day it covers', () => {
    seedNotes();
    render(<App />);
    // Wed 25, Thu 26, Fri 27 — a band across the week, not a mark on the 25th.
    for (const dn of ['Wed', 'Thu', 'Fri']) {
      expect(within(headFor(document, dn)).getByText('Thanksgiving')).toBeTruthy();
    }
    // ...and not on the days either side of it.
    expect(within(headFor(document, 'Tue')).queryByText('Thanksgiving')).toBeNull();
    expect(within(headFor(document, 'Sat')).queryByText('Thanksgiving')).toBeNull();
  });

  it('counts the rest instead of dropping them', () => {
    seedNotes();
    render(<App />);
    const thu = headFor(document, 'Thu'); // Thanksgiving + Add/drop deadline
    expect(within(thu).getByText('+1')).toBeTruthy();
    // The full set stays reachable without opening the day.
    expect(thu.querySelector('.dnline').title).toContain('Add/drop deadline');
    // A day with exactly one note does not claim there are more.
    expect(within(headFor(document, 'Wed')).queryByText(/^\+/)).toBeNull();
  });

  it('a clear day header is untouched', () => {
    seedNotes();
    render(<App />);
    expect(headFor(document, 'Mon').querySelector('.dnline')).toBeNull();
  });

  it('is not coral — a holiday is not a scheduling problem (P-1)', () => {
    seedNotes();
    render(<App />);
    const line = headFor(document, 'Wed').querySelector('.dnline');
    expect(line.className).toContain('holiday');
    expect(line.className).not.toContain('warn');
    // The whole column stays untinted: a tint means BLOCKED (D-1/D-6).
    expect(document.querySelector('.day.blocked')).toBeNull();
  });

  it('renders a repeating note on its date, from the shared period shape', () => {
    seedNotes();
    render(<App />);
    expect(within(headFor(document, 'Tue')).getByText("Mum's birthday")).toBeTruthy();
  });
});

describe('the day view lists them in full', () => {
  it('shows each note with its range and its source', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(within(headFor(document, 'Thu')).getByText('Thu'));
    const list = document.querySelector('.dnlist');
    expect(list).toBeTruthy();
    expect(within(list).getByText('Thanksgiving')).toBeTruthy();
    expect(within(list).getByText('Add/drop deadline')).toBeTruthy();
    // Inclusive range, and where it came from.
    expect(within(list).getByText(/25–27 Nov · US Holidays/)).toBeTruthy();
    expect(within(list).getByText(/^26 Nov$/)).toBeTruthy();
  });

  it('says "every year" for a year-less note rather than inventing a date', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(within(headFor(document, 'Tue')).getByText('Tue'));
    expect(within(document.querySelector('.dnlist')).getByText('every year')).toBeTruthy();
  });

  it('a clear day gets no list at all', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(within(headFor(document, 'Mon')).getByText('Mon'));
    expect(document.querySelector('.dvcol')).toBeTruthy(); // the day did open
    expect(document.querySelector('.dnlist')).toBeNull();
  });
});

describe('the bar opens the day\'s notes in the panel', () => {
  const barIn = (root, dn) => headFor(root, dn).querySelector('.dnline');

  it('is a real BUTTON, and a sibling of the open-day button', () => {
    seedNotes();
    render(<App />);
    const bar = barIn(document, 'Thu');
    // A button nested inside .dhopen would be invalid HTML and unreachable by
    // keyboard — the exact trap the ⋯ menu is a sibling to avoid.
    expect(bar.tagName).toBe('BUTTON');
    expect(bar.closest('.dhopen')).toBeNull();
    expect(bar.parentElement.classList.contains('dayhead')).toBe(true);
  });

  it('opens the right panel with every note on that day', () => {
    seedNotes();
    render(<App />);
    expect(document.querySelector('.panel')).toBeNull(); // closed by default
    fireEvent.click(barIn(document, 'Thu'));
    const panel = document.querySelector('.panel');
    expect(within(panel).getByText(/Thursday 26/)).toBeTruthy();
    expect(within(panel).getByText('2 notes')).toBeTruthy();
    expect(within(panel).getByText('Thanksgiving')).toBeTruthy();
    expect(within(panel).getByText('Add/drop deadline')).toBeTruthy();
    // range · source, so you can tell an imported note from one you typed.
    expect(within(panel).getByText('25–27 Nov · US Holidays')).toBeTruthy();
  });

  it('does not open the day view — the bar and the header are separate controls', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(barIn(document, 'Thu'));
    expect(document.querySelector('.dayview')).toBeNull();
    expect(document.querySelectorAll('.day').length).toBe(7); // still the week
  });

  it('marks the open day, and clicking the same bar again closes it', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(barIn(document, 'Thu'));
    expect(barIn(document, 'Thu').classList.contains('sel')).toBe(true);
    expect(barIn(document, 'Wed').classList.contains('sel')).toBe(false);

    fireEvent.click(barIn(document, 'Thu'));
    expect(document.querySelector('.panel')).toBeNull();
    expect(barIn(document, 'Thu').classList.contains('sel')).toBe(false);
  });

  it('opening another day replaces the panel rather than stacking one', () => {
    seedNotes();
    render(<App />);
    fireEvent.click(barIn(document, 'Thu'));
    fireEvent.click(barIn(document, 'Sat'));
    expect(document.querySelectorAll('.panel')).toHaveLength(1);
    const panel = document.querySelector('.panel');
    expect(within(panel).getByText(/Saturday 28/)).toBeTruthy();
    expect(within(panel).queryByText('Add/drop deadline')).toBeNull();
  });

  it('names how many without a second row, however many there are', () => {
    seedNotes();
    render(<App />);
    // The whole reason the bar hands off to a panel: it only says HOW MANY, so
    // a crowded day cannot grow taller than a quiet one.
    expect(headFor(document, 'Thu').querySelectorAll('.dnline')).toHaveLength(1);
    expect(headFor(document, 'Wed').querySelectorAll('.dnline')).toHaveLength(1);
  });
});

describe('the third surface came free (sharp edges #14/#17)', () => {
  it('the tablet weekend drawer draws them too', () => {
    setWidth(TABLET);
    seedNotes();
    render(<App />);
    fireEvent.click(screen.getByTitle(/show the weekend/i));
    const drawer = document.querySelector('.wkdrawer');
    // Sat 28 + Sun 29 — the drawer renders a real <WeekGrid>, so the header line
    // arrives with it. If this ever fails, someone reimplemented those columns.
    expect(within(headFor(drawer, 'Sat')).getByText('Make-a-thon')).toBeTruthy();
    expect(within(headFor(drawer, 'Sun')).getByText('Make-a-thon')).toBeTruthy();
  });

  it('the phone opens on a day and shows that day\'s notes', () => {
    setWidth(PHONE);
    seedNotes();
    render(<App />);
    // Opens on today (Wed 25), which Thanksgiving covers.
    const list = document.querySelector('.dnlist');
    expect(within(list).getByText('Thanksgiving')).toBeTruthy();
  });
});
