// recurrenceModel.js — translate the RecurrenceEditor's UI state into the
// engine's recurrence object (SPEC §4). Kept out of components so both Add and
// Edit paths build identical structures.

import { dateFromKey, weekStart } from '../core/index.js';

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
 */
export function buildRecurrence(model, anchor = new Date()) {
  if (!model.enabled || model.windows.length === 0) return null;
  const anchorDate = weekStart(anchor);
  const periods = [{
    windows: model.windows.map((w) => ({ ...w })),
    interval: Number(model.interval) || 1,
    effectiveFrom: null,
    effectiveUntil: null,
  }];
  if (model.temporary && model.temporary.from && model.temporary.until) {
    // A simple period sandwich: base pattern, then a bounded temp window.
    periods[0].effectiveUntil = dateFromKey(model.temporary.from);
    periods.push({
      windows: model.windows.map((w) => ({ ...w })),
      interval: Number(model.interval) || 1,
      effectiveFrom: dateFromKey(model.temporary.from),
      effectiveUntil: dateFromKey(model.temporary.until),
    });
  }
  return { periods, anchorDate, exceptions: [] };
}
