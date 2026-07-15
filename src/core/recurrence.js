// recurrence.js — materialize virtual occurrences at read time (SPEC §4, OD-12).
// Occurrences have id `taskId@YYYY-MM-DD`, behave as fixed anchors, and carry
// per-occurrence lived data from the parent's occurrenceData map. Editing an
// occurrence writes exceptions/occurrenceData — never the pattern.

import { Task } from './Task.js';
import {
  DAY_KEYS,
  addDays,
  atTime,
  dateKey,
  weeksBetween,
  dayStart,
} from './time.js';

/** Is a period active on a given calendar date? */
function periodActiveOn(period, date) {
  const t = dayStart(date).getTime();
  if (period.effectiveFrom && t < dayStart(period.effectiveFrom).getTime()) return false;
  if (period.effectiveUntil && t >= dayStart(period.effectiveUntil).getTime()) return false;
  return true;
}

/** Interval parity: does this week materialize for the period? (4D) */
function intervalMatches(recurrence, period, weekStartDate) {
  const interval = period.interval ?? 1;
  if (interval <= 1) return true;
  const anchor = recurrence.anchorDate || weekStartDate;
  return ((weeksBetween(anchor, weekStartDate) % interval) + interval) % interval === 0;
}

/** 'YYYY-MM-DD' → local Date at 00:00. */
function parseDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Expand a recurring task into virtual occurrences for the week beginning
 * weekStartDate (a Monday 00:00).
 *
 * Exceptions can do three things to a date (§4.2, extended):
 *   skip                        — no occurrence
 *   move {start,end}            — same date, new times
 *   move {toDate,start,end}     — that session happens on another date instead
 *   add  {start,end}            — an EXTRA session the pattern doesn't have
 *
 * A relocated or added session keeps the identity `taskId@originalDate`, so its
 * lived data and ML history follow it (§4.4: one task = one identity).
 * @returns Task[]
 */
export function expandRecurrence(task, weekStartDate) {
  if (!task.recurrence) return [];
  const rec = task.recurrence;
  const exceptions = rec.exceptions || [];
  const out = [];
  const seen = new Set();
  const weekFrom = dayStart(weekStartDate).getTime();
  const weekTo = addDays(dayStart(weekStartDate), 7).getTime();
  const inWeek = (d) => d.getTime() >= weekFrom && d.getTime() < weekTo;

  const emit = (key, start, end) => {
    const identity = `${task.id}@${key}`;
    if (seen.has(identity)) return;
    if (!inWeek(start)) return;
    seen.add(identity);

    const od = (task.occurrenceData && task.occurrenceData[key]) || {};
    out.push(buildOccurrence(task, identity, key, start, end, od));
  };

  // 1) Pattern occurrences on this week's own dates.
  for (const period of rec.periods || []) {
    if (!intervalMatches(rec, period, weekStartDate)) continue;
    for (const w of period.windows || []) {
      const dayIdx = DAY_KEYS.indexOf(w.day);
      if (dayIdx < 0) continue;
      const date = addDays(weekStartDate, dayIdx);
      if (!periodActiveOn(period, date)) continue;
      const key = dateKey(date);

      const ex = exceptions.find((e) => e.date === key);
      if (ex && ex.action === 'skip') continue;
      // Relocated elsewhere → emitted by pass 2 against its host week.
      if (ex && ex.action === 'move' && ex.toDate && ex.toDate !== key) continue;

      let start = atTime(date, w.start);
      let end = atTime(date, w.end);
      if (ex && ex.action === 'move') {
        if (ex.start) start = resolveTime(date, ex.start);
        if (ex.end) end = resolveTime(date, ex.end);
      }
      emit(key, start, end);
    }
  }

  // 2) Sessions relocated INTO this week, and extra one-off sessions. These are
  //    driven off the exception list, not the pattern, so a session can move to
  //    any date — including across a week boundary.
  for (const ex of exceptions) {
    if (ex.action === 'move' && ex.toDate && ex.toDate !== ex.date) {
      const host = parseDateKey(ex.toDate);
      if (!ex.start || !ex.end) continue; // a relocation always carries its times
      emit(ex.date, resolveTime(host, ex.start), resolveTime(host, ex.end));
    } else if (ex.action === 'add' && ex.start && ex.end) {
      const host = parseDateKey(ex.date);
      emit(ex.date, resolveTime(host, ex.start), resolveTime(host, ex.end));
    }
  }

  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

function buildOccurrence(task, identity, key, start, end, od) {
  return new Task({
    id: identity,
    title: task.title,
    details: task.details,
    tags: [...task.tags],
    type: 'fixed', // occurrences behave as fixed anchors
    pinned: task.pinned,
    priority: task.priority,
    startTime: start,
    endTime: end,
    deadline: null,
    placedBy: 'auto',
    completion: od.completion ?? null,
    satisfaction: od.satisfaction ?? null,
    history: od.history ?? undefined,
    isOccurrence: true,
    occurrenceDate: key,
    parentId: task.id,
  });
}

function resolveTime(date, val) {
  if (val instanceof Date) return atTime(date, `${String(val.getHours()).padStart(2, '0')}:${String(val.getMinutes()).padStart(2, '0')}`);
  if (typeof val === 'number') return new Date(val);
  return atTime(date, val); // 'HH:MM'
}

/**
 * Add / replace an exception on a task's pattern (§4.2).
 *   'skip'                      — this session doesn't happen
 *   'move' {start,end}          — same date, new times
 *   'move' {toDate,start,end}   — this session happens on another date instead
 *   'add'  {start,end}          — an extra session the pattern doesn't have
 * Exceptions are keyed by the ORIGINAL date, so a relocated session keeps its
 * identity and lived data (§4.4).
 */
export function addException(task, dateKeyStr, action, times = {}) {
  if (!task.recurrence) return;
  task.recurrence.exceptions = task.recurrence.exceptions.filter((e) => e.date !== dateKeyStr);
  const ex = { date: dateKeyStr, action };
  if (times.start) ex.start = times.start;
  if (times.end) ex.end = times.end;
  if (times.toDate) ex.toDate = times.toDate;
  task.recurrence.exceptions.push(ex);
}

/** Period split for a permanent change "from now on" (4B). Closes the active
 *  period at `fromDate` and opens a new one with the new windows. */
export function splitPeriod(task, fromDate, newWindows, opts = {}) {
  if (!task.recurrence) return;
  const from = dayStart(fromDate);
  const active = task.recurrence.periods.find((p) => periodActiveOn(p, from));
  if (active) active.effectiveUntil = from;
  task.recurrence.periods.push({
    windows: newWindows.map((w) => ({ ...w })),
    interval: opts.interval ?? (active ? active.interval : 1),
    effectiveFrom: from,
    effectiveUntil: opts.effectiveUntil ? dayStart(opts.effectiveUntil) : null,
  });
}

/** Temporary change "from … until …" — builds a bounded period sandwich (4E).
 *  Inserts a middle period with new windows between from and until, leaving the
 *  surrounding pattern intact. */
export function temporaryChange(task, fromDate, untilDate, tempWindows, opts = {}) {
  if (!task.recurrence) return;
  const from = dayStart(fromDate);
  const until = dayStart(untilDate);
  const base = task.recurrence.periods.find((p) => periodActiveOn(p, from)) || task.recurrence.periods[0];
  const interval = opts.interval ?? (base ? base.interval : 1);
  const baseWindows = base ? base.windows.map((w) => ({ ...w })) : [];
  const originalUntil = base ? base.effectiveUntil : null; // capture BEFORE mutating
  // Close the base at `from`, add temp period, reopen base at `until`.
  if (base) base.effectiveUntil = from;
  task.recurrence.periods.push({
    windows: tempWindows.map((w) => ({ ...w })),
    interval,
    effectiveFrom: from,
    effectiveUntil: until,
  });
  task.recurrence.periods.push({
    windows: baseWindows,
    interval,
    effectiveFrom: until,
    effectiveUntil: originalUntil,
  });
}

/** End the recurrence cleanly (this-and-future delete / let-it-go): sets
 *  effectiveUntil on the active period (SPEC §3.10, 6L). */
export function endRecurrence(task, atDate) {
  if (!task.recurrence) return;
  const at = dayStart(atDate);
  for (const p of task.recurrence.periods) {
    if (periodActiveOn(p, at)) p.effectiveUntil = at;
  }
}
