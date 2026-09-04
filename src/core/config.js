// config.js — the default configuration (SPEC §8). All values Cabana-tunable
// unless noted. Kept as plain data so it round-trips through JSON untouched.

export const defaultConfig = {
  // Widened to 23:00 on 2026-08-13, at the user's request. The old 18:00 weekday
  // end meant the scheduler could not see the evening at all — while the real
  // week it was scheduling for did most of its studying 20:00–24:00. A window is
  // the DEFAULT AVAILABILITY for automatic placement, not a claim that those
  // hours are free; `sleep` below is what stops the evening running away.
  windows: {
    monFri: { start: '08:00', end: '23:00' },
    sat: { start: '08:00', end: '23:00' },
    sun: { start: '10:00', end: '23:00', maxTasks: 2, lightDay: true },
  },
  // Sleep safeguard: nothing may be AUTOMATICALLY placed so late that it leaves
  // less than this many hours before the next day's first commitment. Physics,
  // not bookkeeping — so it clips the legal window rather than scoring badly,
  // and like every other window rule it binds the scheduler and not the user's
  // own hand (R-1). Set `minHoursBeforeNextDay: 0` to switch it off.
  //
  // It only bites when tomorrow starts early: with a 23:00 window and an 09:00
  // first class it never triggers, and with a 07:00 start it pulls tonight's
  // cutoff back to 23:00 exactly. That asymmetry is the point — the guard exists
  // for the early mornings, which are the nights that actually cost you sleep.
  sleep: { minHoursBeforeNextDay: 8 },
  breaks: { default: 30, medium: 15, minimum: 5 },
  breakThresholds: { medium: 0.5, minimum: 0.7 },
  maxPlacementLookahead: 3, // days
  defaultDuration: 60,
  // `buffer` is the finish-early preference (WEEKLY-PLANNING §4.4): aim to be
  // done one fifth of the RUNWAY — plan time → deadline — before that deadline.
  // (Corrected 2026-08-12; it originally read one fifth of the task's own
  // length, which scored a 20-minute task the same at Monday 09:00 as at Friday
  // 16:45 and so did almost nothing.) Weighted high on purpose — the user's call
  // was "not a must, but a strong preference" — and being a WEIGHT is what lets
  // an overburdened week or a two-day deadline override it with no special-case
  // logic. It only ever moves deadlined tasks; for everything else `bufferScore`
  // returns a constant, which cannot change a ranking.
  //
  // ⚠️ `buffer` SATURATES once the target is met, and `proximity` is normalised
  // by `maxPlacementLookahead` above, so it is identically 0 past day 3. Beyond
  // that horizon only `balance` still discriminates, which is why long-runway
  // work bunches into the first days — see WEEKLY-PLANNING §4.5.
  // Renormalised with the rest, so these are ratios, not percentages.
  // `energy` — how depleted you ARRIVE at the slot, on the axes the task draws
  // on (design/ENERGY-PLACEMENT-EVAL.md D-1, settled on evidence: the term
  // belongs in scoring.js at the candidate slot, and its quantity is C3,
  // reserve-at-sit-down, not C1's day dip). Gated: a task that spends nothing
  // gets no opinion rather than inheriting one from the day's state.
  //
  // ⚠️ 0.15 IS MEASURED, NOT CHOSEN — probe-energy-weight.mjs. On a week of
  // heavy mornings and recovered evenings the effect SATURATES immediately:
  //
  //     w.energy   placements moved   mean arrival depletion
  //       0.00            0                  1.000
  //       0.10            5                  0.675
  //       0.50            5                  0.675   ← buys nothing more
  //
  // So the term wants the smallest weight that captures it. Above ~0.35 the
  // renormalisation drops `buffer` under 0.2 and quietly overrules the user's
  // own "a strong preference" for finishing early — that is the ceiling, and
  // scoring-buffer.test.js holds it as a tripwire. 0.15 is the saturation point
  // plus margin, and matches `preference`.
  weights: { proximity: 0.5, balance: 0.35, stability: 0.15, preference: 0.15, buffer: 0.4, energy: 0.15 },
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
    // ⚠️ THIS KEY DID NOT EXIST. `report.js` read
    // `config.detectors.deadlineBufferHours ?? 24` and nothing ever defined it,
    // so every wrap report ever printed judged "close to the wire" against a
    // hardcoded 24 hours — the same threshold for something due in two days and
    // something due in three months, and a number the user never set.
    //
    // 24 is kept as the declared default rather than silently changed, because
    // changing it changes what past reports would have said. The better
    // denominator is the one `bufferScore` already uses — one fifth of the
    // RUNWAY — and moving the report onto it is a behaviour change worth making
    // deliberately (design/WRAP-REPORT-ADDITIONS.md A8).
    deadlineBufferHours: 24,
  },
  coldStartRatings: 10,
  // Energy battery (design/ENERGY-MODEL.md; design/RECONCILIATION.md P-2). Capacity is
  // LEARNED from your energy ratings (energy.js#learnedCapacity) once there are ratings
  // across ≥ calibrationWeeks distinct weeks; before that the card shows a "still learning"
  // shape, never a fabricated ceiling. In load-hours of reserve debt.
  //
  // ⚠️ THIS IS A SCORING PRIOR, NOT A DISPLAY FALLBACK — corrected 2026-09-03,
  // because the two sentences this comment used to carry contradicted each
  // other. `learnedCapacity` returns null for an axis without evidence and
  // never substitutes this; otherwise three mental-only ratings would open the
  // global calibration gate and hand back an invented ceiling for the other
  // three axes, which `energyBudget` turns into headroom and `EnergyCard`
  // prints as "in the red" in warning colour. Read it via `capacityPrior()`
  // where a term needs a denominator from week one and the number is never
  // shown; never where it would be rendered, compared, or judged against.
  energy: { capacity: { mental: 8, physical: 6, social: 5, creative: 5 }, calibrationWeeks: 3 },
  // Activity library list ergonomics (EDITOR-REDESIGN §7.1). frequencyDays is the
  // trailing window "most used" counts over — recent habits, not lifetime totals.
  activities: { pageSize: 8, frequencyDays: 90 },
  stabilityBonus: 1, // raw bonus magnitude for a placedBy:'user' task (scaled by weight)
  learning: {
    lambda: 0.1, learningRate: 0.05, epochs: 400, topTags: 6,
    // Reserved for future load×position interaction terms (sparse-data safety):
    // regularized harder than base terms, gated until a cell has enough ratings.
    interactionLambda: 0.4, interactionMinSamples: 4,
  },
  // Activity-library "what to do" steering (design/ACTIVITY-LIBRARY.md, Phase C).
  // Fit dominates; the load bias is a gentle nudge derived only from ratings.
  suggest: {
    window: 10, // recent rated tasks to steer from…
    recentDays: 14, // …or the trailing days, whichever yields more
    fitWeight: 1, // opening-fit weight (dominant)
    loadBias: 0.35, // magnitude of one steering lean (by load character)
    varietyPenalty: 0.15, // nudge away from the load character just finished
    priorityPressureHigh: 0.15, // normalised threshold: important work "looms"
    restFlat: 3, // restorative avgOverall (1–5) at/below which rest reads as "flat"
    // ⚠️ DECLARED 2026-09-04. This existed only as a `?? 0.2` fallback inside
    // suggest.js, so the largest nudge after `loadBias` was invisible to anyone
    // reading the config — including anyone tuning the others around it.
    reserveBias: 0.2, // nudge away from deepening a bottomed-out axis
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
