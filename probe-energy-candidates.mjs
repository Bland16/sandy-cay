// Evaluate the five candidate equations in design/ENERGY-PLACEMENT-CANDIDATES.md.
// Each is implemented as a DAY-CHOICE rule (D-1's lean: generation time), then the
// sittings are placed with placeTask({from: day, to: day}) — the idiom §4.1.1 step 6
// specifies. Sizing is held constant at 5 x 240m so the ONLY variable is day choice.
import { Schedule } from './src/core/Schedule.js';
import { Task } from './src/core/Task.js';
import { energyTrajectory, loadForTask } from './src/core/energy.js';
import { placeTask } from './src/core/placement.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const from = D(9, 7);
const DAY = 86400000;
const AXES = ['mental', 'physical', 'social', 'creative'];
const dayOf = (n) => new Date(from.getTime() + n * DAY);
const N_DAYS = 14, N_SIT = 5, SIT_MIN = 240;

// ---- helpers --------------------------------------------------------------
const dipOf = (s, d) => energyTrajectory(s, dayOf(d)).low;

/** Exact dip AFTER hypothetically placing a sitting on day d — push, measure, pop. */
function dipAfter(s, d, proto) {
  const t = new Task({ ...proto, startTime: D(9, 7 + d, 13, 0), endTime: D(9, 7 + d, 13 + SIT_MIN / 60, 0) });
  s.tasks.push(t);
  const low = energyTrajectory(s, dayOf(d)).low;
  s.tasks.pop();
  return low;
}

/** The day's already-spent vector (positive components only = what it costs you). */
function spentVector(s, d) {
  const out = { mental: 0, physical: 0, social: 0, creative: 0 };
  for (const t of s.getTasksForDay(dayOf(d))) {
    if (t.chunking) continue;
    const L = loadForTask(s, t);
    const hrs = t.getDuration() / 60;
    for (const a of AXES) if (L[a] > 0) out[a] += L[a] * hrs;
  }
  return out;
}

const dot = (a, b) => AXES.reduce((n, k) => n + a[k] * b[k], 0);
const mag = (a) => Math.sqrt(dot(a, a));
const dominant = (L) => AXES.reduce((best, a) => (L[a] > L[best] ? a : best), AXES[0]);

// ---- the five candidates: score a day, higher = better ---------------------
const CANDIDATES = {
  'C1 relative depth': (s, d, proto, ctx) => {
    const after = Math.abs(dipAfter(s, d, proto)[ctx.axis]);
    return 1 - after / (ctx.worstAfter || 1);
  },
  'C2 marginal': (s, d, proto, ctx) => {
    const before = Math.abs(dipOf(s, d)[ctx.axis]);
    const after = Math.abs(dipAfter(s, d, proto)[ctx.axis]);
    return 1 - (after - before) / (ctx.worstMarginal || 1);
  },
  'C3 reserve at start': (s, d, proto, ctx) => {
    // reserve just before a nominal 13:00 sitting — the point-in-time reading
    const traj = energyTrajectory(s, dayOf(d)).points;
    const before13 = traj.filter((p) => p.at && p.at.getHours() < 13);
    const r = before13.length ? before13[before13.length - 1].reserve[ctx.axis] : 0;
    return 1 - Math.abs(r) / (ctx.worstReserve || 1);
  },
  'C4 complementarity': (s, d, proto, ctx) => {
    const S = spentVector(s, d);
    const m = mag(S) * mag(ctx.L);
    return m === 0 ? 1 : 1 - Math.max(0, dot(S, ctx.L) / m);
  },
  'C5 recovery spacing': (s, d, proto, ctx) => {
    const gaps = ctx.heavyDays.filter((h) => h !== d).map((h) => Math.abs(h - d));
    return gaps.length ? Math.min(...gaps) : N_DAYS;
  },
  // --- hybrids -------------------------------------------------------------
  // C5's gap is in DAYS; divide by N_DAYS so both terms live in [0,1] before
  // they are added, or spacing silently dominates by being on a bigger scale.
  'H1 = C1 + C5': (s, d, proto, ctx) => {
    const depth = 1 - Math.abs(dipAfter(s, d, proto)[ctx.axis]) / (ctx.worstAfter || 1);
    const gaps = ctx.heavyDays.filter((h) => h !== d).map((h) => Math.abs(h - d));
    const space = (gaps.length ? Math.min(...gaps) : N_DAYS) / N_DAYS;
    return depth + space;
  },
  // C4 as a GATE rather than a term: it is the only candidate that is provably
  // inert when the task itself carries no load (cosine with a zero vector), so
  // using it to scale the depth term means a characterless task is untouched.
  // H3 keeps the two concerns ORTHOGONAL, which H1/H2 conflate: clustering is
  // about SIBLINGS (five sittings of one thing, in a row) and has nothing to do
  // with energy; energy is about the DAY. So spacing is measured against the
  // sittings already chosen, not against energy-heavy days — which also removes
  // C5's silent dependency on a dominant axis that a zero-load task does not have.
  'H3 = C1 + sibling spread': (s, d, proto, ctx) => {
    const depth = 1 - Math.abs(dipAfter(s, d, proto)[ctx.axis]) / (ctx.worstAfter || 1);
    const gaps = ctx.chosen.map((c) => Math.abs(c - d));
    const space = (gaps.length ? Math.min(...gaps) : N_DAYS) / N_DAYS;
    return depth + space;
  },
  // H4: H3 with a REAL gate. If the task itself carries no load there is nothing
  // it can make worse, so the energy term contributes nothing and spacing alone
  // decides. (H2's "gate" returned 1 — neutral — for a zero-load task, which
  // multiplied the depth term straight through instead of switching it off.)
  'H4 = gated C1 + sibling': (s, d, proto, ctx) => {
    const hasLoad = mag(ctx.L) > 0;
    const depth = hasLoad
      ? 1 - Math.abs(dipAfter(s, d, proto)[ctx.axis]) / (ctx.worstAfter || 1)
      : 0;
    const gaps = ctx.chosen.map((c) => Math.abs(c - d));
    const space = (gaps.length ? Math.min(...gaps) : N_DAYS) / N_DAYS;
    return depth + space;
  },
  'H2 = C1*C4 + C5': (s, d, proto, ctx) => {
    const depth = 1 - Math.abs(dipAfter(s, d, proto)[ctx.axis]) / (ctx.worstAfter || 1);
    const S = spentVector(s, d);
    const m = mag(S) * mag(ctx.L);
    const comp = m === 0 ? 1 : 1 - Math.max(0, dot(S, ctx.L) / m);
    const gaps = ctx.heavyDays.filter((h) => h !== d).map((h) => Math.abs(h - d));
    const space = (gaps.length ? Math.min(...gaps) : N_DAYS) / N_DAYS;
    return depth * comp + space;
  },
};

// ---- generation: pick N days by a candidate, place one sitting each ---------
function generate(s, name, tags) {
  const proto = { title: 'Thesis', tags, type: 'flexible' };
  const L = loadForTask(s, new Task({ ...proto, startTime: from, endTime: D(9, 7, 4, 0) }));
  const axis = dominant(L);
  const chosen = [];
  for (let k = 0; k < N_SIT; k++) {
    const avail = [];
    for (let d = 0; d < N_DAYS; d++) if (!chosen.includes(d)) avail.push(d); // maxPerDay = 1
    // context recomputed each pick, so earlier picks influence later ones
    const spent = avail.map((d) => spentVector(s, d)[axis]);
    const median = [...spent].sort((a, b) => a - b)[Math.floor(spent.length / 2)];
    const ctx = {
      axis, L, chosen: [...chosen],
      heavyDays: [...Array(N_DAYS).keys()].filter((d) => spentVector(s, d)[axis] > median),
      worstAfter: Math.max(...avail.map((d) => Math.abs(dipAfter(s, d, proto)[axis]))),
      worstMarginal: Math.max(...avail.map((d) => Math.abs(dipAfter(s, d, proto)[axis]) - Math.abs(dipOf(s, d)[axis]))),
      worstReserve: Math.max(...avail.map((d) => {
        const pts = energyTrajectory(s, dayOf(d)).points.filter((p) => p.at && p.at.getHours() < 13);
        return pts.length ? Math.abs(pts[pts.length - 1].reserve[axis]) : 0;
      })),
    };
    let best = null;
    for (const d of avail) {
      const sc = CANDIDATES[name](s, d, proto, ctx);
      if (!best || sc > best.sc + 1e-9) best = { d, sc };
    }
    if (!best) break;
    chosen.push(best.d);
    const t = new Task({ ...proto, startTime: dayOf(best.d), endTime: new Date(dayOf(best.d).getTime() + SIT_MIN * 60000) });
    placeTask(s, t, { from: dayOf(best.d), to: dayOf(best.d) });
    t.placedBy = 'auto'; t._probeChunk = true;
    s.tasks.push(t);
  }
  return chosen.sort((a, b) => a - b);
}

const streakOf = (idx) => {
  let st = idx.length ? 1 : 0, run = 1;
  for (let i = 1; i < idx.length; i++) { run = idx[i] === idx[i - 1] + 1 ? run + 1 : 1; if (run > st) st = run; }
  return st;
};

// ---- week shapes ----------------------------------------------------------
function mkBuckets(s) {
  s.addBucket({ label: 'Deep', tags: ['deep'], color: '#2E8C99', load: { mental: 2, physical: 0, social: 0, creative: 1 } });
  s.addBucket({ label: 'Errands', tags: ['errand'], color: '#7FBE8B', load: { mental: 0, physical: 1, social: 0, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 2, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'Sport', tags: ['sport'], color: '#E2685F', load: { mental: 0, physical: 3, social: 0, creative: 0 } });
}
function fixtureFrontLoad() {           // the acceptance fixture
  const s = new Schedule({}); mkBuckets(s);
  for (let d = 0; d < N_DAYS; d++) {
    const heavy = d < 4;
    s.addFixed({ title: heavy ? `Deep ${d}` : `Errand ${d}`, tags: [heavy ? 'deep' : 'errand'],
      startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 11, 0) });
  }
  return s;
}
function allAxesDeep() {                // every day catastrophic on every axis
  const s = new Schedule({}); mkBuckets(s);
  for (let d = 0; d < N_DAYS; d++) {
    s.addFixed({ title: `Deep ${d}`, tags: ['deep'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 12, 0) });
    s.addFixed({ title: `Sport ${d}`, tags: ['sport'], startTime: D(9, 7 + d, 17, 0), endTime: D(9, 7 + d, 19, 0) });
  }
  return s;
}
function physicalFront() {              // front days PHYSICALLY hammered, mentally free
  const s = new Schedule({}); mkBuckets(s);
  for (let d = 0; d < N_DAYS; d++) {
    const heavy = d < 4;
    s.addFixed({ title: heavy ? `Sport ${d}` : `Errand ${d}`, tags: [heavy ? 'sport' : 'errand'],
      startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 11, 0) });
  }
  return s;
}

console.log('=== ACCEPTANCE: front-loaded MENTAL fixture (must avoid d+0..d+3) ===');
console.log('    shipped placer put 960 of 1200 minutes on d+0..d+3\n');
for (const name of Object.keys(CANDIDATES)) {
  const s = fixtureFrontLoad();
  const days = generate(s, name, ['study']);
  const onFront = days.filter((d) => d < 4).length * SIT_MIN;
  console.log(`  ${name.padEnd(22)} days=[${days.join(',')}]  front=${String(onFront).padStart(4)}m  streak=${streakOf(days)}  ${onFront > 480 ? '<-- FAILS' : ''}`);
}

console.log('\n=== Q4: a week deep on EVERY axis (does C4 approve it?) ===');
for (const name of Object.keys(CANDIDATES)) {
  const s = allAxesDeep();
  const days = generate(s, name, ['study']);
  console.log(`  ${name.padEnd(22)} days=[${days.join(',')}]  streak=${streakOf(days)}`);
}

console.log('\n=== A MENTAL task against a PHYSICALLY hammered front ===');
console.log('    (front days are mentally FREE — a good place for mental work)\n');
for (const name of Object.keys(CANDIDATES)) {
  const s = physicalFront();
  const days = generate(s, name, ['study']);
  const onFront = days.filter((d) => d < 4).length;
  console.log(`  ${name.padEnd(22)} days=[${days.join(',')}]  usesFront=${onFront}/4`);
}

console.log('\n=== Q3: INERTNESS — a task whose tags match no bucket (load all zero) ===');
for (const name of Object.keys(CANDIDATES)) {
  const s = fixtureFrontLoad();
  const days = generate(s, name, ['unbucketed-xyz']);
  console.log(`  ${name.padEnd(22)} days=[${days.join(',')}]`);
}
