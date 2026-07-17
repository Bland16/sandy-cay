// Activity.js — a user-authored template inside a bucket
// (design/ACTIVITY-LIBRARY.md): a label, tags, an elastic duration range
// (min..max) and an optional default priority. Instantiating one into an opening
// makes an ordinary flexible Task sized to *fill the opening*
// (clamp(opening, min, max)). Mirrors Zone.js / Bucket.js.

import { slug } from './ids.js';

const MIN_DURATION = 15; // grid minimum (OD-1) — the wave/sand borders can't cross
const DEFAULT_MAX = 60;

export class Activity {
  constructor(data = {}) {
    this.label = data.label ?? 'Activity';
    this.id = data.id || slug(this.label) + '-act';
    this.bucketId = data.bucketId ?? null;
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];
    // Elastic range. Guard so a bad author input can never produce an invalid
    // span: min ≥ 15 (grid minimum), max ≥ min.
    const min = Number.isFinite(data.durationMin) ? Math.max(MIN_DURATION, Math.round(data.durationMin)) : MIN_DURATION;
    const max = Number.isFinite(data.durationMax) ? Math.round(data.durationMax) : Math.max(min, DEFAULT_MAX);
    this.durationMin = min;
    this.durationMax = Math.max(min, max);
    this.priority = Number.isFinite(data.priority) ? data.priority : null;
  }

  /** How long this activity runs to fill an opening of `openingMin` minutes:
   *  clamp(opening, min, max) — the design's "fill the opening" rule. */
  durationFor(openingMin) {
    const o = Number.isFinite(openingMin) ? openingMin : this.durationMin;
    return Math.max(this.durationMin, Math.min(this.durationMax, o));
  }

  /** Does this activity fit an opening of `openingMin` minutes? (min ≤ opening) */
  fits(openingMin) {
    return Number.isFinite(openingMin) && openingMin >= this.durationMin;
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      bucketId: this.bucketId,
      label: this.label,
      tags: [...this.tags],
      durationMin: this.durationMin,
      durationMax: this.durationMax,
      priority: this.priority,
    };
  }

  static fromJSON(json) {
    return new Activity(json);
  }
}
