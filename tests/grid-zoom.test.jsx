// @vitest-environment jsdom
// Grid zoom — design/GRID-ZOOM.md.
//
// ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has no layout engine, so it
// cannot see whether a 12px card is comfortably clickable, whether the hour
// rules actually line up on screen, or whether 4× is far enough for a 2-minute
// step. Those went to the user with a checklist. What it CAN prove is the thing
// that fails silently: that the number the cards were drawn with is the same
// number `data-pxh` reports back, at every rung. `design/probes/probe-grid-zoom.mjs`
// prints the rest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { layoutDay, columnItems } from '../src/ui/layout.js';
import {
  ZOOM_LEVELS, DEFAULT_ZOOM, BASE_PXH_WEEK, BASE_PXH_DAY,
  pxhFor, floorPxFor, zoomIn, zoomOut, loadZoom, saveZoom, clampZoom, nearestRung,
} from '../src/ui/zoom.js';
import { pinchZoomFor } from '../src/ui/usePinchZoom.js';

const NOW = new Date(2026, 6, 15, 10, 0, 0, 0); // Wed 15 Jul 2026
const thisWeek = () => weekStartOf(NOW);
const at = (offset, h, m = 0) => {
  const d = addDays(thisWeek(), offset);
  d.setHours(h, m, 0, 0);
  return d;
};

const seedWeek = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({ title: 'Monday thing', startTime: at(0, 9), endTime: at(0, 10) });
  // A two-minute touchpoint — the block this whole feature exists for.
  s.addFixed({ title: 'Load the machine', startTime: at(2, 8), endTime: at(2, 8, 2) });
  s.markWeekSeen(NOW);
  window.localStorage.setItem('sandycay.session', 'guest');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
};

const columns = () => [...document.querySelectorAll('[data-dropzone]')];
const pxhOf = (col) => Number(col.dataset.pxh);

/**
 * ⚠️ jsdom has no PointerEvent, and `fireEvent.pointerDown(el, {pointerType})`
 * silently DROPS the property — so the code under test takes the mouse path and
 * the test passes while proving nothing. Same helper shape as ui-drag and
 * ui-responsive, for the same reason.
 */
const touchEvent = (type, { x = 100, y = 100, id = 1, kind = 'touch' } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: kind });
  return e;
};

/** Phone: the day view is the layout, and the surface pinch was asked for. */
const setPhone = () => {
  window.innerWidth = 390;
  window.matchMedia = (query) => ({
    matches: /max-width:\s*767px/.test(query) && !/min-width/.test(query),
    media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
};

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

describe('the zoom model', () => {
  it('is an exact no-op at 1× on BOTH surfaces', () => {
    // The week grid was 34px/hour and the day view 42 before this existed, and
    // both floored cards at 26px. If any of those three moved at rest, the
    // feature changed the app for someone who never pressed a key.
    expect(pxhFor(BASE_PXH_WEEK, 1)).toBe(34);
    expect(pxhFor(BASE_PXH_DAY, 1)).toBe(42);
    expect(floorPxFor(1)).toBe(26);
    expect(DEFAULT_ZOOM).toBe(1);
  });

  it('keys the floor on ZOOM, not on absolute pixels', () => {
    // Anchoring on a pixel count (26 × 34 / pxh) would floor the day view at
    // 21px at rest rather than 26 — a behaviour change smuggled in under a
    // feature meant to be a no-op. Both surfaces share one zoom, so one floor.
    expect(floorPxFor(1)).toBe(26);
    expect(floorPxFor(2)).toBe(13);
    // Never below the hit-target minimum, however far you zoom.
    expect(floorPxFor(2.8)).toBe(12);
    expect(floorPxFor(4)).toBe(12);
  });

  it('zooms far enough to SEE A 5-MINUTE TASK — the reason the top rungs exist', () => {
    // The user's report was "we still can't see 5 minute tasks" at 4×, and the
    // arithmetic agreed: 136px/hour × 5min = 11.3px, which is under the 12px
    // floor, so it was drawn AT the floor and still overstating its length.
    //
    // This locks the requirement rather than the rung list, so trimming the
    // ladder back to 4× fails here with the reason attached — the numbers are
    // data, the requirement is not.
    const honestAt = (durMin) => ZOOM_LEVELS.find((z) => {
      const pxh = pxhFor(BASE_PXH_WEEK, z);
      return (durMin / 60) * pxh >= floorPxFor(z);
    });

    // 4× is NOT enough for five minutes. That is the whole finding.
    expect((5 / 60) * pxhFor(BASE_PXH_WEEK, 4)).toBeLessThan(floorPxFor(4));
    expect(honestAt(5)).toBe(5.6);

    // And at the top rung it is comfortably readable, not merely non-zero.
    const top = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    expect((5 / 60) * pxhFor(BASE_PXH_WEEK, top)).toBeGreaterThan(20);

    // The rungs it already handled must not regress.
    expect(honestAt(15)).toBe(2);
    expect(honestAt(10)).toBe(2.8);
  });

  it('shrinks the floor\'s LIE as it zooms in', () => {
    // The floor buys visibility by overstating length, and the overstatement is
    // measured in apparent minutes, not pixels.
    const apparent = (z) => (floorPxFor(z) / pxhFor(BASE_PXH_WEEK, z)) * 60;
    expect(apparent(1)).toBeCloseTo(45.9, 1);
    expect(apparent(4)).toBeCloseTo(5.3, 1);
    // Monotonic: no rung may make the lie worse than the one before it.
    for (let i = 1; i < ZOOM_LEVELS.length; i += 1) {
      expect(apparent(ZOOM_LEVELS[i])).toBeLessThan(apparent(ZOOM_LEVELS[i - 1]));
    }
  });

  it('saturates at both ends and never goes below 1× (D-3)', () => {
    expect(ZOOM_LEVELS[0]).toBe(1);

    // ⚠️ Assert the STEP, not just where a loop ends up. An earlier version of
    // this test pressed + nine times and expected the top rung — which a
    // WRAPPING zoomIn also satisfies whenever the press count lands back on it.
    // It passed against a broken implementation. Caught by mutation, which is
    // the only reason it is written this way. Derived from the ladder, not
    // hardcoded, so adding rungs cannot quietly make it vacuous again.
    const top = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    expect(zoomIn(top)).toBe(top);
    expect(zoomOut(1)).toBe(1);

    // And the whole ladder, in order, both ways.
    const up = [1];
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) up.push(zoomIn(up[up.length - 1]));
    expect(up).toEqual([...ZOOM_LEVELS, top]);
    const down = [top];
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) down.push(zoomOut(down[down.length - 1]));
    expect(down).toEqual([...[...ZOOM_LEVELS].reverse(), 1]);
  });

  it('falls back to 1× for a stored value that is not a rung', () => {
    // A zoom preference is the least important thing in the app; nothing it can
    // contain may stop the grid rendering.
    window.localStorage.setItem('sandycay.gridZoom', '3.3');
    expect(loadZoom()).toBe(1);
    window.localStorage.setItem('sandycay.gridZoom', 'banana');
    expect(loadZoom()).toBe(1);
    window.localStorage.removeItem('sandycay.gridZoom');
    expect(loadZoom()).toBe(1);
    saveZoom(2);
    expect(loadZoom()).toBe(2);
  });

  it('layoutDay defaults its floor to 26, so callers with no opinion are untouched', () => {
    const seg = { task: { id: 'a' }, s: 9, e: 9 + 2 / 60 };
    const [noOpinion] = layoutDay([seg], 5, 34);
    expect(noOpinion.style.height).toBe('26px');
    const [zoomed] = layoutDay([seg], 5, 136, floorPxFor(4));
    expect(zoomed.style.height).toBe('12px');
  });
});

describe('the grid honours the zoom', () => {
  it('every column reports the pxh its cards were drawn with', () => {
    // ⚠️ THE TRAP. useCardInteraction reads data-pxh at pointer-down and drives
    // every drop calculation from it. Asserting the attribute merely EXISTS
    // proves nothing — at 4× a stale 34 sends a 14:30 drop to 43:00 in silence.
    seedWeek();
    render(<App />);
    for (const z of ZOOM_LEVELS) {
      window.localStorage.setItem('sandycay.gridZoom', String(z));
      cleanup();
      render(<App />);
      const expected = pxhFor(BASE_PXH_WEEK, z);
      const cols = columns();
      expect(cols.length).toBe(7);
      for (const col of cols) expect(pxhOf(col)).toBe(expected);
      // The column's height must agree with the same number: 24 hours of it.
      expect(cols[0].style.height).toBe(`${24 * expected}px`);
      // And --pxh, which is what the CSS hour rules are ruled at. Cards and
      // gridlines drifting apart is trap 2 in the spec.
      expect(cols[0].style.getPropertyValue('--pxh')).toBe(`${expected}px`);
    }
  });

  it('+ and − step the grid, and 0 returns it to rest', () => {
    seedWeek();
    render(<App />);
    expect(pxhOf(columns()[0])).toBe(34);

    fireEvent.keyDown(window, { key: '+' });
    expect(pxhOf(columns()[0])).toBe(pxhFor(BASE_PXH_WEEK, 1.4));

    fireEvent.keyDown(window, { key: '+' });
    expect(pxhOf(columns()[0])).toBe(pxhFor(BASE_PXH_WEEK, 2));

    fireEvent.keyDown(window, { key: '-' });
    expect(pxhOf(columns()[0])).toBe(pxhFor(BASE_PXH_WEEK, 1.4));

    fireEvent.keyDown(window, { key: '0' });
    expect(pxhOf(columns()[0])).toBe(34);
  });

  it('persists across a reload', () => {
    seedWeek();
    render(<App />);
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '+' });
    const zoomed = pxhOf(columns()[0]);
    expect(zoomed).toBe(pxhFor(BASE_PXH_WEEK, 2));
    cleanup();
    render(<App />); // a fresh mount reads localStorage, as a reload would
    expect(pxhOf(columns()[0])).toBe(zoomed);
  });

  it('a two-minute block gets taller in APPARENT honesty, not in pixels', () => {
    seedWeek();
    render(<App />);
    const heightOf = (name) => {
      const card = screen.getByText(name).closest('.card');
      return parseFloat(card.style.height);
    };
    const at1 = heightOf('Load the machine');
    expect(at1).toBe(26); // the pixel floor, as it has always been

    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(window, { key: '+' });
    const at4 = heightOf('Load the machine');

    // SMALLER in pixels and far more honest: 26/34 of an hour reads as 46
    // minutes, 12/136 reads as 5. That trade is the decision in GRID-ZOOM §4.
    //
    // This only reaches 5 minutes because D-5 removed the 15-minute minimum
    // SPAN that used to sit upstream in `columnItems` — before that it bottomed
    // out at an apparent 15 minutes however far you zoomed.
    expect(at4).toBe(12);
    expect((at1 / 34) * 60).toBeCloseTo(45.9, 1);
    expect((at4 / 136) * 60).toBeCloseTo(5.3, 1);
  });

  it('an hour-long block still fills exactly one hour at every rung', () => {
    seedWeek();
    render(<App />);
    for (const z of ZOOM_LEVELS) {
      window.localStorage.setItem('sandycay.gridZoom', String(z));
      cleanup();
      render(<App />);
      const card = screen.getByText('Monday thing').closest('.card');
      expect(parseFloat(card.style.height)).toBe(pxhFor(BASE_PXH_WEEK, z));
    }
  });
});

describe('D-5 — the span is the truth, the minimum is a drawn height', () => {
  const DATE = new Date(2026, 6, 15, 12, 0, 0, 0);
  const mk = (id, min, durMin) => {
    const st = new Date(2026, 6, 15, 8, min, 0, 0);
    return {
      id, title: id, startTime: st,
      endTime: new Date(st.getTime() + durMin * 60000),
      getDuration: () => durMin,
    };
  };

  it('columnItems reports the REAL span, however short', () => {
    // It used to floor every span at a quarter of an hour, which made one number
    // answer two unrelated questions — how tall to draw a card, and whether it
    // overlaps its neighbours — and got both wrong for short work.
    const spanOf = (durMin) => {
      const [seg] = columnItems([mk('t', 0, durMin)], DATE, 5);
      return (seg.e - seg.s) * 60;
    };
    expect(spanOf(2)).toBeCloseTo(2, 5);
    expect(spanOf(5)).toBeCloseTo(5, 5);
    expect(spanOf(30)).toBeCloseTo(30, 5);
  });

  it('still guards a DEGENERATE span, which is a broken card not a short one', () => {
    const [seg] = columnItems([mk('zero', 0, 0)], DATE, 5);
    expect(seg.e).toBeGreaterThan(seg.s);
    expect((seg.e - seg.s) * 60).toBeCloseTo(1, 5); // one minute, not fifteen
  });

  it('never draws two cards on top of each other, at any zoom', () => {
    // THE INVARIANT, and the reason lanes are assigned on pixels rather than on
    // minutes. Two 2-minute touchpoints five minutes apart do not overlap in
    // TIME, but each is drawn at the floor — 26px tall, 2.8px apart at rest — so
    // they collide on SCREEN. If the boxes collide they must be in separate
    // lanes; if they do not, they may share the full width.
    const segs = columnItems([mk('load', 0, 2), mk('move', 5, 2)], DATE, 5);
    for (const z of ZOOM_LEVELS) {
      const laid = layoutDay(segs, 5, pxhFor(BASE_PXH_WEEK, z), floorPxFor(z));
      const box = (c) => ({
        top: parseFloat(c.style.top),
        bottom: parseFloat(c.style.top) + parseFloat(c.style.height),
        split: c.style.width.includes('50%'),
      });
      const [a, b] = laid.map(box);
      const collide = a.top < b.bottom && b.top < a.bottom;
      expect(a.split).toBe(collide);
      expect(b.split).toBe(collide);
    }
  });

  it('still shares lanes for work that genuinely overlaps', () => {
    // The change must not buy short-card honesty by breaking the ordinary case.
    const segs = columnItems([mk('long', 0, 60), mk('inside', 30, 15)], DATE, 5);
    const laid = layoutDay(segs, 5, 34, 26);
    expect(laid[0].style.width).toBe('calc(50% - 6px)');
    expect(laid[1].style.width).toBe('calc(50% - 6px)');
  });

  it('leaves a normal-length card exactly where it was', () => {
    // Above the floor, pixel overlap and time overlap are the same thing, so
    // nothing about an ordinary day may move.
    const segs = columnItems([mk('a', 0, 60), mk('b', 90, 60)], DATE, 5);
    const laid = layoutDay(segs, 5, 34, 26);
    expect(laid[0].style.height).toBe('34px');
    expect(laid[0].style.width).toBe('calc(100% - 6px)');
    expect(laid[1].style.width).toBe('calc(100% - 6px)');
  });
});

describe('pinch (D-6/D-7) — the half that is provable without a touchscreen', () => {
  // ⚠️ jsdom has no touch, no PointerEvent and no layout. These prove the maths
  // and the bookkeeping ONLY. Whether pinch feels right against the 450ms
  // long-press is a device question and went to the user as a checklist.
  it('scales from the finger distance, and clamps to the end rungs', () => {
    expect(pinchZoomFor(1, 100, 200)).toBeCloseTo(2, 5); // fingers twice as far
    expect(pinchZoomFor(2, 100, 50)).toBeCloseTo(1, 5); // half as far
    expect(pinchZoomFor(1, 100, 1000)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]); // never past the top
    expect(pinchZoomFor(4, 100, 1)).toBe(1); // never below 1× (D-3)
    expect(pinchZoomFor(2, 0, 100)).toBe(2); // no division by zero
  });

  it('settles on the NEAREST rung, so a stored zoom is always a rung', () => {
    expect(nearestRung(1.05)).toBe(1);
    expect(nearestRung(1.6)).toBe(1.4);
    expect(nearestRung(2.5)).toBe(2.8);
    expect(nearestRung(3.9)).toBe(4);
    // Which is what keeps loadZoom's whitelist honest after a pinch.
    saveZoom(nearestRung(2.37));
    expect(ZOOM_LEVELS).toContain(loadZoom());
  });

  it('renders a mid-gesture value rather than snapping it back to 1×', () => {
    // The committed zoom is always a rung, but DURING a pinch the grid is
    // legitimately at 2.37×. Running that through the stored-value whitelist
    // would snap every intermediate frame to 1× and the gesture would judder.
    expect(pxhFor(BASE_PXH_WEEK, 2.37)).toBe(Math.round(34 * 2.37));
    expect(clampZoom(2.37)).toBeCloseTo(2.37, 5);
    expect(clampZoom(NaN)).toBe(1);
  });

  it('a second finger abandons a LIVE drag, through the existing cancel path', () => {
    // Two fingers can only mean zoom, and a pinch that quietly moved a task is
    // the one failure here that corrupts data rather than merely looking wrong.
    //
    // ⚠️ An earlier version of this test dispatched `pointercancel` itself and
    // checked that a listener fired — which tests the DOM, not this code, and
    // passed with the cancel removed from `usePinchZoom` entirely. Caught by
    // mutation. It now drives the real gesture: hold to arm a drag, then land a
    // second finger, and assert the drag is gone.
    setPhone();
    seedWeek();
    render(<App />);

    const card = document.querySelector('.dayview .card');
    fireEvent(card, touchEvent('pointerdown', { x: 100, y: 100, id: 1 }));
    act(() => { vi.advanceTimersByTime(500); }); // past LONG_PRESS_MS
    expect(document.body.classList.contains('sc-dragging')).toBe(true);

    // The second finger arrives on the grid the gesture lives on.
    const grid = document.querySelector('.dvgrid');
    fireEvent(grid, touchEvent('pointerdown', { x: 200, y: 300, id: 2 }));

    expect(document.body.classList.contains('sc-dragging')).toBe(false);
  });

  it('one finger is never a pinch — it must still be able to arm a drag', () => {
    // The mirror of the rule above: if a single pointerdown cancelled drags,
    // touch drag would be dead on the phone entirely.
    setPhone();
    seedWeek();
    render(<App />);
    const card = document.querySelector('.dayview .card');
    fireEvent(card, touchEvent('pointerdown', { x: 100, y: 100, id: 1 }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.classList.contains('sc-dragging')).toBe(true);
  });
});

describe('the keyboard guard', () => {
  it('does not zoom while you are typing', () => {
    // Typing "-" in a title or "0" in a duration must not touch the grid. This
    // is the failure that goes unnoticed until it has corrupted a task.
    seedWeek();
    render(<App />);
    const before = pxhOf(columns()[0]);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: '+', bubbles: true });
    fireEvent.keyDown(input, { key: '-', bubbles: true });
    fireEvent.keyDown(input, { key: '0', bubbles: true });
    expect(pxhOf(columns()[0])).toBe(before);

    const area = document.createElement('textarea');
    document.body.appendChild(area);
    fireEvent.keyDown(area, { key: '+', bubbles: true });
    expect(pxhOf(columns()[0])).toBe(before);

    const rich = document.createElement('div');
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(rich, 'isContentEditable', { value: true });
    document.body.appendChild(rich);
    fireEvent.keyDown(rich, { key: '+', bubbles: true });
    expect(pxhOf(columns()[0])).toBe(before);
  });

  it('leaves the browser\'s own Ctrl/Cmd +/- alone', () => {
    // Page zoom is a control the user already has everywhere; taking it would
    // break something that is not ours to break.
    seedWeek();
    render(<App />);
    const before = pxhOf(columns()[0]);
    fireEvent.keyDown(window, { key: '+', ctrlKey: true });
    fireEvent.keyDown(window, { key: '+', metaKey: true });
    expect(pxhOf(columns()[0])).toBe(before);
  });
});
