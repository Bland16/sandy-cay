// Activity.js — a user-authored template inside a bucket
// (design/ACTIVITY-LIBRARY.md): a label, tags, an elastic duration range
// (min..max) and an optional default priority. Instantiating one into an opening
// makes an ordinary flexible Task sized to *fill the opening*
// (clamp(opening, min, max)). Mirrors Zone.js / Bucket.js.

import { slug } from './ids.js';
import { normalizeLoad } from './energy.js';

const MIN_DURATION = 15; // grid minimum (OD-1) — the wave/sand borders can't cross
const DEFAULT_MAX = 60;

/**
 * ROUTINE STEPS (design/ROUTINES.md R-A).
 *
 * Laundry = `[load 2-5][wait 45][switch 2-5][wait 60][fold 10-15]`. An ACTIVE
 * step occupies you and becomes an anchored touchpoint task; a PASSIVE step is
 * the machine running, and is NOT a task — it is the enforced gap between two
 * touchpoints, which the existing placer already fills with other work.
 *
 * The two bounds on a WAIT are not the same kind of thing, and R-1 says that is
 * the whole decision:
 *
 *   `durationMin` — the machine is not finished. PHYSICS. The next touchpoint
 *                   may never be placed earlier, full stop.
 *   `maxWaitMin`  — it degrades after this. PREFERENCE. Stated, never enforced;
 *                   it may not block a placement or refuse a drop. Absent means
 *                   today's min-only behaviour exactly, so appliances (the
 *                   dishwasher's 4C hold, the oven's keep-warm) are unchanged.
 *
 * The user's words, deciding it: "I think it is fine though if there is cold
 * waffles, as long as I have the ability to place it there."
 *
 * SUB-15 IS ALLOWED HERE, and only here (Decision 2). A 2-minute "switch"
 * cannot exist at the 15-minute grid floor, but routine steps are placed
 * programmatically and never hand-resized, so the floor that protects drag
 * geometry does not apply. The floor stays for manual resize.
 */
const STEP_MIN = 1;

function reviveStep(raw, i) {
  const d = raw || {};
  const kind = d.kind === 'passive' ? 'passive' : 'active';
  const min = Number.isFinite(Number(d.durationMin))
    ? Math.max(STEP_MIN, Math.round(Number(d.durationMin))) : STEP_MIN;
  const rawMax = Number.isFinite(Number(d.durationMax)) ? Math.round(Number(d.durationMax)) : min;
  const maxWait = Number.isFinite(Number(d.maxWaitMin)) ? Math.round(Number(d.maxWaitMin)) : null;
  return {
    label: typeof d.label === 'string' && d.label.trim()
      ? d.label.trim() : (kind === 'passive' ? 'wait' : `step ${i + 1}`),
    kind,
    durationMin: min,
    // A ceiling below the floor is incoherent; the floor is the physics, so it wins.
    durationMax: Math.max(min, rawMax),
    // Only meaningful on a wait. Kept null on an active step rather than
    // undefined, so the round-trip is symmetric.
    maxWaitMin: kind === 'passive' && maxWait !== null ? Math.max(min, maxWait) : null,
  };
}

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
    // Optional load override (design/ENERGY-MODEL.md); null = inherit the bucket's.
    this.load = data.load ? normalizeLoad(data.load) : null;

    // ROUTINES (design/ROUTINES.md R-A) - both optional, both additive.
    //
    // `travelMin` is an active LEAD-IN fused to the core: the gym's "can't just
    // go whenever" - travel 15 + workout 45-60 is a 75-90m contiguous footprint,
    // so the picker needs a >=75m opening. It is sugar for a leading active step
    // (Decision 4: lead-in only for v1; a trailing cool-down waits until
    // something needs it).
    this.travelMin = Number.isFinite(Number(data.travelMin)) && Number(data.travelMin) > 0
      ? Math.round(Number(data.travelMin)) : 0;
    // `steps` PRESENT => this is a routine, and it overrides the single core
    // block. Absent => a simple activity, exactly as before.
    this.steps = Array.isArray(data.steps) && data.steps.length
      ? data.steps.map(reviveStep) : null;
  }

  /** Is this a routine - a chain of touchpoints - rather than one block? */
  get isRoutine() {
    return Array.isArray(this.steps) && this.steps.length > 0;
  }

  /** The steps that become anchored TASKS. Waits are gaps, never tasks. */
  activeSteps() {
    return this.isRoutine ? this.steps.filter((s) => s.kind === 'active') : [];
  }

  /**
   * The whole chain's span, min and max, INCLUDING the waits - what "how long
   * does laundry take" means. Not the same as how much of your attention it
   * costs, which is the active steps alone.
   */
  span() {
    if (!this.isRoutine) {
      return { min: this.travelMin + this.durationMin, max: this.travelMin + this.durationMax };
    }
    return this.steps.reduce(
      (acc, s) => ({ min: acc.min + s.durationMin, max: acc.max + s.durationMax }),
      { min: this.travelMin, max: this.travelMin },
    );
  }

  /** How much of your ATTENTION it costs - active steps only, waits excluded. */
  attentionMin() {
    if (!this.isRoutine) return this.travelMin + this.durationMin;
    return this.travelMin + this.activeSteps().reduce((n, s) => n + s.durationMin, 0);
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
      load: this.load ? { ...this.load } : null,
      travelMin: this.travelMin,
      steps: this.steps ? this.steps.map((x) => ({ ...x })) : null,
    };
  }

  static fromJSON(json) {
    return new Activity(json);
  }
}
