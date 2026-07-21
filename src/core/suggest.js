// suggest.js — the library fallback for "what to do" (design/ACTIVITY-LIBRARY.md,
// Phase C). Ranks the user's OWN activities that fit the current opening, gently
// steered by how they've recently rated their time.
//
// Two boundaries are structural here, not conventions:
//   • Read-only. suggestActivities / steerBias never mutate and never touch the
//     model — cycling past a suggestion records NOTHING (P-1: it cannot infer
//     procrastination because it never watches what you skip).
//   • User-authored only. It reorders YOUR activities; it never invents any.
// placeActivity is the sole mutation and fires only on an explicit "Do it now".

import { addMinutes, dayStart, addDays } from './time.js';
import { dayCapacityMin } from './placement.js';
import { openingLabel } from './whatToDo.js';
import { normalizeLoad, LOAD_AXES, loadForTask, reserveAt } from './energy.js';

function suggestCfg(config) {
  const s = (config && config.suggest) || {};
  return {
    window: s.window ?? 10,
    recentDays: s.recentDays ?? 14,
    fitWeight: s.fitWeight ?? 1,
    loadBias: s.loadBias ?? 0.35,
    reserveBias: s.reserveBias ?? 0.2, // nudge away from deepening a bottomed-out axis
    varietyPenalty: s.varietyPenalty ?? 0.15,
    priorityPressureHigh: s.priorityPressureHigh ?? 0.15,
    restFlat: s.restFlat ?? 3,
    coldStart: (config && config.coldStartRatings) ?? 10,
  };
}

// A thing's character IS its load vector (design/RECONCILIATION.md — no `role`).
const netLoad = (L) => L.mental + L.physical + L.social + L.creative;
// Restorative: it gives energy back overall, or is mentally restful (rest, and
// exercise/health, which is physically demanding but clears the head).
const isRestful = (L) => netLoad(L) < 0 || L.mental < 0;
function dominantAxis(L) {
  let ax = null; let m = 0;
  for (const a of LOAD_AXES) if (Math.abs(L[a]) > m) { m = Math.abs(L[a]); ax = a; }
  return m > 0 ? ax : null;
}
/** The load a task/activity carries. An activity belongs to one bucket; a task
 *  derives from ALL its tags' buckets (loadForTask), so both agree with the budget. */
function loadOf(schedule, item) {
  if (item && item.load) return normalizeLoad(item.load);
  if (item && item.bucketId != null) { // an activity → its single bucket
    const b = schedule.buckets.find((x) => x.id === item.bucketId);
    return b && b.load ? normalizeLoad(b.load) : normalizeLoad({});
  }
  return loadForTask(schedule, item); // a task → averaged across its tags' buckets
}

/** Recent rated tasks: the trailing `recentDays`, or the last `window`, whichever
 *  yields more (spec). Rated = a numeric satisfaction.overall. */
function recentRated(schedule, now, cfg) {
  const rated = schedule.tasks
    .filter((t) => t.satisfaction && typeof t.satisfaction.overall === 'number')
    .sort((a, b) => b.startTime - a.startTime);
  const cutoff = addDays(dayStart(now), -cfg.recentDays).getTime();
  const within = rated.filter((t) => t.startTime.getTime() >= cutoff);
  const lastN = rated.slice(0, cfg.window);
  return within.length >= lastN.length ? within : lastN;
}

/** "Priority space" — normalised minutes of incomplete P4–P5 work due within the
 *  placement lookahead. High → important work looms; ~0 → genuinely free. */
export function priorityPressure(schedule, now = new Date()) {
  const config = schedule.config;
  const horizon = addDays(dayStart(now), config.maxPlacementLookahead);
  let looming = 0;
  for (const t of schedule.tasks) {
    if (t.completion !== null || t.recurrence || t.chunking) continue;
    if (t.priority < 4 || !t.deadline) continue;
    if (t.deadline.getTime() < now.getTime() || t.deadline.getTime() > horizon.getTime()) continue;
    looming += t.getDuration();
  }
  let capacity = 0;
  for (let d = dayStart(now); d.getTime() <= horizon.getTime(); d = addDays(d, 1)) capacity += dayCapacityMin(config, d);
  return capacity > 0 ? Math.max(0, Math.min(1, looming / capacity)) : 0;
}

/**
 * The steering context, plus `biasFor(load)` → { bias, reason } that scores any
 * activity's LOAD character (restorative vs demanding, and on which axis). Pure
 * and read-only. Cold start (< coldStartRatings recent ratings) → no bias.
 */
export function steerBias(schedule, now = new Date()) {
  const cfg = suggestCfg(schedule.config);
  const recent = recentRated(schedule, now, cfg);
  const none = {
    trained: false, energyBalance: 0, pressure: 0, restorativeFlat: false,
    biasFor: () => ({ bias: 0, reason: null }),
  };
  if (recent.length < cfg.coldStart) return none;

  let energyBalance = 0;
  const restorativeOveralls = []; // overalls of recent tasks that were restorative
  for (const t of recent) {
    energyBalance += t.satisfaction.energy || 0;
    if (netLoad(loadOf(schedule, t)) < 0) restorativeOveralls.push(t.satisfaction.overall);
  }
  const pressure = priorityPressure(schedule, now);
  const restAvg = restorativeOveralls.length
    ? restorativeOveralls.reduce((a, b) => a + b, 0) / restorativeOveralls.length
    : null;
  const restorativeFlat = restAvg != null && restAvg <= cfg.restFlat;
  const b = cfg.loadBias;

  const biasFor = (load) => {
    const L = normalizeLoad(load);
    let bias = 0; let reason = null;
    // 1) Running down → something restful (restorative overall, or mentally restful).
    if (energyBalance < 0 && isRestful(L)) {
      bias += b; reason = "You've been running down — something restful?";
    }
    // 2) Restful time hasn't been landing → shift the lean toward creative work.
    if (restorativeFlat) {
      if (L.creative > 0) { bias += b; reason = "Rest's felt flat lately — a creative project?"; }
      else if (isRestful(L)) { bias -= b; }
    }
    // 3) Charged + important work looming → a mentally-demanding focused block.
    if (energyBalance > 0 && pressure > cfg.priorityPressureHigh && L.mental > 0) {
      bias += b; reason = 'Momentum and things due — a focused block?';
    }
    // 4) Charged + nothing pressing → something creative or social you enjoy.
    if (energyBalance > 0 && pressure <= cfg.priorityPressureHigh && (L.creative > 0 || L.social > 0)) {
      bias += b; reason = reason || 'Nothing pressing — time for something you enjoy?';
    }
    return { bias, reason };
  };
  return { trained: true, energyBalance, pressure, restorativeFlat, biasFor };
}

/** The load character of the most recently finished thing — for the variety nudge. */
function lastFinishedLoad(schedule, now) {
  let last = null;
  for (const t of schedule.tasks) {
    if (t.completion === null || t.startTime.getTime() > now.getTime()) continue;
    if (!last || t.startTime > last.startTime) last = t;
  }
  return last ? loadOf(schedule, last) : null;
}

/**
 * Ranked library activities that fit `opts.opening`, gently steered by load
 * character. Read-only.
 * @returns [{ activity, load, duration, score, reasons: string[] }]
 */
export function suggestActivities(schedule, now = new Date(), opts = {}) {
  const cfg = suggestCfg(schedule.config);
  const opening = opts.opening;
  const limit = opts.limit ?? 5;
  if (!opening || opening.minutes <= 0) return [];
  const openMin = opening.minutes;

  const steer = steerBias(schedule, now);
  const lastLoad = lastFinishedLoad(schedule, now);
  const vAxis = lastLoad ? dominantAxis(lastLoad) : null;

  // Reserve-aware nudge: the axis you're most depleted on RIGHT NOW (today's battery
  // up to `now`). Favour activities that give it back, avoid ones that deepen it —
  // so the picker steers away from bottoming you out (design/RECONCILIATION.md).
  const reserve = reserveAt(schedule, now);
  let worst = null; let worstVal = 0;
  for (const a of LOAD_AXES) if (reserve[a] < worstVal) { worstVal = reserve[a]; worst = a; }

  const ranked = schedule.activities
    .filter((a) => a.durationMin <= openMin) // fits the opening
    .map((a) => {
      const load = loadOf(schedule, a);
      const duration = a.durationFor(openMin);
      const fitScore = a.durationMax > 0 ? Math.min(1, duration / a.durationMax) : 1;
      const { bias, reason } = steer.biasFor(load);
      const axis = dominantAxis(load);
      const variety = vAxis && axis === vAxis ? -cfg.varietyPenalty : 0;
      let reserveBias = 0; let reserveReason = null;
      if (worst) {
        if (load[worst] < 0) { reserveBias = cfg.reserveBias; reserveReason = `Your ${worst} reserve is low — something that gives it back?`; }
        else if (load[worst] > 0) { reserveBias = -cfg.reserveBias; }
      }
      const score = cfg.fitWeight * fitScore + bias + variety + reserveBias;
      const rs = [`fills your ${openingLabel(openMin)} opening`];
      if (bias > 0 && reason) rs.push(reason);
      else if (reserveBias > 0 && reserveReason) rs.push(reserveReason);
      return { activity: a, load, duration, score, reasons: rs };
    });
  ranked.sort((x, y) => y.score - x.score || x.activity.label.localeCompare(y.activity.label));
  return ranked.slice(0, limit);
}

/**
 * Instantiate an activity into the opening at `start`, filling it
 * (clamp(opening, min, max)) — the "Do it now" commit. Goes in as an ordinary
 * flexible task via resolveDropConflicts, so displacement behaves as it would for
 * any hand-placed task. Mutates.
 */
export function placeActivity(schedule, activity, start, openingMin) {
  const duration = activity.durationFor(openingMin);
  // Only carry an EXPLICIT activity override onto the task; otherwise leave load
  // null so the task derives its energy from its tags (loadForTask) — that way the
  // picker's prediction and the placed task can't disagree (design/RECONCILIATION.md).
  const task = schedule.addFlexible({
    title: activity.label,
    tags: [...activity.tags],
    priority: activity.priority ?? undefined,
    startTime: new Date(start),
    endTime: addMinutes(new Date(start), duration),
    placedBy: 'user',
    load: activity.load ?? null,
    // Back-link to the template this came from (EDITOR-REDESIGN §7.1). Read by
    // activityUsage for the "most used" sort. It records that you CHOSE this
    // activity — never that you skipped one (P-1, see the boundary note at the
    // top of this file).
    activityId: activity.id,
  });
  const res = schedule.resolveDropConflicts(task);
  return { task, displaced: (res && res.displaced) || [] };
}
