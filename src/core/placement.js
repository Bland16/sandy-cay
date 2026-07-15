// placement.js — pure placement geometry + the scored best-slot search used by
// autoSchedule, displacement, evacuation, ripple overflow, backfill and
// carryOver. Constraint precedence: deadline > zone > general windows
// (SPEC §2.2). Zone relaxation and parking implemented in placeTask().

import {
  atTime,
  dayStart,
  addDays,
  addMinutes,
  minutesBetween,
  weekdayIndex,
  dayKeyOf,
  clamp,
} from './time.js';
import { walkGaps, breakMinForFill } from './gaps.js';
import { score } from './scoring.js';

/** Config window bounds for a calendar day. */
export function dayWindowBounds(config, date) {
  const idx = weekdayIndex(date); // Mon=0 … Sun=6
  let win;
  if (idx <= 4) win = config.windows.monFri;
  else if (idx === 5) win = config.windows.sat;
  else win = config.windows.sun;
  return {
    start: atTime(dayStart(date), win.start),
    end: atTime(dayStart(date), win.end),
    maxTasks: win.maxTasks ?? Infinity,
    lightDay: !!win.lightDay,
  };
}

export function dayCapacityMin(config, date) {
  const b = dayWindowBounds(config, date);
  return Math.max(0, minutesBetween(b.start, b.end));
}

/** Subtract holes from base intervals. Returns Date intervals. */
export function subtractIntervals(base, holes) {
  let out = base.map((iv) => ({ start: iv.start, end: iv.end }));
  for (const hole of holes) {
    const next = [];
    for (const iv of out) {
      if (hole.end <= iv.start || hole.start >= iv.end) {
        next.push(iv);
        continue;
      }
      if (hole.start > iv.start) next.push({ start: iv.start, end: new Date(Math.min(hole.start.getTime(), iv.end.getTime())) });
      if (hole.end < iv.end) next.push({ start: new Date(Math.max(hole.end.getTime(), iv.start.getTime())), end: iv.end });
    }
    out = next.filter((iv) => iv.end.getTime() > iv.start.getTime());
  }
  return out;
}

/** Merge/union Date intervals. */
export function unionIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

function zoneIntervalsOnDay(zone, date) {
  const key = dayKeyOf(date);
  return zone.windowsForDay(key).map((w) => ({ start: atTime(dayStart(date), w.start), end: atTime(dayStart(date), w.end) }));
}

/**
 * Allowed placement windows for a task on a given day.
 *  - task matches ≥1 zone → union of those zones' windows (∩ base).
 *  - else → base minus exclusive zones' windows.
 *  - deadline clips every window to end ≤ deadline.
 */
export function computeWindows(schedule, task, date, { ignoreZone = false } = {}) {
  const b = dayWindowBounds(schedule.config, date);
  const base = [{ start: b.start, end: b.end }];
  let windows;
  const matching = ignoreZone ? [] : schedule.zones.filter((z) => z.matches(task));
  if (matching.length > 0) {
    const zoneIvs = matching.flatMap((z) => zoneIntervalsOnDay(z, date));
    // intersect with base
    const clipped = [];
    for (const iv of zoneIvs) {
      const s = new Date(Math.max(iv.start.getTime(), b.start.getTime()));
      const e = new Date(Math.min(iv.end.getTime(), b.end.getTime()));
      if (e > s) clipped.push({ start: s, end: e });
    }
    windows = unionIntervals(clipped);
  } else {
    const exclusiveHoles = ignoreZone
      ? []
      : schedule.zones.filter((z) => z.exclusive).flatMap((z) => zoneIntervalsOnDay(z, date));
    windows = subtractIntervals(base, exclusiveHoles);
  }
  if (task.deadline) {
    windows = windows
      .map((iv) => ({ start: iv.start, end: new Date(Math.min(iv.end.getTime(), task.deadline.getTime())) }))
      .filter((iv) => iv.end.getTime() > iv.start.getTime());
  }
  return windows;
}

/** Occupied minutes overlapping a day's window (for fill ratio). */
export function occupiedMinutesOnDay(occupied, config, date) {
  const b = dayWindowBounds(config, date);
  let total = 0;
  for (const iv of occupied) {
    const s = Math.max(iv.start.getTime(), b.start.getTime());
    const e = Math.min(iv.end.getTime(), b.end.getTime());
    if (e > s) total += Math.round((e - s) / 60000);
  }
  return total;
}

export function intervalsOf(tasks) {
  return tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
}

/**
 * Scored search for the best slot for `task` in [from, to].
 * @returns { slot:{start,end}, score, day } | null
 */
export function findBestSlot(schedule, task, opts = {}) {
  const config = schedule.config;
  const durationMin = task.getDuration() || config.defaultDuration;
  const from = opts.from ? new Date(opts.from) : new Date();
  const to = opts.to ? new Date(opts.to) : addDays(from, config.maxPlacementLookahead);
  const origin = opts.origin || task.startTime;
  const occupied = opts.occupied || [];
  const ignoreZone = !!opts.ignoreZone;
  const ignoreBreaks = !!opts.ignoreBreaks;
  const lookaheadHorizonMin = config.maxPlacementLookahead * 24 * 60;
  const weights = schedule._weights();

  let best = null;
  const lastDay = dayStart(to);
  for (let d = dayStart(from); d.getTime() <= lastDay.getTime(); d = addDays(d, 1)) {
    const windows = computeWindows(schedule, task, d, { ignoreZone });
    if (windows.length === 0) continue;
    const capacity = dayCapacityMin(config, d) || 1;
    const dayOccupied = occupied.filter((iv) => iv.end > dayWindowBounds(config, d).start && iv.start < dayWindowBounds(config, d).end);
    const occMin = occupiedMinutesOnDay(dayOccupied, config, d);
    const fill = clamp(occMin / capacity, 0, 1);
    const breakMin = ignoreBreaks ? 0 : breakMinForFill(fill, config);

    for (const win of windows) {
      // Clamp the window start to the search lower bound (forward-only / now).
      let wStart = win.start;
      if (from.getTime() > wStart.getTime() && from.getTime() < win.end.getTime()) wStart = new Date(from.getTime());
      if (wStart.getTime() >= win.end.getTime()) continue;
      const cands = walkGaps({ windowStart: wStart, windowEnd: win.end, occupied: dayOccupied, durationMin, breakMin });
      for (const slot of cands) {
        if (task.deadline && slot.end.getTime() > task.deadline.getTime()) continue;
        const dayFillAfter = clamp((occMin + durationMin) / capacity, 0, 1);
        const stability = task.placedBy === 'user' && slot.start.getTime() === task.startTime.getTime() ? 1 : 0;
        const ms = schedule._modelScore(task, slot);
        const s = score({
          slotStart: slot.start,
          origin,
          lookaheadHorizonMin,
          dayFillAfter,
          stability,
          modelScore: ms,
          weights,
        });
        if (
          !best ||
          s > best.score + 1e-9 ||
          (Math.abs(s - best.score) <= 1e-9 && slot.start.getTime() < best.slot.start.getTime())
        ) {
          best = { slot, score: s, day: new Date(d.getTime()) };
        }
      }
    }
  }
  return best;
}

/**
 * Place `task` honouring deadline > zone > windows, with relaxation + parking
 * (SPEC §2.2). Mutates the task's position and its warning/info flags.
 * @returns { placed, slot, outsideZone, warning }
 */
export function placeTask(schedule, task, opts = {}) {
  const config = schedule.config;
  const matchesZone = schedule.zones.some((z) => z.matches(task));
  // Deadline caps the search end.
  const searchOpts = { ...opts };
  if (task.deadline) {
    const cap = task.deadline;
    if (!searchOpts.to || new Date(searchOpts.to).getTime() > cap.getTime()) searchOpts.to = cap;
  }

  // 1) honour zone.
  let best = findBestSlot(schedule, task, searchOpts);
  let outsideZone = false;

  // 2) zone relaxation — no pre-deadline zone capacity → general windows.
  if (!best && matchesZone) {
    best = findBestSlot(schedule, task, { ...searchOpts, ignoreZone: true });
    if (best) outsideZone = true;
  }

  // 3) park: no capacity anywhere pre-deadline → violate break padding.
  let warning = false;
  if (!best) {
    best = findBestSlot(schedule, task, { ...searchOpts, ignoreZone: true, ignoreBreaks: true });
    if (best) {
      warning = true;
      if (matchesZone) outsideZone = true;
    }
  }

  // 4) still nothing (e.g. deadline already impossible) → park at earliest
  //    pre-deadline window start; last resort keeps the task visible.
  if (!best) {
    const from = searchOpts.from ? new Date(searchOpts.from) : new Date();
    const windows = computeWindows(schedule, task, from, { ignoreZone: true });
    const start = windows[0] ? windows[0].start : dayWindowBounds(config, from).start;
    best = { slot: { start, end: addMinutes(start, task.getDuration() || config.defaultDuration) }, score: 0, day: dayStart(from) };
    warning = true;
  }

  task.placeAt(best.slot.start);
  task.schedulingWarning = warning;
  task.schedulingInfo = outsideZone ? 'outside-zone' : null;
  return { placed: true, slot: best.slot, outsideZone, warning };
}
