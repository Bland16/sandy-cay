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

const ROLES = ['rest', 'creative', 'work', 'social', 'health', 'neutral'];

function suggestCfg(config) {
  const s = (config && config.suggest) || {};
  return {
    window: s.window ?? 10,
    recentDays: s.recentDays ?? 14,
    fitWeight: s.fitWeight ?? 1,
    roleBias: s.roleBias ?? 0.35,
    varietyPenalty: s.varietyPenalty ?? 0.15,
    priorityPressureHigh: s.priorityPressureHigh ?? 0.15,
    restFlat: s.restFlat ?? 3,
    coldStart: (config && config.coldStartRatings) ?? 10,
  };
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
 * The steering biases per role plus the invitation reason for each biased role.
 * Pure and read-only. Cold start (< coldStartRatings recent ratings) → all zero.
 */
export function steerBias(schedule, now = new Date()) {
  const cfg = suggestCfg(schedule.config);
  const recent = recentRated(schedule, now, cfg);
  const biases = Object.fromEntries(ROLES.map((r) => [r, 0]));
  const reasons = {};
  if (recent.length < cfg.coldStart) {
    return { biases, reasons, trained: false, energyBalance: 0, pressure: 0 };
  }

  const agg = {}; // role → { n, overallSum, energySum }
  let energyBalance = 0;
  for (const t of recent) {
    const role = schedule.roleOf(t);
    const a = agg[role] || (agg[role] = { n: 0, overallSum: 0, energySum: 0 });
    a.n += 1;
    a.overallSum += t.satisfaction.overall;
    const e = t.satisfaction.energy || 0;
    a.energySum += e;
    energyBalance += e;
  }
  const avgOverall = (role) => (agg[role] && agg[role].n ? agg[role].overallSum / agg[role].n : null);
  const pressure = priorityPressure(schedule, now);
  const bias = cfg.roleBias;

  // 1) Running down → restful.
  if (energyBalance < 0) {
    biases.rest += bias; biases.health += bias;
    reasons.rest = "You've been running down — something restful?";
    reasons.health = reasons.rest;
  }
  // 2) Passive rest not landing → shift the rest lean to creative.
  const restAvg = avgOverall('rest');
  if (restAvg != null && restAvg <= cfg.restFlat) {
    biases.rest -= bias;
    biases.creative += bias;
    reasons.creative = "Rest's felt flat lately — a creative project?";
    delete reasons.rest;
  }
  // 3) Charged + important work looming → focused work.
  if (energyBalance > 0 && pressure > cfg.priorityPressureHigh) {
    biases.work += bias;
    reasons.work = 'Momentum and things due — a focused block?';
  }
  // 4) Charged + nothing pressing → something you enjoy.
  if (energyBalance > 0 && pressure <= cfg.priorityPressureHigh) {
    biases.creative += bias; biases.social += bias;
    reasons.creative = reasons.creative || 'Nothing pressing — time for something you enjoy?';
    reasons.social = 'Nothing pressing — time for something you enjoy?';
  }
  return { biases, reasons, trained: true, energyBalance, pressure };
}

/** The role of the most recently finished thing — for the variety nudge. */
function lastFinishedRole(schedule, now) {
  let last = null;
  for (const t of schedule.tasks) {
    if (t.completion === null || t.startTime.getTime() > now.getTime()) continue;
    if (!last || t.startTime > last.startTime) last = t;
  }
  return last ? schedule.roleOf(last) : null;
}

function activityRole(schedule, activity) {
  const b = schedule.buckets.find((x) => x.id === activity.bucketId)
    || schedule.bucketForTask({ tags: activity.tags });
  return b ? b.role : 'neutral';
}

/**
 * Ranked library activities that fit `opts.opening`, gently steered. Read-only.
 * @returns [{ activity, role, duration, score, reasons: string[] }]
 */
export function suggestActivities(schedule, now = new Date(), opts = {}) {
  const cfg = suggestCfg(schedule.config);
  const opening = opts.opening;
  const limit = opts.limit ?? 5;
  if (!opening || opening.minutes <= 0) return [];
  const openMin = opening.minutes;

  const { biases, reasons } = steerBias(schedule, now);
  const vRole = lastFinishedRole(schedule, now);

  const ranked = schedule.activities
    .filter((a) => a.durationMin <= openMin) // fits the opening
    .map((a) => {
      const role = activityRole(schedule, a);
      const duration = a.durationFor(openMin);
      const fitScore = a.durationMax > 0 ? Math.min(1, duration / a.durationMax) : 1;
      const roleBias = biases[role] || 0;
      const variety = vRole && role === vRole ? -cfg.varietyPenalty : 0;
      const score = cfg.fitWeight * fitScore + roleBias + variety;
      const rs = [`fills your ${openingLabel(openMin)} opening`];
      if (roleBias > 0 && reasons[role]) rs.push(reasons[role]);
      return { activity: a, role, duration, score, reasons: rs };
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
  // Carry the activity's effective load onto the task so its energy budget is
  // right: the activity's own override if set, else its bucket's default.
  const bucket = schedule.buckets.find((b) => b.id === activity.bucketId);
  const load = activity.load ?? (bucket ? bucket.load : null);
  const task = schedule.addFlexible({
    title: activity.label,
    tags: [...activity.tags],
    priority: activity.priority ?? undefined,
    startTime: new Date(start),
    endTime: addMinutes(new Date(start), duration),
    placedBy: 'user',
    load,
  });
  const res = schedule.resolveDropConflicts(task);
  return { task, displaced: (res && res.displaced) || [] };
}
