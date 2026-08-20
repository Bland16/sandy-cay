// openings.js — ordering the openings Find-a-time already found
// (design/FIND-A-TIME.md P1).
//
// ════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A SEPARATE PASS AND NOT A CHANGE TO findFreeSlots
// ════════════════════════════════════════════════════════════════════════════
//
// Sharp edge #13: `findFreeSlots` is DELIBERATELY UNSCORED — "it returns the
// first gap after `from`, not the best one. Fine for 'show me openings' (Find
// Times), wrong for placing." That distinction is load-bearing, so this does
// not blur it. `findFreeSlots` keeps returning every opening in time order;
// this reorders a copy and says why.
//
// It therefore NEVER HIDES AN OPENING. Ranking is an opinion about order, not a
// filter, and a search that quietly drops candidates because it disapproved of
// them is the surprise P-1 exists to prevent.
//
// ════════════════════════════════════════════════════════════════════════════
// THE RULE (decided by the user, 2026-08-19)
// ════════════════════════════════════════════════════════════════════════════
//
//   the model can speak about this tag  → rank by what you have ACTUALLY DONE
//   otherwise                           → least impact first, then most left
//
// ⚠️ "Once there is data" is NOT a threshold invented here. `modelScore`
// already returns 0 below `config.coldStartRatings`, which is this project's own
// answer to when the model may speak and what `scoring.js` already relies on.
// The per-tag half is `vocab`: the vocabulary is the top-N tags by frequency
// among RATED tasks, so a tag absent from it has no term in the feature vector
// at all and the score would carry no information about it. Both halves are
// read off the model rather than chosen.
//
// ⚠️ And the trap `LearningModule#inspect` already warns about: "a caller that
// ranks on `weight` alone will rank an untried sitting length above one you have
// tried and disliked." Ranking openings is exactly such a caller. Using the
// GATED `modelScore` — rather than reaching into the weights — is what avoids
// it, and is why this file never touches `weights` directly.

import { Task } from './Task.js';
import { LOAD_AXES, loadForTask, dipIfPlaced, reserveAt } from './energy.js';

/** Would the learned model say anything useful about this tag? */
export function modelCanSpeak(schedule, tag) {
  const m = schedule.learning;
  if (!m || !m.trained) return false;
  const need = (schedule.config && schedule.config.coldStartRatings) ?? 10;
  if ((m.sampleCount || 0) < need) return false;
  return Array.isArray(m.vocab) && m.vocab.includes(tag);
}

/** How many more ratings before the model may speak — for the "still learning" line. */
export function ratingsUntilLearned(schedule) {
  const m = schedule.learning;
  const need = (schedule.config && schedule.config.coldStartRatings) ?? 10;
  return { have: (m && m.sampleCount) || 0, need };
}

/**
 * A stand-in for the thing you are about to schedule.
 *
 * ⚠️ A REAL `Task`, not a hand-made object with the four fields `featureVector`
 * happens to read today. A plain object would silently score zero for any
 * feature added later — the exact shape of bug that left `dayFillAtCompletion`
 * reading a field nothing ever wrote, constant-zero from the day it shipped.
 */
export function draftFor({ tag, durationMin, title = 'Find a time' }) {
  return new Task({ title, tags: tag ? [tag] : [], durationMin });
}

/** The axes this thing SPENDS. Restoring axes are not what "have I got enough
 *  left" is about — a walk does not need spare walking. */
function spendingAxes(load) {
  return LOAD_AXES.filter((a) => load[a] > 0);
}

/**
 * Order a set of openings by how well each suits the given tag.
 *
 * @param slots  what `findFreeSlots` returned — untouched; a copy is ordered
 * @param tag    optional. WITHOUT ONE, the order is unchanged (chronological),
 *               which is exactly today's behaviour
 * @returns `{ rule, rows }` where `rule` is 'time' | 'learned' | 'energy'.
 *          Each row is `{ slot, score, reason, impact, resulting, headroom }` —
 *          `resulting` is what the order is by (F-4), `impact` is what "costs
 *          your day nothing" means.
 */
export function rankOpenings(schedule, slots, { tag = null, durationMin = 60 } = {}) {
  const rows = slots.map((slot) => ({ slot, score: 0, reason: '', impact: null, headroom: null }));
  if (!tag) return { rule: 'time', rows };

  const draft = draftFor({ tag, durationMin });
  const load = loadForTask(schedule, draft);
  const spends = spendingAxes(load);

  if (modelCanSpeak(schedule, tag)) {
    for (const row of rows) {
      row.score = schedule.learning.modelScore(draft, row.slot);
      row.reason = `you usually do ${tag} around here`;
    }
    // Descending: a higher model score is a better fit.
    rows.sort((a, b) => b.score - a.score);
    return { rule: 'learned', rows };
  }

  for (const row of rows) {
    const dip = dipIfPlaced(schedule, row.slot, draft);
    const reserve = reserveAt(schedule, row.slot.start);
    // Sum over the axes this SPENDS. `reserve` is ≤ 0, so nearer zero is more
    // left; an empty `spends` (a purely restorative thing) scores 0 and lets
    // impact decide alone, which is right — a walk cannot run you out.
    const headroom = spends.reduce((n, a) => n + reserve[a], 0);
    row.impact = dip.total;
    // ⚠️ BOTH numbers are kept, because "least impact" has two readings and they
    // disagree. `impact` is how much DEEPER this day's dip gets — marginal.
    // `resulting` is how deep the day ends up ALTOGETHER — absolute. A day
    // already six hours into the red barely gets deeper, so ranking on the
    // marginal number recommends piling more onto your worst day. See the
    // probe, which prints both orderings.
    row.resulting = LOAD_AXES.reduce((n, a) => n + Math.abs(dip.after[a]), 0);
    row.headroom = headroom;

    // ⚠️ NAMING AN AXIS ONLY WHEN THE AXES DISAGREE. On a day nothing has been
    // spent on yet, every axis sits at 0 and this sort returns whichever comes
    // first in LOAD_AXES — so a SOCIAL hour on an empty Tuesday was explaining
    // itself with "most mental left". Arbitrary, and it reads as a finding.
    // When they are all level the honest reason is the day, not an axis.
    const spread = spends.map((a) => reserve[a]);
    const level = spread.length === 0 || spread.every((v) => v === spread[0]);
    row.mostLeft = level ? null : spends.slice().sort((x, y) => reserve[y] - reserve[x])[0];
    row.untouched = level && spread.every((v) => v === 0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F-4 — SORTED BY WHERE THE DAY ENDS UP, not by how much this adds.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ⚠️ THE MARGINAL READING WAS BUILT FIRST AND WAS WRONG, and the probe is
  // what showed it: a Monday already six hours into the red barely gets any
  // deeper, so ranking on the CHANGE recommended piling more onto the worst day
  // of the week and put an empty Tuesday LAST. Both numbers are honest
  // measures of "impact" and they are opposite recommendations for the same
  // afternoon; `resulting` is the one that answers the question a person is
  // actually asking. Decided by the user, 2026-08-20 (F-4).
  //
  // `impact` is still carried on every row — it is what the row means by
  // "costs your day nothing" — but it does not decide the order.
  //
  // Rounded before comparing, because two openings differing in the fourth
  // decimal are the same answer to any question a person is asking, and
  // unrounded values let floating-point noise outrank the headroom tiebreak so
  // completely that it would never once fire.
  const round = (n) => Math.round(n * 100) / 100;
  rows.sort((a, b) => (round(a.resulting) - round(b.resulting)) || (b.headroom - a.headroom));

  // ⚠️ THE REASON EXPLAINS THE RANK, and is written AFTER the sort for that
  // reason. Describing an axis instead ("most creative left") put a
  // recommendation-shaped sentence on the row that came LAST — a label that
  // lies about its own row, which is the defect class this project keeps
  // catching in its panels.
  const best = round(rows[0] ? rows[0].resulting : 0);
  for (const row of rows) {
    if (row.impact === 0) row.reason = 'costs your day nothing';
    else if (round(row.resulting) === best) {
      if (row.mostLeft) row.reason = `leaves the day least drained · most ${row.mostLeft} left`;
      else if (row.untouched) row.reason = 'leaves the day least drained · nothing spent there yet';
      else row.reason = 'leaves the day least drained';
    } else row.reason = 'that day is already deeper';
  }
  return { rule: 'energy', rows };
}
