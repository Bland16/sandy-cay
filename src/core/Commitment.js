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

/** Like `posInt` but ZERO is a real answer, not an absent one.
 *
 *  ⚠️ `posInt`'s fallback treats 0 as missing, so a commitment set to zero
 *  hours a week silently became 120 minutes and reported "120/120m short 0m" —
 *  the model booking two hours of someone's week that they had explicitly set
 *  to none. Reachable by import today; the editor's own minimum is 0.25h. */
const nonNegInt = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export class Commitment {
  constructor(data = {}) {
    this.title = data.title ?? 'New commitment';
    this.id = data.id || slug(this.title) + '-commit';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];

    // HOURS is the unit the user types (PLAN D-1, resolved 2026-08-12) and
    // MINUTES is the unit stored, because minutes are what every other duration
    // in the engine is. The editor converts; nothing downstream has to know.
    this.amountMinPerWeek = nonNegInt(data.amountMinPerWeek, 120);

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
    // ⚠️ `minSitting` is stored EXACTLY AS TYPED and never clamped here.
    //
    // A minimum above the weekly amount is incoherent — the engine resolves it
    // by rounding the AMOUNT up (`chooseSittings`' single-sitting branch takes
    // `max(amountMin, sMin)`), booking a 60m block for a 30m job and breaking
    // §4.3's `placed + shortfall === amount`. The first fix clamped the stored
    // field, and that DESTROYED the setting permanently: the editor patches per
    // keystroke, so typing "0.5" into hours/week on the way to "5" rebuilt the
    // commitment at 30m and rewrote minSitting 45 → 30, and correcting the
    // hours back left it at 30 for ever.
    //
    //     stored              amt=120 min=45
    //     typed 0.5 hours     amt=30  min=30
    //     corrected to 2h     amt=120 min=30   ← 45 is gone
    //
    // So the cap is a VIEW (`effectiveMinSitting()`), applied where the engine
    // reads it. Same lesson as the date swap on an edit: never silently
    // overwrite a field the user set.
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
   * The minimum sitting the ENGINE should use — the stored value, capped at the
   * weekly amount.
   *
   * A minimum above the amount is incoherent, and the engine resolves it by
   * rounding the AMOUNT up (`chooseSittings`' single-sitting branch takes
   * `max(amountMin, sMin)`), which books a 60m block for a 30m job and breaks
   * §4.3's `placed + shortfall === amount`. So it is capped here — as a VIEW.
   * Clamping the stored field instead destroyed it permanently, because the
   * editor patches per keystroke and every intermediate value rewrote it.
   */
  effectiveMinSitting() {
    return Math.min(this.minSitting, this.amountMinPerWeek);
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
   * Returns null when there is nothing to offer: the week is outside the term,
   * the term ends before the week begins, or — with `now` supplied — THE LAST
   * USABLE DAY HAS ALREADY PASSED.
   *
   * ⚠️ That last one is a defect found by `design/probes/probe-mixed-terms.mjs`
   * and it is not cosmetic. A commitment due Thursday, asked on Friday, used to
   * return a window of Mon→Thu; `generateSittings` then floors its search at
   * `now`, finds no legal day, places nothing and reports the WHOLE amount as a
   * shortfall. So the preview promised "owes 3h" for work that could no longer
   * be done, and pressing the button manufactured a 3h shortfall out of the
   * passage of time. §4.3 says a shortfall is a fact that gets stated once,
   * D-3 says it must never grow because time passed, and §5 forbids "you missed
   * your target" outright. A week you can no longer act on owes nothing.
   *
   * `now` is INJECTED (sharp edge #8 — the engine must never read the clock)
   * and optional, because the pure date arithmetic is useful without it.
   */
  engineInputForWeek(ws, now = null) {
    const start = weekStartOf(ws);
    if (!this.coversWeek(start)) return null;

    const termFrom = dateFromKey(this.from);
    const from = start.getTime() > termFrom.getTime() ? start : termFrom;

    const lastInWeek = addDays(start, this.dueDay ? DAY_KEYS.indexOf(this.dueDay) : 6);
    const termUntil = dateFromKey(this.until);
    const last = lastInWeek.getTime() < termUntil.getTime() ? lastInWeek : termUntil;
    if (last.getTime() < from.getTime()) return null; // the term ended first
    // Compared by DAY KEY, so the due day itself still counts: asked ON
    // Thursday there are hours left, asked on Friday there are not.
    if (now && dateKey(last) < dateKey(now)) return null;

    return {
      id: this.id,
      title: this.title,
      tags: [...this.tags],
      amountMin: this.amountMinPerWeek,
      from,
      until: untilAfterLastRun(last),
      minSitting: this.effectiveMinSitting(),
      maxSitting: Math.max(this.maxSitting, this.effectiveMinSitting()),
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
