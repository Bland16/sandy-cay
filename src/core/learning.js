// learning.js — satisfaction → placement preference (SPEC §5, R-5).
// Ridge-regularized linear regression trained by plain-JS gradient descent.
// Weights are directly inspectable so the Cabana can render learned preferences
// in plain language. Deterministic: zero-initialized, fixed epoch count.

import { clamp } from './time.js';

export const TIME_BUCKETS = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night'];
const DURATION_EDGES = [45, 90, 150, 240]; // → 5 buckets

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
    this.bias = 0;
    this.sampleCount = 0;
    this.trained = false;
    this.labels = []; // human-readable feature labels (Cabana insight)
  }

  /** Feature vector for a (task, slot). slot defaults to the task's own time. */
  featureVector(task, slot) {
    const start = slot ? slot.start : task.startTime;
    const durationMin = slot ? Math.round((slot.end - slot.start) / 60000) : task.getDuration();
    const tagInd = this.vocab.map((tag) => (task.tags.includes(tag) ? 1 : 0));
    const time = oneHot(timeBucket(start.getHours()), 6);
    const day = oneHot((start.getDay() + 6) % 7, 7);
    const dur = oneHot(durationBucket(durationMin), 5);
    const priorityNorm = task.priority / 5;
    const dayFill = task._dayFillAtCompletion ?? 0;
    const placedByUser = task.placedBy === 'user' ? 1 : 0;
    const moveNorm = Math.min(task.history.moveCount, 10) / 10;
    return [...tagInd, ...time, ...day, ...dur, priorityNorm, dayFill, placedByUser, moveNorm];
  }

  buildLabels() {
    this.labels = [
      ...this.vocab.map((t) => `tag:${t}`),
      ...TIME_BUCKETS.map((t) => `time:${t}`),
      ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => `day:${d}`),
      ...['dur:<45', 'dur:45-90', 'dur:90-150', 'dur:150-240', 'dur:>240'],
      'priority',
      'dayFill',
      'placedByUser',
      'moveCount',
    ];
  }

  /**
   * Train on rated tasks (each a Task with satisfaction set; its startTime is
   * the slot). timingFit ≠ 0 doubles the sample weight (SPEC §5).
   */
  train(ratedTasks, opts = {}) {
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

    const samples = rated.map((t) => ({
      x: this.featureVector(t),
      y: clamp((t.satisfaction.overall - 1) / 4, 0, 1),
      weight: t.satisfaction.timingFit && t.satisfaction.timingFit !== 0 ? 2 : 1,
    }));

    const dim = samples.length > 0 ? samples[0].x.length : 0;
    const w = new Array(dim).fill(0);
    let b = 0;
    if (samples.length === 0) {
      this.weights = w;
      this.bias = b;
      this.trained = false;
      return this;
    }

    const lr = opts.learningRate ?? this.config.learning.learningRate;
    const lambda = opts.lambda ?? this.config.learning.lambda;
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
      for (let j = 0; j < dim; j += 1) gw[j] += lambda * w[j]; // ridge
      for (let j = 0; j < dim; j += 1) w[j] -= (lr * gw[j]) / totalW;
      b -= (lr * gb) / totalW;
    }

    this.weights = w;
    this.bias = b;
    this.trained = true;
    return this;
  }

  /** modelScore(task, slot) ∈ [0,1]. 0 when untrained / below cold start. */
  modelScore(task, slot) {
    if (!this.trained || this.sampleCount < this.config.coldStartRatings) return 0;
    const x = this.featureVector(task, slot);
    let pred = this.bias;
    for (let j = 0; j < x.length; j += 1) pred += (this.weights[j] || 0) * x[j];
    return clamp(pred, 0, 1);
  }

  /** Inspectable learned preferences for the Cabana ("study +0.8 mornings"). */
  inspect() {
    return this.labels.map((label, i) => ({ label, weight: this.weights[i] ?? 0 }));
  }

  toJSON() {
    return {
      schemaVersion: 1,
      vocab: [...this.vocab],
      weights: [...this.weights],
      bias: this.bias,
      sampleCount: this.sampleCount,
      trained: this.trained,
      labels: [...this.labels],
    };
  }

  static fromJSON(json, config) {
    const m = new LearningModule(config);
    if (json) {
      m.vocab = json.vocab || [];
      m.weights = json.weights || [];
      m.bias = json.bias || 0;
      m.sampleCount = json.sampleCount || 0;
      m.trained = json.trained || false;
      m.labels = json.labels || [];
    }
    return m;
  }
}
