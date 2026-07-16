// @vitest-environment jsdom
// Responsive layouts (SPEC §11) + the touch gate.
//
// jsdom has no layout engine and no real matchMedia, so these tests do NOT prove
// anything looks right — they prove the app renders the layout it decided on,
// and that the touch gate's logic holds. Whether five columns actually fit at
// 800px is a question only a browser answers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { readViewport, PHONE_MAX, TABLET_MAX } from '../src/ui/useViewport.js';

/** Drive matchMedia by width, the way a browser would. */
function setWidth(px) {
  window.innerWidth = px;
  window.matchMedia = (query) => {
    // Enough of a parser for the two queries useViewport actually asks.
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const okMin = !min || px >= Number(min[1]);
    const okMax = !max || px <= Number(max[1]);
    return {
      matches: okMin && okMax,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  };
}

const PHONE = 390;
const TABLET = 900;
const DESKTOP = 1440;

// The phone opens on TODAY's column, so "today" has to be a fixed thing or these
// tests quietly assert something different depending on the day they run. Pin it
// to a Wednesday: WED_INDEX is 2, and Monday/Saturday are reliably NOT today.
const NOW = new Date(2026, 6, 15, 10, 0, 0, 0); // Wed 15 Jul 2026
const WED_INDEX = 2;

const thisWeek = () => weekStartOf(NOW); // Mon 13 Jul
const at = (offset, h) => {
  const d = addDays(thisWeek(), offset);
  d.setHours(h, 0, 0, 0);
  return d;
};

/** Mon, today (Wed) and Sat each carry one uniquely-named thing. */
const seedWeek = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({ title: 'Monday thing', startTime: at(0, 9), endTime: at(0, 10) });
  s.addFixed({ title: 'Today thing', startTime: at(WED_INDEX, 14), endTime: at(WED_INDEX, 15) });
  s.addFixed({ title: 'Saturday thing', startTime: at(5, 11), endTime: at(5, 12) });
  s.markWeekSeen(NOW); // no rollover banner in the way
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
};

beforeEach(() => {
  window.localStorage.clear();
  setWidth(DESKTOP);
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('§11 — the breakpoints', () => {
  it('classifies each width as the spec does', () => {
    setWidth(PHONE); expect(readViewport()).toBe('phone');
    setWidth(PHONE_MAX); expect(readViewport()).toBe('phone');
    setWidth(PHONE_MAX + 1); expect(readViewport()).toBe('tablet');
    setWidth(TABLET); expect(readViewport()).toBe('tablet');
    setWidth(TABLET_MAX); expect(readViewport()).toBe('tablet');
    setWidth(TABLET_MAX + 1); expect(readViewport()).toBe('desktop');
  });

  it('falls back to desktop when matchMedia is missing rather than throwing', () => {
    const saved = window.matchMedia;
    delete window.matchMedia;
    expect(readViewport()).toBe('desktop');
    window.matchMedia = saved;
  });
});

describe('≥1280 — desktop keeps the full week', () => {
  it('draws all seven columns', () => {
    seedWeek();
    setWidth(DESKTOP);
    render(<App />);
    expect(document.querySelectorAll('.day')).toHaveLength(7);
    expect(document.querySelector('.wkdrawer')).toBeNull();
    expect(document.querySelector('.daypick')).toBeNull();
  });
});

describe('768–1279 — tablet: Mon–Fri + a weekend drawer', () => {
  beforeEach(() => setWidth(TABLET));

  it('shows five weekday columns, with the weekend in the drawer', () => {
    seedWeek();
    render(<App />);
    // 5 in the main grid + 2 in the drawer = 7 columns, but only 5 in the week.
    const grids = document.querySelectorAll('.gridwrap');
    expect(grids).toHaveLength(2); // the week, and the drawer's own
    expect(within(grids[0]).getAllByText(/^(Mon|Tue|Wed|Thu|Fri)$/)).toHaveLength(5);
    expect(within(grids[0]).queryByText('Sat')).toBeNull();
    expect(within(grids[1]).getAllByText(/^(Sat|Sun)$/)).toHaveLength(2);
  });

  it('the drawer is closed by default and opens from the towel tab', () => {
    seedWeek();
    render(<App />);
    const tab = screen.getByTitle(/show the weekend/i);
    expect(document.querySelector('.wkdrawer').classList.contains('open')).toBe(false);
    expect(tab.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(tab);
    expect(document.querySelector('.wkdrawer').classList.contains('open')).toBe(true);
    expect(screen.getByTitle(/hide the weekend/i).getAttribute('aria-expanded')).toBe('true');
  });

  it('a closed drawer is inert — not a drop zone hiding behind Friday', () => {
    seedWeek();
    render(<App />);
    const drawer = document.querySelector('.wkdrawer');
    // The drag code finds columns via [data-dropzone]. If the closed drawer's
    // columns stayed live, a drop near the right edge could land on Sunday.
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(drawer.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByTitle(/show the weekend/i));
    expect(document.querySelector('.wkdrawer').hasAttribute('inert')).toBe(false);
  });

  it('the weekend columns keep the drop-geometry contract', () => {
    seedWeek();
    render(<App />);
    fireEvent.click(screen.getByTitle(/show the weekend/i));
    const zones = [...document.querySelectorAll('[data-dropzone]')];
    const days = zones.map((z) => Number(z.dataset.dayIndex)).sort((a, b) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Same geometry attributes as any weekday column — the drawer renders a real
    // WeekGrid, so a drag into Saturday lands on Saturday.
    const sat = zones.find((z) => Number(z.dataset.dayIndex) === 5);
    expect(sat.dataset.pxh).toBeTruthy();
    expect(sat.dataset.startHour).toBeTruthy();
  });
});

describe('touch: hold to pick up, otherwise scroll', () => {
  // jsdom has no PointerEvent, so `fireEvent.pointerDown(el, {pointerType})`
  // silently drops the property and the code takes the MOUSE path — the test
  // would pass while proving nothing. Same shape as ui-drag.test.jsx's helper.
  const pointer = (type, { x = 100, y = 100, kind = 'touch' } = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: kind });
    return e;
  };
  const touchDown = (el, x = 100, y = 100) => fireEvent(el, pointer('pointerdown', { x, y }));

  beforeEach(() => setWidth(PHONE));

  const card = () => document.querySelector('.dayview .card');

  it('a finger on a card does NOT immediately arm a drag', () => {
    seedWeek();
    render(<App />);
    touchDown(card());
    // The whole bug this prevents: 4px of slop is nothing to a finger, so every
    // attempt to scroll the 24h grid used to fling a task somewhere.
    expect(document.body.classList.contains('sc-dragging')).toBe(false);
  });

  it('holding still arms it', () => {
    seedWeek();
    render(<App />);
    touchDown(card());
    expect(card().classList.contains('pressing')).toBe(true); // visible wind-up
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(true);
  });

  it('moving first is a scroll, and never becomes a drag', () => {
    seedWeek();
    render(<App />);
    touchDown(card(), 100, 100);
    fireEvent(window, pointer('pointermove', { y: 140 }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(false);
    expect(card().classList.contains('pressing')).toBe(false);
  });

  it('the browser taking the gesture (pointercancel) abandons the hold', () => {
    seedWeek();
    render(<App />);
    touchDown(card());
    // pointercancel IS the browser saying "I'm scrolling this now".
    fireEvent(window, pointer('pointercancel'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(false);
  });

  it('lifting before the hold completes is a tap, not a drag', () => {
    seedWeek();
    render(<App />);
    touchDown(card());
    fireEvent(window, pointer('pointerup'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(false);
  });

  it('a mouse still picks up instantly — the gate is touch-only', () => {
    setWidth(DESKTOP);
    seedWeek();
    render(<App />);
    const c = document.querySelector('.day .card');
    fireEvent(c, pointer('pointerdown', { kind: 'mouse' }));
    expect(document.body.classList.contains('sc-dragging')).toBe(true);
  });
});

describe('<768 — phone: the day is the layout', () => {
  beforeEach(() => setWidth(PHONE));

  it('opens on a day, not on a seven-column grid', () => {
    seedWeek();
    render(<App />);
    // §11 calls single-day the PRIMARY mobile layout — so it is what you land on.
    expect(document.querySelector('.dayview')).toBeTruthy();
    expect(document.querySelector('.daypick')).toBeTruthy();
    expect(document.querySelector('.grid')).toBeNull();
  });

  it('has no ✕ — there is no week behind the day to go back to', () => {
    seedWeek();
    render(<App />);
    expect(screen.queryByLabelText(/back to week/i)).toBeNull();
  });

  it('opens on today', () => {
    seedWeek();
    render(<App />);
    const day = document.querySelector('.dayview');
    expect(within(day).getByText('Today thing')).toBeTruthy();
    expect(within(day).queryByText('Saturday thing')).toBeNull();
  });

  it('the picker changes day', () => {
    seedWeek();
    render(<App />);
    fireEvent.click(within(document.querySelector('.daypick')).getByLabelText(/^Sat /));
    const day = document.querySelector('.dayview');
    expect(within(day).getByText('Saturday thing')).toBeTruthy();
    expect(within(day).queryByText('Today thing')).toBeNull();
  });

  it('marks which days have anything on them — presence, not pressure', () => {
    seedWeek();
    render(<App />);
    const strip = document.querySelector('.daypick');
    // Mon has one thing, Tue has nothing. The label says so without a colour,
    // and says "nothing scheduled" rather than anything about that being bad.
    expect(within(strip).getByLabelText('Mon 13, 1 scheduled')).toBeTruthy();
    expect(within(strip).getByLabelText('Tue 14, nothing scheduled')).toBeTruthy();
    expect(strip.querySelectorAll('.dpdot.has')).toHaveLength(3); // Mon, Wed, Sat
  });

  it('keeps the week reachable as an overview', () => {
    seedWeek();
    render(<App />);
    fireEvent.click(screen.getByLabelText(/week overview/i));
    expect(document.querySelectorAll('.day')).toHaveLength(7);
    // ...and the picker is still there to get back to a day.
    expect(document.querySelector('.daypick')).toBeTruthy();
    fireEvent.click(within(document.querySelector('.daypick')).getByLabelText(/^Sat /));
    expect(document.querySelector('.dayview')).toBeTruthy();
  });
});
