// @vitest-environment jsdom
// DATES-AND-RECURRENCE P1 — "When" is a date, not a weekday.
//
// The regression this whole change exists for: the old panel resolved a weekday
// <select> against `addDays(weekStart, day)`, so the date was implicit in
// whichever week the grid was showing. Adding "Orientation, 3 September" from an
// August view was impossible without navigating there first.
//
// The clock is frozen to a WEDNESDAY (2026-07-15) for the same reason the drag
// and bulk suites are: a fresh flexible's placement origin is "now", so the
// weekday the suite runs on changes where things land. See HANDOFF.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { weekStart, addDays, dateKey } from '../src/core/index.js';
import { whenNote, fmtDay } from '../src/ui/components/panels/AddTaskPanel.jsx';

const WEDNESDAY = new Date(2026, 6, 15, 9, 0, 0); // Wed 15 Jul 2026, 09:00

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); // fake Date only — async timers must live
  vi.setSystemTime(WEDNESDAY);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Open the add-task panel and return it. */
function openAdd() {
  render(<App />);
  fireEvent.click(screen.getByLabelText('Add task'));
  return document.querySelector('.panel');
}

const setDate = (panel, key) =>
  fireEvent.change(within(panel).getByLabelText('Date'), { target: { value: key } });

describe('P1 — a task can be dated outside the viewed week', () => {
  it('a fixed task lands on the DATE given, not the same weekday of the viewed week', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Orientation' } });
    // Seven weeks past the viewed week — the old panel could not express this.
    setDate(panel, '2026-09-03');
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: '14:00' } });
    fireEvent.click(within(panel).getByText('Add'));

    // It is NOT in the viewed week, so the grid (still on July) must not show it.
    expect(screen.queryByText('Orientation')).toBeNull();

    // Follow the toast's offer, and there it is — on the 3rd, at the time given.
    fireEvent.click(screen.getByText('Go there'));
    const card = screen.getByText('Orientation').closest('.card');
    expect(card.getAttribute('aria-label')).toContain('14:00–15:00');
    // 3 Sep 2026 is a Thursday: day index 3, not "whatever weekday July showed".
    expect(Number(card.closest('[data-dropzone]').dataset.dayIndex)).toBe(3);
  });

  it('the toast names the day and offers to jump ONLY when it lands off-week', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed'));
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Dentist' } });
    setDate(panel, dateKey(addDays(weekStart(WEDNESDAY), 4))); // Friday, this week
    fireEvent.click(within(panel).getByText('Add'));

    expect(document.querySelector('.toast').textContent).toContain('Fri 17 Jul');
    // In the viewed week there is nowhere to go — the affordance must not appear.
    expect(screen.queryByText('Go there')).toBeNull();
  });

  it('a flexible task is placed in the week of the date given, by score', () => {
    const panel = openAdd();
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Read chapter' } });
    setDate(panel, '2026-09-03'); // no time picked — placement stays scored
    expect(within(panel).queryByLabelText('Start time')).toBeNull();
    fireEvent.click(within(panel).getByText('Add'));

    fireEvent.click(screen.getByText('Go there'));
    const card = screen.getByText('Read chapter').closest('.card');
    expect(card).toBeTruthy();
    // Scored placement, not pinned to the exact date — but inside that week.
    const day = Number(card.closest('[data-dropzone]').dataset.dayIndex);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThanOrEqual(6);
  });

  it('leaving the date alone reproduces the old behaviour exactly (today, this week)', () => {
    const panel = openAdd();
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Break' } });
    // Default is today when the viewed week is the current one.
    expect(within(panel).getByLabelText('Date').value).toBe(dateKey(WEDNESDAY));
    fireEvent.click(within(panel).getByText('Add'));

    expect(screen.getByText('Break')).toBeTruthy(); // visible without jumping
    expect(screen.queryByText('Go there')).toBeNull();
  });

  it('submit is blocked without a date, rather than silently defaulting', () => {
    const panel = openAdd();
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Thing' } });
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
  it('is collapsed by default, so the common case stays one field', () => {
    const panel = openAdd();
    expect(within(panel).queryByText('Place it')).toBeNull();
    fireEvent.click(within(panel).getByText(/more options/));
    expect(within(panel).getByText('Place it')).toBeTruthy();
    expect(within(panel).getByText('that week')).toBeTruthy();
  });

  it('is offered only where it means something — never for a task you timed yourself', () => {
    const panel = openAdd();
    fireEvent.click(within(panel).getByText('Fixed')); // a fixed task IS its time
    expect(within(panel).queryByText(/more options/)).toBeNull();
  });

  it('widens the search past the chosen week when asked', () => {
    const panel = openAdd();
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Essay' } });
    setDate(panel, dateKey(addDays(weekStart(WEDNESDAY), 7))); // next week
    fireEvent.click(within(panel).getByText(/more options/));
    fireEvent.change(within(panel).getByLabelText('Place it before'), { target: { value: '2026-08-14' } });
    fireEvent.click(within(panel).getByText('Add'));

    // It lands somewhere in that window rather than being clamped to one week.
    fireEvent.click(screen.getByText('Go there'));
    expect(screen.getByText('Essay')).toBeTruthy();
  });
});

describe('P1 — repeating still takes its times from the pattern', () => {
  it('hides the date field but says which week the pattern starts', () => {
    const panel = openAdd();
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Gym' } });
    setDate(panel, '2026-09-08'); // a Tuesday, seven weeks out
    fireEvent.click(within(panel).getByLabelText('Repeat this task'));

    expect(within(panel).queryByLabelText('Date')).toBeNull();
    // The hidden date still seeds effectiveFrom, so it must be stated, not assumed.
    expect(within(panel).getByText(/Starts the week of Mon 7 Sep/)).toBeTruthy();
  });
});
