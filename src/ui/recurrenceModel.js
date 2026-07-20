// recurrenceModel.js — translate the RecurrenceEditor's UI state into the
// engine's recurrence object (SPEC §4). Kept out of components so both Add and
// Edit paths build identical structures.

import { dateFromKey, weekStart, untilAfterLastRun } from '../core/index.js';

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

/**
 * Is this pattern exactly "every weekday at one time"? Derived from the windows
 * rather than stored as a flag, so the "every weekday" option in the editor is a
 * readback as well as a preset: change Tuesday to 13:00 and the pattern honestly
 * stops describing itself that way, with nothing to keep in sync.
 */
export function isWeekdayPattern(windows) {
  if (!windows || windows.length !== WEEKDAY_KEYS.length) return false;
  const days = windows.map((w) => w.day);
  if (!WEEKDAY_KEYS.every((d) => days.includes(d))) return false;
  return windows.every((w) => w.start === windows[0].start && w.end === windows[0].end);
}

/**
 * Mon–Fri at a single time, keeping whatever time is already on the first row —
 * "lunch every weekday at noon" is one choice, not five rows retyped.
 */
export function toWeekdayWindows(windows) {
  const t = (windows && windows[0]) || { start: '09:00', end: '10:00' };
  return WEEKDAY_KEYS.map((day) => ({ day, start: t.start, end: t.end }));
}

/** A fresh, empty editor model. */
export function emptyRecurrence() {
  return {
    enabled: false,
    windows: [{ day: 'mon', start: '09:00', end: '10:00' }],
    interval: 1,
    scope: 'future', // 'future' = from now on · 'all' = including past
    temporary: null, // null | { from: 'YYYY-MM-DD', until: 'YYYY-MM-DD' }
  };
}

/** Derive an editor model from an existing task's recurrence (for the edit panel). */
export function modelFromTask(task) {
  if (!task.recurrence) return emptyRecurrence();
  const rec = task.recurrence;
  const active = rec.periods.find((p) => !p.effectiveUntil) || rec.periods[0] || {};
  return {
    enabled: true,
    windows: (active.windows || []).map((w) => ({ ...w })),
    interval: active.interval ?? 1,
    scope: 'future',
    temporary: null,
  };
}

/**
 * Build the engine `recurrence` object for a NEW task, or the base pattern used
 * when enabling recurrence on an existing one.
 *
 * ONE period, always bounded at the start. It used to emit `effectiveFrom: null`
 * — a pattern active since the dawn of time — so lunch added this week appeared
 * every weekday of every week already gone. `periodActiveOn` treats a null
 * `effectiveFrom` as "no lower bound", and a routine you invented on Wednesday
 * was never true in March.
 *
 * It also used to build a period "sandwich" for a temporary run: a base period
 * from forever until `from`, then a bounded period with THE SAME windows. That
 * is the 4E shape for changing an EXISTING routine, and it is meaningless for a
 * new one — there is no surrounding pattern to sandwich into, so all it did was
 * re-open the unbounded past. A new task's "from…until" is simply when it runs.
 * (Editing a live pattern still goes through the engine's `temporaryChange`,
 * which builds the real sandwich — see TaskPanel.)
 *
 * The MODEL's dates are inclusive — `temporary.until` is the last day it runs,
 * because that is what a person means. The engine is half-open, so the bound is
 * converted here via `untilAfterLastRun` (see time.js). Edges convert; the core
 * does not.
 */
export function buildRecurrence(model, anchor = new Date()) {
  if (!model.enabled || model.windows.length === 0) return null;
  const temp = model.temporary;
  // Default start: the week you're adding it in. You can't attend a lunch that
  // hadn't been invented yet.
  const effectiveFrom = temp && temp.from ? dateFromKey(temp.from) : weekStart(anchor);
  const effectiveUntil = temp && temp.until ? untilAfterLastRun(dateFromKey(temp.until)) : null;
  return {
    periods: [{
      windows: model.windows.map((w) => ({ ...w })),
      interval: Number(model.interval) || 1,
      effectiveFrom,
      effectiveUntil,
    }],
    // Parity for "every Nth week" counts from where the pattern STARTS, so
    // "every 2nd week from the 13th" means the 13th, the 27th, and so on.
    anchorDate: weekStart(effectiveFrom),
    exceptions: [],
  };
}
