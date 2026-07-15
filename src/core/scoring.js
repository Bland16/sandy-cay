// scoring.js — the weighted slot score shared by every placement flow
// (SPEC §2.3, OD-2). Pure and deterministic.
//
//   score(slot) = w.proximity · (1 − |slot.start − origin| / lookaheadHorizon)
//               + w.balance   · (1 − dayFillRatioAfterPlacement)
//               + w.stability · stabilityBonus(placedBy === 'user')
//               + w.preference· modelScore(task, slot)      // 0 until ≥10 ratings
//
// Highest wins; ties → earlier slot (broken by the caller's ordering).

import { minutesBetween, clamp } from './time.js';

/** Renormalize the four weights so they sum to 1 (SPEC §2.3 "renormalized"). */
export function normalizeWeights(weights) {
  const w = {
    proximity: weights.proximity ?? 0,
    balance: weights.balance ?? 0,
    stability: weights.stability ?? 0,
    preference: weights.preference ?? 0,
  };
  const sum = w.proximity + w.balance + w.stability + w.preference;
  if (sum <= 0) return { proximity: 0.25, balance: 0.25, stability: 0.25, preference: 0.25 };
  return {
    proximity: w.proximity / sum,
    balance: w.balance / sum,
    stability: w.stability / sum,
    preference: w.preference / sum,
  };
}

export function proximityScore(slotStart, origin, lookaheadHorizonMin) {
  if (!origin || lookaheadHorizonMin <= 0) return 1;
  const dist = Math.abs(minutesBetween(origin, slotStart));
  return clamp(1 - dist / lookaheadHorizonMin, 0, 1);
}

export function balanceScore(dayFillRatioAfterPlacement) {
  return clamp(1 - dayFillRatioAfterPlacement, 0, 1);
}

/**
 * @param {object} p
 * @param {Date}   p.slotStart
 * @param {Date}   p.origin                 original start (or "now") for proximity
 * @param {number} p.lookaheadHorizonMin
 * @param {number} p.dayFillAfter           day fill ratio if the task were placed here
 * @param {number} p.stability              1 if leaving a user-placed task put, else 0
 * @param {number} p.modelScore             preference model output ∈ [0,1]
 * @param {object} p.weights                normalized weights
 */
export function score(p) {
  const w = p.weights;
  return (
    w.proximity * proximityScore(p.slotStart, p.origin, p.lookaheadHorizonMin) +
    w.balance * balanceScore(p.dayFillAfter) +
    w.stability * (p.stability || 0) +
    w.preference * (p.modelScore || 0)
  );
}
