// @vitest-environment jsdom
// The wrap report's day shapes — the PLANNED energy curve with what actually
// happened marked on it. Asked for 2026-09-02: "the planned curve with what
// happened marked on it."
//
// ⚠️ THE MARKS ARE SHAPES, NEVER COLOURS, and two independent rules demand it:
//   - P-1: "neither arrow is a judgement — no warning colour on a rating."
//   - the dataviz validator rejects the obvious red/green pair outright:
//     ΔE 3.9 under deuteranopia against a floor of 8, so colour would carry
//     nothing for a colourblind reader even if P-1 allowed it.
// Both tests below assert the shapes, and one asserts the absence of colour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Schedule, Task, defaultConfig, resetIds, addDays } from '../src/core/index.js';
import { buildTrajectories } from '../src/ui/report.js';
import WrapReport from '../src/ui/components/WrapReport.jsx';

const MON = new Date(2026, 8, 7); // Mon 7 Sep 2026
const NOW = new Date(2026, 8, 13, 20, 0, 0);
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** A week with real load on its tags — without buckets everything is zero. */
function week() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 1, creative: 0.3 } });
  s.addBucket({ label: 'Gym', tags: ['gym'], load: { physical: 1 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -0.6 } });
  const add = (o, tag, a, b, sat) => {
    const t = new Task({
      title: `${tag} ${a}`, tags: [tag], type: 'flexible',
      startTime: at(o, a), endTime: at(o, b), completion: sat ? 'done' : null,
    });
    if (sat) t.satisfaction = sat;
    s.tasks.push(t);
    return t;
  };
  add(0, 'study', 9, 11, { overall: 3, energy: -1 });
  add(0, 'study', 11, 13, { overall: 2, energy: -1 });
  add(0, 'gym', 17, 18, { overall: 5, energy: 1 });
  add(0, 'study', 20, 22, null); // planned, never rated — the evening you didn't reach
  add(2, 'study', 9, 10, { overall: 4, energy: 0 });
  add(2, 'rest', 15, 16, null);
  return s;
}

const draw = (s) => render(
  <WrapReport sched={s} weekStart={MON} onBack={() => {}} onOpenTask={() => {}} mutate={(fn) => fn(s)} showToast={() => {}} />,
);
const svgs = () => [...document.querySelectorAll('.rp-shape svg')];

describe('the view model', () => {
  it('is the PLANNED day, not only what was completed', () => {
    // Deliberate: drawing completed work only would answer "what did I spend?",
    // which the week totals already answer, and would erase the evening you
    // planned and did not reach — the comparison actually worth seeing.
    const s = week();
    const t = buildTrajectories(s, MON);
    const monday = t.days[0];
    const last = monday.curve[monday.curve.length - 1];
    expect(last.at.getHours()).toBe(22); // the unrated 20:00–22:00 block is in the line
    expect(monday.marks).toHaveLength(3); // …but only the three rated ones are marked
  });

  it('starts the walk at zero, so the first task does not look like a starting state', () => {
    const t = buildTrajectories(week(), MON);
    expect(t.days[0].curve[0].depth).toBe(0);
    expect(t.days[0].curve[0].at.getHours()).toBe(8); // the day window's own start
  });

  it('shows recovery — a restorative task lifts the line back', () => {
    const t = buildTrajectories(week(), MON);
    const wed = t.days[2].curve;
    expect(wed[wed.length - 1].depth).toBeLessThan(wed[wed.length - 2].depth);
  });

  it('draws no ceiling until one is earned (P-2)', () => {
    // `learnedCapacity` is null until ratings span calibrationWeeks distinct
    // weeks. A ring appearing later would mean every earlier chart had lied.
    const t = buildTrajectories(week(), MON);
    expect(t.calibrated).toBe(false);
    expect(t.capacity).toBeNull();
  });
});

describe('the drawing', () => {
  it('renders one small multiple per day on a shared scale', () => {
    // ⚠️ Shared, or Monday's exhaustion and Saturday's spare hour draw the same
    // picture. Seven days, one scale, and a number under each.
    draw(week());
    expect(svgs()).toHaveLength(7);
  });

  it('produces sane geometry — no NaN, nothing outside the box', () => {
    // The validator checks colour, not layout. This is the layout check, since
    // a chart cannot be eyeballed from a terminal.
    draw(week());
    const nums = [];
    for (const svg of svgs()) {
      for (const el of svg.querySelectorAll('path, polyline, polygon, line')) {
        const d = el.getAttribute('d') || el.getAttribute('points') || '';
        expect(d).not.toMatch(/NaN|Infinity|undefined/);
        for (const n of d.match(/-?\d+(\.\d+)?/g) || []) nums.push(Number(n));
        for (const a of ['x1', 'x2', 'y1', 'y2']) {
          const v = el.getAttribute(a);
          if (v != null) nums.push(Number(v));
        }
      }
    }
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.every(Number.isFinite)).toBe(true);
    // viewBox is 108×56 with 3px padding; marks may reach a little past it.
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...nums)).toBeLessThanOrEqual(112);
  });

  it('marks each rated task, and by SHAPE — never by colour', () => {
    draw(week());
    const monday = svgs()[0];
    const marks = monday.querySelectorAll('.rp-shape-mark');
    expect(marks).toHaveLength(3);

    // Two drained (down) and one energized (up) — told apart by their geometry.
    const tris = [...marks].filter((m) => m.tagName.toLowerCase() === 'polygon');
    expect(tris).toHaveLength(3);
    const apexBelow = tris.filter((m) => {
      const ys = m.getAttribute('points').split(' ').map((p) => Number(p.split(',')[1]));
      return ys[2] > ys[0]; // apex lower on screen = pointing down = drained
    });
    expect(apexBelow).toHaveLength(2);

    // ⚠️ P-1: no colour distinguishes them. Every mark carries the same class
    // and no per-mark fill or stroke.
    for (const m of marks) {
      expect(m.getAttribute('class')).toBe('rp-shape-mark');
      expect(m.getAttribute('fill')).toBeNull();
      expect(m.getAttribute('stroke')).toBeNull();
      expect(m.getAttribute('style')).toBeNull();
    }
  });

  it('names each mark in words, so shape is not the only channel either', () => {
    draw(week());
    const titles = [...svgs()[0].querySelectorAll('.rp-shape-mark title')].map((t) => t.textContent);
    expect(titles.join(' | ')).toMatch(/drained me/);
    expect(titles.join(' | ')).toMatch(/gave something back/);
    // …and none of them says "good", "bad", "missed" or any verdict (P-1).
    expect(titles.join(' ')).not.toMatch(/good|bad|poor|missed|fail|should/i);
  });

  it('offers the same seven days as a table', () => {
    // Identity never by colour alone, and a table view is the relief the
    // contrast check obligates.
    draw(week());
    const rows = document.querySelectorAll('.rp-shapes-table tbody tr');
    expect(rows).toHaveLength(7);
  });

  it('says it is still learning rather than inventing a ceiling', () => {
    draw(week());
    expect(document.querySelector('.rp-shapes-key').textContent).toMatch(/No ceiling is drawn/);
  });

  it('a week with no load says so, and draws nothing', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'Untagged', type: 'flexible', startTime: at(0, 9), endTime: at(0, 10) }));
    draw(s);
    expect(svgs()).toHaveLength(0);
    expect(document.body.textContent).toMatch(/nothing to draw a shape from/);
  });
});
