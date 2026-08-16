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
  monthsBetween,
  dayStart,
  weekStart as weekStartOf,
  jsDayOfKey,
  nthWeekdayDate,
  lastWeekdayDate,
  monthDayDate,
  monthsInWeek,
} from './time.js';

/** Is a period active on a given calendar date? */
export function periodActiveOn(period, date) {
  const t = dayStart(date).getTime();
  if (period.effectiveFrom && t < dayStart(period.effectiveFrom).getTime()) return false;
  if (period.effectiveUntil && t >= dayStart(period.effectiveUntil).getTime()) return false;
  return true;
}

/** A period's frequency. Absent means 'weekly', so every save written before
 *  P2 loads and expands exactly as it always did (sharp edge #15: new state is
 *  additive, schemaVersion stays 1). */
export function freqOf(period) {
  return period.freq || 'weekly';
}

/**
 * Interval parity: does this occurrence materialize? (4D)
 *
 * "Every Nth" counts in the period's own unit — weeks for a weekly pattern,
 * months for a monthly one, years for a yearly one — always measured from
 * `anchorDate`, so "every other week from the 15th" means the 15th and the 29th.
 */
function intervalMatches(recurrence, period, date) {
  const interval = period.interval ?? 1;
  if (interval <= 1) return true;
  const anchor = recurrence.anchorDate || date;
  const freq = freqOf(period);
  const n = freq === 'monthly' ? monthsBetween(anchor, date)
    : freq === 'yearly' ? date.getFullYear() - anchor.getFullYear()
      : weeksBetween(anchor, date);
  return ((n % interval) + interval) % interval === 0;
}

/**
 * The candidate dates a single window lands on inside the given week. Returns
 * [] when the month genuinely has no such day — the skip rule, not a clamp.
 *
 * A week can straddle two months (and two years), so monthly and yearly windows
 * are resolved against every month/year the week touches; `emit` then drops
 * anything outside the week. Checking only the week's own month is how a
 * straddled session silently disappears.
 */
function datesForWindow(freq, w, weekStartDate) {
  if (freq === 'weekly') {
    const dayIdx = DAY_KEYS.indexOf(w.day);
    return dayIdx < 0 ? [] : [addDays(weekStartDate, dayIdx)];
  }

  if (freq === 'monthly') {
    const out = [];
    for (const { y, m } of monthsInWeek(weekStartDate)) {
      let d = null;
      if (w.monthDay != null) {
        d = monthDayDate(y, m, w.monthDay);            // "the 15th" / "the last day"
      } else if (w.nth != null) {
        const wd = jsDayOfKey(w.day);
        if (wd >= 0) {
          d = w.nth === -1 ? lastWeekdayDate(y, m, wd) // "the last Tuesday"
            : nthWeekdayDate(y, m, wd, w.nth);         // "the third Tuesday"
        }
      }
      if (d) out.push(d);
    }
    return out;
  }

  if (freq === 'yearly') {
    const out = [];
    const seen = new Set();
    for (const { y } of monthsInWeek(weekStartDate)) {
      if (seen.has(y)) continue;
      seen.add(y);
      // month is 1-based in the stored window, 0-based in Date.
      const d = monthDayDate(y, (w.month ?? 1) - 1, w.monthDay ?? 1);
      if (d) out.push(d);
    }
    return out;
  }

  return [];
}

/**
 * The calendar date inside an occurrence key. A key is `YYYY-MM-DD` for the
 * first session of a day, `YYYY-MM-DD#2` for the second, `YYYY-MM-DD#add` for an
 * extra one — so anything that wants the DATE rather than the identity must
 * strip the suffix. Most callers use the key opaquely (as a lookup into
 * `occurrenceData`, or as an exception key) and must NOT use this.
 */
export function dateOfOccurrence(occurrenceKey) {
  return String(occurrenceKey || '').split('#')[0];
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

  // 1) Pattern occurrences on this week's own dates. The frequency decides only
  //    WHICH dates a window lands on; everything after that — periods,
  //    exceptions, identity, lived data — is frequency-independent.
  //
  //    A date may carry SEVERAL sessions ("meds at 08:00 and 20:00"), so each is
  //    numbered within its day: the first keeps the bare `YYYY-MM-DD` key and
  //    later ones get `#2`, `#3`. That keeps every existing save byte-identical
  //    — a once-a-day pattern is all first-sessions — while giving the second
  //    dose an identity of its own. Before this, both collided on
  //    `taskId@date` and `emit` dropped the evening one in silence.
  //
  //    The ordinal comes from the WINDOW's declared time, not from the final
  //    adjusted one, so moving a session to a new time does not renumber it and
  //    take its lived data with it (§4.4: one session = one identity).
  for (const period of rec.periods || []) {
    const freq = freqOf(period);
    const byDate = new Map();
    for (const w of period.windows || []) {
      for (const date of datesForWindow(freq, w, weekStartDate)) {
        const k = dateKey(date);
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k).push({ w, date });
      }
    }

    for (const [k, entries] of byDate) {
      entries.sort((a, b) => String(a.w.start).localeCompare(String(b.w.start)));
      entries.forEach(({ w, date }, i) => {
        if (!periodActiveOn(period, date)) return;
        // Parity is per-occurrence, so a monthly pattern counts months and a
        // weekly one counts weeks off the same anchor.
        if (!intervalMatches(rec, period, date)) return;
        const occKey = i === 0 ? k : `${k}#${i + 1}`;

        // Exceptions are matched on the SESSION's key, so "skip Wednesday" on a
        // once-daily pattern behaves exactly as it always did, and a twice-daily
        // one can skip just the evening via `date#2`.
        const ex = exceptions.find((e) => e.date === occKey);
        if (ex && ex.action === 'skip') return;
        // Relocated elsewhere → emitted by pass 2 against its host week.
        if (ex && ex.action === 'move' && ex.toDate && ex.toDate !== k) return;

        let start = atTime(date, w.start);
        let end = atTime(date, w.end);
        if (ex && ex.action === 'move') {
          if (ex.start) start = resolveTime(date, ex.start);
          if (ex.end) end = resolveTime(date, ex.end);
        }
        emit(occKey, start, end);
      });
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
      // An EXTRA session gets its own identity namespace (`date#add`) rather
      // than competing for the date's bare key. That is the fix for "one more
      // gym this week": adding a session on a day the pattern ALREADY fills
      // used to collide with the pattern occurrence and be dropped in silence —
      // on the likeliest day to want one. The namespace is separate rather than
      // "the next free ordinal" so the extra session's identity, and therefore
      // its lived data, cannot shift if a pattern window is later added or
      // removed from that day.
      const host = parseDateKey(ex.date);
      emit(`${ex.date}#add`, resolveTime(host, ex.start), resolveTime(host, ex.end));
    }
  }

  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

/**
 * One materialized session.
 *
 * Rebuilt field by field, which is a trap: anything on `Task` that matters to a
 * session must be listed HERE as well as in `toJSON`/the constructor, or it is
 * dropped in silence for recurring tasks only. `load` was lost exactly that way.
 *
 * Deliberately NOT carried: `deadline` (a pattern has no per-session due date)
 * and `schedulingInfo` (an engine verdict about a PLACEMENT — an occurrence is
 * generated, never placed, so the parent's verdict would be a lie about it).
 */
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
    // ⚠️ Carried, and it was not. `loadForTask`'s very first line prefers a
    // task's own `load` over its buckets, and this function rebuilds an
    // occurrence field by field — so every recurring session silently fell back
    // to the bucket and the battery read a fraction of the real drain. Probed:
    // the same task with an explicit override reported physical net=4 as a
    // one-off and net=1 as a recurrence.
    load: task.load ?? undefined,
    // The activity a session came from. Nothing reads it over occurrences today,
    // but a session that forgets where it came from cannot be learned from —
    // which is exactly the parked time-of-day preference (§7.1).
    activityId: task.activityId ?? null,
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
export function periodFor(recurrence, date) {
  if (!recurrence) return null;
  // LAST match wins. Periods are not stored chronologically (`temporaryChange`
  // pushes a reopened tail after the middle slice), so "the first one that
  // matches" is an accident of insertion order, not a decision.
  let found = null;
  for (const p of recurrence.periods || []) if (periodActiveOn(p, date)) found = p;
  return found;
}

/**
 * "From now on, the pattern is this" (4B).
 *
 * ⚠️ It SUPERSEDES, and that is the fix for a real bug. It used to close only
 * the period active at `from` and push a new one — so if a `temporaryChange`
 * sandwich had left a reopened tail further down the array, the schedule ended
 * up with TWO open-ended periods. `expandRecurrence` iterates periods in array
 * order and `emit` is first-wins on identity, so the STALE tail beat the new
 * period for ever: the user edited the pattern, was told "Pattern updated", and
 * every future session kept its old time. `modelFromTask` picked the same stale
 * tail, so the editor showed a third time that governed neither.
 *
 * Superseding is also what the words mean. If you say "from Tuesday on it is
 * 06:15", a temporary change you had queued for next month is not still owed to
 * you — it is part of the future you just overwrote.
 */
export function splitPeriod(task, fromDate, newWindows, opts = {}) {
  if (!task.recurrence) return;
  const from = dayStart(fromDate);
  const active = task.recurrence.periods.find((p) => periodActiveOn(p, from));
  // A new period inherits the old period's frequency unless told otherwise —
  // changing the times of a monthly pattern must not silently make it weekly.
  const freq = opts.freq || (active ? freqOf(active) : 'weekly');
  const interval = opts.interval ?? (active ? active.interval : 1);

  const kept = [];
  for (const p of task.recurrence.periods) {
    // Anything that would START at or after the split is entirely superseded.
    if (p.effectiveFrom && dayStart(p.effectiveFrom).getTime() >= from.getTime()) continue;
    // Anything still running at the split is closed there.
    if (!p.effectiveUntil || dayStart(p.effectiveUntil).getTime() > from.getTime()) {
      p.effectiveUntil = from;
    }
    kept.push(p);
  }
  task.recurrence.periods = kept;

  task.recurrence.periods.push({
    ...(freq !== 'weekly' ? { freq } : {}),
    windows: newWindows.map((w) => ({ ...w })),
    interval,
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
  const baseFreq = base ? freqOf(base) : 'weekly';
  const tempFreq = opts.freq || baseFreq;
  const originalUntil = base ? base.effectiveUntil : null; // capture BEFORE mutating
  // Close the base at `from`, add temp period, reopen base at `until`. The
  // reopened slice must carry the BASE frequency, not the temporary one — the
  // surrounding pattern is what resumes.
  if (base) base.effectiveUntil = from;
  task.recurrence.periods.push({
    ...(tempFreq !== 'weekly' ? { freq: tempFreq } : {}),
    windows: tempWindows.map((w) => ({ ...w })),
    interval,
    effectiveFrom: from,
    effectiveUntil: until,
  });
  task.recurrence.periods.push({
    ...(baseFreq !== 'weekly' ? { freq: baseFreq } : {}),
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

/**
 * Does a recurrence land on this calendar DATE? A date-level predicate for
 * things that are not tasks — a day note repeating every year, say.
 *
 * Built from the same `datesForWindow` / `periodActiveOn` / `intervalMatches`
 * internals `expandRecurrence` uses, deliberately: a second implementation of
 * "when does this pattern fire" would drift, and this codebase has the scars
 * (`format.js` grew a second ISO-week function and the two disagreed about the
 * year). Everything the pattern knows — the monthly skip rules, leap-year
 * February, interval parity — comes along for free.
 *
 * Exceptions are NOT consulted: they carry times, which a day-level thing has
 * none of.
 */
export function occursOn(recurrence, date) {
  if (!recurrence) return false;
  const ws = weekStartOf(date);
  const key = dateKey(date);
  for (const period of recurrence.periods || []) {
    const freq = freqOf(period);
    for (const w of period.windows || []) {
      for (const d of datesForWindow(freq, w, ws)) {
        if (dateKey(d) !== key) continue;
        if (!periodActiveOn(period, d)) continue;
        if (!intervalMatches(recurrence, period, d)) continue;
        return true;
      }
    }
  }
  return false;
}
