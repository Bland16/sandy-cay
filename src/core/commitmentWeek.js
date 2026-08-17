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
 *  - **`owes`**  — active here and nothing laid out yet. The only state the
 *    button acts on.
 *  - **`done`**  — sittings for it already exist in this week. ⚠️ It carries
 *    `placedMin` and `owedMin` rather than being a bare flag, because "already
 *    laid out" is a per-WEEK boolean and you may have deleted a sitting by hand
 *    (case E3). A week holding 2h of a 4h commitment must SAY so; calling it
 *    "done" would be the app stating something untrue.
 *  - **`passed`** — its due day has gone. Owes nothing: a shortfall must never
 *    be manufactured by the passage of time (§4.3 / D-3 / §5, three rules
 *    independently).
 *  - **`outside`** — the term does not reach this week.
 */
export function previewWeek(schedule, ws, now) {
  const start = weekStartOf(ws);
  return (schedule.commitments || []).map((c) => {
    const sittings = schedule.sittingsFor(c.id, start);
    const placedMin = sittings.reduce((n, t) => n + t.getDuration(), 0);
    const input = c.engineInputForWeek(start, now);
    let state = 'owes';
    if (sittings.length) state = 'done';
    else if (!input) state = c.coversWeek(start) ? 'passed' : 'outside';
    return { commitment: c, state, input, sittings, placedMin, owedMin: c.amountMinPerWeek };
  });
}

/** Everything this week still owes, in minutes — the number the offer states. */
export function owedThisWeek(schedule, ws, now) {
  return previewWeek(schedule, ws, now)
    .filter((p) => p.state === 'owes')
    .reduce((n, p) => n + p.owedMin, 0);
}

/**
 * Lay out one week. Returns `generateAll`'s results, so each entry carries its
 * own `shortfall` for §4.3 to state once.
 *
 * **Idempotent by construction**: only `owes` entries are passed on, so a
 * commitment already laid out here is skipped and pressing twice is a no-op
 * (case E2). That is also why a hand-moved sitting survives a second press
 * (E4, R-1) — the commitment simply is not a candidate any more.
 *
 * ⚠️ ONE call to `generateAll` for the whole week, never one per commitment.
 * §4.1.2 needs them generated together in ρ order so they do not collide on
 * days; generating them one at a time, in whatever order a surface iterates,
 * is that flaw reintroduced through the back door.
 */
export function layOutWeek(schedule, ws, now) {
  const inputs = previewWeek(schedule, weekStartOf(ws), now)
    .filter((p) => p.state === 'owes')
    .map((p) => p.input);
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
