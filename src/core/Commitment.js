// Commitment.js — "2 hours of maths a week, all term", stored.
//
// design/WEEKLY-PLANNING.md §2 and §4. The generator (`generate.js`) has been
// built and proven since 2026-08-16; it takes a plain object and had no stored
// home, which meant a working engine the user could not reach. This is that
// home, and nothing more: **it does not change the engine's shape.**
// `engineInputForWeek()` returns exactly the object `generateSittings` accepts.
//
// A commitment says *how much the week owes*, not when it happens (§1). The
// sittings it generates are ordinary flexible tasks — nothing new reaches the
// grid, the scorer, the energy model or the wrap report.
//
// ⚠️ THE AMOUNT IS PER WEEK, and that is §2's model rather than a choice made
// here: `amountMin, // 120 — what each PERIOD owes`, with a weekly cadence. The
// field is named `amountMinPerWeek` because it was briefly built as a total
// across from→until, and a field whose name outlives its meaning is how this
// codebase's bugs live.
//
// `from`/`until` are therefore the TERM the commitment stands for, not a
// deadline. The deadline is per-week and it is `dueDay` (below).
//
// ⚠️ Fields the spec sketches that are deliberately ABSENT:
//
//  - **`cadence`.** Weekly only. §2 says "weekly, monthly, …" but the editor
//    says `/week` in as many words, and a stored cadence no code branches on is
//    a field that drifts out of truth before its first user. Add it when
//    something needs it.
//  - **`lastFilled`.** Derived instead — `Schedule#sittingsFor(id, weekStart)`
//    asks the grid what is actually there. A stored flag disagrees with reality
//    the moment you delete a sitting by hand ("every weekday is derived, not
//    stored — no flag to fall out of sync").
//  - **`load`.** The engine accepts `commitment.load` as an override, and this
//    class never sets one: energy DERIVES FROM TAGS (the locked decision that
//    cancelled the task-panel dials). `loadForTask` averages every bucket the
//    tags touch, so a commitment tagged `study` already has the right character
//    and a dial here would be a second, divergent answer to a settled question.

import { slug } from './ids.js';
import {
  dateKey, dateFromKey, untilAfterLastRun, addDays, weekStart as weekStartOf, DAY_KEYS,
} from './time.js';

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
    this.amountMinPerWeek = posInt(data.amountMinPerWeek, 120);

    // The TERM, as 'YYYY-MM-DD' STRINGS, BOTH ENDS INCLUSIVE. The same choice
    // DayNote makes, for the same reason: a span of days has no time of day,
    // and a string cannot be misread as UTC midnight (sharp edge #4, in a form
    // that cannot occur). Half-open bounds are produced at the boundary by
    // `engineInputForWeek()` — sharp edge #11: convert at the edge, never
    // inside.
    const today = dateKey(new Date());
    this.from = asKey(data.from, today);
    this.until = asKey(data.until, this.from);
    if (this.until < this.from) { const t = this.from; this.from = this.until; this.until = t; }

    // OPTIONAL per-week deadline: 'mon'…'sun', or null for the week's end.
    //
    // ⚠️ §2 says "No separate deadline field" and this does not contradict it.
    // What §1 rejected was per-OCCURRENCE dated deadlines — "eleven psets, each
    // due its own Friday", eleven objects with their own machinery. This is ONE
    // value applying uniformly to every week: it moves the period's end from
    // Sunday to Thursday, which is §2's "the period's end is the implicit
    // deadline" with a different end. Recorded as a new decision because §2's
    // plain language would otherwise mislead the next reader.
    //
    // Day KEYS, not an index — the same vocabulary zone windows use (`day:
    // 'tue'`), so it costs no new one and survives JSON as itself.
    this.dueDay = DAY_KEYS.includes(data.dueDay) ? data.dueDay : null;

    // BOUNDS on a single sitting, not a size — the week decides the actual
    // length (§4.1). This is the whole reason the generator asks the calendar
    // what it has instead of booking a number it invented.
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

  /** Does the term cover any part of the week beginning `ws` (a Monday)? */
  coversWeek(ws) {
    const start = weekStartOf(ws);
    return dateKey(addDays(start, 6)) >= this.from && dateKey(start) <= this.until;
  }

  /**
   * The plain object `generateSittings` takes, for ONE week — Dates, not keys.
   *
   * ⚠️ This is the ONLY correct way to hand a stored commitment to the engine.
   * `generateSittings` calls `dayStart(commitment.from)`, which throws on a
   * string, so skipping this fails loudly — but it still fails, and neither
   * bound is a straight conversion:
   *
   *  - **`from`** is the later of the week's Monday and the term's start, so a
   *    commitment beginning mid-week does not place before it exists.
   *  - **`until` is EXCLUSIVE — the start of the day AFTER the last usable
   *    one.** `placeTask` clips every window to `end ≤ deadline`, so a deadline
   *    of Thursday 00:00 would make Wednesday the last usable day and quietly
   *    cost a day of runway every single week. `untilAfterLastRun` is the
   *    existing edge converter (sharp edge #11) and this is the case it was
   *    written for. The last usable day is `dueDay` if set, else Sunday, and
   *    never past the term's own end.
   *
   * Returns null when the week is outside the term, or when the term ends
   * before the week's due day leaves no day at all to work in.
   */
  engineInputForWeek(ws) {
    const start = weekStartOf(ws);
    if (!this.coversWeek(start)) return null;

    const termFrom = dateFromKey(this.from);
    const from = start.getTime() > termFrom.getTime() ? start : termFrom;

    const lastInWeek = addDays(start, this.dueDay ? DAY_KEYS.indexOf(this.dueDay) : 6);
    const termUntil = dateFromKey(this.until);
    const last = lastInWeek.getTime() < termUntil.getTime() ? lastInWeek : termUntil;
    if (last.getTime() < from.getTime()) return null; // the due day has gone

    return {
      id: this.id,
      title: this.title,
      tags: [...this.tags],
      amountMin: this.amountMinPerWeek,
      from,
      until: untilAfterLastRun(last),
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
      amountMinPerWeek: this.amountMinPerWeek,
      from: this.from,
      until: this.until,
      dueDay: this.dueDay,
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
