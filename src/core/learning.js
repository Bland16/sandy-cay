// learning.js — satisfaction → placement preference (SPEC §5, R-5).
// Ridge-regularized linear regression trained by plain-JS gradient descent.
// Weights are directly inspectable so the Cabana can render learned preferences
// in plain language. Deterministic: zero-initialized, fixed epoch count.
//
// Features are additive base terms: tag, time-of-day, day-of-week, duration,
// priority, day-fill, placed-by-user, move-count. (The `role` was ripped out —
// see design/RECONCILIATION.md — so the old `role×time`/`role×weekend` interaction
// terms are gone; per-position learning returns in L-2 keyed off *load*, not an
// enum. Steering now reads a bucket's character from its load vector, in suggest.js.)

import { clamp } from './time.js';

// Bump when featureVector's layout changes: a saved model's weights no longer
// line up, so it's discarded and retrained from the rated tasks (which persist).
// v3: dropped the role×time / role×weekend interaction columns (role rip-out).
// 4 (2026-08-13): `dayFill` went live. The column's LAYOUT is unchanged, but a
// stored model's dayFill weight was trained against a constant zero and is
// meaningless now that the column carries values — so force a clean retrain.
// `fromJSON` already sets `needsRetrain` on a mismatch and `Schedule`'s
// constructor already acts on it; ratings persist on the tasks, so nothing is lost.
// 5 (2026-09-03): dropped `moveCount` (user's call). It counted ONLY the user's
// own drags — `moveTo` has one caller (useCardInteraction, the drag) and nothing
// ever passes `countMove:true` to `placeAt` — so it never once measured engine
// displacement, and a deliberate nudge at creation ("15 minutes earlier, it was
// placed late") was indistinguishable from a reschedule. It was also inert at
// placement (task-level constant: identical for every candidate slot, so it
// cannot move the arg-max), it fought `starvationCheck` in `whatToDo` by
// downranking exactly the work that detector exists to surface, and narrating
// it is moral bookkeeping (P-1). `history.moveCount` is still RECORDED — only
// the feature is gone. See design/ML-HEURISTICS-RECOMMENDATIONS.md §1.3b.
export const MODEL_LAYOUT_VERSION = 5;

export const TIME_BUCKETS = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night'];
// Finer low end than before ([45,90,150,240]): "< 45" was one bucket, so the
// model couldn't tell a 15m task from a 40m one. Now 7 buckets, including < 15.
const DURATION_EDGES = [15, 30, 45, 90, 150, 240]; // → 7 buckets

// The bucket edges as DATA, so `humanLabel` below can state them without a
// second, hand-typed copy drifting out of sync with the one that does the work.
// `night` is everything else — it wraps midnight, so it has no [lo, hi) row.
const TIME_BUCKET_HOURS = [[5, 8], [8, 11], [11, 14], [14, 17], [17, 21]];

export function timeBucket(hour) {
  for (let i = 0; i < TIME_BUCKET_HOURS.length; i += 1) {
    if (hour >= TIME_BUCKET_HOURS[i][0] && hour < TIME_BUCKET_HOURS[i][1]) return i;
  }
  return 5;
}

const DAY_LABELS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const hr = (h) => (h % 12 === 0 ? 12 : h % 12);
const mins = (m) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

/**
 * A feature label as a person would say it. SPEC §5 asks the Cabana for
 * "plain-language preferences" and §7.1 for "plain language" — both surfaces
 * were printing the raw internal string, so a wrap report could read "the model
 * leans toward dur:45-90".
 *
 * ⚠️ GENERATED from `TIME_BUCKETS`, `TIME_BUCKET_HOURS` and `DURATION_EDGES`,
 * never retyped. A parallel table is the `dayFillAtCompletion` bug shape: two
 * descriptions of one thing, one of them silently wrong after the next edit.
 */
export function humanLabel(label) {
  const s = String(label ?? '');
  if (s.startsWith('tag:')) return s.slice(4); // the user's own word
  if (s.startsWith('time:')) {
    const i = TIME_BUCKETS.indexOf(s.slice(5));
    if (i < 0) return s;
    if (i === TIME_BUCKETS.length - 1) return `late evenings (${hr(21)} onward)`;
    const [lo, hi] = TIME_BUCKET_HOURS[i];
    return `${TIME_BUCKETS[i]}s (${hr(lo)}–${hr(hi)})`;
  }
  if (s.startsWith('day:')) {
    const i = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(s.slice(4));
    return i < 0 ? s : DAY_LABELS[i];
  }
  if (s.startsWith('dur:')) {
    const r = s.slice(4);
    if (r.startsWith('<')) return `sittings under ${mins(DURATION_EDGES[0])}`;
    if (r.startsWith('>')) return `sittings over ${mins(DURATION_EDGES[DURATION_EDGES.length - 1])}`;
    const [lo, hi] = r.split('-');
    return `${lo}–${hi} minute sittings`;
  }
  return s;
}

/**
 * Columns that may be spoken to the user, even when they carry weight.
 *
 * `priority` is a claim about the user's own labelling, not their life.
 * `dayFill` has a weight that flips sign between retrains, so it is not a
 * sentence. `placedByUser` narrates the user's relationship with the app, and
 * its negative reading is a P-1 hazard on its face. All three stay in the FIT —
 * they are real confound controls — and none of them gets a sentence.
 *
 * What remains is exactly the four families a person can act on by choosing
 * WHEN and WHAT to schedule.
 */
export function isNarratable(label) {
  return /^(tag|time|day|dur):/.test(String(label ?? ''));
}

function durationBucket(min) {
  for (let i = 0; i < DURATION_EDGES.length; i += 1) if (min < DURATION_EDGES[i]) return i;
  return DURATION_EDGES.length;
}

function oneHot(idx, len) {
  const a = new Array(len).fill(0);
  if (idx >= 0 && idx < len) a[idx] = 1;
  return a;
}

export class LearningModule {
  constructor(config) {
    this.config = config;
    this.vocab = []; // top-N tag names
    this.weights = [];
    this.gates = []; // per-feature 1/0: an ungated interaction cell contributes 0
    this.bias = 0;
    this.sampleCount = 0;
    this.trained = false;
    this.labels = []; // human-readable feature labels (Cabana insight)
    this.interactionIdx = []; // indices of role×… features
    this.layoutVersion = MODEL_LAYOUT_VERSION;
    this.needsRetrain = false; // set on load when a stored layout is out of date
  }

  /** Feature vector for a (task, slot). slot defaults to the task's own time. */
  featureVector(task, slot) {
    const start = slot ? slot.start : task.startTime;
    const durationMin = slot ? Math.round((slot.end - slot.start) / 60000) : task.getDuration();
    const ti = timeBucket(start.getHours());
    const dow = start.getDay(); // 0=Sun … 6=Sat

    const tagInd = this.vocab.map((tag) => (task.tags.includes(tag) ? 1 : 0));
    const time = oneHot(ti, TIME_BUCKETS.length);
    const day = oneHot((dow + 6) % 7, 7); // Mon=0 … Sun=6
    const dur = oneHot(durationBucket(durationMin), DURATION_EDGES.length + 1);
    const priorityNorm = task.priority / 5;
    // Wired 2026-08-13. It read `_dayFillAtCompletion`, a field nothing ever
    // wrote — one repo hit, not a Task field, not serialised — so this feature
    // was constant-zero from the day it was added. Now stamped at rating time
    // alongside `energyAt`, for the same reason: deriving it later would train
    // the model on a day that never happened.
    const dayFill = task.dayFillAtCompletion ?? 0;
    const placedByUser = task.placedBy === 'user' ? 1 : 0;
    return [
      ...tagInd, ...time, ...day, ...dur,
      priorityNorm, dayFill, placedByUser,
    ];
  }

  buildLabels() {
    this.labels = [
      ...this.vocab.map((t) => `tag:${t}`),
      ...TIME_BUCKETS.map((t) => `time:${t}`),
      ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => `day:${d}`),
      ...['dur:<15', 'dur:15-30', 'dur:30-45', 'dur:45-90', 'dur:90-150', 'dur:150-240', 'dur:>240'],
      'priority', 'dayFill', 'placedByUser',
    ];
    // The gated set. It was empty after the role rip-out, so the gating
    // machinery below no-opped — and the DURATION buckets were the columns that
    // needed it most. A sitting length you have tried twice and disliked earns a
    // real negative weight; one you have never been offered stays at exactly
    // +0.000 and therefore OUTRANKS it. Gating stops a column speaking at all
    // until it has `interactionMinSamples` observations behind it.
    //
    // (`observations` below is what lets a caller tell "0 because unobserved"
    // from "0 because neutral" — the two are indistinguishable in the weight.)
    const durStart = this.vocab.length + TIME_BUCKETS.length + 7; // tags · times · weekdays
    const durCount = DURATION_EDGES.length + 1;
    this.interactionIdx = Array.from({ length: durCount }, (_, k) => durStart + k);
  }

  /**
   * Train on rated tasks (each a Task with satisfaction set; its startTime is
   * the slot). timingFit ≠ 0 doubles the sample weight (SPEC §5).
   */
  train(ratedTasks, opts = {}) {
    // ⚠️ `Number.isFinite`, NOT `typeof === 'number'` — because `typeof NaN` IS
    // 'number'. One rating with a NaN `overall` passed this filter, propagated
    // through `clamp` (Math.max/Math.min return NaN), took every weight with it,
    // and the divergence guard below then refused to ship the fit — so a single
    // corrupt rating disabled learning permanently, with no error anywhere and a
    // UI that said "cold start". A bad rating should cost one sample.
    const rated = ratedTasks.filter(
      (t) => t.satisfaction && Number.isFinite(t.satisfaction.overall),
    );
    this.sampleCount = rated.length;
    // Build tag vocabulary (top-N by frequency, deterministic tiebreak by name).
    const counts = new Map();
    for (const t of rated) for (const tag of t.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    this.vocab = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, this.config.learning.topTags)
      .map((e) => e[0]);
    this.buildLabels();
    this.layoutVersion = MODEL_LAYOUT_VERSION;
    this.needsRetrain = false;

    const samples = rated.map((t) => ({
      x: this.featureVector(t, null),
      y: clamp((t.satisfaction.overall - 1) / 4, 0, 1),
      weight: t.satisfaction.timingFit && t.satisfaction.timingFit !== 0 ? 2 : 1,
    }));

    const dim = samples.length > 0 ? samples[0].x.length : 0;
    const w = new Array(dim).fill(0);
    // ⚠️ START THE INTERCEPT AT THE WEIGHTED MEAN, NOT AT ZERO.
    //
    // Every one-hot block (time, weekday, duration) sums to 1, so each block is
    // collinear with the intercept and nothing in the data identifies the split
    // between them. From b = 0 the descent has to carry the whole level up
    // through that null space, which converges FAR slower than the signal
    // directions — so at the fixed 400 epochs the level has not arrived and the
    // shortfall is sitting in the one-hot columns, indistinguishable from
    // learned preference.
    //
    // Measured (probe-learn-fit.mjs), 30 ratings that are all identical — a
    // person with no preference whatsoever:
    //
    //     epochs      bias   largest |weight|   the report would print
    //        400     0.135        0.126         "leans toward study"
    //      5,000     0.225        0.119         "leans toward study"
    //     50,000     0.473        0.012         "leans toward study"
    //    200,000     0.500        0.000         (nothing)   ← the truth
    //
    // Six columns cleared the display floor at 400, including `day:wed` from
    // six observations. Starting at the mean puts the level where it belongs
    // before the first step, so the columns have nothing left to absorb. This
    // is not a speed-up: it is the difference between the model reporting a
    // preference it invented and reporting none.
    //
    // Note this is a DIFFERENT problem from lambda. Raising lambda shrinks the
    // invented weights and the real ones alike; it never moves the intercept.
    const wSum = samples.reduce((acc, sm) => acc + sm.weight, 0) || 1;
    let b = samples.length
      ? samples.reduce((acc, sm) => acc + sm.weight * sm.y, 0) / wSum
      : 0;
    if (samples.length === 0) {
      this.weights = w;
      this.gates = new Array(dim).fill(1);
      this.bias = b;
      this.trained = false;
      return this;
    }

    // Per-cell gating: an interaction feature contributes nothing until its cell
    // has ≥ interactionMinSamples non-zero observations. Zero the ungated columns
    // in the training data so their weights stay 0 (and again at score time).
    const minSamples = this.config.learning.interactionMinSamples ?? 4;
    const gates = new Array(dim).fill(1);
    const interaction = new Set(this.interactionIdx);
    // ⚠️ COUNTED FOR EVERY COLUMN, not just the gated ones. This loop used to
    // walk `interactionIdx`, so `observations` was populated for the 7 duration
    // columns and left at 0 for the other ~20 — while `inspect()`'s docstring
    // below promises the count is what distinguishes "0 because you have never
    // tried this" from "0 because it is genuinely neutral". For tags, times and
    // weekdays it delivered neither, and both narration surfaces rank on
    // `|weight|` alone as a result. Counting is free; gating stays scoped.
    const observations = new Array(dim).fill(0);
    for (let j = 0; j < dim; j += 1) {
      let n = 0;
      for (const sm of samples) if (sm.x[j] !== 0) n += 1;
      observations[j] = n;
    }
    for (const j of this.interactionIdx) if (observations[j] < minSamples) gates[j] = 0;
    this.observations = observations;
    for (const sm of samples) for (const j of this.interactionIdx) if (gates[j] === 0) sm.x[j] = 0;

    const lr = opts.learningRate ?? this.config.learning.learningRate;
    const lambda = opts.lambda ?? this.config.learning.lambda;
    // Interactions are regularized harder — they need consistent evidence to move.
    const iLambda = opts.interactionLambda ?? this.config.learning.interactionLambda ?? lambda * 4;
    const epochs = opts.epochs ?? this.config.learning.epochs;
    const totalW = samples.reduce((s, sm) => s + sm.weight, 0) || 1;

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const gw = new Array(dim).fill(0);
      let gb = 0;
      for (const sm of samples) {
        let pred = b;
        for (let j = 0; j < dim; j += 1) pred += w[j] * sm.x[j];
        const err = pred - sm.y;
        for (let j = 0; j < dim; j += 1) gw[j] += sm.weight * err * sm.x[j];
        gb += sm.weight * err;
      }
      for (let j = 0; j < dim; j += 1) gw[j] += (interaction.has(j) ? iLambda : lambda) * w[j]; // grouped ridge
      for (let j = 0; j < dim; j += 1) w[j] -= (lr * gw[j]) / totalW;
      b -= (lr * gb) / totalW;
    }

    // A diverged model is worse than no model. One non-finite weight makes every
    // modelScore NaN, every "highest wins" comparison false, and placement
    // silently degrades to "first slot" app-wide — with no error anywhere.
    // Refuse to ship it and stay cold-start instead.
    if (!w.every((v) => Number.isFinite(v)) || !Number.isFinite(b)) {
      this.weights = new Array(dim).fill(0);
      this.gates = new Array(dim).fill(1);
      this.bias = 0;
      this.trained = false;
      this.diverged = true;
      return this;
    }

    this.weights = w;
    this.gates = gates;
    this.bias = b;
    this.trained = true;
    this.diverged = false;

    // ⚠️ `assessSkill: false` IS LOAD-BEARING, NOT AN OPTIMISATION.
    // `_assessSkill` fits a throwaway model per fold, and each of those calls
    // `train` — so without this guard the first retrain recurses until the
    // stack gives out. The fold fits do not need their own skill estimate.
    this.skill = opts.assessSkill === false ? null : this._assessSkill(rated);
    return this;
  }

  /** modelScore(task, slot) ∈ [0,1]. 0 when untrained / below cold start. */
  modelScore(task, slot) {
    if (!this.trained || this.sampleCount < this.config.coldStartRatings) return 0;
    const x = this.featureVector(task, slot);
    let pred = this.bias;
    for (let j = 0; j < x.length; j += 1) pred += (this.weights[j] || 0) * x[j] * (this.gates[j] ?? 1);
    // Belt and braces: never let a NaN escape into the scoring function.
    if (!Number.isFinite(pred)) return 0;
    return clamp(pred, 0, 1);
  }

  /** Inspectable learned preferences for the Cabana ("study +0.8 mornings").
   *  Gated-off cells read as 0 — they aren't firing yet.
   *
   *  `observations` is the count behind each column, and it is the difference
   *  between "0 because you have never tried this" and "0 because it is
   *  genuinely neutral". A caller that ranks on `weight` alone will rank an
   *  untried sitting length above one you have tried and disliked. */
  /**
   * Does this fit beat predicting your average, on ratings it did not see?
   *
   * ⚠️ THE ONLY GATE HERE THAT MEASURES WHETHER THE MODEL IS *RIGHT*. Everything
   * else — `coldStartRatings`, the per-column observation counts — measures how
   * much the user has typed. `trained` means only "gradient descent ran and
   * produced finite numbers", so a fit worse than a constant has always carried
   * exactly the same authority as a good one.
   *
   * Measured (probe-learn-baselines.mjs), held-out MAE by leave-one-group-out:
   *
   *   persona    model    no model   verdict
   *   MORNING    0.1107   0.2175     model wins
   *   DOMINANT   0.0553   0.0942     model wins
   *   NULL       0.0431   0.0260     NO MODEL WINS   ← fitting noise
   *   CROSSED    0.0894   0.0682     NO MODEL WINS   ← additive fit, crossed truth
   *
   * A user with no real preference gets a model that fits noise and then steers
   * their week with it; an additive model on interacting preferences does worse
   * than a constant. Both are cases where the honest contribution is zero, and
   * neither is visible from the sample count.
   *
   * ⚠️ GROUPED FOLDS. Leaving out one OCCURRENCE of a recurring series while its
   * siblings stay in training measures "can you predict Tuesday gym from eleven
   * other Tuesday gyms", which is trivially yes. Folds are by `parentId ?? id`,
   * so a whole series leaves together. Capped at `SKILL_FOLDS` to bound cost.
   */
  _assessSkill(rated) {
    const K = 6;
    if (rated.length < K * 2) return null; // too little to split honestly
    const groupOf = (t) => t.parentId || t.id;
    const groups = [...new Set(rated.map(groupOf))];
    if (groups.length < 3) return null; // one or two series is not a test set
    const folds = Array.from({ length: Math.min(K, groups.length) }, () => []);
    groups.forEach((g, i) => folds[i % folds.length].push(g));

    let errModel = 0;
    let errMean = 0;
    let n = 0;
    for (const held of folds) {
      const inFold = new Set(held);
      const train = rated.filter((t) => !inFold.has(groupOf(t)));
      const test = rated.filter((t) => inFold.has(groupOf(t)));
      if (train.length === 0 || test.length === 0) continue;
      // A throwaway fit on the fold — vocabulary and all, since choosing the
      // vocabulary over the full set before splitting would leak.
      const sub = new LearningModule(this.config);
      sub.train(train, { assessSkill: false });
      const ys = train.map((t) => clamp((t.satisfaction.overall - 1) / 4, 0, 1));
      const mu = ys.reduce((s, v) => s + v, 0) / ys.length;
      for (const t of test) {
        const truth = clamp((t.satisfaction.overall - 1) / 4, 0, 1);
        const pred = sub.trained ? sub.modelScore(t, null) : mu;
        errModel += (pred - truth) ** 2;
        errMean += (mu - truth) ** 2;
        n += 1;
      }
    }
    if (n === 0 || errMean === 0) return null;
    return 1 - errModel / errMean; // R² against the mean predictor
  }

  inspect() {
    return this.labels.map((label, i) => ({
      label,
      weight: (this.weights[i] ?? 0) * (this.gates[i] ?? 1),
      observations: this.observations ? (this.observations[i] ?? 0) : 0,
      gated: (this.gates[i] ?? 1) === 0,
    }));
  }

  toJSON() {
    return {
      schemaVersion: 1,
      layoutVersion: this.layoutVersion,
      vocab: [...this.vocab],
      weights: [...this.weights],
      gates: [...this.gates],
      bias: this.bias,
      sampleCount: this.sampleCount,
      trained: this.trained,
      labels: [...this.labels],
      // ⚠️ SERIALIZED, because `inspect()` leans on it. Without this the count
      // read 0 for every column after any reload — so the untried/neutral
      // distinction the docstring calls load-bearing survived exactly until the
      // page was refreshed, and both narration surfaces got the degraded copy.
      observations: this.observations ? [...this.observations] : [],
      // Why the model is quiet, not just that it is. A diverged fit sets
      // `trained: false`, which every consumer reads as "cold start" — so a
      // model killed by one bad rating reported "12 of 10 ratings so far".
      diverged: !!this.diverged,
      // Held-out skill, so a reload does not silently restore authority a
      // measured-unskilled model had lost until the next retrain.
      skill: typeof this.skill === 'number' ? this.skill : null,
    };
  }

  static fromJSON(json, config) {
    const m = new LearningModule(config);
    if (json) {
      // A stored model from an older feature layout can't be scored against the
      // new vector — discard its weights and flag a retrain (weights are
      // disposable; the ratings that produced them persist on the tasks).
      if ((json.layoutVersion ?? 1) !== MODEL_LAYOUT_VERSION) {
        m.needsRetrain = true;
        m.layoutVersion = MODEL_LAYOUT_VERSION;
        return m;
      }
      m.vocab = json.vocab || [];
      m.weights = json.weights || [];
      m.gates = json.gates || new Array(m.weights.length).fill(1);
      m.bias = json.bias || 0;
      m.sampleCount = json.sampleCount || 0;
      m.trained = json.trained || false;
      m.labels = json.labels || [];
      m.observations = Array.isArray(json.observations) && json.observations.length
        ? [...json.observations] : null;
      m.diverged = !!json.diverged;
      m.skill = typeof json.skill === 'number' ? json.skill : null;
      // ⚠️ STRUCTURAL GUARD, because the version constant cannot detect its own
      // staleness. Removing a column without bumping MODEL_LAYOUT_VERSION fails
      // SILENTLY: `modelScore` walks the shorter feature vector against the
      // longer stored weights, the leading columns still line up, and there is
      // no crash and no NaN — just quiet drift in every placement, plus a
      // phantom row in the Cabana because `inspect()` maps over `labels`.
      // Disagreeing lengths can only mean a layout change, so retrain.
      if (m.weights.length !== m.labels.length) {
        m.needsRetrain = true;
        m.weights = [];
        m.trained = false;
      }
      m.layoutVersion = json.layoutVersion;
      m.interactionIdx = []; // no interaction terms in the base model (role rip-out)
    }
    return m;
  }
}
