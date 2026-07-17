// learning.js — satisfaction → placement preference (SPEC §5, R-5).
// Ridge-regularized linear regression trained by plain-JS gradient descent.
// Weights are directly inspectable so the Cabana can render learned preferences
// in plain language. Deterministic: zero-initialized, fixed epoch count.
//
// Phase D.1 (design/ACTIVITY-LIBRARY.md) adds per-bucket POSITION learning: the
// base features are additive (it can learn "mornings good" and "work good"
// separately but not "work good IN the morning"), so interaction terms on the
// task's bucket `role` × slot position let it represent the combination —
// `role×time` (36) and `role×weekend` (6). Kept honest on sparse data by:
//   • per-cell gating — an interaction contributes 0 until its cell has ≥
//     interactionMinSamples ratings (one grumpy Saturday can't mint a pattern),
//   • grouped ridge — interactions are regularized harder than base terms.
// (Phase D.2 — availability features crunch/weekFill/vs-typical baseline — is
// still to come; it needs a completion-context snapshot the app doesn't record
// yet.)

import { clamp } from './time.js';

// Bump when featureVector's layout changes: a saved model's weights no longer
// line up, so it's discarded and retrained from the rated tasks (which persist).
export const MODEL_LAYOUT_VERSION = 2;

export const TIME_BUCKETS = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night'];
export const ROLES = ['rest', 'creative', 'work', 'social', 'health', 'neutral'];
// Finer low end than before ([45,90,150,240]): "< 45" was one bucket, so the
// model couldn't tell a 15m task from a 40m one. Now 7 buckets, including < 15.
const DURATION_EDGES = [15, 30, 45, 90, 150, 240]; // → 7 buckets

export function timeBucket(hour) {
  if (hour >= 5 && hour < 8) return 0;
  if (hour >= 8 && hour < 11) return 1;
  if (hour >= 11 && hour < 14) return 2;
  if (hour >= 14 && hour < 17) return 3;
  if (hour >= 17 && hour < 21) return 4;
  return 5;
}

function durationBucket(min) {
  for (let i = 0; i < DURATION_EDGES.length; i += 1) if (min < DURATION_EDGES[i]) return i;
  return DURATION_EDGES.length;
}

function roleIndex(role) {
  const i = ROLES.indexOf(role);
  return i >= 0 ? i : ROLES.length - 1; // unknown → neutral
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

  /** Feature vector for a (task, slot). slot defaults to the task's own time.
   *  `ctx.role` is the task's bucket role (from the caller, which has the buckets);
   *  absent → neutral. */
  featureVector(task, slot, ctx = {}) {
    const start = slot ? slot.start : task.startTime;
    const durationMin = slot ? Math.round((slot.end - slot.start) / 60000) : task.getDuration();
    const ri = roleIndex(ctx.role || 'neutral');
    const ti = timeBucket(start.getHours());
    const dow = start.getDay(); // 0=Sun … 6=Sat
    const weekend = dow === 0 || dow === 6 ? 1 : 0;

    const tagInd = this.vocab.map((tag) => (task.tags.includes(tag) ? 1 : 0));
    const time = oneHot(ti, TIME_BUCKETS.length);
    const day = oneHot((dow + 6) % 7, 7); // Mon=0 … Sun=6
    const dur = oneHot(durationBucket(durationMin), DURATION_EDGES.length + 1);
    const roleTime = oneHot(ri * TIME_BUCKETS.length + ti, ROLES.length * TIME_BUCKETS.length); // 36
    const roleWeekend = new Array(ROLES.length).fill(0);
    roleWeekend[ri] = weekend; // 6
    const priorityNorm = task.priority / 5;
    const dayFill = task._dayFillAtCompletion ?? 0; // dead until Phase D.2 wires it
    const placedByUser = task.placedBy === 'user' ? 1 : 0;
    const moveNorm = Math.min(task.history.moveCount, 10) / 10;
    return [
      ...tagInd, ...time, ...day, ...dur, ...roleTime, ...roleWeekend,
      priorityNorm, dayFill, placedByUser, moveNorm,
    ];
  }

  buildLabels() {
    this.labels = [
      ...this.vocab.map((t) => `tag:${t}`),
      ...TIME_BUCKETS.map((t) => `time:${t}`),
      ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => `day:${d}`),
      ...['dur:<15', 'dur:15-30', 'dur:30-45', 'dur:45-90', 'dur:90-150', 'dur:150-240', 'dur:>240'],
      ...ROLES.flatMap((r) => TIME_BUCKETS.map((tb) => `role×time:${r}·${tb}`)),
      ...ROLES.map((r) => `role×weekend:${r}`),
      'priority', 'dayFill', 'placedByUser', 'moveCount',
    ];
    this.interactionIdx = [];
    for (let i = 0; i < this.labels.length; i += 1) if (this.labels[i].startsWith('role×')) this.interactionIdx.push(i);
  }

  /**
   * Train on rated tasks (each a Task with satisfaction set; its startTime is
   * the slot). timingFit ≠ 0 doubles the sample weight (SPEC §5). `opts.roleOf`
   * resolves each task's bucket role (the module has no bucket access itself).
   */
  train(ratedTasks, opts = {}) {
    const roleOf = opts.roleOf || (() => 'neutral');
    const rated = ratedTasks.filter((t) => t.satisfaction && typeof t.satisfaction.overall === 'number');
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
      x: this.featureVector(t, null, { role: roleOf(t) }),
      y: clamp((t.satisfaction.overall - 1) / 4, 0, 1),
      weight: t.satisfaction.timingFit && t.satisfaction.timingFit !== 0 ? 2 : 1,
    }));

    const dim = samples.length > 0 ? samples[0].x.length : 0;
    const w = new Array(dim).fill(0);
    let b = 0;
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
    for (const j of this.interactionIdx) {
      let n = 0;
      for (const sm of samples) if (sm.x[j] !== 0) n += 1;
      if (n < minSamples) gates[j] = 0;
    }
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
    return this;
  }

  /** modelScore(task, slot, ctx) ∈ [0,1]. 0 when untrained / below cold start. */
  modelScore(task, slot, ctx = {}) {
    if (!this.trained || this.sampleCount < this.config.coldStartRatings) return 0;
    const x = this.featureVector(task, slot, ctx);
    let pred = this.bias;
    for (let j = 0; j < x.length; j += 1) pred += (this.weights[j] || 0) * x[j] * (this.gates[j] ?? 1);
    // Belt and braces: never let a NaN escape into the scoring function.
    if (!Number.isFinite(pred)) return 0;
    return clamp(pred, 0, 1);
  }

  /** Inspectable learned preferences for the Cabana ("study +0.8 mornings").
   *  Gated-off interaction cells read as 0 — they aren't firing yet. */
  inspect() {
    return this.labels.map((label, i) => ({ label, weight: (this.weights[i] ?? 0) * (this.gates[i] ?? 1) }));
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
      m.layoutVersion = json.layoutVersion;
      m.interactionIdx = [];
      for (let i = 0; i < m.labels.length; i += 1) if (m.labels[i].startsWith('role×')) m.interactionIdx.push(i);
    }
    return m;
  }
}
