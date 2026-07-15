// autoSchedule.js — urgency-aware placement (SPEC §2.4, case 2E). Greedy with
// recompute: slack is recomputed after every placement. Anchors (fixed / pinned
// / protected / recurrence occurrences) are fixed; flexible ∧ unpinned tasks are
// the candidates.

import {
  weekStart as weekStartOf,
  addDays,
  dayStart,
  minutesBetween,
} from './time.js';
import { dayWindowBounds, intervalsOf, placeTask } from './placement.js';
import { expandRecurrence } from './recurrence.js';

/** Free capacity (minutes) between `from` and a task's deadline, given the
 *  current occupied set — the slack numerator (SPEC §2.4 / 2E). */
export function freeCapacityBefore(schedule, deadline, occupied, from) {
  const config = schedule.config;
  let free = 0;
  for (let d = dayStart(from); d.getTime() <= dayStart(deadline).getTime(); d = addDays(d, 1)) {
    const b = dayWindowBounds(config, d);
    let winStart = b.start;
    let winEnd = b.end;
    if (dayStart(d).getTime() === dayStart(from).getTime() && from.getTime() > winStart.getTime()) {
      winStart = new Date(Math.max(b.start.getTime(), from.getTime()));
    }
    if (dayStart(d).getTime() === dayStart(deadline).getTime() && deadline.getTime() < winEnd.getTime()) {
      winEnd = new Date(deadline.getTime());
    }
    const capMin = Math.max(0, minutesBetween(winStart, winEnd));
    let occMin = 0;
    for (const iv of occupied) {
      const a = Math.max(iv.start.getTime(), winStart.getTime());
      const z = Math.min(iv.end.getTime(), winEnd.getTime());
      if (z > a) occMin += Math.round((z - a) / 60000);
    }
    free += Math.max(0, capMin - occMin);
  }
  return free;
}

function compareCandidates(a, b) {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  if (a.urgent && b.urgent && a.slack !== b.slack) return a.slack - b.slack;
  if (a.t.priority !== b.t.priority) return b.t.priority - a.t.priority; // priority DESC
  const ad = a.t.deadline ? a.t.deadline.getTime() : Infinity;
  const bd = b.t.deadline ? b.t.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd; // deadline ASC
  const adur = a.t.getDuration();
  const bdur = b.t.getDuration();
  if (adur !== bdur) return bdur - adur; // duration DESC
  return a.t.title.localeCompare(b.t.title); // title ASC
}

/**
 * @returns { placed: Task[] (placement order), warnings: Task[] }
 */
export function autoSchedule(schedule, opts = {}) {
  const config = schedule.config;
  const now = opts.now || new Date();
  const ws = opts.weekStart ? new Date(opts.weekStart) : weekStartOf(now);
  const from = opts.from ? new Date(opts.from) : ws;
  const to = opts.to ? new Date(opts.to) : addDays(ws, 6);
  const protectedTags = config.protectedTags;

  const inWeek = (t) => {
    const idx = t.getDayIndex(ws);
    if (idx >= 0 && idx <= 6) return true;
    if (t.deadline) {
      const di = Math.round((dayStart(t.deadline).getTime() - dayStart(ws).getTime()) / 86400000);
      return di >= 0 && di <= 6;
    }
    return false;
  };

  // Anchors: fixed/pinned/protected non-recurring tasks in the week + all
  // recurrence occurrences for the week.
  const anchors = [];
  const candidates = [];
  for (const t of schedule.tasks) {
    if (t.chunking) continue; // parent bookkeeping record, not a grid object
    if (t.recurrence) continue; // materialized separately below
    if (!inWeek(t)) continue;
    if (t.isAnchored(protectedTags)) anchors.push(t);
    else if (t.type === 'flexible' && !t.pinned) candidates.push(t);
    else anchors.push(t);
  }
  for (const t of schedule.tasks) {
    if (t.recurrence) anchors.push(...expandRecurrence(t, ws));
  }

  const occupied = intervalsOf(anchors);
  const placed = [];
  const warnings = [];
  const remaining = [...candidates];

  while (remaining.length > 0) {
    const meta = remaining.map((t) => {
      let slack = Infinity;
      let urgent = false;
      if (t.deadline) {
        slack = freeCapacityBefore(schedule, t.deadline, occupied, from) - t.getDuration();
        urgent = slack < t.getDuration() * config.urgencyFactor;
      }
      return { t, slack, urgent };
    });
    meta.sort(compareCandidates);
    const pick = meta[0].t;
    remaining.splice(remaining.indexOf(pick), 1);

    const res = placeTask(schedule, pick, { from, to, occupied });
    pick.placedBy = 'auto';
    occupied.push({ start: pick.startTime, end: pick.endTime, task: pick });
    placed.push(pick);
    if (res.warning) warnings.push(pick);
  }

  return { placed, warnings };
}
