// R-C step 1 — a routine typed as one sentence (design/ROUTINES.md §UI).
//
// §"The bar for the routine editor: SEAMLESS" forbids a grid of kind/min/max
// rows, and forbids asking the user to name `active` vs `passive`: "a wait is
// the thing with no verb; if a row has 'I do this' in it, it is active. INFER
// it." These lock the inference and the arithmetic.
//
// Every case here was PRINTED first (design/probes/probe-routine-parse.mjs) —
// parsing is where "Whenpick a time"-class bugs live, and the printout caught
// three before a single assertion was written.
import { describe, it, expect } from 'vitest';
import { parseRoutineLine, routineToLine } from '../src/core/routineParse.js';

const shape = (line) => parseRoutineLine(line).steps
  .map((s) => `${s.kind === 'passive' ? 'W' : 'A'}:${s.label}:${s.durationMin}-${s.durationMax}${s.maxWaitMin ? `/${s.maxWaitMin}` : ''}`);

describe('the spec\'s own sentences', () => {
  it('parses the laundry', () => {
    expect(shape('load 2m, wait 45m, switch 2m, wait 60m, fold 10-15m')).toEqual([
      'A:load:2-2', 'W:wait:45-45', 'A:switch:2-2', 'W:wait:60-60', 'A:fold:10-15',
    ]);
  });

  it('parses the waffles, ceiling and all', () => {
    // §R-1's own example. The 5–10 is floor–ceiling, NOT an elastic length.
    expect(shape('waffles in the air fryer 2m then wait 5-10m then eat 10m')).toEqual([
      'A:waffles in the air fryer:2-2', 'W:wait:5-5/10', 'A:eat:10-10',
    ]);
  });
});

describe('the kind is INFERRED, never asked', () => {
  it('treats an IMPERATIVE as something you do', () => {
    // ⚠️ The first version keyword-matched machine names — wash, dry, run,
    // cook, bake, preheat — and classified the oven's `preheat 2m` as a WAIT,
    // exactly backwards: pressing the button is the touchpoint. Caught by the
    // probe before any assertion existed.
    expect(shape('preheat 2m then heating 15m then food in 3m')).toEqual([
      'A:preheat:2-2', 'W:heating:15-15', 'A:food in:3-3',
    ]);
  });

  it('treats a GERUND as the machine getting on with it', () => {
    expect(shape('put the dishwasher on 5m, running 90m, unload 5m')).toEqual([
      'A:put the dishwasher on:5-5', 'W:running:90-90', 'A:unload:5-5',
    ]);
  });

  it('always accepts the plain word "wait"', () => {
    expect(shape('put the dishwasher on 5m, wait 90m, unload 5m')).toEqual([
      'A:put the dishwasher on:5-5', 'W:wait:90-90', 'A:unload:5-5',
    ]);
  });

  it('does not mistake a SHORT -ing word for a wait', () => {
    expect(parseRoutineLine('sing 5m').steps[0].kind).toBe('active');
  });
});

describe('a RANGE means different things either side of that line (R-1)', () => {
  it('on an ACTIVE step it is the elastic length', () => {
    const s = parseRoutineLine('fold 10-15m').steps[0];
    expect([s.durationMin, s.durationMax, s.maxWaitMin]).toEqual([10, 15, null]);
  });

  it('on a WAIT it is floor (physics) and ceiling (preference)', () => {
    // The ceiling must NOT become `durationMax` — the offsets are driven by the
    // floor, and a ceiling that leaked into the length would move anchors.
    const s = parseRoutineLine('wait 5-10m').steps[0];
    expect([s.durationMin, s.durationMax, s.maxWaitMin]).toEqual([5, 5, 10]);
  });
});

describe('durations the way people write them', () => {
  it.each([
    ['wait 90', 90],
    ['wait 90m', 90],
    ['wait 1h', 60],
    ['wait 1h30', 90],
    ['wait 1h 30m', 90],
    ['wait 4 min', 4],
    ['wait 8 hours', 480],
    ['wait 1.5h', 90],
  ])('%s → %i minutes', (line, mins) => {
    expect(parseRoutineLine(line).steps[0].durationMin).toBe(mins);
  });

  it('reads a bare number as MINUTES', () => {
    // Everyone who has set a kitchen timer means minutes; defaulting to hours
    // would be the app inventing a number it was not given.
    expect(parseRoutineLine('wait 45').steps[0].durationMin).toBe(45);
  });

  it('accepts "10 to 20m" as well as "10-20m"', () => {
    expect(shape('stretch 10 to 20m')).toEqual(['A:stretch:10-20']);
  });
});

describe('a half-typed line is the normal state of a text field', () => {
  it('RETURNS errors rather than throwing', () => {
    // Throwing would blank the live preview on every keystroke.
    const r = parseRoutineLine('load 2m, just a label, wait 45m');
    expect(r.steps.map((s) => s.label)).toEqual(['load', 'wait']);
    expect(r.errors).toEqual([{ chunk: 'just a label', reason: 'no time given' }]);
  });

  it('rejects a zero-minute step', () => {
    expect(parseRoutineLine('x 0m').steps).toEqual([]);
    expect(parseRoutineLine('x 0m').errors[0].reason).toMatch(/zero/);
  });

  it('survives empty, blank and doubled separators', () => {
    expect(parseRoutineLine('').steps).toEqual([]);
    expect(parseRoutineLine('   ').steps).toEqual([]);
    expect(shape('load 2m,,, wait 45m')).toEqual(['A:load:2-2', 'W:wait:45-45']);
  });
});

describe('routineToLine — the inverse, so a saved routine stays editable', () => {
  const LINES = [
    'load 2m, wait 45m, switch 2m, wait 1h, fold 10-15m',
    'waffles in the air fryer 2m, wait 5-10m, eat 10m',
    'preheat 2m, heating 15m, food in 3m, cooking 40m, take out 3m',
    'travel 15m, workout 45-60m',
    'soaking 8h, rinse 5m',
  ];

  it.each(LINES)('round-trips: %s', (line) => {
    const once = parseRoutineLine(line).steps;
    const twice = parseRoutineLine(routineToLine(once)).steps;
    expect(twice).toEqual(once);
  });

  it('renders a RANGE in one unit — not "45-1h"', () => {
    // It parsed back correctly and read like a typo. Caught by the probe.
    expect(routineToLine(parseRoutineLine('workout 45-60m').steps)).toBe('workout 45-60m');
  });

  it('keeps a named wait\'s name, and does not invent one for a bare wait', () => {
    expect(routineToLine(parseRoutineLine('running 90m').steps)).toBe('running 90m');
    expect(routineToLine(parseRoutineLine('wait 90m').steps)).toBe('wait 90m');
  });
});
