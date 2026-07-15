// @vitest-environment jsdom
// UI smoke test — mounts the real <App/> (engine-backed, seed data) and asserts
// the week grid chrome and a seed task title render. jsdom is scoped to this
// file only via the docblock above; the node-env engine suite is untouched.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';

afterEach(cleanup);

describe('App smoke render', () => {
  it('renders the masthead, the week grid day headers, and a seed task', () => {
    render(<App />);

    // Masthead present (the title uses a non-breaking space).
    expect(screen.getByRole('heading', { name: /Sandy\s*Cay/ })).toBeTruthy();

    // Week grid renders all seven day headers.
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }

    // A seed task from the engine is on the grid (Team standup, fixed, Monday).
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
});
