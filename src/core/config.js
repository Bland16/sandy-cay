// config.js — the default configuration (SPEC §8). All values Cabana-tunable
// unless noted. Kept as plain data so it round-trips through JSON untouched.

export const defaultConfig = {
  windows: {
    monFri: { start: '08:00', end: '18:00' },
    sat: { start: '08:00', end: '22:00' },
    sun: { start: '10:00', end: '14:00', maxTasks: 2, lightDay: true },
  },
  breaks: { default: 30, medium: 15, minimum: 5 },
  breakThresholds: { medium: 0.5, minimum: 0.7 },
  maxPlacementLookahead: 3, // days
  defaultDuration: 60,
  weights: { proximity: 0.5, balance: 0.35, stability: 0.15, preference: 0.15 },
  urgencyFactor: 1.5,
  evacuationPenalty: 120, // minutes-equivalent cost of forcing one evacuation (OD-8)
  strategyBias: 0.8, // cause-bias factor for chooseConflictStrategy (OD-8)
  backfillOfferThreshold: 45,
  protectedTags: ['rest', 'break', 'recovery'],
  detectors: {
    driftN: 5,
    driftHits: 4,
    driftMin: 30,
    starvation: 3,
    skipStreak: 3,
    overpackDays: 3,
    overpackBreakFactor: 1.5,
    pinnedRatioNote: 0.5,
  },
  coldStartRatings: 10,
  stabilityBonus: 1, // raw bonus magnitude for a placedBy:'user' task (scaled by weight)
  learning: { lambda: 0.1, learningRate: 0.05, epochs: 400, topTags: 6 },
  // Activity-library "what to do" steering (design/ACTIVITY-LIBRARY.md, Phase C).
  // Fit dominates; the role bias is a gentle nudge derived only from ratings.
  suggest: {
    window: 10, // recent rated tasks to steer from…
    recentDays: 14, // …or the trailing days, whichever yields more
    fitWeight: 1, // opening-fit weight (dominant)
    roleBias: 0.35, // magnitude of one steering lean
    varietyPenalty: 0.15, // nudge away from the role just finished
    priorityPressureHigh: 0.15, // normalised threshold: important work "looms"
    restFlat: 3, // rest avgOverall (1–5) at/below which rest reads as "flat"
  },
};

/** Structured deep clone of plain JSON-ish data (no class instances). */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
  return out;
}

/** Deep-merge `overrides` into a clone of `base` (arrays replaced wholesale). */
export function deepMerge(base, overrides) {
  const out = deepClone(base);
  if (!overrides || typeof overrides !== 'object') return out;
  for (const k of Object.keys(overrides)) {
    const ov = overrides[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], ov);
    } else {
      out[k] = deepClone(ov);
    }
  }
  return out;
}

/** Build a config from partial overrides layered on the defaults. */
export function makeConfig(overrides) {
  return deepMerge(defaultConfig, overrides || {});
}
