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
  const byTitle = a.t.title.localeCompare(b.t.title); // title ASC
  if (byTitle !== 0) return byTitle;
  // §2.4's chain ends at title, which is NOT a total order: project chunks all
  // carry the parent's title, so ties are routine. Stable sort would preserve
  // input order, but leaning on that is a subtlety; id makes it explicit.
  return String(a.t.id).localeCompare(String(b.t.id));
}

/**
 * @returns { placed: Task[] (placement order), warnings: Task[] }
 */
export function autoSchedule(schedule, opts = {}) {
  const config = schedule.config;
  const now = opts.now || new Date();
  const ws = opts.weekStart ? new Date(opts.weekStart) : weekStartOf(now);
  // Never place into the past. Re-optimizing on Thursday used to start the
  // search at Monday, so work was "scheduled" into hours that have already
  // happened. An explicit opts.from still wins (callers like backfill mean it).
  const weekEnd = addDays(ws, 7);
  const floor = now.getTime() > ws.getTime() && now.getTime() < weekEnd.getTime() ? now : ws;
  const from = opts.from ? new Date(opts.from) : floor;
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
    // A resolved task is history, never a re-placement candidate — moving finished
    // work into the present/future is the bug this guards. `skipped` is resolved
    // as not-done, so it neither moves nor blocks its old slot; `done`/`partial`
    // happened where they sit, so they anchor (their time is spent).
    if (t.completion === 'skipped') continue;
    if (t.completion != null) { anchors.push(t); continue; }
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
    // NB: placedBy is deliberately NOT reset to 'auto' here.
    //
    // OD-3 makes it a soft preference: hand-placing a task rewards it with a
    // stability bonus so the algorithm PREFERS not to move it — while still
    // being allowed to. Stamping 'auto' after the first placement erased that
    // memory on every run, so w.stability (0.15 of the score) could never fire
    // again and re-optimize treated your hand-placed work as anonymous. §3.6
    // explicitly says carryOver re-enters tasks as 'auto'; §2.4 says no such
    // thing for autoSchedule, which also runs on load.
    occupied.push({ start: pick.startTime, end: pick.endTime, task: pick });
    placed.push(pick);
    if (res.warning) warnings.push(pick);
  }

  return { placed, warnings };
}
