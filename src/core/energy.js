// energy.js — the load basis & the deterministic energy-budget accountant
// (design/ENERGY-MODEL.md, L-1). ZERO ML: buckets/activities carry a signed load
// vector across four axes (+ spends that reserve, − restores it); the accountant
// sums a day's net load per axis against a capacity and flags overdraft. Physics,
// never a scold — the same voice as "this won't fit the time" (P-1).

export const LOAD_AXES = ['mental', 'physical', 'social', 'creative'];

// Signed default load per bucket role. Personal (an introvert *spends* social
// energy, an extrovert restores it) — so these are only defaults the user tunes.
export const DEFAULT_LOAD_BY_ROLE = {
  rest: { mental: -2, physical: -1, social: 0, creative: 0 },
  creative: { mental: 1, physical: 0, social: 0, creative: 2 },
  work: { mental: 2, physical: 0, social: 0, creative: 0 },
  social: { mental: 0, physical: 0, social: 1, creative: 0 },
  health: { mental: -1, physical: 2, social: 0, creative: 0 },
  neutral: { mental: 0, physical: 0, social: 0, creative: 0 },
};

const clampAxis = (v) => Math.max(-2, Math.min(2, Math.round(Number.isFinite(v) ? v : 0)));
const zeroLoad = () => ({ mental: 0, physical: 0, social: 0, creative: 0 });

/** Normalise a partial load into a full, clamped 4-axis vector. */
export function normalizeLoad(load) {
  const out = {};
  for (const a of LOAD_AXES) out[a] = clampAxis(load && load[a]);
  return out;
}

export function defaultLoadForRole(role) {
  return normalizeLoad(DEFAULT_LOAD_BY_ROLE[role] || DEFAULT_LOAD_BY_ROLE.neutral);
}

/** A task's effective load: its own override if set, else its bucket's (by tag),
 *  else zero. The per-task override is how a specific thing spends differently
 *  from the rest of its bucket. */
export function loadForTask(schedule, task) {
  if (task && task.load) return normalizeLoad(task.load);
  const b = schedule.bucketForTask ? schedule.bucketForTask(task) : null;
  return b && b.load ? normalizeLoad(b.load) : zeroLoad();
}

function sumLoad(schedule, tasks) {
  const net = zeroLoad();
  for (const t of tasks) {
    const l = loadForTask(schedule, t);
    for (const a of LOAD_AXES) net[a] += l[a];
  }
  return net;
}

function capacityFor(schedule) {
  const cap = (schedule.config.energy && schedule.config.energy.capacity) || {};
  const out = {};
  for (const a of LOAD_AXES) out[a] = Number.isFinite(cap[a]) ? cap[a] : 6;
  return out;
}

/**
 * The day's energy budget per axis: `{ capacity, net, remaining, over }`.
 * Restorative (negative-load) tasks lower net demand. Deterministic — no ML.
 * `over` is the physics flag ("this axis is overspent"), never a judgement.
 */
export function energyBudget(schedule, date) {
  const cap = capacityFor(schedule);
  const tasks = schedule.getTasksForDay(date).filter((t) => !t.chunking && t.completion !== 'skipped');
  const net = sumLoad(schedule, tasks);
  const out = {};
  for (const a of LOAD_AXES) {
    out[a] = { capacity: cap[a], net: net[a], remaining: cap[a] - net[a], over: net[a] > cap[a] };
  }
  return out;
}
