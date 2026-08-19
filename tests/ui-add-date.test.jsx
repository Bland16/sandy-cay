// @vitest-environment jsdom
// DATES-AND-RECURRENCE P1 — "When" is a date, not a weekday.
//
// The regression this whole change exists for: the old panel resolved a weekday
// <select> against `addDays(weekStart, day)`, so the date was implicit in
// whichever week the grid was showing. Adding "Orientation, 3 September" from an
// August view was impossible without navigating there first.
//
// Who shows what (revised 2026-08-11 after the first cut got it wrong):
//   flexible  — nothing, until you tick "pick a date"; then a date, and a time
//               ONLY if you want one. A blank time means "that day, you choose".
//   fixed     — a date AND a time. A fixed task is a time (7B).
//   repeating — a date, meaning the week the pattern starts. Never hidden: the
//               first cut hid the whole block, which read as "never built".
//
// The clock is frozen to a WEDNESDAY (2026-07-15) for the same reason the drag
// and bulk suites are: a fresh flexible's placement origin is "now". See HANDOFF.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { weekStart, addDays, dateKey } from '../src/core/index.js';
import { whenNote, fmtDay } from '../src/ui/components/panels/AddTaskPanel.jsx';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

const WEDNESDAY = new Date(2026, 6, 15, 9, 0, 0); // Wed 15 Jul 2026, 09:00

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('sandycay.session', 'guest');
  // shouldAdvanceTime keeps async work alive while letting us step the save
  // debounce on demand — the same setup ui-report.test.jsx uses.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function openAdd() {
  render(<App />);
  fireEvent.click(screen.getByLabelText('Add task'));
  return document.querySelector('.panel');
}
const titled = (panel, v) =>
  fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: v } });
const setDate = (panel, key) =>
  fireEvent.change(within(panel).getByLabelText('Date'), { target: { value: key } });
const pickADate = (panel) => fireEvent.click(within(panel).getByText('pick a date'));
/** Step past the save debounce, then read what actually persisted. */
const savedTask = (title) => {
  act(() => { vi.advanceTimersByTime(2500); });
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY)).tasks.find((t) => t.title === title);
};

describe('P1 — which fields each kind of task shows', () => {
  it('a flexible task shows NO date until you ask for one', () => {
    const panel = openAdd();
    expect(within(panel).queryByLabelText('Date')).toBeNull();
    expect(within(panel).queryByLabelText('Start time')).toBeNull();
    expect(within(panel).getByText(/Placed by score this week/)).toBeTruthy();

    pickADate(panel);
    expect(within(panel).getByLabelText('Date')).toBeTruthy();
    // The time is optional ON TOP of the date, and starts blank.
    expect(within(panel).getByLabelText('Start time').value).toBe('');
    expect(within(panel).getByText(/leave the time blank for any time/)).toBeTruthy();
  });

  it('a fixed task shows both, with a time already filled in', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    expect(within(panel).getByLabelText('Date')).toBeTruthy();
    expect(within(panel).getByLabelText('Start time').value).not.toBe('');
  });

  it('a repeating task still shows its date, labelled Starts — it must never vanish', () => {
    const panel = openAdd();
    titled(panel, 'Gym');
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));

    // The bug this replaces: the whole When block was hidden while repeating,
    // so the feature looked unbuilt.
    expect(within(panel).getByLabelText('Date')).toBeTruthy();
    expect(within(panel).getByText('Starts')).toBeTruthy();
    expect(within(panel).getByText(/first week the pattern runs/)).toBeTruthy();
    // A pattern carries its own times, so no separate start time is asked for.
    expect(within(panel).queryByLabelText('Start time')).toBeNull();
  });

  it('the When label and the opt-in are separate elements, not run together', () => {
    const panel = openAdd();
    // "Whenpick a date" was the rendered result of dropping a trailing space.
    expect(within(panel).getByText('When')).toBeTruthy();
    expect(within(panel).getByText('pick a date')).toBeTruthy();
  });
});

describe('P1 — a task can be dated outside the viewed week', () => {
  it('a fixed task lands on the DATE given, not the same weekday of the viewed week', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    titled(panel, 'Orientation');
    setDate(panel, '2026-09-03'); // seven weeks out
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: '14:00' } });
    fireEvent.click(within(panel).getByText('Add'));

    expect(screen.queryByText('Orientation')).toBeNull(); // not in the viewed week
    fireEvent.click(screen.getByText('Go there'));
    const card = screen.getByText('Orientation').closest('.card');
    expect(card.getAttribute('aria-label')).toContain('14:00–15:00');
    expect(Number(card.closest('[data-dropzone]').dataset.dayIndex)).toBe(3); // Thu
  });

  it('a dated flexible task is placed ON THAT DAY, by score — not just that week', () => {
    const panel = openAdd();
    titled(panel, 'Read chapter');
    pickADate(panel);
    setDate(panel, '2026-09-03'); // a Thursday, no time given
    fireEvent.click(within(panel).getByText('Add'));

    const t = savedTask('Read chapter');
    expect(t).toBeTruthy();
    // The whole point: the day is honoured, not merely the week it falls in.
    expect(dateKey(new Date(t.startTime))).toBe('2026-09-03');
  });

  it('adding a time to a dated flexible task pins it there', () => {
    const panel = openAdd();
    titled(panel, 'Study group');
    pickADate(panel);
    setDate(panel, '2026-09-03');
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: '16:30' } });
    fireEvent.click(within(panel).getByText('Add'));

    const t = savedTask('Study group');
    expect(dateKey(new Date(t.startTime))).toBe('2026-09-03');
    expect(new Date(t.startTime).getHours()).toBe(16);
    expect(new Date(t.startTime).getMinutes()).toBe(30);
    expect(t.placedBy).toBe('user'); // you chose it; re-optimize leaves it be
  });

  it('the toast names the day, and offers to jump ONLY when it lands off-week', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    titled(panel, 'Dentist');
    setDate(panel, dateKey(addDays(weekStart(WEDNESDAY), 4))); // Friday, this week
    fireEvent.click(within(panel).getByText('Add'));

    expect(document.querySelector('.toast').textContent).toContain('Fri 17 Jul');
    expect(screen.queryByText('Go there')).toBeNull(); // nowhere to go
  });

  it('the untouched default is the old behaviour: this week, placed by score', () => {
    const panel = openAdd();
    titled(panel, 'Break');
    fireEvent.click(within(panel).getByText('Add'));

    expect(screen.getByText('Break')).toBeTruthy(); // visible without jumping
    expect(screen.queryByText('Go there')).toBeNull();
    const t = savedTask('Break');
    const ws = weekStart(WEDNESDAY).getTime();
    expect(new Date(t.startTime).getTime()).toBeGreaterThanOrEqual(ws);
    expect(new Date(t.startTime).getTime()).toBeLessThan(addDays(weekStart(WEDNESDAY), 7).getTime());
  });

  it('a fixed task without a time cannot be submitted — that is what fixed means', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    titled(panel, 'Thing');
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: '' } });
    expect(within(panel).getByText('Add').disabled).toBe(true);
  });

  it('a cleared date blocks submit rather than silently defaulting', () => {
    const panel = openAdd();
    titled(panel, 'Thing');
    pickADate(panel);
    setDate(panel, '');
    expect(within(panel).getByText('Add').disabled).toBe(true);
  });
});

describe('P1 — the readback', () => {
  it('names the weekday and the distance, so an ISO string is never the only cue', () => {
    expect(whenNote(dateKey(WEDNESDAY), WEDNESDAY)).toBe('Wednesday · this week');
    expect(whenNote('2026-07-20', WEDNESDAY)).toBe('Monday · next week');
    expect(whenNote('2026-07-09', WEDNESDAY)).toBe('Thursday · last week');
    expect(whenNote('2026-09-03', WEDNESDAY)).toBe('Thursday · 7 weeks ahead');
    expect(whenNote('2026-06-15', WEDNESDAY)).toBe('Monday · 4 weeks ago');
    expect(whenNote('', WEDNESDAY)).toBe('');
  });

  it('renders under the field and follows the date', () => {
    const panel = openAdd();
    pickADate(panel);
    expect(within(panel).getByText('Wednesday · this week')).toBeTruthy();
    setDate(panel, '2026-09-03');
    expect(within(panel).getByText('Thursday · 7 weeks ahead')).toBeTruthy();
  });

  it('parses via dateFromKey, NOT new Date(str) — sharp edge #4', () => {
    // new Date('2026-09-03') is UTC midnight, which is 2 Sep west of Greenwich.
    // If the panel ever regressed to it, this reads "Wednesday".
    expect(whenNote('2026-09-03', WEDNESDAY).startsWith('Thursday')).toBe(true);
    expect(fmtDay(new Date(2026, 8, 3))).toBe('Thu 3 Sep');
  });
});

describe('P4 — the placement range is behind a disclosure', () => {
  it('is collapsed by default, and reads "that week" until a date narrows it', () => {
    const panel = openAdd();
    expect(within(panel).queryByText('Place it')).toBeNull();
    fireEvent.click(within(panel).getByText(/more options/));
    expect(within(panel).getByText('that week')).toBeTruthy();

    pickADate(panel); // now the default really is one day, so say so
    expect(within(panel).getByText('that day')).toBeTruthy();
  });

  it('is never offered for a task you timed yourself', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    expect(within(panel).queryByText(/more options/)).toBeNull();

    cleanup();
    const p2 = openAdd();
    pickADate(p2);
    fireEvent.change(within(p2).getByLabelText('Start time'), { target: { value: '10:00' } });
    expect(within(p2).queryByText(/more options/)).toBeNull(); // pinned now
  });

  it('widens the search past the chosen day when asked', () => {
    const panel = openAdd();
    titled(panel, 'Essay');
    pickADate(panel);
    setDate(panel, '2026-08-10'); // a Monday, four weeks out
    fireEvent.click(within(panel).getByText(/more options/));
    fireEvent.change(within(panel).getByLabelText('Place it before'), { target: { value: '2026-08-21' } });
    fireEvent.click(within(panel).getByText('Add'));

    const t = savedTask('Essay');
    expect(t).toBeTruthy();
    const at = new Date(t.startTime);
    // Free to land anywhere in the window, rather than clamped to the 10th.
    expect(at.getTime()).toBeGreaterThanOrEqual(new Date(2026, 7, 10).getTime());
    expect(at.getTime()).toBeLessThan(new Date(2026, 7, 22).getTime());
  });
});

describe('P1 — the repeating pattern starts from the date you gave', () => {
  it('seeds effectiveFrom from the chosen date, not the week being viewed', () => {
    const panel = openAdd();
    titled(panel, 'Gym');
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));
    setDate(panel, '2026-09-08'); // a Tuesday, seven weeks out
    fireEvent.click(within(panel).getByText('Add'));

    const t = savedTask('Gym');
    expect(t.recurrence).toBeTruthy();
    // Monday of the chosen date's week — not Monday of the viewed July week.
    expect(dateKey(new Date(t.recurrence.periods[0].effectiveFrom))).toBe('2026-09-07');
  });
});
