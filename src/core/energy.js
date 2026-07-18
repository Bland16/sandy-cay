// energy.js — the load basis & the deterministic energy BATTERY (design/ENERGY-MODEL.md,
// design/RECONCILIATION.md). ZERO ML: buckets/activities carry a signed load RATE across
// four axes (+ spends per hour, − restores per hour). The accountant walks the day in time
// order, draining/refilling a per-axis reserve, and reports the deepest dip — so *when*
// you rest matters, not just how much. Physics, never a scold (P-1).

import { isoWeekKey, dateKey } from './time.js';

export const LOAD_AXES = ['mental', 'physical', 'social', 'creative'];

// Load is a continuous float in [-2, 2] — the wave control stores where the float
// actually sits, not a snapped integer (smoother authoring). Clamp, don't round.
const clampAxis = (v) => Math.max(-2, Math.min(2, Number.isFinite(v) ? v : 0));
const zeroLoad = () => ({ mental: 0, physical: 0, social: 0, creative: 0 });

/** Normalise a partial load into a full, clamped 4-axis vector. */
export function normalizeLoad(load) {
  const out = {};
  for (const a of LOAD_AXES) out[a] = clampAxis(load && load[a]);
  return out;
}

/** A task's effective load — a per-hour RATE, per axis. An explicit override wins;
 *  otherwise it's DERIVED from every bucket the task's tags touch (not just the
 *  first — design/RECONCILIATION.md), so you never hand-assign a task's energy.
 *  Per axis: average the positive contributions and average the negative ones, then
 *  total. Splitting the sign before averaging means a restorative bucket offsets a
 *  demanding one without either being diluted by count — "trivia" that's a little
 *  mental + a little social + restful nets near zero, its social fatigue cancelling
 *  its rest. Distinct buckets (a bucket counts once, however many of its tags match). */
export function loadForTask(schedule, task) {
  if (task && task.load) return normalizeLoad(task.load);
  const tags = (task && task.tags) || [];
  const buckets = (schedule.buckets || []).filter((b) => b.load && b.tags.some((t) => tags.includes(t)));
  if (buckets.length === 0) return zeroLoad();
  const vectors = buckets.map((b) => normalizeLoad(b.load));
  const out = zeroLoad();
  for (const a of LOAD_AXES) {
    let posSum = 0; let posN = 0; let negSum = 0; let negN = 0;
    for (const v of vectors) {
      if (v[a] > 0) { posSum += v[a]; posN += 1; } else if (v[a] < 0) { negSum += v[a]; negN += 1; }
    }
    out[a] = (posN ? posSum / posN : 0) + (negN ? negSum / negN : 0);
  }
  return out;
}

const HOUR = 3600000;
const durationHours = (t) => Math.max(0, (t.endTime - t.startTime) / HOUR);

function capacityFor(schedule) {
  const cap = (schedule.config.energy && schedule.config.energy.capacity) || {};
  const out = {};
  for (const a of LOAD_AXES) out[a] = Number.isFinite(cap[a]) ? cap[a] : 6;
  return out;
}

/**
 * Is the energy budget calibrated yet? A day's *capacity* is not something the
 * app can honestly invent — it's LEARNED from how you rate your energy over time
 * (design/RECONCILIATION.md, Principle 2). Until there are energy ratings across
 * at least `config.energy.calibrationWeeks` distinct weeks, the app shows a "still
 * learning" shape and NEVER a fabricated ceiling or over/under verdict.
 * Returns `{ calibrated, weeksRated, weeksNeeded }`.
 */
export function energyCalibration(schedule) {
  const need = (schedule.config.energy && schedule.config.energy.calibrationWeeks) ?? 3;
  const weeks = new Set();
  for (const t of schedule.tasks) {
    const s = t.satisfaction;
    if (t.completion === 'done' && s && typeof s.energy === 'number') weeks.add(isoWeekKey(t.startTime));
  }
  return { calibrated: weeks.size >= need, weeksRated: weeks.size, weeksNeeded: need };
}

/** Walk a set of tasks in time order → per-axis `{ net, low }`. The reserve starts
 *  full (0), can't bank credit above full, drains on spend and repays on restore;
 *  `low` (≤ 0) is the deepest dip, `net` the signed total (both in load-hours). */
function reserveWalk(schedule, tasks) {
  const sorted = tasks.slice().sort((a, b) => a.startTime - b.startTime);
  const net = zeroLoad();
  const low = zeroLoad();
  const reserve = zeroLoad();
  for (const t of sorted) {
    const l = loadForTask(schedule, t);
    const h = durationHours(t);
    for (const a of LOAD_AXES) {
      net[a] += l[a] * h;
      reserve[a] = Math.min(0, reserve[a] - l[a] * h); // + spends (drains), − restores (repays)
      if (reserve[a] < low[a]) low[a] = reserve[a];
    }
  }
  return { net, low };
}

/**
 * Learned per-axis capacity — how deep a dip you sustain before you're overdrawn.
 * Capacity is NOT invented (design/RECONCILIATION.md P-2): it's read from your own
 * history. For each past day that carries an energy rating, we take the day's reserve
 * dip per axis and the day's mean `energy` facet; a day you rated non-negative is one
 * you demonstrably tolerated. `capacity[axis]` = the deepest dip on such a day (the
 * most you took and still felt fine). Needs calibration + ≥ 2 evidence days per axis,
 * else that axis falls back to the config prior. Returns null until calibrated.
 */
export function learnedCapacity(schedule) {
  if (!energyCalibration(schedule).calibrated) return null;
  const prior = capacityFor(schedule);
  const days = new Map(); // dayKey → tasks that day
  for (const t of schedule.tasks) {
    if (t.chunking || t.completion === 'skipped') continue;
    const k = dateKey(t.startTime);
    (days.get(k) || days.set(k, []).get(k)).push(t);
  }
  const okDips = { mental: [], physical: [], social: [], creative: [] };
  for (const tasks of days.values()) {
    const rated = tasks.filter((t) => t.satisfaction && typeof t.satisfaction.energy === 'number');
    if (rated.length === 0) continue; // no energy signal this day
    const meanEnergy = rated.reduce((s, t) => s + t.satisfaction.energy, 0) / rated.length;
    if (meanEnergy < 0) continue; // a drained day — its dip is beyond capacity, not evidence of tolerance
    const { low } = reserveWalk(schedule, tasks);
    for (const a of LOAD_AXES) if (-low[a] > 0) okDips[a].push(-low[a]);
  }
  const out = {};
  for (const a of LOAD_AXES) out[a] = okDips[a].length >= 2 ? Math.max(...okDips[a]) : prior[a];
  return out;
}

/**
 * The day's energy as a per-axis BATTERY, walked in TIME ORDER (design/RECONCILIATION.md).
 * The old accountant summed the whole day, which is order-blind — two 4-hour work blocks
 * split by a movie scored the same as 8 hours straight, and rest scheduled *after* draining
 * work "rescued" a day it couldn't really rescue. The battery fixes both:
 *   - load is a per-hour RATE, so longer blocks drain more (rate × duration);
 *   - the reserve starts full (0), can't bank credit above full — restoration only helps
 *     when spent BETWEEN demanding blocks; the signal is the DEEPEST DIP (`low` ≤ 0).
 * `capacity` is LEARNED (learnedCapacity) and stays null until calibrated — never a
 * fabricated ceiling (P-2). Per axis: `{ net, low, capacity, over, remaining }`.
 */
export function energyBudget(schedule, date) {
  const cap = learnedCapacity(schedule); // null until calibrated
  const tasks = schedule.getTasksForDay(date).filter((t) => !t.chunking && t.completion !== 'skipped');
  const { net, low } = reserveWalk(schedule, tasks);
  const out = {};
  for (const a of LOAD_AXES) {
    const capacity = cap ? cap[a] : null;
    const over = capacity != null && -low[a] > capacity;
    const remaining = capacity != null ? capacity + low[a] : null; // headroom at the low point
    out[a] = { net: net[a], low: low[a], capacity, over, remaining };
  }
  return out;
}
