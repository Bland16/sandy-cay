// format.js — pure presentation helpers (no engine mutation). Time math for
// display only; the engine remains the source of truth for scheduling.

import { formatHHMM, weekStart, addDays } from '../core/index.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human duration: 90 → "1h 30m", 60 → "1h", 45 → "45m". */
export function fmtDur(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return `${h}h ${mm}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** 12-hour clock label matching the mockup's time axis ("8a", "1p"). */
/** Grid rows run past 24 (the 5am-anchored day), so 26 must read "2a", not "2p". */
export function hourLabel(h) {
  const hh = ((h % 24) + 24) % 24;
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}${hh >= 12 ? 'p' : 'a'}`;
}

export function fmtTime(date) {
  return formatHHMM(date);
}

/** "9:00–10:30" for a task's own span. */
export function fmtRange(task) {
  return `${fmtTime(task.startTime)}–${fmtTime(task.endTime)}`;
}

/** "July 13 – 19" week-range sign, plus the "2026 · wk NN" sub-line. */
export function weekSign(ws) {
  const start = weekStart(ws);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const left = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const right = sameMonth ? `${end.getDate()}` : `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return { range: `${left} – ${right}`, sub: `${start.getFullYear()} · wk ${isoWeek(start)}` };
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = d - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

/** Hour in decimal (9:30 → 9.5) for grid positioning. */
export function decimalHour(date) {
  return date.getHours() + date.getMinutes() / 60;
}

/** The grid is a full 24 hours (SPEC §2.1, §11: "the grid is 24h and users may
 *  drag anywhere"). config.windows bound AUTOMATIC placement only, so hours
 *  outside them still exist as drop targets — shaded, not missing (windowForDay).
 *
 *  The day is anchored at 05:00 rather than midnight: it runs 05:00 → 05:00, so
 *  a 02:00 task belongs to the night it actually belongs to (the previous
 *  column, row 26) instead of jumping to the next day. Rows therefore run
 *  5 → 29, and hour 26 means 02:00 tomorrow. */
export const DAY_START_HOUR = 5;
export function gridBounds() {
  return { start: DAY_START_HOUR, end: DAY_START_HOUR + 24 }; // 5 → 29
}

/** Decimal hour on the 5am-anchored grid: 02:00 → 26, 09:30 → 9.5. */
export function gridHour(date) {
  const h = decimalHour(date);
  return h < DAY_START_HOUR ? h + 24 : h;
}

/** The calendar day whose 05:00→05:00 window contains `date`. A 02:00 Tuesday
 *  task belongs to Monday's column. */
export function gridDayOf(date) {
  const d = new Date(date.getTime());
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The auto-placement window for a day key (§2.1) — the hours outside it are
 *  shaded: the scheduler won't place there, but you may drag there. */
export function windowForDay(config, dayKey) {
  if (dayKey === 'sat') return config.windows.sat;
  if (dayKey === 'sun') return config.windows.sun;
  return config.windows.monFri;
}

/** A recurring occurrence card carries id "parent@YYYY-MM-DD". */
export function isOccurrence(task) {
  return task.isOccurrence === true;
}

/** Percentage helper for load meters. */
export function pct(ratio) {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
