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
import { seed } from '../src/core/index.js';
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
    fireEvent.click(screen.getAllByText('Wed')[0]);
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
