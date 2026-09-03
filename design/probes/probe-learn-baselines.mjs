// probe-learn-baselines.mjs — does the learned model earn its place?
//
// The model gets `w.preference` in every placement. This asks whether it beats
// estimators that cost nothing and explain themselves:
//
//   B0  no model at all          — a constant. Today's cold-start behaviour.
//   B1  the global mean rating   — "everything feels about the same"
//   B4  shrunken tag x time mean — which is getSatisfactionMatrix, i.e. THE
//                                  TABLE THE WRAP REPORT ALREADY PRINTS
//   M   the LearningModule
//
// If M cannot beat B4, the honest conclusion is that B4 should BE the preference
// term: no gradient descent, no learning rate, no divergence guard, and it
// explains itself in one sentence the report already shows you.
//
// ⚠️ TWO METHOD RULES, both of which invalidate the obvious version.
//   1. LEAVE-ONE-GROUP-OUT, group = parentId ?? id. Twelve rated gym sessions
//      share tag, weekday, hour and duration; scoring them as twelve
//      independent samples measures "can you predict Tuesday gym from eleven
//      other Tuesday gyms", which is trivially yes and means nothing.
//   2. REFIT THE VOCABULARY INSIDE EVERY FOLD. `train` picks topTags by
//      frequency over all samples; choosing it before splitting is
//      data-dependent feature selection and leaks.
//
// Run: node design/probes/probe-learn-baselines.mjs
import { Schedule, Bucket, Task, resetIds, addDays, weekStart, LearningModule } from '../../src/core/index.js';
import { defaultConfig } from '../../src/core/config.js';

const line = (s = '') => console.log(s);
const fx = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : ' n/a ');
const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h) => { const d = addDays(MON, o); d.setHours(h, 0, 0, 0); return d; };

// Deterministic LCG, matching the other probes.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const TAGS = ['study', 'gym', 'admin', 'social'];
const HOURS = [8, 10, 13, 16, 19, 22];

/** A persona is a ground-truth utility plus noise. */
const PERSONAS = {
  // A real, simple preference: mornings good, late evenings bad.
  MORNING: (tag, hour) => 0.5 + (hour <= 10 ? 0.3 : 0) - (hour >= 22 ? 0.35 : 0),
  // No preference whatsoever. The P-2 control: M must not beat B1 here.
  NULL: () => 0.5,
  // One dominant tag with a real effect, a long sparse tail with none.
  DOMINANT: (tag) => (tag === 'study' ? 0.75 : 0.5),
  // Tag and hour INTERACT — study is good early, gym is good late. A per-cell
  // mean can represent this; a purely additive linear model cannot.
  CROSSED: (tag, hour) => {
    if (tag === 'study') return hour <= 10 ? 0.8 : 0.4;
    if (tag === 'gym') return hour >= 19 ? 0.8 : 0.4;
    return 0.5;
  },
};

// ⚠️ GROUPS ARE RECURRING SERIES, NOT `tag@hour`, AND THE DIFFERENCE IS THE
// WHOLE EXPERIMENT. A first version grouped by tag@hour — which is exactly the
// cell B4 estimates — so the held-out cell was BY CONSTRUCTION never present in
// training, `agg.get(key)` always missed, and B4 fell back to its prior. B1 and
// B4 then printed identical numbers down every row, which looks like a tie and
// is actually a harness that cannot see the estimator it exists to test.
//
// Real data is series-shaped: several recurring things share a slot. So each
// series gets a fixed (tag, hour) and several occurrences, and MORE THAN ONE
// SERIES may land on the same cell — which is what lets a held-out series still
// have its cell represented in training, as it would be for a real user.
//
// σ is 0.15, not 0.08. At 0.08 the ratings for a flat persona all round to 3,
// every estimator predicts 0.5, and every MAE is exactly 0.0000 — a fixture
// with no variance measures nothing.
function sample(persona, nSeries, seed, sigma = 0.15) {
  const r = rng(seed);
  const out = [];
  for (let s = 0; s < nSeries; s += 1) {
    const tag = TAGS[Math.floor(r() * TAGS.length)];
    const hour = HOURS[Math.floor(r() * HOURS.length)];
    const day = Math.floor(r() * 5);
    const occurrences = 3 + Math.floor(r() * 4); // 3–6, as a recurring thing has
    for (let k = 0; k < occurrences; k += 1) {
      const u = PERSONAS[persona](tag, hour) + (r() - 0.5) * 2 * sigma;
      const overall = Math.max(1, Math.min(5, Math.round(1 + 4 * u)));
      out.push({ tag, hour, day, overall, group: `series${s}` });
    }
  }
  return out;
}

const toTask = (r, i) => {
  const t = new Task({
    title: `s${i}`, tags: [r.tag], type: 'fixed',
    startTime: at(r.day, r.hour), endTime: at(r.day, r.hour + 1),
  });
  t.completion = 'done';
  t.satisfaction = { overall: r.overall };
  return t;
};

const y = (r) => (r.overall - 1) / 4;

// ---- estimators -------------------------------------------------------------
const B0 = () => () => 0.5;

const B1 = (train) => {
  const m = train.reduce((s, r) => s + y(r), 0) / (train.length || 1);
  return () => m;
};

/** Shrunken per-cell mean: (sum + k*prior) / (n + k). k = 3. */
const cellMean = (keyOf) => (train) => {
  const prior = train.reduce((s, r) => s + y(r), 0) / (train.length || 1);
  const agg = new Map();
  for (const r of train) {
    const k = keyOf(r);
    const a = agg.get(k) || { sum: 0, n: 0 };
    a.sum += y(r); a.n += 1;
    agg.set(k, a);
  }
  const K = 3;
  return (r) => {
    const a = agg.get(keyOf(r));
    if (!a) return prior;
    return (a.sum + K * prior) / (a.n + K);
  };
};
const B4 = cellMean((r) => `${r.tag}@${r.hour}`);

const MODEL = (lambda) => (train) => {
  resetIds();
  const s = new Schedule({
    config: { ...defaultConfig, learning: { ...defaultConfig.learning, lambda } },
  });
  s.buckets.push(new Bucket({ label: 'B', tags: [...TAGS] }));
  // ⚠️ vocabulary is rebuilt by train() from THESE samples only — the fold's.
  const lm = new LearningModule(s.config);
  lm.train(train.map(toTask));
  return (r) => {
    const t = toTask(r, 0);
    // `modelScore` is the public reader; it returns 0 when untrained, so the
      // untrained case is handled explicitly rather than scored as "worst".
      return lm.trained ? lm.modelScore(t, null) : 0.5;
  };
};

// ---- leave-one-group-out ----------------------------------------------------
function logo(rows, fit) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const errs = [];
  for (const g of groups) {
    const train = rows.filter((r) => r.group !== g);
    const test = rows.filter((r) => r.group === g);
    if (train.length === 0) continue;
    const f = fit(train);
    for (const r of test) errs.push(Math.abs(f(r) - y(r)));
  }
  return errs;
}

/** 95% bootstrap CI over paired differences. */
function ci(diffs, seed = 7, reps = 4000) {
  const r = rng(seed);
  const means = [];
  for (let b = 0; b < reps; b += 1) {
    let s = 0;
    for (let i = 0; i < diffs.length; i += 1) s += diffs[Math.floor(r() * diffs.length)];
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]];
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

line('=== held-out error, leave-one-group-out (group = tag@hour) ===');
line('  Lower MAE is better. "vs M" is the PAIRED difference (baseline − model):');
line('  positive means the model is better. A CI crossing zero means this data');
line('  cannot tell them apart, and the tiebreak is then simplicity, not the');
line('  point estimate.');
line();

for (const persona of Object.keys(PERSONAS)) {
  const rows = sample(persona, 16, 11);
  const M = logo(rows, MODEL(defaultConfig.learning.lambda));
  line(`  ${persona}   (n=${rows.length}, groups=${new Set(rows.map((r) => r.group)).size})`);
  line('    estimator                MAE      vs M      95% CI            verdict');
  for (const [name, fit] of [['B0 constant', B0], ['B1 global mean', B1], ['B4 tag x time mean', B4]]) {
    const E = logo(rows, fit);
    const diffs = E.map((e, i) => e - M[i]);
    const [lo, hi] = ci(diffs);
    const verdict = lo > 0 ? 'model wins' : hi < 0 ? 'BASELINE WINS' : 'indistinguishable';
    line(`    ${name.padEnd(20)} ${fx(mean(E), 4)}  ${fx(mean(diffs), 4)}   [${fx(lo, 4)}, ${fx(hi, 4)}]   ${verdict}`);
  }
  line(`    ${'M model'.padEnd(20)} ${fx(mean(M), 4)}`);
  line();
}

line('=== lambda, on held-out error ===');
line('  The value is config.learning.lambda. Anything inside the noise of the');
line('  best is not distinguishable from it.');
line();
for (const persona of ['MORNING', 'CROSSED', 'NULL']) {
  const rows = sample(persona, 16, 11);
  const scores = [];
  for (const lambda of [0.1, 1, 4, 8, 16, 32]) {
    scores.push([lambda, mean(logo(rows, MODEL(lambda)))]);
  }
  const best = Math.min(...scores.map((s) => s[1]));
  line(`  ${persona}`);
  line(`    ${scores.map(([l]) => String(l).padStart(7)).join('')}`);
  line(`    ${scores.map(([, v]) => fx(v, 4).padStart(7)).join('')}`);
  line(`    ${scores.map(([, v]) => (v === best ? '   best' : '       ')).join('')}`);
  line();
}
