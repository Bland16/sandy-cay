// probe-energy-weight.mjs — what does `w.energy` actually do, per weight?
//
// D-1 (design/ENERGY-PLACEMENT-EVAL.md) settled that the energy term belongs in
// scoring.js, evaluated at the candidate slot, and that its quantity is C3 —
// reserve at sit-down. It never settled the WEIGHT, because every number in that
// document was run in a day-chooser harness and D-1 moved the term afterwards.
//
// This measures the two things that decide it:
//   1. how many placements the term actually moves, per weight
//   2. whether it moves them toward arriving fresher — the point of the term
//
// Run: node design/probes/probe-energy-weight.mjs
import {
  Schedule, Task, resetIds, addDays, dateKey,
  arrivalDepletionFor, loadForTask, normalizeWeights,
} from '../../src/core/index.js';
import { defaultConfig } from '../../src/core/config.js';

const line = (s = '') => console.log(s);
const MON = new Date(2026, 8, 7, 0, 0, 0, 0); // fixed Monday
const D = (d, h, m = 0) => { const x = addDays(MON, d); x.setHours(h, m, 0, 0); return x; };
const fx = (n) => (Math.round(n * 1000) / 1000).toFixed(3);

const WEIGHTS = [0, 0.1, 0.15, 0.25, 0.35, 0.5];

/** A week whose mornings are already spent and whose evenings are not. */
function fixture(energyWeight) {
  resetIds();
  const config = {
    ...defaultConfig,
    weights: { ...defaultConfig.weights, energy: energyWeight },
  };
  const s = new Schedule({ config });
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -1.5, physical: -1 } });
  // Every weekday carries a heavy morning block, so the reserve is deep by
  // midday and recovers over a long afternoon gap. The evening is free.
  for (let d = 0; d < 5; d += 1) {
    for (let i = 0; i < 3; i += 1) {
      s.addFixed({ title: `AM${d}-${i}`, tags: ['study'], startTime: D(d, 8 + i), endTime: D(d, 9 + i) });
    }
    s.addFixed({ title: `Rest${d}`, tags: ['rest'], startTime: D(d, 15), endTime: D(d, 17) });
  }
  return s;
}

line('=== 1. the quantity, across one day ===');
{
  const s = fixture(0);
  const dep = arrivalDepletionFor(s);
  const load = loadForTask(s, { tags: ['study'] });
  line('  a `study` sitting, arriving at each hour of Monday:');
  line('  hour   depletion   (0 = fresh, 1 = at your ceiling)');
  for (const h of [8, 10, 11, 13, 15, 17, 19, 21]) {
    const v = dep(D(0, h), load);
    const bar = '#'.repeat(Math.round((v ?? 0) * 40));
    line(`  ${String(h).padStart(2)}:00   ${fx(v ?? 0)}   ${bar}`);
  }
}

line();
line('=== 2. the gate ===');
{
  const s = fixture(0);
  const dep = arrivalDepletionFor(s);
  const loaded = loadForTask(s, { tags: ['study'] });
  const bare = loadForTask(s, { tags: ['nothing-carries-this'] });
  line(`  a loaded task at 13:00        → ${fx(dep(D(0, 13), loaded))}`);
  line(`  a characterless task at 13:00 → ${dep(D(0, 13), bare)}   (null = no opinion)`);
  line('  A task that spends nothing cannot make any day worse, so it must not');
  line('  inherit a preference from the day\'s own state.');
}

line();
line('=== 3. placements moved, per weight ===');
{
  const baseline = new Map();
  line('  weight  moved  mean arrival depletion  buffer share  note');
  for (const w of WEIGHTS) {
    const s = fixture(w);
    const dep = arrivalDepletionFor(s);
    const placed = [];
    // Five flexible study sittings, placed one at a time into the live week.
    for (let i = 0; i < 5; i += 1) {
      // ⚠️ NO `startTime`. Passing one makes `addFlexible` skip scored
      // placement altogether (HANDOFF sharp edges #12/#13) — which is how the
      // first run of this probe measured nothing at all and reported 0 moved
      // at every weight.
      const t = s.addFlexible({
        title: `Flex${i}`, tags: ['study'], durationMin: 60, from: D(0, 8),
      });
      placed.push(t);
    }
    let moved = 0;
    let depSum = 0;
    for (const t of placed) {
      const key = `${dateKey(t.startTime)}T${t.startTime.getHours()}`;
      if (w === 0) baseline.set(t.title, key);
      else if (baseline.get(t.title) !== key) moved += 1;
      depSum += dep(t.startTime, loadForTask(s, t)) ?? 0;
    }
    const nw = normalizeWeights(s.config.weights);
    const note = nw.buffer <= 0.2 ? '⚠ buffer below the user\'s 0.2 floor' : '';
    line(`  ${fx(w)}   ${String(moved).padStart(3)}    ${fx(depSum / placed.length)}                  ${fx(nw.buffer)}       ${note}`);
  }
  line();
  line('  "moved" counts placements that differ from the w.energy = 0 baseline.');
  line('  Mean arrival depletion should FALL as the weight rises; if it does not,');
  line('  the term is being outvoted and the weight is not buying anything.');
}

line();
line('=== 4. determinism ===');
{
  const a = fixture(0.25);
  const b = fixture(0.25);
  const place = (s) => {
    const t = s.addFlexible({ title: 'Det', tags: ['study'], durationMin: 60, from: D(0, 8) });
    return `${dateKey(t.startTime)}T${t.startTime.getHours()}:${t.startTime.getMinutes()}`;
  };
  const x = place(a);
  const y = place(b);
  line(`  two identical schedules place identically: ${x === y ? 'yes' : `NO — ${x} vs ${y}`}`);
}
