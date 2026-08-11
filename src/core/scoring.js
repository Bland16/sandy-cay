// scoring.js — the weighted slot score shared by every placement flow
// (SPEC §2.3, OD-2). Pure and deterministic.
//
//   score(slot) = w.proximity · (1 − |slot.start − origin| / lookaheadHorizon)
//               + w.balance   · (1 − dayFillRatioAfterPlacement)
//               + w.stability · stabilityBonus(placedBy === 'user')
//               + w.preference· modelScore(task, slot)      // 0 until ≥10 ratings
//               + w.buffer    · bufferScore(slot.end, deadline, duration)
//
// Highest wins; ties → earlier slot (broken by the caller's ordering).

import { minutesBetween, clamp } from './time.js';

/** Renormalize the weights so they sum to 1 (SPEC §2.3 "renormalized"). */
export function normalizeWeights(weights) {
  const w = {
    proximity: weights.proximity ?? 0,
    balance: weights.balance ?? 0,
    stability: weights.stability ?? 0,
    preference: weights.preference ?? 0,
    buffer: weights.buffer ?? 0,
  };
  const sum = w.proximity + w.balance + w.stability + w.preference + w.buffer;
  if (sum <= 0) {
    return { proximity: 0.2, balance: 0.2, stability: 0.2, preference: 0.2, buffer: 0.2 };
  }
  return {
    proximity: w.proximity / sum,
    balance: w.balance / sum,
    stability: w.stability / sum,
    preference: w.preference / sum,
    buffer: w.buffer / sum,
  };
}

/**
 * Finish-early preference: aim to be done **one fifth of the task's own length**
 * before the deadline (WEEKLY-PLANNING §4.4).
 *
 * The deadline itself is already a hard cap on the search window — nothing may
 * be placed past it. But until now nothing *preferred* earlier either, so a task
 * due Friday 17:00 could legitimately land finishing 16:59. Meanwhile
 * `report.js#buildDeadlineBuffer` has been measuring exactly this and flagging
 * anything under 24h as close to the wire: the app reported on a quality it
 * never optimised for. This closes that loop.
 *
 * One fifth of the TASK, not of the runway, because it is an **overrun
 * allowance** — "if this runs 20% over, you still make it" — and overrun scales
 * with the size of the job, not with how much notice you happened to get. A
 * runway-proportional version would just restate "earlier is better", which is
 * what `proximity` already says.
 *
 * It is a PREFERENCE, not a rule. That is what makes the obvious exceptions —
 * an overburdened week, a two-day deadline — need no special-case logic at all:
 * they simply cannot score well here and the other weights win.
 *
 * @param {Date}   slotEnd
 * @param {?Date}  deadline     null → 1 (neutral: a constant cannot change a ranking)
 * @param {number} durationMin  the work this buffer is protecting. For a chunked
 *   project pass the whole remaining amount, not one sitting — otherwise 30-min
 *   sittings each get a 6-min cushion and the project itself gets none.
 * @returns {number} ∈ [0,1] — 1 once the target buffer is met, falling linearly
 *   to 0 at the deadline itself.
 */
export function bufferScore(slotEnd, deadline, durationMin) {
  if (!deadline) return 1;
  const target = (durationMin || 0) / 5;
  if (target <= 0) return 1;
  const slack = minutesBetween(slotEnd, deadline);
  return clamp(slack / target, 0, 1);
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
 * @param {Date}   p.slotEnd                for the buffer term
 * @param {?Date}  p.deadline               null when the task has none
 * @param {number} p.bufferDurationMin      work the buffer protects (see bufferScore)
 * @param {object} p.weights                normalized weights
 */
export function score(p) {
  const w = p.weights;
  return (
    w.proximity * proximityScore(p.slotStart, p.origin, p.lookaheadHorizonMin) +
    w.balance * balanceScore(p.dayFillAfter) +
    w.stability * (p.stability || 0) +
    w.preference * (p.modelScore || 0) +
    (w.buffer || 0) * bufferScore(p.slotEnd, p.deadline, p.bufferDurationMin)
  );
}
