// commitmentWeek.js — what a week owes, and laying it out.
//
// design/WEEKLY-PLANNING.md D-3 + design/COMMITMENT-USE-CASES.md. This is the
// ONE implementation of "what does this week owe" and "lay it out", because
// THREE surfaces will ask: the Cabana button (built first), the week's own
// owed-line (D-3's real surface), and the offer-on-open (D-9). `zoneBands` is
// the cautionary tale — it was reimplemented per surface and painted zones into
// weeks the scheduler correctly saw as free (sharp edge #14). A third copy
// drifts; so there is one.
//
// The shape here was written and RUN as a probe before any of it was built
// (`design/probes/probe-commitment-cases.mjs`, 22 lifecycle cases), which is
// how three defects were found while this was still a design.
//
// ⚠️ `now` is INJECTED everywhere (sharp edge #8). Every function here takes it,
// and none of them reads the clock — a surface that fires on a date must be
// testable at a fixed one.

import { generateAll } from './generate.js';
import { Schedule } from './Schedule.js';
import { weekStart as weekStartOf } from './time.js';

/**
 * What each commitment's position is in the week beginning `ws`. Writes nothing.
 *
 * The four states, and why each exists:
 *
 *  - **`owes`**  — active here and NOT YET COVERED. ⚠️ This is a QUANTITY, not
 *    a bare "nothing laid out yet": see `remainingMin` and D-11 below.
 *  - **`done`**  — the week's amount is covered. ⚠️ It carries `placedMin` and
 *    `owedMin` rather than being a bare flag, because "already laid out" is a
 *    per-WEEK boolean and you may have deleted a sitting by hand (case E3). A
 *    week holding 2h of a 4h commitment must SAY so; calling it "done" would be
 *    the app stating something untrue.
 *
 *    ⚠️ IT USED TO SAY EXACTLY THAT AND THEN DO IT (WEEKLY-PLANNING D-11, fixed
 *    2026-08-31). The state was `sittings.length ? 'done' : 'owes'` — ANY
 *    sitting at all marked the week handled — and `layOutWeek` acts only on
 *    `owes`. So deleting one sitting of two left the week holding 90m of 240m,
 *    permanently, with the button a no-op. `placedMin`/`owedMin` were computed
 *    right here and never consulted. Measured before the fix:
 *
 *        after deleting one sitting   state=done  placed=90m   owed=240m
 *        press "lay out" again        state=done  placed=90m   owed=240m
 *
 *    `done` now means COVERED, and the remainder is what the button places.
 *  - **`passed`** — its due day has gone. Owes nothing: a shortfall must never
 *    be manufactured by the passage of time (§4.3 / D-3 / §5, three rules
 *    independently).
 *  - **`outside`** — the term does not reach this week.
 */
export function previewWeek(schedule, ws, now) {
  const start = weekStartOf(ws);
  return (schedule.commitments || []).map((c) => {
    const sittings = schedule.sittingsFor(c.id, start);
    // ⚠️ A SKIPPED SITTING IS NOT PLACED TIME (D-12). You did not do it, so the
    // hours are still outstanding and a top-up may re-place them — consistent
    // with `skipped` everywhere else in the engine (§2.4's resolved rule has it
    // neither move nor hold its slot). Counting it left a week that skipped
    // every session reporting itself fully covered.
    //
    // This is NOT a catch-up ledger and does not touch §5: it applies within
    // the week and only until the due day, after which `passed` owes nothing.
    const placedMin = sittings
      .filter((t) => t.completion !== 'skipped')
      .reduce((n, t) => n + t.getDuration(), 0);
    // ⚠️ THE MARK OVERRIDES THE ARITHMETIC (D-13). "I finished ESF 2 early" is a
    // statement the grid cannot make — the work may have happened in a block
    // that was never a generated sitting, or away from the app entirely — so
    // when it is set the week owes nothing regardless of what the sittings add
    // up to. Everything else here still reports honestly: `placedMin` is what
    // is actually on the grid, so the surface can still say "2h of 4h laid out"
    // beside a week you have called finished.
    const settled = typeof schedule.isCommitmentWeekDone === 'function'
      && schedule.isCommitmentWeekDone(c.id, start);
    const remainingMin = settled ? 0 : Math.max(0, c.amountMinPerWeek - placedMin);
    const input = c.engineInputForWeek(start, now);
    let state = 'owes';
    if (settled) state = 'done';
    else if (sittings.length && remainingMin === 0) state = 'done';
    else if (!input) state = c.coversWeek(start) ? 'passed' : 'outside';
    // A commitment that owes nothing per week owes nothing this week either.
    // Without this it reached the generator with `amountMin: 0`, and
    // `chooseSittings`' running total satisfies `>= 0` on the first gap, so it
    // booked a sitting for work the user had set to zero.
    else if (c.amountMinPerWeek === 0) state = 'outside';
    return {
      commitment: c, state, input, sittings, placedMin, remainingMin, settled,
      owedMin: c.amountMinPerWeek,
    };
  });
}

/** Everything this week still owes, in minutes — the number the offer states.
 *
 *  ⚠️ THE REMAINDER, not the full amount (D-11). A week holding 2h of a 4h
 *  commitment owes 2h, and saying "4h" would overstate what the button is
 *  about to do — which is the same untruth D-11 fixed one level down. */
export function owedThisWeek(schedule, ws, now) {
  return previewWeek(schedule, ws, now)
    .filter((p) => p.state === 'owes')
    .reduce((n, p) => n + p.remainingMin, 0);
}

/**
 * Lay out one week. Returns `generateAll`'s results, so each entry carries its
 * own `shortfall` for §4.3 to state once.
 *
 * **Idempotent, but by ARITHMETIC rather than by state** (D-11, 2026-08-31).
 * It used to hold because a week with any sitting at all was `done` and so was
 * never a candidate. Now it holds because such a week's REMAINDER IS ZERO —
 * same behaviour on the common path, and the difference is the whole point:
 * a week holding 2h of 4h is no longer mistaken for a finished one.
 *
 * Case E2 (pressing twice is a no-op) therefore still stands. So does case E4
 * (a hand-moved sitting survives a second press, R-1): a sitting you dragged is
 * still a sitting, so it still counts toward `placedMin` and shrinks the
 * remainder by its own length. What CHANGES is case E3 — deleting a sitting by
 * hand now leaves a week that can be topped up, which is what a person deleting
 * one obviously means.
 *
 * ⚠️ THE REMAINDER IS SUBSTITUTED INTO `input.amountMin`, and the rest of the
 * input is left exactly as `engineInputForWeek` built it. The bounds
 * (`minSitting`, `maxSitting`, `maxPerDay`), the window and the due day are all
 * still the commitment's own — only the AMOUNT is what is left rather than what
 * the week owes in total. Rebuilding the input by hand here would be a second
 * implementation of `engineInputForWeek` and would drift from it.
 *
 * ⚠️ ONE call to `generateAll` for the whole week, never one per commitment.
 * §4.1.2 needs them generated together in ρ order so they do not collide on
 * days; generating them one at a time, in whatever order a surface iterates,
 * is that flaw reintroduced through the back door.
 */
export function layOutWeek(schedule, ws, now) {
  const inputs = previewWeek(schedule, weekStartOf(ws), now)
    .filter((p) => p.state === 'owes' && p.remainingMin > 0 && p.input)
    .map((p) => ({ ...p.input, amountMin: p.remainingMin }));
  if (!inputs.length) return [];
  return generateAll(schedule, inputs, { now });
}

/**
 * What `layOutWeek` WOULD do, without writing anything.
 *
 * §3 is explicit that the offer previews first — *"Accepting shows where
 * everything would go before anything is written, naming each block"* — and an
 * action you cannot preview is one you cannot agree to. Same plan-then-apply
 * pair `planBlockerConversion` / `convertBlockersToDayNotes` already uses, and
 * for the same reason.
 *
 * It runs the real generator against a THROWAWAY COPY rather than
 * reimplementing it, because a second implementation of the plan is a second
 * thing to drift — and the preview disagreeing with what you then get is worse
 * than having no preview at all. The copy goes through `toJSON`/`fromJSON`,
 * which is the round-trip the footlocker already proves.
 *
 * Generation is deterministic given the schedule and `now` (ids do not affect
 * placement), so applying immediately after reproduces this plan exactly.
 */
export function planWeek(schedule, ws, now) {
  return layOutWeek(Schedule.fromJSON(schedule.toJSON()), ws, now);
}
