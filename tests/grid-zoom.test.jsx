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
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { layoutDay, columnItems } from '../src/ui/layout.js';
import {
  ZOOM_LEVELS, DEFAULT_ZOOM, BASE_PXH_WEEK, BASE_PXH_DAY,
  pxhFor, floorPxFor, zoomIn, zoomOut, loadZoom, saveZoom,
} from '../src/ui/zoom.js';

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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
};

const columns = () => [...document.querySelectorAll('[data-dropzone]')];
const pxhOf = (col) => Number(col.dataset.pxh);

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
    // this test pressed + nine times and expected 4 — which a wrapping zoomIn
    // also satisfies, because nine steps through five rungs happens to land back
    // on the top one. It passed against a broken implementation. Caught by
    // mutation, which is the only reason it is written this way.
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(1)).toBe(1);

    // And the whole ladder, in order, both ways.
    const up = [1];
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) up.push(zoomIn(up[up.length - 1]));
    expect(up).toEqual([...ZOOM_LEVELS, 4]);
    const down = [4];
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

  it('a two-minute block gets more honest, but bottoms out at the SPAN floor', () => {
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

    // Real, and worth having: 26/34 of an hour reads as 46 minutes, 34/136 as
    // 15. But it stops at 15 and NOT at the 5 minutes GRID-ZOOM §4 predicted,
    // because a second floor upstream (`columnItems`, layout.js:34) inflates
    // every span under a quarter-hour to a quarter-hour before `layoutDay` ever
    // sees it. Zoom cannot go below a floor that is applied in MINUTES.
    // Locked here so the limit is visible rather than folklore — GRID-ZOOM D-5.
    expect(at4).toBe(34);
    expect((at1 / 34) * 60).toBeCloseTo(45.9, 1);
    expect((at4 / 136) * 60).toBeCloseTo(15.0, 1);
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

describe('the SECOND floor, found while building this (GRID-ZOOM D-5)', () => {
  // Not part of zoom, and deliberately NOT changed here — it has layout
  // consequences and wants a decision. Locked so it is a known quantity.
  it('columnItems inflates any span under 15 minutes to 15 minutes', () => {
    const date = new Date(2026, 6, 15, 12, 0, 0, 0);
    const mk = (durMin) => {
      const st = new Date(2026, 6, 15, 8, 0, 0, 0);
      return {
        id: 't', title: 't', startTime: st,
        endTime: new Date(st.getTime() + durMin * 60000),
        getDuration: () => durMin,
      };
    };
    const spanOf = (durMin) => {
      const [seg] = columnItems([mk(durMin)], date, 5);
      return (seg.e - seg.s) * 60;
    };
    expect(spanOf(2)).toBe(15);
    expect(spanOf(10)).toBe(15);
    expect(spanOf(15)).toBe(15);
    expect(spanOf(30)).toBe(30); // untouched above the floor
  });

  it('so two touchpoints five minutes apart are treated as OVERLAPPING', () => {
    // A routine is a chain of short touchpoints, which is exactly the shape this
    // hits: they get half-width side-by-side lanes for an overlap that does not
    // exist. This is the cost of the minute-floor, stated rather than hidden.
    const date = new Date(2026, 6, 15, 12, 0, 0, 0);
    const mk = (id, min) => {
      const st = new Date(2026, 6, 15, 8, min, 0, 0);
      return {
        id, title: id, startTime: st,
        endTime: new Date(st.getTime() + 2 * 60000),
        getDuration: () => 2,
      };
    };
    const segs = columnItems([mk('load', 0), mk('move', 5)], date, 5);
    expect(segs[0].e).toBeGreaterThan(segs[1].s); // computed as overlapping
    const laid = layoutDay(segs, 5, 136, floorPxFor(4));
    expect(laid[0].style.width).toBe('calc(50% - 6px)');
    expect(laid[1].style.width).toBe('calc(50% - 6px)');
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
