// @vitest-environment jsdom
// UI smoke test — mounts the real <App/> against the real engine. jsdom is
// scoped to this file only via the docblock above; the node-env engine suite is
// untouched.
//
// The app ships EMPTY: it's for your schedule, not a showroom. So the first-run
// case is an empty week, and a test wanting content hands it over the way a
// returning user would — persisted state.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { seed, weekStart, addDays, dateKey } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

/** Boot with the demo week already persisted, as a returning user would have. */
const withSavedWeek = () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed(new Date()).toJSON()));
};

describe('App smoke render', () => {
  it('first run is an EMPTY week — chrome renders, no demo data invented', () => {
    render(<App />);

    // Masthead present (the title uses a non-breaking space).
    expect(screen.getByRole('heading', { name: /Sandy\s*Cay/ })).toBeTruthy();

    // Week grid renders all seven day headers.
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }

    // Nothing from the old seed week is conjured up for a new user.
    expect(screen.queryByText('Team standup')).toBeNull();
    expect(screen.queryByText('Morning gym')).toBeNull();
    expect(document.querySelectorAll('.card').length).toBe(0);
  });

  it('a saved week is hydrated from storage', () => {
    withSavedWeek();
    render(<App />);
    expect(screen.getByText('Team standup')).toBeTruthy();
  });

  it('opens the Add-task panel from the top bar cluster', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');
    expect(panel).toBeTruthy();
    expect(within(panel).getByText(/only required field/i)).toBeTruthy();
  });

  it('reaches the major views without crashing', () => {
    withSavedWeek();
    render(<App />);

    // Task detail-edit panel opens from a card.
    fireEvent.click(screen.getByText('Team standup'));
    expect(document.querySelector('.panel')).toBeTruthy();

    // What-To-Do panel (whatToDo engine call).
    fireEvent.click(screen.getByLabelText('What to do now'));
    expect(screen.getByText(/what to do/i)).toBeTruthy();

    // Find-times panel (findFreeSlots).
    fireEvent.click(screen.getByLabelText('Find times'));
    expect(screen.getByText(/free-slot search/i)).toBeTruthy();

    // Day view (main-area mode with its own ✕).
    // The header opens the day panel now; the view is on the ⋯ menu.
    fireEvent.click(document.querySelectorAll('.dhdots')[2]);
    fireEvent.click(screen.getByText(/Open day view/));
    expect(screen.getByText(/Wednesday/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Back to week'));

    // Cabana full page (getTagBreakdown + learned-weights read).
    fireEvent.click(screen.getByLabelText('Cabana settings'));
    expect(screen.getByText('The Cabana')).toBeTruthy();
    expect(screen.getByText('Tuning')).toBeTruthy();
  });

  it('the empty app still reaches every view (no crash on zero tasks)', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('What to do now'));
    expect(screen.getByText(/what to do/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cabana settings'));
    expect(screen.getByText('The Cabana')).toBeTruthy();
  });
});

describe('7B — a fixed task goes where you say', () => {
  it('"Dentist, Friday 2pm" is expressible — not auto-placed somewhere else', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');

    // Fixed reveals the when-fields; they are not optional for a fixed task.
    fireEvent.click(within(panel).getByText('Fixed'));
    fireEvent.change(within(panel).getByPlaceholderText(/Call plumber/i), { target: { value: 'Dentist' } });
    // Friday OF THE VIEWED WEEK, derived — this file doesn't freeze the clock,
    // and a hardcoded date would be a different week on most days of the year.
    fireEvent.change(within(panel).getByLabelText('Date'), {
      target: { value: dateKey(addDays(weekStart(new Date()), 4)) },
    });
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: '14:00' } });
    fireEvent.click(within(panel).getByText('Add'));

    const card = screen.getByText('Dentist').closest('.card');
    expect(card.getAttribute('aria-label')).toContain('14:00–15:00'); // where I said
    expect(Number(card.closest('[data-dropzone]').dataset.dayIndex)).toBe(4); // Friday
  });

  it('a flexible task is still auto-placed unless you ask to pick a date', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');
    // Flexible is the default, and offers no when-fields until asked.
    expect(within(panel).queryByLabelText('Date')).toBeNull();
    expect(within(panel).queryByLabelText('Start time')).toBeNull();
    expect(within(panel).getByText(/no unscheduled tray/i)).toBeTruthy();

    // The opt-in is a DATE; the time is then optional on top of it, and blank
    // means "that day, you choose when" — which is what flexible means.
    fireEvent.click(within(panel).getByText('pick a date'));
    expect(within(panel).getByLabelText('Date')).toBeTruthy();
    expect(within(panel).getByLabelText('Start time').value).toBe('');
  });
});
