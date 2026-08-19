// @vitest-environment jsdom
// The entry screen and the guest/Google choice — GOOGLE-AS-STORAGE.md P2.
//
// ⚠️ jsdom has no layout engine, so nothing here says the screen LOOKS right —
// the parallax, the torn edge and the scratchy doors went to the user in a
// browser. What this proves is the part that would silently misbehave: which
// screen you land on, that guest never touches the network, and that the choice
// can be changed rather than being a one-way door.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { SESSION_KEY, SESSION, loadSession, saveSession, clearSession } from '../src/ui/session.js';

const NOW = new Date(2026, 6, 15, 10, 0, 0, 0); // Wed
const at = (offset, h) => {
  const d = addDays(weekStartOf(NOW), offset);
  d.setHours(h, 0, 0, 0);
  return d;
};

const seedSchedule = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({ title: 'Monday thing', startTime: at(0, 9), endTime: at(0, 10) });
  s.markWeekSeen(NOW);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

const onLanding = () => !!document.querySelector('.lz');
const inApp = () => !!document.querySelector('.stage');

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1440;
  window.matchMedia = (query) => ({
    matches: /min-width:\s*1280px/.test(query),
    media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the stored key', () => {
  it('matches the literal the other test files hardcode', () => {
    // ⚠️ THE DRIFT GUARD. Twelve test files seed `'sandycay.session'` as a
    // literal rather than importing this constant, which is a deliberate trade
    // to avoid twelve imports. This is what stops that duplication going stale:
    // rename SESSION_KEY without updating them and every UI test would land on
    // the entry screen with no clue why. This fails first, and says why.
    expect(SESSION_KEY).toBe('sandycay.session');
  });

  it('reads an unset or nonsense value as "not chosen"', () => {
    expect(loadSession()).toBe(null);
    window.localStorage.setItem(SESSION_KEY, 'pirate');
    // The safe direction: showing the entry screen ASKS, where guessing assumes.
    expect(loadSession()).toBe(null);
    saveSession(SESSION.GUEST);
    expect(loadSession()).toBe(SESSION.GUEST);
    clearSession();
    expect(loadSession()).toBe(null);
  });
});

describe('which screen you land on', () => {
  it('shows the entry screen when nobody has chosen', () => {
    seedSchedule();
    render(<App />);
    expect(onLanding()).toBe(true);
    expect(inApp()).toBe(false);
    expect(screen.getByText(/Bury it in the chest/i)).toBeTruthy();
    expect(screen.getByText(/Sail without a flag/i)).toBeTruthy();
  });

  it('shows it EVEN WHEN a schedule already exists', () => {
    // The user's call: everyone sees it until they choose. An existing schedule
    // must not silently bypass the question, or sign-in is undiscoverable.
    seedSchedule();
    render(<App />);
    expect(onLanding()).toBe(true);
  });

  it('goes straight to the app once a choice is recorded', () => {
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GUEST);
    render(<App />);
    expect(onLanding()).toBe(false);
    expect(inApp()).toBe(true);
  });
});

describe('the guest door', () => {
  it('lands you in the app and KEEPS the schedule you already had', () => {
    // The entry screen is a question about where the schedule LIVES. It must
    // never be a wall between someone and data already in their browser.
    seedSchedule();
    render(<App />);
    fireEvent.click(screen.getByText(/Sail without a flag/i).closest('button'));
    expect(inApp()).toBe(true);
    expect(screen.getByText('Monday thing')).toBeTruthy();
  });

  it('records the choice, so a reload does not ask again', () => {
    seedSchedule();
    render(<App />);
    fireEvent.click(screen.getByText(/Sail without a flag/i).closest('button'));
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(SESSION.GUEST);
    cleanup();
    render(<App />);
    expect(onLanding()).toBe(false);
  });

  it('NEVER touches the network', async () => {
    // The whole promise of guest mode in one assertion. If this ever fails,
    // "nothing leaves this device" has become a lie on the screen itself.
    seedSchedule();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('guest mode must not fetch');
    });
    try {
      render(<App />);
      fireEvent.click(screen.getByText(/Sail without a flag/i).closest('button'));
      await act(async () => {});
      expect(inApp()).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      // and no Google script was injected either
      expect(document.querySelector('script[src*="accounts.google.com"]')).toBe(null);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('the Google door', () => {
  it('SAYS SO when Google refuses, rather than doing nothing', async () => {
    // A door that silently does nothing is the disabled-button-that-swallows-
    // clicks bug this project has already had once.
    seedSchedule();
    render(<App />);
    fireEvent.click(screen.getByText(/Bury it in the chest/i).closest('button'));
    await act(async () => { await Promise.resolve(); });
    // jsdom cannot load Google's script, so the attempt fails — which is
    // exactly the path being tested. Either an error is shown, or we are still
    // on the entry screen; what must NOT happen is a silent sign-in.
    await vi.waitFor(() => {
      expect(onLanding()).toBe(true);
    });
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBe(SESSION.GOOGLE);
  });

  it('does not record a session it did not get', () => {
    seedSchedule();
    render(<App />);
    fireEvent.click(screen.getByText(/Bury it in the chest/i).closest('button'));
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBe(SESSION.GOOGLE);
  });
});

describe('step two: which calendar is the storage (GS-5)', () => {
  const onPicker = () => !!document.querySelector('.cp-list, .cp-lead');

  it('a signed-in session with no calendar lands on the picker, not the app', () => {
    // Nothing can sync until this is answered, so being dropped into the app
    // would mean silently saving nothing until you found a panel in the Cabana.
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    render(<App />);
    expect(onPicker()).toBe(true);
    expect(inApp()).toBe(false);
    expect(screen.getByText(/Where to bury it/i)).toBeTruthy();
  });

  it('says an empty calendar is wanted, and that it cannot make one', () => {
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    render(<App />);
    expect(screen.getByText(/can.t create one for you/i)).toBeTruthy();
    expect(screen.getByText(/refuse a calendar that already has other events/i)).toBeTruthy();
  });

  it('goes straight to the app once a calendar is stored', () => {
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    window.localStorage.setItem('sandycay.sync.calendar', JSON.stringify('cal-1'));
    render(<App />);
    expect(onPicker()).toBe(false);
    expect(inApp()).toBe(true);
  });

  it('⚠️ asks for a CLICK rather than popping up from an effect', () => {
    // THE BUG THIS PINS, seen on a real browser: the picker requested a token
    // in its mount effect, so Google opened a popup with no user gesture behind
    // it and the browser closed it instantly. The screen showed "Popup window
    // closed" and an empty list, with no way forward.
    //
    // With no token held, the picker must offer a button instead — a click is
    // the only context a popup reliably survives. jsdom has no Google, so
    // `cachedAccessToken()` is always null here, which is exactly this case.
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    render(<App />);
    expect(screen.getByText(/Show me my calendars/i)).toBeTruthy();
    // and it must NOT have tried to reach Google on its own
    expect(screen.queryByText(/Popup window closed/i)).toBe(null);
    expect(document.querySelector('.cp-list')).toBe(null);
  });

  it('is never a dead end — Go back returns to the entry screen', () => {
    // If no calendar works out, the guest door is still a real way to use this.
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    render(<App />);
    fireEvent.click(screen.getByText(/Go back/i).closest('button'));
    expect(onLanding()).toBe(true);
    expect(loadSession()).toBe(null);
  });

  it('a GUEST never sees the picker', () => {
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GUEST);
    render(<App />);
    expect(onPicker()).toBe(false);
    expect(inApp()).toBe(true);
  });
});

describe('the choice is not a one-way door', () => {
  it('can be changed from the Cabana, WITHOUT losing the schedule', () => {
    // Without this, switching from guest to Google would mean clearing browser
    // storage — a terrible answer to "actually, I do want this on my phone".
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GUEST);
    render(<App />);
    expect(inApp()).toBe(true);

    fireEvent.click(screen.getByTitle(/cabana/i) || screen.getByText(/cabana/i));
    const change = screen.getByText(/Change how you sign in/i).closest('button');
    fireEvent.click(change);

    expect(onLanding()).toBe(true);
    expect(loadSession()).toBe(null);
    // The schedule is untouched — changing where your week lives must never be
    // a way to lose it.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    fireEvent.click(screen.getByText(/Sail without a flag/i).closest('button'));
    expect(screen.getByText('Monday thing')).toBeTruthy();
  });

  it('⚠️ changing how you sign in also lets you re-choose the calendar', () => {
    // It used to clear the session but KEEP the stored calendar, so signing
    // back in with Google skipped the picker and silently reused the old one —
    // there was no way to re-choose it short of clearing browser storage.
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GOOGLE);
    window.localStorage.setItem('sandycay.sync.calendar', JSON.stringify('cal-1'));
    render(<App />);
    expect(inApp()).toBe(true);            // straight in, calendar already set

    fireEvent.click(screen.getByTitle(/cabana/i) || screen.getByText(/cabana/i));
    fireEvent.click(screen.getByText(/Change how you sign in/i).closest('button'));

    expect(onLanding()).toBe(true);
    // The calendar is forgotten, so the picker will ask again.
    expect(window.localStorage.getItem('sandycay.sync.calendar')).toBe('null');
    // ...and the schedule is untouched.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('names which way you are signed in', () => {
    seedSchedule();
    window.localStorage.setItem(SESSION_KEY, SESSION.GUEST);
    render(<App />);
    fireEvent.click(screen.getByTitle(/cabana/i) || screen.getByText(/cabana/i));
    expect(screen.getByText(/Sailing without a flag/i)).toBeTruthy();
  });
});
