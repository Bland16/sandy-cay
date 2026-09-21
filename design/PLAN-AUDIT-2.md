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
- **`unmarked` means "didn't do it"** — the user's decision 2026-09-20, which
  **REVERSED** their 2026-09-18 answer of "I did it and didn't tick it". Recorded
  as a reversal in `AUDIT-UNMARKED-WORK.md` §6 rather than swapped quietly,
  because work had already been queued against the first reading.
- **⚠️ And the boundary is the DAY, not the moment.** *"I do batch rate so it
  would need to read unmarked tasks. Consider anything unmarked on the current
  day as having been done and assumed to will be done."* So today is charged in
  full; only a day BEFORE today treats unmarked as "did not happen". A first
  implementation keyed on `endTime <= now` dropped this user's unticked morning
  work mid-afternoon, decided they were fresh and piled more on — it failed the
  regression guard *"it must not recommend the day you have already wrecked"*.

**Consequence of the reversal:** F-5 and F-6 were **withdrawn** (§2.1b) — both
would have broken code that was already right.

---

## 2. Fix regardless — no decision required, no test needed

These are wrong under any model. They should not wait for the second audit.

| # | Fix | Evidence | status |
|---|---|---|---|
| **F-1** | Filter by category **before** the limit in `suggestActivities` | 7/9 categories empty → 9/9 | ✅ SHIPPED be4573f |
| **F-2** | `ratedSamples()` carries `activityId` **and** `load` | both dropped in one object literal; `load` loss makes a session the user marked restful count as demanding | ✅ SHIPPED be4573f |
| **F-3** | `lastFinishedLoad` reads the door, not `schedule.tasks` | 29% of hours see the wrong last item; 10% get the wrong axis; up to 45 of 46 candidates reorder | ✅ SHIPPED 994f0ef |
| **F-4** | `buildOccurrence` reads `od.at`/`od.endAt` when present | a session recorded 20:15/90m prints as 18:15/60m; the "when it happened" strip draws it two hours early | ✅ SHIPPED — see §2.3 |
| ~~F-5~~ | ~~`buildAccomplished` counts unmarked past work~~ | — | **WITHDRAWN** — §2.1b |
| ~~F-6~~ | ~~`carryOver` must not carry unmarked past work~~ | — | **WITHDRAWN** — §2.1b |
| **F-7** | `buildDeadlineBuffer` — drop the `runwayH = 0` exclusion and fix the median index | "2 came in late" when 3 did; median indexes a filtered array | ✅ SHIPPED 83f37ad |
| **F-8** | `ranAsWritten` must consult completion | claims 3 sessions "ran" that have no record, one of them on a future Saturday | ✅ SHIPPED 2803b58 |
| **F-9** | **Exclude future days; add a horizon section** — see §2.2b | 630 future minutes inside the sick week's bars, strips, tag table and denominator | ✅ SHIPPED |
| **F-10** | Label the two charts that disagree | sand bars 13h vs day strips 4h30m, same page, same day | ✅ SHIPPED f88334b |
| **F-11** | **Surface unsorted tags in the Tag manager** — see §2.1 | 10% of the user's hours carry an all-zero load vector | ✅ SHIPPED fcfe8ef |

### 2.1b F-5 and F-6 — WITHDRAWN 2026-09-20, and this is why

Both were queued as fixes and **both would have broken working code.** They were
written when "unmarked = I did it" was the standing answer; the user reversed it
to "unmarked = didn't do it" (`AUDIT-UNMARKED-WORK.md` §6), and under that reading:

- **`buildAccomplished` is already correct** — counting only `done`/`partial` is
  right, and "make it count unmarked work" would have inflated the sick week to
  ~2,300 minutes accomplished.
- **`carryOver` is already correct** — carrying unmarked past work forward IS
  carrying the unfinished work.

Recorded rather than deleted, because a reversed decision leaves plausible-looking
work items behind it and the next person needs to know they were considered and
dropped on purpose.

### 2.3 F-4, decided 2026-09-20 — the lived time wins, the type does not change

> *"What do you mean like a moved one-off? It should record it at the time it was
> moved at in that instance, but as an instance of that type."*

So the clock comes from the record and the identity stays the pattern's.
`rateOccurrence` already stamps `at`/`endAt` as the record of when a session
really ran; `buildOccurrence` rebuilt the occurrence field by field and ignored
them.

**⚠️ One guard the user's answer does not cover, added deliberately: SAME
CALENDAR DAY ONLY.** `expandRecurrence` decides week and day membership by the
DECLARED start (`if (!inWeek(start)) return`), so honouring a lived time on
another day would leave an occurrence sitting inside a day it no longer occupies
— the "select by overlap, not by start" trap `DAY-NOTES.md` §8.2 already records,
arriving from the other direction. Moving a session across days is what a `move`
exception is for; this only ever adjusts the clock within the day the pattern
already chose.

**⚠️ The whole suite passed before the regression test existed** — 1385 tests,
none covering it. That is why the defect survived.

### 2.2 F-9, decided 2026-09-20

> *"I think show them in the report, exclude them from readings. Like don't
> project readings from things which haven't occurred yet."*

**The split is between what the page DRAWS and what the page CONCLUDES.**

| | future days |
|---|---|
| sand bars, day strips, the plan — **what is on the calendar** | **shown** |
| every computed reading — averages, denominators, energy, satisfaction, capacity, detector inputs | **excluded** |

So a mid-week report still shows you Saturday and Sunday sitting there, and
never counts them. The concrete failures this fixes, all measured on the sick
week, which was generated on the Friday:

- *"how it felt: 4.7 out of 5 (12 rated)"* — the **highest average of all four
  weeks**, on the week the user was ill, with two days still to come.
- *"18 sessions"* as a denominator, including a Saturday that had not arrived.
- 630 scheduled minutes inside the energy figures for days that had not happened.

**The boundary is `endTime <= now`**, the same test rule (e) uses for unmarked
work (`AUDIT-UNMARKED-WORK.md` §6) — one notion of "elapsed", not two.

⚠️ **`buildWrapReport(sched, weekStartDate)` takes no `now`.** It must be
threaded, defaulting to `new Date()`, and every builder that computes a reading
has to honour it. That is the real cost of this item and the reason it is not a
one-liner.

### 2.2b ⚠️ F-9 REVISED 2026-09-20 — exclude future days entirely, and add a horizon

The decision above ("show them, exclude them from readings") was **superseded the
same day** once the reason for showing them was examined:

> *"Does it matter? I think I know the day of week. You can do a what's on the
> horizon."*

The only argument for drawing future days inline was so the user could see what
was coming — and they already know. So:

| | future days |
|---|---|
| every computed reading — averages, denominators, energy, satisfaction, capacity | **excluded** (unchanged) |
| the week's charts and counts | **excluded too** — this is the change |
| a separate **"on the horizon"** section naming what is still ahead | **new** |

This is simpler than the first design *and* more honest: a chart that draws days
it does not count needs a caption explaining itself, and the caption was the
open question. Splitting the tense into its own section removes the need for one.

**D-2 is therefore closed** — the page does not need to say "2 days still to
come" inline, because the horizon section is that sentence.

**Built 2026-09-20.** The section states the day count, the item count, the total
minutes, and then each remaining day with its own count and minutes — **in date
order**. Nothing else.

⚠️ **Chronological ordering is load-bearing, not cosmetic.** Sorting by size
would make it a ranking, and a ranking of work you have not done yet is a verdict
waiting to happen (§7.1, P-1). There is a test for the ordering. The busiest day
is deliberately not picked out, and the section is **absent** once the week is
over rather than printing "0 days to come".

⚠️ **The exclusion is report-only, and expressed by what `buildWrapReport`
passes** — never by changing `queries.js`. `getWeekLoad` also drives the grid's
load bar, which must see the whole week: a planner that stops counting Thursday
on Wednesday is useless.

### 2.1 F-11, as the user actually asked for it

**Decided 2026-09-20.** *"Add a button to the tag manager which is just sort
unsorted tags."*

⚠️ **This supersedes F-11's original line**, which said "warn at authoring". An
authoring-time warning interrupts you while you are typing a task; a button in
the Tag manager is something you reach for when you are already tidying. The
second is what was asked for and it is the better shape — it puts the repair in
the place that repairs things.

**An unsorted tag is one in use on a task that belongs to no bucket.** It matters
because `loadForTask` derives a task's energy from the buckets its tags belong
to, so a task matching none gets an all-zero vector and is **silently invisible**
to the battery, `learnedCapacity`, the budget card and the report's
spend/restore. Measured: **17 of 159 items, 19.2 of 192.7 hours — a tenth of the
record** — 15 carrying no tags at all and 2 carrying a tag no bucket holds.

**The design:**

- A button in the Tag manager's bucket list, beside `＋ bucket` and `⤓ paste
  many`, carrying the count. Absent entirely when there are none — a button that
  reports zero is a nag.
- It toggles a strip in the idiom the **Retired tags** strip already uses, so it
  costs no new vocabulary.
- **Ordered by hours on the tag, not alphabetically.** One mistyped tag on a
  three-hour block deserves more attention than six on fifteen-minute ones, and
  the ordering is the finding.
- The strip states the consequence plainly — these hours carry no energy — and
  **states no verdict about the user**. It is a fact about the data (P-1).

**OPEN — D-1: does a chip do anything?** Surfacing is unambiguous and is what was
asked for. *Sorting* them into buckets is the obvious next move and is a second
design (drag to a bucket? a picker on the chip? assign-many?). **Not invented
here.** v1 surfaces; assignment waits for a decision.

**Pure helper, testable without a DOM:** `unsortedTags(sched)` →
`[{ tag, minutes }]`, beside `tagsInUse` in `TagEditor.jsx`.

---

## 3. The equations and strategies to test

Each is stated as a question with candidates, a **decision criterion**, and the
measurement that would settle it. Ranked by how much rests on the answer.

### E-1 · The capacity estimator — ✅ **SHIPPED b9bcc54** (p70, both gates, with rule (e))

Run under rule (e) (elapsed unmarked work not charged — `AUDIT-UNMARKED-WORK.md`
§6). `evid` is how many rated days the estimator draws on; `over` is the share of
the user's 27 working days it calls over capacity on at least one axis.

```
estimator                     mental physical  social creative  evid  over
max of tolerated (SHIPPED)      4.48     7.31   11.84     1.88    4d   41%
p80 of tolerated                4.40     3.96    9.20     1.68    4d   52%
median of tolerated             4.08     2.87    8.04     1.32    4d   67%
max of ALL rated days           9.08     7.31   20.19     3.57   15d    4%
p90 of ALL rated days           7.57     3.88   14.39     2.29   15d   37%
p80 of ALL rated days           5.97     3.26   11.41     1.87   15d   44%
p70 of ALL rated days           5.19     2.83    8.77     1.75   15d   63%  <- RECOMMENDED
median of ALL rated days        4.34     2.50    6.95     1.03   15d   70%
```

**Recommendation: the 70th percentile over ALL rated days.** It wins on three
counts, not one:

1. **63% matches the only calibration evidence that exists** — the user's own
   report of being at or above their ceiling most days.
2. **15 days of evidence rather than 4.** Every "of tolerated" row rests on four
   days; that thinness is the estimator's worst property.
3. **It breaks the circularity.** Filtering to days rated non-negative means a
   day you tolerated can *never* be reported over its ceiling — the ceiling is
   *defined* as the worst day you were fine on. Drawing from all rated days
   removes that, and unlike `Math.max` a quantile can move **down** when
   tolerance drops.

**The physical axis is the clearest evidence against the shipped estimator:**
`max of tolerated` says 7.31 on the strength of one outlier day, while every
quantile puts it at 2.5–3.9. And `max of ALL rated days` flags only 4% of days,
which shows `max` is the wrong statistic whatever filter is applied to it.

**RESOLVED 2026-09-20 — the user chose p70 over all rated days.** Their words:
*"P70, no idea what that means but go for it."* — so it was explained back before
building: line up every measured day lightest to heaviest, p70 is the one 70% of
the way along, and `max` takes the single heaviest day you ever tolerated, which
is why one unusual day was setting the whole physical ceiling at 7.31 against
2.5–3.9 on every other observation.

### E-1.1 — it is COUPLED to rule (e), and must ship with it

⚠️ **The measured numbers above assume elapsed-unmarked work is not charged.**
The probe applied rule (e) by hand; `energy.js` does not implement it — five
charge sites still count elapsed unmarked work in full. Shipping p70 alone would
produce a capacity vector that does not match anything measured here, so the two
land together:

1. **Rule (e) at every charge site**, through one shared predicate rather than
   five copies of a filter — `isCharged(task, now)`. This repo's recurring bug is
   the walk that got forgotten, and there are five of them here.
2. **p70 over all rated days** in `learnedCapacity`, replacing `max` over
   tolerated days.

**`now` has to be threaded** into `energyTrajectory`, `dipIfPlaced`,
`energyBudget` and `spendRestore`, which currently take none. Defaulting to
`new Date()` follows `learnedCapacity`'s existing convention in the same file;
tests inject a fixed clock (sharp edge #8).

---

### E-1 (original brief, retained for the reasoning)

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

### E-1.2 · An unplanned benefit, found by the adversary AFTER shipping

The E-3a adversarial review (`design/E3A-LATE-WORKOUT.md` §3b) found a feedback
loop nobody on this feature was watching, and it runs through **`learnedCapacity`
— not the preference model** everyone assumed was gating it (`modelMaySpeak()` is
false, so the ML loop is shut; this one is not).

Measured: planting one 90-minute demanding block at 21:30 into each rated day
moves capacity from `{4.354, 3.075, 8.438, 1.575}` to
`{5.500, 3.330, 9.368, 1.575}` — **mental +26%**. The chain closes: heavier days →
higher ceiling → `spent/capacity` falls → heavy looks cheaper → more of it. And
`energyBudget().over` stops firing, so the one surface that would say "this is a
lot" goes quiet exactly when it should not.

**p70 is what makes that recoverable rather than a ratchet**, because a quantile
can move DOWN and `Math.max` structurally could not. The estimator change was
made for thinness and for the user's lived experience; it turns out to also be
the only brake on a loop that was never considered. Recorded so nobody
"simplifies" it back.

**Still open:** the loop is damped, not closed. Any future term that shapes which
days get scheduled must not then feed the ceiling it divides by.

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

### E-3a · When a demanding activity is the RIGHT answer — decided 2026-09-20

The bake-off flagged one place its recommendation read wrong: with `dir = +1` the
scorer ranks the **shortest** demanding activity first when the user is fresh,
i.e. "do the short workout on a rested morning". Put to the user:

> *"I like working out either early in the morning or last thing at night, so
> yes. Do the workout while rested is accurate since I am rested in the morning —
> but it also applies to at the end of the day prior to resting."*

**So the flagged behaviour is CORRECT and the note comes off E-3.** But the
second half is a new requirement and it is not the same thing:

**A demanding block at the END of the day is not about arriving rested.** At
22:00 the reserve is deep, so any scorer keyed on arrival depletion will rank a
workout badly — exactly when the user wants it. What makes it fine is that
**nothing follows it**: the cost of going deeper only matters if there is
something left to protect, and at the end of the day there is not.

**Nothing in the engine expresses this.** `arrivalDepletionFor` asks how spent
you are when you sit down and never asks what comes after; `dipIfPlaced` asks
what placing this costs the rest of the day, which is nearer but still measures
the wrong end. The quantity that matters is **how much day remains after the
block** — small or zero means a spend is nearly free.

**To test in the second session**, and note it interacts with the sick-day tail:
a recovery day's reduced ceiling should not push a late workout out, because the
late workout was never the thing overloading the day.

### E-5 · The bucket vectors — **RESOLVED 2026-09-20: they are correct**

> *"A lecture costs more social energy for me since my classes tend to be seminar
> style and I need to put effort into how I'm acting."*

**The coursework bucket's `social 1.49 > mental 1.24` is right, and no
re-authoring is needed.** This closes the largest open question hanging over the
axis work, and it closes it in the direction that vindicates the model: the
+196 social load-hours against mental's +35 are not a parameterisation error.

⚠️ **This changes how the separability analysis must be read.** That report
proposed the bucket vectors as the likeliest confound — that the engine was
disagreeing with its own user on 22 of 102 samples and that the disagreement,
not physiology, was what the axis tests were measuring. **It was not.** The axis
assignment matches how the user experiences their classes, so C1's null is a
genuine null about the data rather than an artefact of mis-authoring, and the
prerequisite E-6 was waiting on is already satisfied.

### E-5b · The original bucket-vector brief, now closed

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

### E-8 · Commitment generation — **raised in rank; this is the feature's purpose failing**

**Scope, decided by the user 2026-09-18:** *"The purpose of the commitment button
is to make sure I'm studying. It isn't helpful for extraneous things — those can
be tasks."* So **commitments are recurring study time; anything with a deadline
is a task.** No deferral or extension state is to be built — an extension belongs
to a deliverable, not to "study four hours a week". A week spent ill did not get
studied, and the hours are not owed later; the engine's existing `passed` state
already says exactly that (*"a shortfall must never be manufactured by the
passage of time"*).

**The defect.** Seven commitments ask ~1,335 min/week; the schedule carries
**15 sittings totalling ~1,660 min across five weeks** — roughly a quarter of the
ask. One generated nothing at all before it expired; three generated 20–35 min
against asks of 135–240. Given the stated purpose, this is not a rough edge, it
is the feature not doing its job, and it ranks above the picker work.

Whether this is "no openings found" or "generation never ran" is not answerable
from an export — **it needs a live reproduction with the user driving.**

### E-9 · Where commitments land in the week — noted, not yet a task

**The user's guidance, 2026-09-18:** *"I don't want commitments to over-burden my
week. I'm usually able to do things on the weekends but classes can really tire
me out. I don't think it is scheduled that poor right now, but it is something to
think about."*

**The data already half-agrees**, so this is not speculative:

- **Classes are the most draining bucket in the file** — mean energy facet −0.62
  (n=8; six of eight are −1). Only the gym is net-positive.
- **Sunday is already the heaviest day** (mean 10.8 h, n=3; its *minimum* exceeds
  the overall median). The weekend is being used.
- **Saturday is where the room actually is** — median 4.5 h against Sunday's
  10.8, and all three Saturdays carry zero mental load.

**No new mechanism is needed.** `w.energy` in slot scoring already exists to push
work off days the user will arrive at depleted; it is running on a ceiling set by
one day per axis, from a bad-day-weighted sample, and it saturates the moment
they cross it. **E-1 and E-2 are this problem.** Revisit only after those settle,
and only if the placement is still wrong — the user's own read is that it is not
currently bad.

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
