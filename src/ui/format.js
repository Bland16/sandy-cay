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
export function hourLabel(h) {
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}${h >= 12 ? 'p' : 'a'}`;
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

/** Grid vertical bounds derived from a week's tasks (keeps cards on-grid; the
 *  requirement: short events still legible, nothing clipped off the top/bottom).
 *  Defaults to the 8–18 working window and widens to fit outliers. */
export function gridBounds(tasks) {
  let lo = 8;
  let hi = 18;
  for (const t of tasks) {
    lo = Math.min(lo, Math.floor(decimalHour(t.startTime)));
    hi = Math.max(hi, Math.ceil(decimalHour(t.endTime)));
  }
  return { start: Math.max(0, lo), end: Math.min(24, Math.max(hi, lo + 4)) };
}

/** A recurring occurrence card carries id "parent@YYYY-MM-DD". */
export function isOccurrence(task) {
  return task.isOccurrence === true;
}

/** Percentage helper for load meters. */
export function pct(ratio) {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
