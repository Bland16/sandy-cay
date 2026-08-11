// time.js — local-time helpers. Minute precision, seconds & ms always zeroed.
// Everything in the engine routes date math through here so no stray seconds
// ever leak in (SPEC §1: "All date math local-time, minute precision, seconds
// zeroed").

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MS_PER_MIN = 60 * 1000;
export const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

/** Parse 'HH:MM' → { h, m }. */
export function parseHHMM(str) {
  const [h, m] = String(str).split(':').map((n) => parseInt(n, 10));
  return { h: h || 0, m: m || 0 };
}

/** Minutes-since-midnight for an 'HH:MM' string. */
export function hhmmToMinutes(str) {
  const { h, m } = parseHHMM(str);
  return h * 60 + m;
}

/** Format a Date as local 'HH:MM'. */
export function formatHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Return a copy of `date` with seconds & milliseconds set to 0. */
export function zeroSeconds(date) {
  const d = new Date(date.getTime());
  d.setSeconds(0, 0);
  return d;
}

/** Local midnight (00:00:00.000) of the given date's day. */
export function dayStart(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Add minutes; result is always seconds-zeroed. */
export function addMinutes(date, minutes) {
  return zeroSeconds(new Date(date.getTime() + minutes * MS_PER_MIN));
}

/** Add whole days preserving time-of-day (DST-safe via setDate). */
export function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return zeroSeconds(d);
}

/** Signed minute distance b − a. */
export function minutesBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_MIN);
}

/** Monday-based day index of a date: Mon=0 … Sun=6. */
export function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Day key ('mon'…'sun') for a date. */
export function dayKeyOf(date) {
  return DAY_KEYS[weekdayIndex(date)];
}

/** Monday 00:00 local of the week containing `date`. */
export function weekStart(date) {
  const d = dayStart(date);
  return addDays(d, -weekdayIndex(d));
}

/** True if a and b fall on the same local calendar day. */
export function sameDay(a, b) {
  return dayStart(a).getTime() === dayStart(b).getTime();
}

/** Whole weeks between two dates (by their week-starts). Signed. */
export function weeksBetween(a, b) {
  const wa = weekStart(a);
  const wb = weekStart(b);
  return Math.round((dayStart(wb).getTime() - dayStart(wa).getTime()) / (7 * MS_PER_DAY));
}

/** Whole days between two dates (by day-start). Signed. */
export function daysBetween(a, b) {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Monthly / yearly calendar maths (DATES-AND-RECURRENCE P2).
//
// The rule throughout: a month that does not HAVE the requested day is SKIPPED,
// never clamped. Clamping "the 31st" to the 30th invents a session on a date the
// person never chose, and RFC 5545 skips too. "Last day" / "last weekday" are
// separate, always-fire options precisely because of this.
// ---------------------------------------------------------------------------

/** Days in a month. `m` is 0-based, as `Date` uses. */
export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

/** Whole calendar months between two dates. Signed. The monthly sibling of
 *  `weeksBetween`, for "every Nth month" parity against `anchorDate`. */
export function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** JS weekday (Sun=0) for a Monday-based day key ('mon'…'sun'). */
export function jsDayOfKey(key) {
  const idx = DAY_KEYS.indexOf(key);
  return idx < 0 ? -1 : (idx + 1) % 7;
}

/** Which occurrence of its own weekday a date is within its month: 1…5.
 *  1 Oct 2026 is a Thursday and the FIRST one — the classic off-by-one is to
 *  assume a month can't start on the target weekday. */
export function nthWeekdayOfMonth(date) {
  return Math.ceil(date.getDate() / 7);
}

/** Is this the last such weekday in its month? (So "last Tuesday" can be
 *  offered only when the chosen date genuinely is one.) */
export function isLastWeekdayOfMonth(date) {
  return date.getDate() + 7 > daysInMonth(date.getFullYear(), date.getMonth());
}

/** The nth (1…5) `wd` (JS Sun=0) of a month, or **null** when that month has no
 *  such day — a fifth Friday only exists in some months. */
export function nthWeekdayDate(y, m, wd, nth) {
  const offset = (wd - new Date(y, m, 1).getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return day <= daysInMonth(y, m) ? new Date(y, m, day, 0, 0, 0, 0) : null;
}

/** The last `wd` of a month. Always exists. */
export function lastWeekdayDate(y, m, wd) {
  const last = new Date(y, m, daysInMonth(y, m));
  return new Date(y, m, last.getDate() - ((last.getDay() - wd + 7) % 7), 0, 0, 0, 0);
}

/** The date of `monthDay` in a month, or null if absent. `-1` = the last day. */
export function monthDayDate(y, m, monthDay) {
  const dim = daysInMonth(y, m);
  if (monthDay === -1) return new Date(y, m, dim, 0, 0, 0, 0);
  return monthDay >= 1 && monthDay <= dim ? new Date(y, m, monthDay, 0, 0, 0, 0) : null;
}

/** The {y, m} pairs a Mon–Sun week touches — one, or two when it straddles a
 *  month boundary. A monthly pattern must be checked against both, or the
 *  session in the straddled month silently disappears. */
export function monthsInWeek(weekStartDate) {
  const a = dayStart(weekStartDate);
  const b = addDays(a, 6);
  const out = [{ y: a.getFullYear(), m: a.getMonth() }];
  if (a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear()) {
    out.push({ y: b.getFullYear(), m: b.getMonth() });
  }
  return out;
}

/** 'YYYY-MM-DD' local date key. */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse 'YYYY-MM-DD' → local Date at 00:00. */
export function dateFromKey(key) {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Combine a day (Date) with an 'HH:MM' string → seconds-zeroed Date. */
export function atTime(day, hhmm) {
  const { h, m } = parseHHMM(hhmm);
  const d = new Date(day.getTime());
  d.setHours(h, m, 0, 0);
  return d;
}

/* ---- inclusive edges over a half-open core -------------------------------
 * Internally every range is half-open: `effectiveFrom` is inclusive and
 * `effectiveUntil` is EXCLUSIVE. That is not a whim — `splitPeriod` ends the old
 * period exactly where the new one begins (`until === from`), so periods tile
 * with no gap and no overlap. Make the core inclusive and every seam grows a
 * ±1-day fudge.
 *
 * Humans and other calendars mean the opposite. "My summer job ends Friday the
 * 24th" means the 24th is the last day worked, and RFC 5545's RRULE UNTIL is
 * inclusive too. So the boundary converts, in exactly one place: these two.
 * Every edge — the recurrence editor, the zone editor, .ics import/export —
 * goes through them, so the app can never disagree with itself by a day.
 */

/** Half-open bound → the last day it actually runs. null means "runs forever". */
export function lastRunDay(until) {
  return until ? addDays(dayStart(until), -1) : null;
}

/** The last day it runs → the half-open bound the engine wants. */
export function untilAfterLastRun(lastDay) {
  return lastDay ? addDays(dayStart(lastDay), 1) : null;
}

/**
 * ISO-8601 week number → { year, week }. The year is the ISO week-numbering
 * year, which is NOT always the calendar year: 2027-01-01 is a Friday, so it
 * belongs to 2026-W53 — as does the Monday before it, 2026-12-28, because they
 * are the same ISO week. Going the other way, 2024-12-30 is a Monday already in
 * 2025-W01. The Wrap report's filename sorts chronologically only if we honour
 * that.
 *
 * (The old comment gave 2026-12-28 as an example of a date in 2027-W01. It
 * isn't — it's in 2026-W53, one week earlier, so the example contradicted
 * itself. Verified against this function, which was right all along.)
 *
 * Method: the Thursday of a week always falls in that week's ISO year, so we
 * count weeks from the Thursday of the target week back to Jan 1 of that
 * Thursday's year.
 */
export function isoWeek(date) {
  const thursday = addDays(weekStart(date), 3);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1, 0, 0, 0, 0);
  const week = Math.floor(daysBetween(jan1, thursday) / 7) + 1;
  return { year, week };
}

/** ISO week stamp 'YYYY-Www' — the Wrap report's filename stem (SPEC §7.1). */
export function isoWeekKey(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Serialize a Date | null to an ISO-ish local marker for JSON round-trips. */
export function dateToJSON(date) {
  return date ? date.getTime() : null;
}

/** Revive a JSON date (epoch ms or ISO string) → seconds-zeroed Date | null. */
export function dateFromJSON(val) {
  if (val === null || val === undefined) return null;
  return zeroSeconds(new Date(val));
}

/** Clamp helper used across scoring. */
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
