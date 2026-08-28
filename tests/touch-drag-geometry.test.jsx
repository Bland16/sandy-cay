// @vitest-environment jsdom
// Touch drag on a phone — the geometry, and the one term in it that goes stale.
//
// ⚠️ WHY THIS FILE EXISTS. All eighteen tests in ui-drag.test.jsx hardcode
// `pointerType: 'mouse'`. The touch path is not a variation on that path: it
// arms on a 450ms long press, so `openSession` runs from a TIMER holding a
// closure over coordinates captured at pointer-down. None of it was covered,
// and the app's only phone-shaped bug lived exactly there.
//
// jsdom has no layout engine, so it cannot SEE a shifted page. What it can do
// is be TOLD the page shifted — which is what these tests do, by moving the
// stubbed column rect mid-drag. That is the honest half; the real-device half
// is a checklist for the user.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { gridBounds } from '../src/ui/format.js';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { BASE_PXH_DAY, pxhFor, DEFAULT_ZOOM } from '../src/ui/zoom.js';

const PHONE = 390;
function setWidth(px) {
  window.innerWidth = px;
  window.matchMedia = (q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      matches: (!min || px >= Number(min[1])) && (!max || px <= Number(max[1])),
      media: q,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    };
  };
}

const NOW = new Date(2026, 6, 15, 10, 0, 0, 0); // Wed
const { start: START_HOUR, end: END_HOUR } = gridBounds();
const PXH = pxhFor(BASE_PXH_DAY, DEFAULT_ZOOM);
const COL_LEFT = 8;
const COL_W = 360;
const COL_H = (END_HOUR - START_HOUR) * PXH;
// Mutable: moving this mid-drag is how "the page shifted" is expressed here.
let colTop = 150;
const yAt = (h, m = 0) => colTop + (h + m / 60 - START_HOUR) * PXH;

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {},
});

const seedWeek = () => {
  const s = new Schedule({ config: defaultConfig });
  const wed = addDays(weekStartOf(NOW), 2);
  const st = new Date(wed); st.setHours(8, 0, 0, 0);
  const en = new Date(wed); en.setHours(9, 0, 0, 0);
  s.addFixed({ title: 'Read novel', startTime: st, endTime: en });
  s.markWeekSeen(NOW);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

let origRect;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  colTop = 150;
  window.localStorage.clear();
  window.localStorage.setItem('sandycay.session', 'guest');
  setWidth(PHONE);
  origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stub() {
    if (this.dataset && this.dataset.dropzone !== undefined) {
      return rect(COL_LEFT, colTop, COL_W, COL_H);
    }
    if (this.classList && this.classList.contains('card')) {
      const col = this.closest('[data-dropzone]');
      if (!col) return rect(0, 0, 0, 0);
      const cr = col.getBoundingClientRect();
      return rect(cr.left + 3, cr.top + (parseFloat(this.style.top) || 0),
        cr.width - 6, parseFloat(this.style.height) || 30);
    }
    return rect(0, 0, 0, 0);
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = origRect;
  cleanup();
  vi.useRealTimers();
});

// jsdom has no PointerEvent, and `fireEvent.pointerDown(el, {pointerType})`
// silently drops the property — the code would take the MOUSE path and the test
// would pass while proving nothing. Same trap the other drag files document.
const pointer = (type, x, y, kind = 'touch') => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: kind });
  return e;
};
const card = () => document.querySelector('.dayview .card') || document.querySelector('.card');
const timeOf = (el) => el.getAttribute('aria-label').split(' · ')[1];

/**
 * Hold, then drag so the card's TOP lands on `targetTop`.
 *
 * `shiftMidDrag` moves the whole page UP by that many pixels partway through.
 * The finger stays on the same pixel OF THE CARD, so it travels with it — which
 * is the whole point: the user has not moved relative to what they are holding.
 */
function touchDrag(c, targetTop, { shiftMidDrag = 0 } = {}) {
  const r = c.getBoundingClientRect();
  const gy = Math.round(r.height / 2);   // finger in the middle of the card
  fireEvent(c, pointer('pointerdown', r.left + 30, r.top + gy));
  act(() => { vi.advanceTimersByTime(500); });          // the long press arms it
  fireEvent(window, pointer('pointermove', r.left + 30, r.top + gy + 20));
  if (shiftMidDrag) colTop -= shiftMidDrag;
  const endY = targetTop - shiftMidDrag + gy;
  fireEvent(window, pointer('pointermove', r.left + 30, endY));
  fireEvent(window, pointer('pointerup', r.left + 30, endY));
}

describe('touch drag on the phone day view', () => {
  it('a held-then-dragged card lands where you put it', () => {
    seedWeek();
    render(<App />);
    expect(document.querySelector('.dayview')).toBeTruthy();
    const c = card();
    expect(timeOf(c)).toBe('08:00–09:00');

    touchDrag(c, yAt(14));
    expect(timeOf(card())).toBe('14:00–15:00');
  });

  it('⚠️ still lands there when the page SHIFTS mid-drag', () => {
    // THE REPORTED BUG. `s.cols` is measured once, when the drag arms, and
    // `col.top` is a viewport coordinate. iOS collapsing its address bar during
    // a gesture moves the real column while that number stays behind, so the
    // drop lands off by the shift — earlier, because the content moved up.
    //
    // 60px at 42px/hour is 85 minutes, snapping to 90: aimed at 14:00, the card
    // landed at 12:30. Which is why it read as "about one task duration too
    // high, so aim a duration low to hit the spot".
    //
    // Reverting `finish` to `s.cols` fails this and passes everything else.
    seedWeek();
    render(<App />);
    touchDrag(card(), yAt(14), { shiftMidDrag: 60 });
    expect(timeOf(card())).toBe('14:00–15:00');
  });

  it('and a shift the other way is equally wrong, so it is equally fixed', () => {
    seedWeek();
    render(<App />);
    touchDrag(card(), yAt(14), { shiftMidDrag: -60 });
    expect(timeOf(card())).toBe('14:00–15:00');
  });

  it('⚠️ the grab offset is NOT double-corrected', () => {
    // `grab.dy` is measured WITHIN the card at one instant. A page that moves
    // takes the card and the finger with it equally, so that number is still
    // true — "correcting" it as well would subtract the shift twice. Grabbing
    // the card near its top must land in the same place as grabbing its middle.
    seedWeek();
    render(<App />);
    const c = card();
    const r = c.getBoundingClientRect();
    // ⚠️ Read the target BEFORE the shift. `yAt` follows `colTop`, so computing
    // it afterwards already includes the shift and subtracting it again moves
    // the aim twice — which is the same double-count the code must not make.
    const target = yAt(14);
    fireEvent(c, pointer('pointerdown', r.left + 30, r.top + 2));
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent(window, pointer('pointermove', r.left + 30, r.top + 22));
    colTop -= 60;
    fireEvent(window, pointer('pointermove', r.left + 30, target - 60 + 2));
    fireEvent(window, pointer('pointerup', r.left + 30, target - 60 + 2));
    expect(timeOf(card())).toBe('14:00–15:00');
  });

  it('a finger that moves before the hold completes scrolls instead', () => {
    // The other half of the touch contract, and the reason the long press
    // exists: 4px of slop is nothing to a finger, so without this every attempt
    // to scroll the 24-hour grid flung a task somewhere.
    seedWeek();
    render(<App />);
    const c = card();
    const r = c.getBoundingClientRect();
    fireEvent(c, pointer('pointerdown', r.left + 30, r.top + 10));
    fireEvent(window, pointer('pointermove', r.left + 30, r.top + 60)); // past the slop
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(false);
    expect(timeOf(card())).toBe('08:00–09:00');
  });
});
