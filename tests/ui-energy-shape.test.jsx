// @vitest-environment jsdom
// The week's energy shape, in the wrap report (design/energy-radar-mockups.html).
//
// These lock the three rules the chart has to obey, each of which this project
// has already been bitten by once:
//   §10  never meaning by colour alone — the report's empty rating shells were a
//        sand tint at full opacity, so a 2-shell rating read as 5 on paper.
//   P-2  never an invented ceiling — capacity is LEARNED, and null until it is.
//   P-1  never coral for bookkeeping — a heavy week is not a fault.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, Task, Bucket, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const ws = () => weekStartOf(new Date());
const at = (o, h) => { const d = addDays(ws(), o); d.setHours(h, 0, 0, 0); return d; };

const seed = ({ loaded = true } = {}) => {
  const s = new Schedule({ config: defaultConfig });
  if (loaded) {
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'], load: { mental: 2, physical: 0, social: 0, creative: 1 } }));
    s.buckets.push(new Bucket({ label: 'Gym', tags: ['gym'], load: { mental: -1, physical: 2, social: 0, creative: 0 } }));
  }
  s.tasks.push(new Task({ title: 'CHEM', tags: ['study'], type: 'fixed', startTime: at(0, 9), endTime: at(0, 12) }));
  s.tasks.push(new Task({ title: 'Gym', tags: ['gym'], type: 'fixed', startTime: at(1, 17), endTime: at(1, 19) }));
  s.markWeekSeen(new Date());
  window.localStorage.setItem('sandycay.session', 'guest');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
};

const openReport = () => {
  fireEvent.click(screen.getByLabelText(/week menu/i));
  fireEvent.click(screen.getByText(/wrap report/i));
};

describe('the energy shape in the report', () => {
  it('draws ONE chart — the butterfly, and no radar beside it', () => {
    seed();
    render(<App />);
    openReport();
    expect(document.querySelectorAll('.rp-bfrow')).toHaveLength(4); // one row per axis
    // ⚠️ ASSERTED ABSENT, not merely unmentioned. A radar "diamond" drew the
    // same eight numbers as the butterfly until 2026-09-02, plus four empty
    // rings around a blob because `capacity` is null until calibration. Its own
    // file argued the butterfly carried the precision it gave up. If it ever
    // comes back it should have to delete this line and say why.
    expect(document.querySelector('.rp-diamond')).toBeNull();
    expect(document.querySelector('.rp-dspend')).toBeNull();
  });

  it('states both numbers on every axis — §10, never meaning by colour alone', () => {
    seed();
    render(<App />);
    openReport();
    // Four axes × spent and restored. This is the whole §10 defence now: in
    // greyscale --pinned and --rest are 173 and 176 of 255, so on paper the two
    // fills are the same grey and the numerals carry the meaning.
    const nums = [...document.querySelectorAll('.rp-bfnum')].map((t) => t.textContent);
    expect(nums).toHaveLength(8);
    for (const n of nums) expect(n).toMatch(/^\d+\.\d$/);
  });

  it('is readable without the picture', () => {
    seed();
    render(<App />);
    openReport();
    // No aria-label to carry it: the butterfly is text and layout, so the axis
    // names and their numbers are simply in the document.
    const text = document.querySelector('.rp-bfly').textContent;
    for (const a of ['mental', 'physical', 'social', 'creative']) expect(text).toContain(a);
    // Which side is which is said in words, not by position alone.
    expect(text).toMatch(/restored/);
    expect(text).toMatch(/spent/);
  });

  it('draws NO capacity ring until ratings earn one (P-2)', () => {
    seed();
    render(<App />);
    openReport();
    // The most useful mark on the chart is exactly the one that may not be
    // invented. Drawing no ring claims nothing, so a ring appearing once
    // ratings calibrate contradicts nothing printed earlier — which is why the
    // absence needs no sentence explaining it.
    expect(document.querySelector('.rp-dcap')).toBeNull();
    // The section is the charts and the totals. Nothing else.
    expect(document.querySelectorAll('.rp-energy p')).toHaveLength(1);
  });

  it('says there is nothing to weigh, rather than drawing an empty shape', () => {
    seed({ loaded: false }); // tasks exist, but no bucket carries a load
    render(<App />);
    openReport();
    expect(document.querySelector('.rp-diamond')).toBeNull();
    // Zeros would have read as a finding about the week. This says which it is.
    expect(screen.getByText(/don’t belong to any\s+bucket carrying a load/i)).toBeTruthy();
  });

  it('states the totals as a fact, with no verdict on them (P-1)', () => {
    seed();
    render(<App />);
    openReport();
    const tot = document.querySelector('.rp-etot').textContent;
    expect(tot).toMatch(/Spent .* restored .* net /);
    const section = document.querySelector('.rp-energy').textContent;
    // No praise, no blame, no "too much" — the report states and stops.
    expect(section).not.toMatch(/too much|overdid|should have|well done|great/i);
  });
});
