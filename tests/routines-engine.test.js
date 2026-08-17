// R-B — the routine ENGINE (design/ROUTINES.md).
//
// Proven by printing chains first (design/probes/probe-routines.mjs); these
// lock what the printout showed. The one genuinely new primitive is a sequenced
// group with MIN-gaps, and the tests that matter are the ones about direction:
// later drags the chain, earlier does not.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Activity, defaultConfig, resetIds,
  instantiateRoutine, reflowRoutine, suggestRoutineStart, addMinutes,
} from '../src/core/index.js';

const DAY = new Date(2026, 8, 7);
const at = (h, m = 0) => { const d = new Date(DAY); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const laundry = () => new Activity({
  label: 'Laundry',
  tags: ['chores'],
  steps: [
    { label: 'load', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'wash', kind: 'passive', durationMin: 45 },
    { label: 'switch', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'dry', kind: 'passive', durationMin: 60 },
    { label: 'fold', kind: 'active', durationMin: 10, durationMax: 15 },
  ],
});
const fresh = () => { resetIds(); return new Schedule({ config: defaultConfig }); };

describe('instantiateRoutine — laying the chain down', () => {
  it('places one touchpoint per ACTIVE step, at the spec\'s own offsets', () => {
    const s = fresh();
    const { instance, touchpoints } = instantiateRoutine(s, laundry(), at(19));
    expect(touchpoints.length).toBe(3); // not 5 — waits are never tasks
    expect(s.touchpointsFor(instance.id).map((t) => hhmm(t.startTime)))
      .toEqual(['19:00', '19:47', '20:49']);
  });

  it('makes touchpoints FIXED anchors, not flexible work', () => {
    // Load-bearing: a touchpoint IS an appointment with a machine. Flexible,
    // the placer would feel free to move it and "switch 45 minutes after you
    // loaded" would evaporate on the next re-optimise.
    const s = fresh();
    const { touchpoints } = instantiateRoutine(s, laundry(), at(19));
    for (const t of touchpoints) expect(t.type).toBe('fixed');
  });

  it('leaves the WAIT free — other work drops into it untouched', () => {
    // The core insight: the gaps are ordinary free time the placer already
    // fills. There is no "fill the wait" scheduler, and there must not be one.
    const s = fresh();
    const { instance } = instantiateRoutine(s, laundry(), at(19));
    const before = s.touchpointsFor(instance.id).map((t) => hhmm(t.startTime));
    s.addFixed({ title: 'Dinner', startTime: at(19, 10), endTime: at(19, 40) });
    expect(s.touchpointsFor(instance.id).map((t) => hhmm(t.startTime))).toEqual(before);
  });

  it('FUSES travel into the first touchpoint rather than leaving a gap', () => {
    // ⚠️ Found by the probe, in my own first version. Held as a leading OFFSET,
    // the travel was unoccupied — the suggestion said 08:00 and the anchor
    // landed 08:15–09:00, leaving the quarter hour free for the placer to fill
    // with something that would then be in the way of getting to the gym.
    // §"Travel": "fused to the core, so it's one contiguous anchor".
    const s = fresh();
    const gym = new Activity({ label: 'Gym', travelMin: 15, durationMin: 45, durationMax: 60 });
    const { touchpoints } = instantiateRoutine(s, gym, at(8));
    expect(touchpoints.length).toBe(1);
    expect(hhmm(touchpoints[0].startTime)).toBe('08:00');
    expect(touchpoints[0].getDuration()).toBe(60); // 15 travel + 45 workout
  });

  it('REPORTS a clash instead of refusing — a drop is the hand (R-1)', () => {
    const s = fresh();
    s.addFixed({ title: 'Call', startTime: at(19), endTime: at(19, 30) });
    const { touchpoints, clashes } = instantiateRoutine(s, laundry(), at(19));
    expect(touchpoints.length).toBe(3); // it still happened
    expect(clashes.length).toBe(1);
    expect(clashes[0].with[0].title).toBe('Call');
  });

  it('runs two routines CONCURRENTLY — the waits simply overlap', () => {
    // §"Concurrency falls out for free": only the tiny touchpoints are anchors,
    // and they only have to miss each other.
    const s = fresh();
    const dish = new Activity({ label: 'Dishwasher', steps: [
      { label: 'load', kind: 'active', durationMin: 5 },
      { label: 'run', kind: 'passive', durationMin: 90 },
      { label: 'unload', kind: 'active', durationMin: 5 },
    ] });
    const oven = new Activity({ label: 'Oven', steps: [
      { label: 'on', kind: 'active', durationMin: 2 },
      { label: 'heating', kind: 'passive', durationMin: 15 },
      { label: 'in', kind: 'active', durationMin: 3 },
    ] });
    const a = instantiateRoutine(s, dish, at(18));
    const b = instantiateRoutine(s, oven, at(18, 10));
    expect(a.clashes.length).toBe(0);
    expect(b.clashes.length).toBe(0);
    // Their waits genuinely overlap: the dishwasher runs 18:05–19:35, the
    // oven's whole chain sits inside that.
    expect(hhmm(b.touchpoints[1].startTime)).toBe('18:27');
  });
});

describe('reflowRoutine — the one new primitive', () => {
  const withChain = () => {
    const s = fresh();
    const { instance } = instantiateRoutine(s, laundry(), at(19));
    return { s, instance };
  };

  it('drags the REST of the chain when a touchpoint moves LATER', () => {
    const { s, instance } = withChain();
    const chain = s.touchpointsFor(instance.id);
    chain[1].startTime = at(20, 30);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    const r = reflowRoutine(s, instance.id, { movedStepIndex: chain[1].stepIndex });
    expect(r.moved.length).toBe(1);
    expect(hhmm(s.touchpointsFor(instance.id)[2].startTime)).toBe('21:32'); // 20:32 + 60m dry
  });

  it('does NOT pull the chain back when a touchpoint moves EARLIER', () => {
    // ⚠️ The case a naive "recompute all offsets" gets wrong. Min-gaps are
    // one-directional: later is fine (you were busy), earlier is PHYSICS — the
    // machine is not finished, so the fold is never pulled back to meet a
    // switch you did sooner.
    const { s, instance } = withChain();
    const chain = s.touchpointsFor(instance.id);
    const foldWas = hhmm(chain[2].startTime);
    chain[1].startTime = at(19, 10);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    const r = reflowRoutine(s, instance.id, { movedStepIndex: chain[1].stepIndex });
    expect(r.moved.length).toBe(0);
    expect(hhmm(s.touchpointsFor(instance.id)[2].startTime)).toBe(foldWas);
  });

  it('leaves everything BEFORE the moved step alone', () => {
    const { s, instance } = withChain();
    const chain = s.touchpointsFor(instance.id);
    const loadWas = hhmm(chain[0].startTime);
    chain[1].startTime = at(21);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    reflowRoutine(s, instance.id, { movedStepIndex: chain[1].stepIndex });
    expect(hhmm(s.touchpointsFor(instance.id)[0].startTime)).toBe(loadWas);
  });

  it('WARNS past a maxWaitMin and never refuses — the cold-waffles rule', () => {
    // R-1: min is physics, max is preference. "I think it is fine though if
    // there is cold waffles, as long as I have the ability to place it there."
    const s = fresh();
    const waffles = new Activity({ label: 'Waffles', steps: [
      { label: 'in the air fryer', kind: 'active', durationMin: 2 },
      { label: 'cooking', kind: 'passive', durationMin: 5, maxWaitMin: 10 },
      { label: 'eat', kind: 'active', durationMin: 10 },
    ] });
    const { instance } = instantiateRoutine(s, waffles, at(8));
    const chain = s.touchpointsFor(instance.id);
    // A 30-minute shower goes in the 5-minute gap. The hand wins.
    chain[1].startTime = at(8, 37);
    chain[1].endTime = addMinutes(chain[1].startTime, 10);
    const r = reflowRoutine(s, instance.id, { movedStepIndex: chain[0].stepIndex });

    expect(r.moved.length).toBe(0); // it was NOT dragged back
    expect(hhmm(s.touchpointsFor(instance.id)[1].startTime)).toBe('08:37'); // still there
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].waitedMin).toBe(35);
    expect(r.warnings[0].maxWaitMin).toBe(10);
  });

  it('says nothing when there is no ceiling — appliances are unchanged', () => {
    // Absent maxWaitMin means today's min-only behaviour exactly, so the
    // dishwasher's 4°C hold never nags.
    const { s, instance } = withChain();
    const chain = s.touchpointsFor(instance.id);
    chain[1].startTime = at(23);
    chain[1].endTime = addMinutes(chain[1].startTime, 2);
    const r = reflowRoutine(s, instance.id, { movedStepIndex: chain[0].stepIndex });
    expect(r.warnings).toEqual([]);
  });

  it('survives a hand-deleted touchpoint rather than throwing', () => {
    const { s, instance } = withChain();
    s.removeTask(s.touchpointsFor(instance.id)[1].id);
    const r = reflowRoutine(s, instance.id, {});
    expect(Array.isArray(r.moved)).toBe(true);
    expect(s.touchpointsFor(instance.id).length).toBe(2);
  });
});

describe('suggestRoutineStart', () => {
  it('finds a start where every TOUCHPOINT is free, waits included or not', () => {
    const s = fresh();
    s.addFixed({ title: 'Class', startTime: at(9), endTime: at(12) });
    s.addFixed({ title: 'Seminar', startTime: at(13), endTime: at(17) });
    const gym = new Activity({ label: 'Gym', travelMin: 15, durationMin: 45, durationMax: 60 });
    const when = suggestRoutineStart(s, gym, at(8));
    expect(when).toBeTruthy();
    const { clashes } = instantiateRoutine(s, gym, when);
    expect(clashes.length).toBe(0);
  });

  it('does not demand the WAITS be free — that is the whole point', () => {
    // A laundry needs 14 minutes of attention across two hours. Requiring an
    // empty two-hour stretch would refuse almost every real evening.
    const s = fresh();
    s.addFixed({ title: 'Dinner', startTime: at(19, 15), endTime: at(20, 15) });
    const when = suggestRoutineStart(s, laundry(), at(19));
    expect(when).toBeTruthy();
    const { clashes } = instantiateRoutine(s, laundry(), when);
    expect(clashes.length).toBe(0);
  });

  it('returns null rather than inventing a start when nothing fits', () => {
    const s = fresh();
    for (let d = 0; d < 5; d += 1) {
      const from = new Date(DAY); from.setDate(from.getDate() + d); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      s.addFixed({ title: `solid ${d}`, startTime: from, endTime: to });
    }
    const gym = new Activity({ label: 'Gym', travelMin: 15, durationMin: 45, durationMax: 60 });
    expect(suggestRoutineStart(s, gym, at(8), { withinDays: 2 })).toBe(null);
  });
});
