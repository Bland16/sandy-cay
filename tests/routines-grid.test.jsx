// @vitest-environment jsdom
// R-C — a routine ON THE GRID (design/ROUTINES.md §UI).
//
// Four things reported by the user 2026-08-17, all real:
//   1. a 2- or 5-minute step is not legibly visible on a 34px/hour grid
//   2. dragging the second touchpoint changed the chain with NO warning
//   3. the card said "Laundry — load" when it should say "load"
//   4. there was no tint between the touchpoints to show the wait
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import {
  Schedule, Activity, defaultConfig, resetIds, weekStart as weekStartOf, addDays,
  instantiateRoutine, reflowRoutine, routineWaits, addMinutes,
} from '../src/core/index.js';
import WeekGrid from '../src/ui/components/WeekGrid.jsx';

afterEach(cleanup);

const WS = weekStartOf(new Date(2026, 8, 7));
const at = (h, m = 0) => { const d = new Date(WS); d.setHours(h, m, 0, 0); return d; };

const laundry = () => new Activity({
  label: 'Laundry',
  tags: ['chores'],
  steps: [
    { label: 'load', kind: 'active', durationMin: 2, durationMax: 2 },
    { label: 'washing', kind: 'passive', durationMin: 45, durationMax: 45, maxWaitMin: 60 },
    { label: 'switch', kind: 'active', durationMin: 2, durationMax: 2 },
    { label: 'drying', kind: 'passive', durationMin: 60, durationMax: 60 },
    { label: 'fold', kind: 'active', durationMin: 10, durationMax: 10 },
  ],
});
const started = (h = 9) => {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const r = instantiateRoutine(s, laundry(), at(h));
  return { s, inst: r.instance };
};

describe('the card says the STEP name, not the routine name', () => {
  it('titles a touchpoint "load", not "Laundry — load"', () => {
    // On a grid a card has room for a few words; prefixing every touchpoint with
    // the routine spends them all saying the same thing three times.
    const { s, inst } = started();
    expect(s.touchpointsFor(inst.id).map((t) => t.title)).toEqual(['load', 'switch', 'fold']);
  });

  it('gives an unnamed step a positional name rather than a blank card', () => {
    // `Activity`'s reviver already names an unnamed step "step 1", so the card
    // is never blank. My first version of this test expected the ROUTINE'S name
    // as the fallback — it never fires, because the label is filled in upstream.
    // Asserting what actually happens rather than what I assumed.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const a = new Activity({ label: 'Oven', steps: [{ label: '', kind: 'active', durationMin: 5 }] });
    const r = instantiateRoutine(s, a, at(9));
    expect(r.touchpoints[0].title).toBe('step 1');
  });
});

describe('the WAIT is a band, derived from the touchpoints', () => {
  it('reports one band per wait, spanning the real gap', () => {
    const { s, inst } = started();
    const w = routineWaits(s);
    expect(w.map((x) => x.label)).toEqual(['washing', 'drying']);
    // load 09:00–09:02, so the wash band runs 09:02 → switch at 09:47.
    expect(w[0].from.getHours() * 60 + w[0].from.getMinutes()).toBe(9 * 60 + 2);
    expect(w[0].to.getHours() * 60 + w[0].to.getMinutes()).toBe(9 * 60 + 47);
    void inst;
  });

  it('FOLLOWS a dragged touchpoint, because it is derived not stored', () => {
    const { s, inst } = started();
    const chain = s.touchpointsFor(inst.id);
    chain[1].startTime = at(11);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    const w = routineWaits(s);
    expect(w[0].to.getHours()).toBe(11); // the wash band grew with the drag
  });

  it('flags an OVERRUN past the max without changing anything', () => {
    // R-1: stated, never enforced. The band still draws and the drop still lands.
    const { s, inst } = started();
    const chain = s.touchpointsFor(inst.id);
    chain[1].startTime = at(11); // 118m wait against a 60m ceiling
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    const w = routineWaits(s);
    expect(w[0].overrun).toBe(true);
    expect(w[0].maxWaitMin).toBe(60);
    // The touchpoint is exactly where the hand put it.
    expect(s.touchpointsFor(inst.id)[1].startTime.getHours()).toBe(11);
  });

  it('reports NO band where a touchpoint was dragged over the gap', () => {
    const { s, inst } = started();
    const chain = s.touchpointsFor(inst.id);
    chain[1].startTime = at(9); // on top of the load
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    expect(routineWaits(s).map((x) => x.label)).toEqual(['drying']);
  });

  it('draws on the week grid, behind the cards and inert to the pointer', () => {
    const { s } = started();
    render(
      <WeekGrid
        sched={s} weekStart={WS} nextWeekStart={addDays(WS, 7)}
        onOpenTask={() => {}} onOpenDay={() => {}}
      />,
    );
    const bands = [...document.querySelectorAll('.waitband')];
    // eslint-disable-next-line no-console
    console.log(`\nWAIT BANDS: ${bands.map((b) => `${b.querySelector('.tag').textContent} h=${b.style.height}`).join(' · ')}\n`);
    expect(bands.length).toBe(2);
    expect(bands[0].querySelector('.tag').textContent).toBe('washing');
    // aria-hidden: the band is a picture of a gap, and a screen reader already
    // gets the gap from the two tasks either side.
    expect(bands[0].getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the CSS rules jsdom cannot check', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');

  it('makes the band INERT — a wait reserves nothing', () => {
    // ⚠️ Load-bearing, not tidiness: the band exists to invite a drop into the
    // wash, so it must not intercept it.
    expect(css).toMatch(/\.waitband\s*\{[^}]*pointer-events:\s*none/);
  });

  it('gives an overrun its own treatment, and it is not coral', () => {
    // P-1: coral is for scheduling physics. Cold waffles is a fact about food.
    expect(css).toMatch(/\.waitband\.over\s*\{/);
    expect(css).not.toMatch(/\.waitband\.over\s*\{[^}]*var\(--warning\)/);
  });
});

describe('dragging a touchpoint re-flows the chain', () => {
  it('pushes the later steps and states the overrun', () => {
    // ⚠️ `reflowRoutine` existed in core and NOTHING called it from the UI, so
    // dragging the second touchpoint moved it alone and left the rest where it
    // was — switching the laundry before the wash finished, silently. Reported
    // as "I can drag the second task down on the thing with no warning."
    const { s, inst } = started();
    const chain = s.touchpointsFor(inst.id);
    chain[1].startTime = at(11);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);

    const r = reflowRoutine(s, inst.id, { movedStepIndex: chain[1].stepIndex });
    expect(r.moved.length).toBe(1); // the fold followed
    expect(s.touchpointsFor(inst.id)[2].startTime.getHours()).toBe(12); // 11:02 + 60m
    expect(r.warnings[0].maxWaitMin).toBe(60);
    expect(r.warnings[0].waitedMin).toBe(118);
  });

  it('is wired into the drag path, not just present in core', () => {
    // The defect was the missing WIRE. Assert the call site exists, since jsdom
    // cannot drive a real pointer drag through the grid geometry.
    const hook = readFileSync(resolve(process.cwd(), 'src/ui/useCardInteraction.js'), 'utf8');
    expect(hook).toMatch(/reflowRoutine/);
    expect(hook).toMatch(/reflowChain\(task\)/);
  });
});
