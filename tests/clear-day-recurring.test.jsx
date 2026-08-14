// @vitest-environment jsdom
// Clear Day and repeating sessions (SPEC §3.4 / OD-7).
//
// The report was "clear day doesn't work". It worked exactly as designed —
// `evacuateDay` filters `!t.recurrence` and an occurrence has never lived in
// `schedule.tasks`, so a full clear left every class on the day untouched and
// only printed a note telling you to go and skip each one from its own card.
// On a term calendar that is the entire day, so the feature did nothing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

const NOW = new Date(2026, 10, 25, 10, 0, 0, 0); // Wed 25 Nov
beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const ws = () => weekStartOf(NOW);
const at = (o, h) => { const d = addDays(ws(), o); d.setHours(h, 0, 0, 0); return d; };

/** A term Thursday: a weekly class, a one-off fixed, and a flexible. */
const seed = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({
    title: 'CHEM1109', tags: ['study'],
    startTime: at(3, 9), endTime: at(3, 10),
    recurrence: {
      periods: [{ windows: [{ day: 'thu', start: '09:00', end: '10:00' }], interval: 1, effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
      anchorDate: new Date(2026, 8, 1), exceptions: [],
    },
  });
  s.addFixed({ title: 'Dentist', startTime: at(3, 14), endTime: at(3, 15) });
  s.addFlexible({ title: 'Read novel', durationMin: 60, startTime: at(3, 16), endTime: at(3, 17) });
  s.markWeekSeen(NOW);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

const thursday = () => {
  const col = [...document.querySelectorAll('[data-dropzone]')].find((c) => Number(c.dataset.dayIndex) === 3);
  return [...col.querySelectorAll('.card')].map((c) => c.querySelector('.t')?.textContent);
};

const openPanel = () => {
  fireEvent.click(document.querySelectorAll('.dhdots')[3]);
  fireEvent.click(screen.getByText(/Clear this day/));
  return document.querySelector('.claripanel');
};

describe('a full clear can clear a repeating session', () => {
  it('offers it as a row that needs a decision', () => {
    seed();
    render(<App />);
    const panel = openPanel();
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));

    // Before, only Dentist got a row and the class was merely mentioned.
    const names = [...panel.querySelectorAll('.cdrow .cdname')].map((n) => n.textContent);
    expect(names).toContain('Dentist');
    expect(names).toContain('CHEM1109');
    expect(panel.textContent).toMatch(/2 need/);
  });

  it('will not commit until the repeating session is answered too', () => {
    seed();
    render(<App />);
    const panel = openPanel();
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));
    const commit = within(panel).getByText('Clear day').closest('button');

    fireEvent.change(within(panel).getByLabelText('Reschedule Dentist'), { target: { value: 'next-weekday' } });
    // OD-7's rule holds for the new row: nothing anchored moves on its own.
    expect(commit.disabled).toBe(true);

    fireEvent.change(within(panel).getByLabelText('Reschedule CHEM1109'), { target: { value: 'skip-occurrence' } });
    expect(commit.disabled).toBe(false);
  });

  it('skips THIS session and leaves the pattern running', () => {
    seed();
    render(<App />);
    let panel = openPanel();
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));
    fireEvent.change(within(panel).getByLabelText('Reschedule Dentist'), { target: { value: 'next-weekday' } });
    fireEvent.change(within(panel).getByLabelText('Reschedule CHEM1109'), { target: { value: 'skip-occurrence' } });
    fireEvent.click(within(panel).getByText('Clear day').closest('button'));

    expect(thursday()).toEqual([]); // the day is actually clear

    // ...and next Thursday's class is untouched: a skip is one session, not an
    // edit to the rule that outlives it.
    fireEvent.click(document.querySelector('[aria-label="Next week"]'));
    expect(thursday()).toContain('CHEM1109');
  });

  it('"leave it in place" keeps the session — the row is a choice, not a forced skip', () => {
    seed();
    render(<App />);
    const panel = openPanel();
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));
    fireEvent.change(within(panel).getByLabelText('Reschedule Dentist'), { target: { value: 'leave' } });
    fireEvent.change(within(panel).getByLabelText('Reschedule CHEM1109'), { target: { value: 'leave' } });
    fireEvent.click(within(panel).getByText('Clear day').closest('button'));

    expect(thursday()).toContain('CHEM1109');
  });

  it('flexibles-only still leaves repeating sessions alone, and says so', () => {
    seed();
    render(<App />);
    const panel = openPanel(); // opens on flexibles-only
    expect(panel.textContent).toMatch(/1 repeating session today stays put/);
    fireEvent.click(within(panel).getByText('Clear day').closest('button'));

    // The narrower scope is exactly that: the flexible went, the anchors stayed.
    expect(thursday()).toEqual(['CHEM1109', 'Dentist']);
  });
});
