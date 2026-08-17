// RoutineInstance.js — one RUN of a routine (design/ROUTINES.md R-A).
//
// "Start the laundry at 19:00": load @19:00 → wash 45m → switch @19:47 →
// dry 60m → fold @20:52. Three anchored touchpoints, two enforced gaps.
//
// ════════════════════════════════════════════════════════════════════════════
// THE HYBRID, and why it is a split rather than a choice (decided 2026-08-16)
// ════════════════════════════════════════════════════════════════════════════
//
//   STORED here   the PROGRAM — the steps and waits as they were when you ran
//                 it, plus any one-time adjustment to this run.
//   DERIVED there the PLACEMENT — which tasks, on which days, at which times.
//                 Touchpoints carry `routineId` + `stepIndex` and are the only
//                 truth about where anything actually is.
//
// Neither half alone works, and that is the argument:
//
//  - **Derived alone cannot hold a per-run adjustment.** §"Program once, adjust
//    per run" is central: stretch this wash to 60m, skip the fold, add travel,
//    *without touching the saved routine*. A passive wait is NOT a task, so a
//    stretched wash has literally nowhere to live on the grid. Nor could an old
//    run be reconstructed after you edit the library — it would re-flow using
//    the NEW waits, silently rewriting history.
//  - **Stored alone drifts.** A record saying "three touchpoints" while the
//    grid holds two is the class of bug this repo keeps finding (sharp edge
//    #14, and #15 three times over). "Every weekday is derived, not stored — no
//    flag to fall out of sync."
//
// Split, they cannot contradict each other: the record says what was
// PROGRAMMED, the tasks say where it LANDED. Delete a touchpoint by hand and
// the chain is honestly shorter without invalidating the program; edit the
// library and past runs keep the program they actually ran.
//
// ⚠️ THE PROGRAM IS FROZEN AT INSTANTIATION — a COPY of the activity's steps,
// never a reference to them. That is the whole point of the second bullet.

import { slug } from './ids.js';
import { dateToJSON, dateFromJSON } from './time.js';

/** A step as it was actually run — the same shape `Activity` authors. */
function reviveStep(raw, i) {
  const d = raw || {};
  const kind = d.kind === 'passive' ? 'passive' : 'active';
  const min = Number.isFinite(Number(d.durationMin)) ? Math.max(1, Math.round(Number(d.durationMin))) : 1;
  const rawMax = Number.isFinite(Number(d.durationMax)) ? Math.round(Number(d.durationMax)) : min;
  const maxWait = Number.isFinite(Number(d.maxWaitMin)) ? Math.round(Number(d.maxWaitMin)) : null;
  return {
    label: typeof d.label === 'string' && d.label.trim()
      ? d.label.trim() : (kind === 'passive' ? 'wait' : `step ${i + 1}`),
    kind,
    durationMin: min,
    durationMax: Math.max(min, rawMax),
    maxWaitMin: kind === 'passive' && maxWait !== null ? Math.max(min, maxWait) : null,
  };
}

export class RoutineInstance {
  constructor(data = {}) {
    this.label = data.label ?? 'Routine';
    this.id = data.id || slug(this.label) + '-run';
    // Where the program CAME from. Nullable on purpose: the activity may be
    // deleted later, and a run that already happened does not stop having
    // happened. Never read to rebuild the program — that is what `steps` is for.
    this.activityId = data.activityId ?? null;
    this.startTime = dateFromJSON(data.startTime) || null;
    this.travelMin = Number.isFinite(Number(data.travelMin)) && Number(data.travelMin) > 0
      ? Math.round(Number(data.travelMin)) : 0;
    // THE FROZEN PROGRAM, already carrying this run's adjustments.
    this.steps = Array.isArray(data.steps) ? data.steps.map(reviveStep) : [];
  }

  /** Steps that become anchored touchpoint TASKS. Waits are gaps, never tasks. */
  activeSteps() {
    return this.steps.filter((s) => s.kind === 'active');
  }

  /**
   * When each ACTIVE step starts, relative to the run's start, in minutes.
   *
   * ⚠️ Uses each wait's `durationMin` — the FLOOR — because that is the physics
   * (R-1): the machine is not finished before then, so the next touchpoint may
   * never be earlier. Being LATER is always fine; the chain simply re-flows and
   * the following steps start later too. `maxWaitMin` is never consulted here,
   * because it is a preference and preferences do not move anchors.
   *
   * Returns `[{ stepIndex, offsetMin, durationMin, durationMax, label }]`,
   * `stepIndex` indexing into `steps` so a touchpoint can find its own program
   * entry back.
   */
  offsets() {
    const out = [];
    let cursor = this.travelMin;
    this.steps.forEach((s, i) => {
      if (s.kind === 'active') {
        out.push({
          stepIndex: i, offsetMin: cursor, label: s.label,
          durationMin: s.durationMin, durationMax: s.durationMax,
        });
        cursor += s.durationMin;
      } else {
        cursor += s.durationMin;
      }
    });
    return out;
  }

  /**
   * The waits, as they would fall for a run starting at `offsetMin` 0 —
   * `[{ stepIndex, fromMin, toMin, maxWaitMin }]`.
   *
   * These are NOT tasks and must never become tasks. They are what the grid may
   * optionally paint as a faint non-blocking band, and what a re-flow checks a
   * moved touchpoint against.
   */
  waits() {
    const out = [];
    let cursor = this.travelMin;
    this.steps.forEach((s, i) => {
      if (s.kind === 'passive') {
        out.push({ stepIndex: i, fromMin: cursor, toMin: cursor + s.durationMin, maxWaitMin: s.maxWaitMin });
      }
      cursor += s.durationMin;
    });
    return out;
  }

  /** Total elapsed span of the run, waits included. */
  get spanMin() {
    return this.steps.reduce((n, s) => n + s.durationMin, this.travelMin);
  }

  /** How much of your attention it costs — active steps only. */
  get attentionMin() {
    return this.activeSteps().reduce((n, s) => n + s.durationMin, this.travelMin);
  }

  /**
   * Build a run from an authored Activity, COPYING its steps.
   *
   * `adjust` is the one-time per-run tweak (§"Program once, adjust per run"):
   * `{ travelMin?, steps?: { [index]: { durationMin?, durationMax?, skip? } } }`.
   * A skipped step is dropped from this run's program entirely, so it neither
   * places a touchpoint nor contributes a wait — and the SAVED routine is
   * untouched, which is the whole split (the same "this one vs the pattern"
   * choice §4C already gives recurrence occurrences).
   */
  static fromActivity(activity, startTime, adjust = {}) {
    const tweaks = adjust.steps || {};
    const src = activity.isRoutine
      ? activity.steps
      // A simple activity is one implicit active block, so "run it as a
      // routine" still has a meaning and needs no special case downstream.
      : [{ label: activity.label, kind: 'active', durationMin: activity.durationMin, durationMax: activity.durationMax, maxWaitMin: null }];
    const steps = src
      .map((s, i) => ({ ...s, ...(tweaks[i] || {}) }))
      .filter((s, i) => !(tweaks[i] && tweaks[i].skip));
    return new RoutineInstance({
      label: activity.label,
      activityId: activity.id,
      startTime,
      travelMin: adjust.travelMin ?? activity.travelMin,
      steps,
    });
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      label: this.label,
      activityId: this.activityId,
      startTime: dateToJSON(this.startTime),
      travelMin: this.travelMin,
      steps: this.steps.map((s) => ({ ...s })),
    };
  }

  static fromJSON(json) {
    return new RoutineInstance(json || {});
  }
}
