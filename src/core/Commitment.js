// Commitment.js — "8 hours of ENGR project by 3 October", stored.
//
// design/WEEKLY-PLANNING.md §2 and §4. The generator (`generate.js`) has been
// built and proven since 2026-08-16; it takes a plain object and had no stored
// home, which meant a working engine the user could not reach. This is that
// home, and nothing more: **it does not change the engine's shape.**
// `engineInput()` returns exactly the object `generateSittings` already accepts.
//
// A commitment says *how much the period owes*, not when it happens (§1). The
// sittings it generates are ordinary flexible tasks — nothing new reaches the
// grid, the scorer, the energy model or the wrap report.
//
// ⚠️ Two fields the spec sketches are deliberately ABSENT:
//
//  - **`cadence` / `lastFilled`.** §2 imagines a template that refills weekly.
//    That belongs to the Sunday ritual (§3, build step 4), which is not built.
//    A stored cadence with nothing reading it is a field that drifts out of
//    truth before its first user — so the period is stated outright, `from` and
//    `until`, which is also what the engine already takes.
//  - **`load`.** The engine accepts `commitment.load` as an override, and this
//    class never sets one: energy DERIVES FROM TAGS (the locked decision that
//    cancelled the task-panel dials). `loadForTask` averages every bucket the
//    tags touch, so a commitment tagged `study` already has the right character
//    and a dial here would be a second, divergent answer to a settled question.

import { slug } from './ids.js';
import { dateKey, dateFromKey, untilAfterLastRun } from './time.js';

/** 'YYYY-MM-DD' or a Date → 'YYYY-MM-DD'. */
function asKey(v, fallback) {
  if (!v) return fallback;
  if (v instanceof Date) return dateKey(v);
  return String(v);
}

const posInt = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export class Commitment {
  constructor(data = {}) {
    this.title = data.title ?? 'New commitment';
    this.id = data.id || slug(this.title) + '-commit';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];

    // HOURS is the unit the user types (PLAN D-1, resolved 2026-08-12) and
    // MINUTES is the unit stored, because minutes are what every other duration
    // in the engine is. The editor converts; nothing downstream has to know.
    this.amountMin = posInt(data.amountMin, 120);

    // Dates are 'YYYY-MM-DD' STRINGS and BOTH ENDS ARE INCLUSIVE — "by 3
    // October" means the 3rd is a day you can work on. The same choice DayNote
    // makes, for the same reason: a period has no time of day, and a string
    // cannot be misread as UTC midnight (sharp edge #4, in a form that cannot
    // occur). The half-open bound the engine wants is produced at the boundary
    // by `engineInput()` — sharp edge #11: convert at the edge, never inside.
    const today = dateKey(new Date());
    this.from = asKey(data.from, today);
    this.until = asKey(data.until, this.from);
    if (this.until < this.from) { const t = this.from; this.from = this.until; this.until = t; }

    // BOUNDS, not a size — the week decides the actual sitting (§4.1). This is
    // the whole reason the generator asks the calendar what it has.
    this.minSitting = posInt(data.minSitting, 30);
    this.maxSitting = posInt(data.maxSitting, 180);
    if (this.maxSitting < this.minSitting) this.maxSitting = this.minSitting;
    this.maxPerDay = posInt(data.maxPerDay, 1);

    // Breaks ties in ρ order only (§4.1.2) — it decides who picks days first,
    // never who gets good days.
    const p = Math.round(Number(data.priority));
    this.priority = Number.isFinite(p) ? Math.min(5, Math.max(1, p)) : 3;
  }

  /**
   * The `{id, label}` shape Schedule's shared collection guards assume
   * (`_uniqueInColl` / `_dedupeIds`, the same id-collision repair buckets and
   * zones get — two commitments both called "New commitment" slug identically).
   *
   * A GETTER, not a field: a stored `label` would be a second name for the
   * title, free to disagree with it, and it would land in `toJSON` as a field
   * nothing reads. This is the `role`-on-a-bucket mistake in miniature.
   */
  get label() {
    return this.title;
  }

  /**
   * The plain object `generateSittings` / `generateAll` take — Dates, not keys.
   *
   * ⚠️ This is the ONLY correct way to hand a stored commitment to the engine.
   * The engine calls `dayStart(commitment.from)`, which throws on a string, so
   * skipping this fails loudly rather than silently — but it still fails, and
   * `until` in particular is not a straight conversion:
   *
   * **`until` becomes the START OF THE NEXT DAY.** `placeTask` clips every
   * window to `end ≤ deadline`, so a deadline of 3 Oct 00:00 would make the 2nd
   * the last usable day and quietly cost the user a day of runway on every
   * commitment. `untilAfterLastRun` is the existing edge converter (sharp edge
   * #11) and this is exactly the case it was written for.
   */
  engineInput() {
    return {
      id: this.id,
      title: this.title,
      tags: [...this.tags],
      amountMin: this.amountMin,
      from: dateFromKey(this.from),
      until: untilAfterLastRun(dateFromKey(this.until)),
      minSitting: this.minSitting,
      maxSitting: this.maxSitting,
      maxPerDay: this.maxPerDay,
      priority: this.priority,
    };
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      title: this.title,
      tags: [...this.tags],
      amountMin: this.amountMin,
      from: this.from,
      until: this.until,
      minSitting: this.minSitting,
      maxSitting: this.maxSitting,
      maxPerDay: this.maxPerDay,
      priority: this.priority,
    };
  }

  static fromJSON(json) {
    return new Commitment(json || {});
  }
}
