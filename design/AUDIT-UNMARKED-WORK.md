# AUDIT — what unmarked work corrupts

**Session 9, 2026-09-18.** Status: **FINDINGS — measured, nothing fixed.** Run
against the user's real export (gitignored; everything below is anonymised).
Method: an instrumented **copy** of `src/` in a scratchpad, driven by the real
data, with a single switchable charge-weight hook replacing the five
`completion !== 'skipped'` filters. The repo itself was not modified.

**The one-line finding:** the energy model charges you in full for work you
never marked as done, and half your learned capacity currently rests on a single
unmarked block.

---

## 1. The split that decides the whole design

```
451 day-task instances materialised across the range
  299 unmarked  ← of which only 17 are in the PAST
  148 done
    4 skipped
```

**Essentially all unmarked work is FUTURE planned work.** That one number kills
the obvious fix. "Stop charging unmarked work" zeroes every future day's budget:
`reserveAt` returns all zeros, `energyBudget` returns `low = 0`, and
`arrivalDepletion` collapses to 0 at every candidate slot — measured, a future
slot went `0.865 → 0`. That silently deadens the `w.energy` term in
`scoring.js`, the day-spreading term in `generate.js#energyRank`, and the
`headroom`/`resulting` columns in `openings.js`. **The app would stop noticing
that Wednesday is already full** — the exact opposite of the intent.

A rule keyed on a task's **start** time is likewise backwards: it leaves every
retrospective number bit-identical to today's while zeroing every forward-looking
one. It fixes nothing and breaks everything.

**The rule that works keys on `endTime`:** *work that has finished unmarked is
not evidence; work still ahead of you is still a plan.*

---

## 2. Consumers — how each reads `completion === null`

Everything in the first group reaches the private `reserveWalk`.

| Surface | reads `null` as | measured distortion |
|---|---|---|
| `reserveAt` | **charged in full** | +51% mental, +87% social, +64% creative on the worst day |
| `energyBudget` / energy card | **charged in full** | prints "in the red" on axes driven by work never done |
| `learnedCapacity` | **charged in full** | mental ceiling **+19.9%**, creative **+15.6%** (§3) |
| `spendRestore` | **charged in full** | sick week 92.79 vs 48.22 load-hours — **+92%** |
| `energyTrajectory` | **charged in full** | +70% final depth on the worst day |
| `dipIfPlaced` | charged (baseline) | marginal total barely moves; absolute reading does |
| `_snapshotEnergy` | **charged, then FROZEN** | 8 of 102 training features, permanently (§4) |
| report energy section | **charged in full** | contradicts `focusedMin` on the same page |
| `buildDayStrips` | **drawn as a block** | 26 blocks drawn, 16 happened |
| report commitment sittings | counted as run | planned sittings counted as sittings |
| `energyCalibration` | ignored (needs `done`) | **none — correct** |
| `getTagBreakdown` | in `scheduledMin` only | **correct — names both denominators** |
| `buildDeadlineBuffer`, `buildAccomplished`, starvation gate | excluded | **correct** |
| `currentOpening` | **holds its slot** | deliberate, and the only place it is argued |
| `whatToDo#eligible` | **the only thing eligible** | the exact opposite reading, 66 lines away |
| `getWeekLoad` / `dayGaps` / `overpackCheck` | counted (also counts `skipped`) | completion-blind by design; 65% of one day's reported minutes were let-go work |
| `carryOver` / `letThemGo` | unfinished work | the only thing that carries |
| `autoSchedule` | movable, not an anchor | — |
| `projects` | re-placeable; `finishProject` **deletes** | — |
| `skipStreakCheck` | **"WE DO NOT KNOW. Not evidence of absence."** | none — and this is the app arguing the other side in writing |

---

## 3. Propagation into the learned ceiling

Capacity has **five evidence days in the entire dataset** (17 rated days, 12
excluded for `meanEnergy < 0`). Exactly one of them contains unmarked work — a
single 75-minute block. Because `learnedCapacity` is `Math.max` over evidence
days, **that one block owns two of the four ceilings**:

| axis | as-is | lived-only | from unmarked | source day |
|---|---|---|---|---|
| mental | **5.373** | 4.480 | **+19.9%** | the day with the unmarked block |
| creative | **2.167** | 1.875 | **+15.6%** | the same day |
| physical | 7.315 | 7.315 | 0 | — |
| social | 11.840 | 11.840 | 0 | — |

This is the "highest-variance order statistic" fragility `energy.js` already
warns about itself, arriving through a second door.

**⚠️ Conditional on a fact only the user knows.** If they *did* that block and
simply did not tick it, today's ceilings are right and the lived-only figures
understate them. **Open question U-1 below.**

**3a. A second, undocumented asymmetry in the same function.**
`energyCalibration` bounds its evidence to `evidenceWindowDays` (56) —
deliberately, per its own warning about ceilings outliving their evidence.
`learnedCapacity` then calls `ratedSamples()` with **no `since`**. The gate is
windowed; the ceiling is not. A dip from any point in history can set the ceiling
so long as *some* rating exists in the last 56 days. Not an unmarked-work bug,
but the same P-2 hazard, and it amplifies §3.

---

## 4. The one irreversible corruption

`Schedule#_snapshotEnergy` writes `task.energyAt = reserveAt(...)` **once, and
never again** — its docblock says so explicitly. All 102 rated samples carry a
stored `energyAt`.

**Recomputing them lived-only changes 8 of 102, by up to 5.23 load-hours on one
axis.** Those eight training features are frozen at the over-charged value. No
later marking, carry-over or "let it go" rewrites them.

Every other distortion in this document recomputes and heals the moment the rule
changes. **This one does not.** It is the reason the decision in §6 is worth
taking sooner rather than later.

---

## 5. The candidate rules, costed

| rule | capacity (m/p/s/c) | sick week spend/restore | future-day budgets |
|---|---|---|---|
| **(a) today** — everything not skipped | 5.373 / 7.315 / 11.840 / 2.167 | 92.79 / 32.44 | intact |
| **(b) only `done`/`partial`** | 4.480 / … / 1.875 | 48.22 / 18.17 | **ALL ZERO — kills the placer** |
| **(c) unmarked only if started** | identical to (a) | 92.79 / 32.44 | **ALL ZERO — fixes nothing, breaks everything** |
| **(d) unmarked past at 0.5** | 4.598 / … / 1.875 | 70.51 / 25.31 | **ALL ZERO** |
| **(e) ELAPSED-and-unmarked → 0; still-plannable → 1** | 4.480 / … / 1.875 | 48.22 / 18.17 | **intact** |
| **(f) as (e), elapsed-unmarked at 0.5** | 4.598 / … / 1.875 | 70.51 / 25.31 | **intact** |

**(e) is the only rule that buys the retrospective fix at zero prospective
cost.** (f) is the same shape with a soft weight.

### 5.1 ⚠️ It does NOT make the app gentler

Excluding unmarked work lowers the day's dip **and** lowers the learned ceiling —
and the ceiling falls proportionally further. Over 33 days:

```
(a) today            "in the red" on 10 days, 18 axis-days
(b)/(e) lived-only   "in the red" on 11 days, 18 axis-days   ← a NEW red day appears
(d)/(f) half-weight  "in the red" on 10 days, 17 axis-days
```

A day appears in the red that today's code does not flag, because the mental
ceiling drops from 5.373 to 4.480. **This is a recalibration with user-visible
consequences, not a softening**, and it must ship as one.

---

## 6. RESOLVED 2026-09-20 — unmarked means "didn't do it"

The user's answer, in full: *"Unmarked = didn't do it probably."*

**This REVERSED an answer given two days earlier** (*"Let's have it be I did it
just didn't tick it and I will simply delete things I don't do"*), and the
reversal is recorded rather than quietly swapped because work was already
committed against the first reading. The second answer also fits the evidence
better: the sick week is **40% unmarked against a 1.5% baseline**, an anomaly
that "I did it and didn't tick it" cannot explain.

| reading | rule | sick week reads | status |
|---|---|---|---|
| "I did it and didn't tick it" | (a) — what the energy module does today | 92.8 load-hours | **rejected** |
| "I didn't do it" | **(e)** | **48.2** | **CHOSEN** |
| "probably partly" | (f) | 70.5 | the hedge, if "probably" turns out to matter |

**Rule (e), precisely:** an **elapsed** unmarked task is not evidence and is not
charged; work still ahead of you is still a plan and is charged normally. Keyed
on `endTime <= now`, never on `startTime` — §1 measures why the start-time
version fixes nothing and breaks every forward-looking number.

### 6.1 What this changes, and what it does NOT

**No change needed** — these were already right under this reading, and were
briefly scheduled for "fixes" that would have broken them:

- `buildAccomplished` already counts only `done`/`partial`. It is correct.
- `carryOver` carrying unmarked past work forward is correct — that IS the
  unfinished work.
- `skipStreakCheck`'s refusal to infer from silence (*"no record at all — WE DO
  NOT KNOW"*) is correct and was always the honest reading.

**Now unblocked:**

- **`ranAsWritten` must consult completion** — it claims sessions "ran" that have
  no record. (F-8.)
- **The energy module needs rule (e)** — the battery, `learnedCapacity`,
  `spendRestore`, `energyTrajectory` and the report's energy section all charge
  elapsed unmarked work in full today.

**The learned ceilings fall**, because §3's 75-minute block was not done:
mental **5.37 → 4.48**, creative **2.17 → 1.88**.

### 6.2 U-1 is answered

The 10 Sep block was not done. Two of the four learned ceilings were being set by
work that did not happen.

---

## 7. Where the app contradicts itself, in writing

- `whatToDo.js` line 33: `null` **holds its slot** — "you were there".
  `whatToDo.js` line 99: `completion !== null → ineligible` — an unmarked task is
  the only kind still worth doing. Same file, same field.
- `skipStreakCheck`: *"no record at all — WE DO NOT KNOW. Not evidence of
  absence."* `energyBudget`, sixty lines away, infers a full day's drain from the
  same silence and prints a verdict from it.
- The wrap report, one page: `focusedMin` **1145 min** accomplished, while the
  energy section computes spend over **2300 min**.
- `buildDayStrips` draws 10 blocks that did not happen, in a section titled
  "when it happened", whose own comment says *"SKIPPED BLOCKS ARE NOT DRAWN …
  drawing one would claim it happened."* The rationale is right; the filter is
  one state too narrow.

---

## 8. Verdicts

**Broken — produces a number the user would call false:** `learnedCapacity`
(ceiling from work not done) · `_snapshotEnergy` (frozen, irreversible) ·
`energyBudget` / the energy card · the wrap report's energy section ·
`buildDayStrips`.

**Merely inconsistent — defensible, but undocumented and disagreeing:**
`currentOpening` holding an unmarked slot · `getWeekLoad` / `dayGaps` /
`overpackCheck` counting skipped minutes · report commitment sittings ·
`whatToDo#eligible` vs `currentOpening`.

**Correct as built:** `energyCalibration` · `getTagBreakdown` ·
`buildDeadlineBuffer` · `buildAccomplished` · the starvation `live` gate ·
`skipStreakCheck`.

---

## 9. Open

- **U-1. Did the user do the 75-minute unmarked block, or not?** Two of four
  learned ceilings depend on the answer. **Ask; never infer.**
- **U-2. Which reading of `null`** (§6). Blocks the fix.
- **U-3. `learnedCapacity`'s unwindowed evidence** (§3a) — inherited hazard,
  separate decision.
- **Not verified:** what `EnergyCard.jsx` renders from `energyBudget` (measured
  the fields, did not run React); whether the terms going dead under (b)/(c)/(d)
  would change the *chosen* slot end to end; whether the UI ever writes a
  distinguishable `completion: null` occurrence entry versus no entry at all.
