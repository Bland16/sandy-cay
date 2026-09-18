# Plan of action — what to test in the second audit session

**Session 9, 2026-09-18.** Written from six parallel audits run against the
user's real export. Status: **PLAN — the user decides the model after the tests
in §3 are run.**

Companions: `AUDIT-UNMARKED-WORK.md` · `AUDIT-REAL-DATA.md` · `SICK-DAYS.md`.
All figures anonymised; the export stays gitignored.

---

## 1. What is now settled — do not re-derive

**Measured, and confirmed independently where it mattered:**

- **The activity picker's score is sign-quantised.** Every load-derived term is a
  predicate on sign or argmax; nothing multiplies by a magnitude. At a 240-minute
  opening the whole 49-activity library collapses to 4–5 distinct scores, every
  bucket yields exactly one, and the top five come out alphabetical. Confirmed by
  three separate agents and by reading `suggest.js`.
- **The category filter runs after the limit.** 7 of 9 categories and 23 of 31
  tags return an empty panel although fitting activities exist. Filtering before
  the limit gives **9 of 9 and 31 of 31** at every opening tested.
- **Each learned capacity axis is one day.** Physical evidence is
  `[2.50, 2.50, 2.87, 3.13, 7.32]`; `Math.max` publishes 7.32. Four of the five
  evidence days carry exactly one energy rating.
- **The energy facet is a selection, not a sample.** An item rated ≤2 is **4×**
  more likely to carry an energy facet than one rated above 2, while `dayFill`
  and arrival depletion are indistinguishable between the two groups. Everything
  learned from those 36 facets is bad-day-weighted.
- **`overall` is fatigue-contaminated, within activity.** One recurring course in
  a fixed slot, four occurrences, only the preceding day varying:
  `prior spend 5.9 → 5, 7.8 → 3, 9.6 → 1, 10.5 → 3`, r = **−0.746**. The
  contamination is **global, not per-axis** (partial r for own-axis given total,
  −0.086).
- **Per-axis separability is NOT ESTIMABLE from this history.** Crossings per
  axis: mental 1, physical 4, social 4, creative 0 — all on four days, 5 of the 8
  running backwards. The discriminating test (same-axis vs cross-axis within-day
  agreement) is a null under both labellings.
- **Every detector is silent, in every week, including the sick one.**
  `overpackCheck` structurally cannot fire (needs 7.5-min gaps; the tightest full
  day averages 19). `skipStreakCheck` is blind to all 21 skips. `starvation`,
  `drift`, `pinnedRatio` all dead.
- **`unmarked` means "I did it and didn't tick it"** — the user's decision,
  2026-09-18. They will delete what they did not do.

**Consequences of that last decision, both now urgent:** `buildAccomplished`
counts only `done`/`partial`, so the report **undercounts the user by roughly
half** (1145 min stated against 2300 charged); and `carryOver` would **resurrect
finished work**, since it carries unmarked past tasks forward.

---

## 2. Fix regardless — no decision required, no test needed

These are wrong under any model. They should not wait for the second audit.

| # | Fix | Evidence |
|---|---|---|
| **F-1** | Filter by category **before** the limit in `suggestActivities` | 7/9 categories empty → 9/9 |
| **F-2** | `ratedSamples()` carries `activityId` **and** `load` | both dropped in one object literal; `load` loss makes a session the user marked restful count as demanding |
| **F-3** | `lastFinishedLoad` reads the door, not `schedule.tasks` | 29% of hours see the wrong last item; 10% get the wrong axis; up to 45 of 46 candidates reorder |
| **F-4** | `buildOccurrence` reads `od.at`/`od.endAt` when present | a session recorded 20:15/90m prints as 18:15/60m; the "when it happened" strip draws it two hours early |
| **F-5** | `buildAccomplished` counts unmarked past work | user's semantics; currently halves their week |
| **F-6** | `carryOver` must not carry unmarked past work | user's semantics; currently resurrects done work |
| **F-7** | `buildDeadlineBuffer` — drop the `runwayH = 0` exclusion and fix the median index | "2 came in late" when 3 did; median indexes a filtered array |
| **F-8** | `ranAsWritten` must consult completion | claims 3 sessions "ran" that have no record, one of them on a future Saturday |
| **F-9** | The report must not include days that have not happened | 630 future minutes inside the sick week's bars, strips, tag table and denominator |
| **F-10** | Label the two charts that disagree | sand bars 13h vs day strips 4h30m, same page, same day |
| **F-11** | Warn at authoring when a tag matches no bucket | 10% of the user's hours carry an all-zero load vector |

---

## 3. The equations and strategies to test

Each is stated as a question with candidates, a **decision criterion**, and the
measurement that would settle it. Ranked by how much rests on the answer.

### E-1 · The capacity estimator — **the highest-value test**

**Question.** `Math.max` over tolerated days publishes a ceiling supported by one
observation per axis, and can only ratchet upward.

**Candidates.** (a) `max`, today · (b) a high quantile (p80/p90) over tolerated
days · (c) median of tolerated dips · (d) a quantile over **all** days, not only
tolerated ones · (e) any of the above with an evidence floor above 2.

**Decision criterion — and it is unusual, so state it plainly.** The user reports
living at or above their ceiling most days. That is the only calibration evidence
that exists. Measured: `max` puts them over on **44%** of days, median on **70%**,
mean on **63%**. **Their own report is evidence for an estimator in the 63–70%
band and against `max`.**

**Also test the filter, not just the statistic.** Tolerance is currently judged by
mean energy facet ≥ 0 — a facet that is 4× over-represented on badly-rated items.
Candidate (d) exists because the tolerated-only filter may be the bigger problem
than `Math.max`.

**Watch for:** the structural bias — a day rated non-negative can *never* be
reported over its ceiling under (a)–(c), so "over" fires only on unrated or
badly-rated days.

### E-2 · The saturation function — **decides whether sick days do anything**

**Question.** `frac = min(1, spent/capacity)` pins at 1 and stops discriminating.
Measured on a normal Friday: 1 of 4 axes already saturated at full capacity, 2 of
4 at 80%, 3 of 4 at 60%. The user lives above the ceiling, so this is the normal
regime, not the edge.

**Candidates.** (a) `min(1, x)` · (b) `tanh` or another soft saturation ·
(c) cap the sick-day scale by headroom so it can never pin an axis that was not
already pinned.

**Decision criterion.** Rank churn under capacity scaling, above the ceiling.
Measured: under the current term, scaling capacity to 80% or 60% moves **not one
score of 49**. The sick-day recovery tail is provably inert in exactly the regime
it exists for.

**Note for `SICK-DAYS.md` §4.3, which records this as open D-4.** Also measured:
a **uniform** capacity scale provably cannot reorder under a `tanh`-based score
(monotone in a uniformly rescaled argument), while a **per-axis** scale reorders
substantially. **If the recovery tail is meant to change which activity is
suggested, it must scale per-axis.** That is true under any formulation.

### E-3 · The picker's scoring function

**Candidate, measured and recommended by the bake-off:**

```
d  = clamp(O, a.durationMin, a.durationMax)     h = d/60
r'[x] = min(0, r[x] − L[x]·h)
Δ  = Σ_x (r'[x] − r[x]) / C[x]
Π  = Σ_x (−L[x]·h) / C[x]
fit = min(1, d / a.durationMax)

S  = dir·tanh(Δ) + ε₁·tanh(Π) + ε₂·fit
```

with **one pick per bucket first**, then fill from the global ranking, and the
category filter applied before the limit.

**What it buys, measured with zero authoring:** 34 distinct scores of 49 against
today's 4–5; top-5 membership churn under perturbation 0 of 5 against today's
3 of 5; and resolution *gained* above the ceiling rather than lost.

**Open sub-questions to test, not assume:**
- **The fresh-morning inversion.** With `dir = +1`, `S` ranks the shortest
  demanding activity first when the user is fresh — it says "do the short workout
  on a rested morning". The bake-off agent flagged this as the one place its own
  recommendation reads wrong. **Ask the user; it is a preference, not arithmetic.**
- **`dir`'s sign** currently comes from `steerBias`'s `energyBalance` crossing
  zero — a knife edge of exactly the kind this rewrite exists to remove. Needs
  its own evaluation before it ships.
- **ε₁ = 0.05, ε₂ = 0.01 were chosen, not measured** (consequence measured: 0.27%
  primary-order inversions). Needs a `probe-energy-weight.mjs`-style pass.
- **The bucket-diversity rule is load-bearing** — without it every one of the top
  five comes from a single bucket at every moment and opening.

### E-4 · Residualising `overall` — **the direct attack on R² = −0.198**

**Question.** `overall` is not a stationary label: the same object gets a
different number depending on when in the day it is rated. The preference model
has no feature that can see that.

**Candidates.** (a) add position-in-day as a feature · (b) add **recomputed**
prior spend as a feature · (c) residualise `overall` against the fatigue term
before training · (d) all of the above.

**Decision criterion.** Does grouped cross-validated R² go **positive**? It is
−0.198 today, and −0.208 retrained on all 101 samples.

**Two traps, both measured.**
- **Do not use the stored `energyAt`.** 28 of 101 stamps disagree with a
  recompute, 22 by more than a load-hour, the worst by 11.3; one *decreases*
  across an evening. They are written when the user rated, not when the task
  happened. Recompute.
- **Do not use `dayFill`.** `r(dayFill, overall) = −0.009`. It carries almost none
  of the signal; position-in-day (−0.261) and recomputed prior spend (−0.215) do.

**Also note the ceiling problem, which no feature fixes:** 58 of 101 `overall`
scores are a 5, variance 1.30. A near-constant target limits what any estimator
can do. That is a conversation with the user about rating habits, not a code
change.

### E-5 · The bucket vectors — **a prerequisite, not an equation**

**Question.** The coursework bucket carries `social 1.49 > mental 1.24`, so
**every class, reading and lab in the history has `social` as its dominant spend
axis.** Social totals +196 load-hours against mental's +35, and two thirds of it
is attendance and eating.

**Why it comes before any further axis work.** The engine's axis assignment
disagrees with the user's own intuition on roughly a fifth of their samples, and
that disagreement — not physiology — is what most of the separability analysis was
actually measuring. **Re-author the vectors, then re-run E-6.** Two numbers, very
large blast radius.

### E-6 · Per-axis vs global depletion — **blocked on instrumentation**

**Not testable today, and the reason is not sample size.** The energy facet asks
*"did this task drain me"*, not *"how depleted am I"* — 10 of 22 "drained me"
ratings sit on items rated `overall = 5`. The user's claim is about their state;
nothing in the schema records state.

**What would unblock it:** a state check-in decoupled from any task — one tap,
four axes, "where are you right now" — or a second facet that asks about the
rater rather than the task. Until then, per-axis capacity, reserve and placement
terms rest on four days and one good anecdote, and the honest surface reading is
"still learning".

**Cheapest partial test in the meantime**, and it is genuinely cheap: late meals
tagged social rate 2,2,2,3,4 while late meals tagged only `food` rate 5,5.
Morning social meals are all 5. **Ask the user to tag meals honestly for two
weeks** and the social-axis question gets its first real evidence.

### E-7 · Detector thresholds — all of them

**Question.** Every detector is silent for this user in every week. That is not
calibration; several are measuring the wrong quantity.

- **`overpackCheck` measures gap compression; this user's problem is item count
  and day length.** Their two fullest days — 11 items / 13½ h and 10 items /
  12¾ h — both read "not packed". SPEC §7.3 defines overpack as average break, so
  measuring fullness instead is a **spec change**, not a bug fix (this is
  `TODO.md` T-4b, now confirmed empirically).
- **`skipStreakCheck` cannot see skip exceptions at all** — a skip exception
  removes the occurrence from the expansion, so the streak breaks. 21 skips, max
  streak 0. Meanwhile `buildPatternDiff` reads the same exceptions and prints all
  21.
- **`durationFitSuggestion`: floor 6 is correct and needs no further tuning.**
  The binding constraint is coverage — only 12 of 102 samples answer `durationFit`
  at all, no tag above 5. At floor 3 it reproduces the exact findings the user
  already reported as unfounded. **Q-1 is answered; close it.**

### E-8 · Commitment generation

Seven commitments ask ~1,335 min/week; the schedule carries **15 sittings
totalling ~1,660 min across five weeks**. One generated nothing at all before it
expired; three generated 20–35 min against asks of 135–240. Whether this is
"no openings found" or "generation never ran" is not answerable from an export —
it needs a live reproduction.

---

## 4. What the data cannot answer, whatever we test

- **One user, five weeks, one rating habit.** Every finding is "true of this
  export", never "true in general".
- **No counterfactual.** We can measure the model's *accuracy* against held-out
  ratings. We cannot measure its *usefulness*, because we cannot know what the
  user would have rated had it suggested differently.
- **No activity–rating link.** 0 of 153 tasks carry an `activityId`, so no
  suggestion has ever been joined to an outcome. Every "sensible ordering"
  judgement in these audits is someone reading labels.
- **No rating timestamps.** Nothing records when a rating was entered, so
  "do they rate in bursts" is structurally unanswerable from an export.
- **Nothing after 18 Sep.** There is no recovery data; any claim about what came
  back first would be invention.

---

## 5. Order

1. **§2 fixes** — no decisions, no tests, several of them one line.
2. **E-5** (bucket vectors) — cheap, and a prerequisite for anything about axes.
3. **E-1 + E-2 together** — they share a denominator and the sick-day tail is
   blocked on both.
4. **E-3** — the picker, once E-2 settles the saturation shape.
5. **E-4** — the preference model.
6. **E-7** — detectors, which are a spec conversation as much as a code one.
7. **E-6** — only after E-5, and only with new instrumentation.

**Nothing in §3 is built before it is measured, and nothing is measured before
the user has chosen between the candidates.** That ordering is what
`design/TODO.md` already does, and it is what kept a 48-activity authoring
programme from being built this session on a scorer that could not have read it.
