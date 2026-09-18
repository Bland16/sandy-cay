# AUDIT PLAN — the learning model and the wrap report, against real lived data

**Session 9, 2026-09-18.** Status: **PLAN — not yet run.** Commissioned by the
user while their own export is available.

Every previous audit in this repo was run against **fixtures we built**. That is
how `design/AUDIT-DETECTORS.md` (2026-09-09) found twelve claim-making surfaces
and proved eight of them capable of printing something false. It answers *"what
can this detector be made to say?"*

This audit answers a different and harder question: **"what does the app actually
say to this person, about their real four weeks, and is each statement true?"**
A detector that can be made to lie may never lie in practice; one that looks
sound may be lying right now. Only real data separates those.

---

## 0. Rules of engagement — not negotiable

1. **The data never enters the repo.** `schedule-*.json` is gitignored. Findings
   are written up with course codes, club names, locations, people and the
   hospital **anonymised** — "a 3-hour lab", "a recurring evening class". This is
   the rule `design/probes/README.md` already sets for real-schedule data, and
   this repo is public.
2. **Read-only against the export.** The audit never writes back to the user's
   file. Probes load it, copy it in memory, and throw the copy away.
3. **Independent recomputation, or it proves nothing.** A number is NOT verified
   by calling the function that produced it. Each claim gets a second,
   deliberately separate計 computation — walking the raw JSON by hand — and the two
   are diffed. Checking `getWeekLoad` with `getWeekLoad` is how every audit in
   this repo that missed something missed it.
4. **Prove by execution.** Probes in `design/probes/`, runnable, kept. No finding
   is recorded from reading code alone.
5. **A finding names the sentence.** Not "the denominator looks wrong" but the
   literal string the user would read, and the true value beside it.

---

## 1. What the data is

Four lived weeks, one real person, mid-term. Anonymised shape:

- 153 tasks, 1 zone, 11 buckets, 49 library activities, 7 commitments
- 102 rated samples through `ratedSamples()` — 82 one-off, 20 recurring
  occurrences; 101 carry `overall`, 36 carry the `energy` facet
- 87 distinct cross-validation fold groups
- Lived weeks: w/c 24 Aug, 31 Aug, 7 Sep, 14 Sep — the last of which is the
  **sick stretch** (`design/SICK-DAYS.md` §1), and must be audited *as* one

---

## 2. Part A — the learning model

### A1. Already measured, 2026-09-18

| | value |
|---|---|
| saved `skill` (cross-validated R²) | **−0.198** |
| `skill` after retraining on all 101 samples | **−0.208** |
| `modelMaySpeak()` | **false** |
| `overall` distribution | **58 fives, 20 fours, 10 threes, 10 twos, 3 ones** |
| `energyCalibration` | calibrated, 5 weeks rated (needs 3) |
| `learnedCapacity` | mental 5.37 · physical 7.31 · social 11.84 · creative 2.17 |

**Negative R² means the fit predicts held-out ratings worse than predicting the
user's own average.** The gate is therefore working exactly as SPEC §5 designed
it: the model has earned nothing and is correctly silent. That is the system
behaving well. It is also a model that does nothing for this user, and has not
since they started.

### A2. The questions this audit must answer

- **A-Q1. Is the model failing, or is the signal absent?** 58% of ratings are a
  5. A ridge fit cannot find structure in a near-constant target. Separate the
  two hypotheses by measuring the variance of `overall` against the variance the
  features could explain at best. **If the target is near-constant, no estimator
  change fixes this and the recommendation is about rating behaviour, not code.**
- **A-Q2. Which features carry any signal at all?** Per-column observation counts
  and weights, on the real pool. `design/TODO.md` M-5 has a standing backlog
  (closed-form solve, analytic LOO for λ, per-column shrinkage `n_j/(n_j+4)`);
  this measures whether any of it would help *this* user or is theory.
- **A-Q3. Does M-1's cross-validation collapse apply here?** `TODO.md` M-1 says
  fold sub-models are muzzled by the same `coldStartRatings` they are tested
  against, cratering skill in the n=12–14 band. This user has n=101 across 87
  groups, so they are **not** in that band — but confirm the measured −0.198 is a
  real result and not a residue of the same muzzling at fold level. **This
  changes the interpretation of the headline number, so it is the first thing to
  settle.**
- **A-Q4. Is `learnedCapacity` trustworthy?** It is `Math.max` over per-day dips —
  the highest-variance order statistic, monotone in n, so it can only ratchet
  upward and never contracts when tolerance drops (the code says so itself).
  Social 11.84 against creative 2.17 is a wide spread: is that a real difference
  in the user's life or one outlier day? Recompute with a high quantile and a
  larger evidence floor and show both numbers side by side.
- **A-Q5. What does the sick stretch do to all of the above?** Recompute A-Q1→Q4
  with the four sick days excluded, per `SICK-DAYS.md` §3. The delta **is** the
  business case for that feature, measured rather than argued.
- **A-Q6. Does the energy facet have enough coverage to steer?** 36 of 102. Its
  values are heavily −1 (22) against +1 (11) and 0 (3). Establish whether
  `steerBias` is reading a genuine pattern or the user's habit of only rating
  energy when it was notable.

### A3. Method

One probe per question, each printing its inputs, its independent recomputation
and the app's own answer side by side. `probe-real-ml-*.mjs`.

---

## 3. Part B — the wrap report, every claim

### B1. The surfaces

`buildWrapReport` composes eleven builders, each of which can print a claim:
`buildAccomplished`, `buildPlanDiff`, `buildSuggestions`, `buildInsight`,
`buildDeadlineBuffer`, `buildWeekContext`, `buildCommitments`, `buildDayStrips`,
`buildPatternDiff`, `buildRoutines`, plus the six detectors they call
(`driftCheck`, `starvationCheck`, `skipStreakCheck`, `pinnedRatioNote`,
`overpackCheck`, `durationFitSuggestion`).

### B2. The method — generate, then contradict

**For each of the four lived weeks:**

1. **Generate the real report.** Capture every sentence, number and denominator
   it would put in front of the user.
2. **Recompute each number independently** from the raw JSON — a separate walk
   that does not call the reporting code. Diff.
3. **For every claim, ask the three questions** the 2026-09-09 audit established
   as the failure shapes:
   - **What is the denominator, and is it the one the sentence implies?** "12 of
     12" and "across 24 ratings" were both wrong this way.
   - **What is the time scope, and does the sentence's tense match it?** A
     lifetime counter inside a weekly report is how "keeps getting pushed"
     described something finished in March.
   - **Would a reader draw a true conclusion from it?** A technically-true
     sentence that reads as a stronger claim is still a defect (P-1).
4. **Record the literal string** and the true value.

### B3. The ones to attack first

Ranked by how wrong the user-visible sentence can get, carrying forward what
`AUDIT-DETECTORS.md` left open and what `TODO.md` still lists:

- **E-1 · one block feeds several denominators.** A session tagged with three
  tags is a full sample in three populations, so twelve lived blocks produce
  three independent-looking "12 of 12" findings. **This user's activities carry
  4–5 tags each** — so this is not hypothetical here, it is the expected case.
  Measure how many report findings share underlying sessions.
- **E-2 · a one-off later made recurring is counted twice.** Check whether any of
  this user's 20 occurrence samples collide with a parent's own `satisfaction`.
- **E-4 · a rating on skipped work trains the model.** Count how many skipped
  items in the real data carry a `satisfaction` object.
- **E-5 · `lastFinishedLoad` still walks `schedule.tasks`**, missing recurring
  work — the ninth "one door" instance. Measure the ranking difference on real
  activities.
- **T-4b · the overpack detector cannot see the fullest day there is**, because
  gaps exist only *between* items. This user has 10–11-item days; check what the
  detector says about them.
- **Q-1 · the duration-fit floor.** Still open, still blocking. The real data can
  now answer it empirically: at floors of 3, 6 and 10, how many findings does
  this user's history produce, and how many of those would they recognise as
  true?

### B4. The sick week is the acid test

Run the full report for w/c 14 Sep — the sick week — and read every sentence as
the user would have read it that Sunday. **Any sentence that reads as a
judgement, or that draws a conclusion from four days of absence, is a P-1
violation and a finding.** This is the single most valuable page in the audit,
because it is the case the app has never been tested against and the one the user
actually lived.

---

## 4. What one export cannot tell us

Stated so the findings are not over-read:

- **One user, four weeks.** Nothing here generalises to a different rating habit.
  A finding is "true for this user's data", never "true in general".
- **No counterfactual.** We cannot know what the user would have rated had the
  app suggested differently, so the model's *usefulness* is unmeasurable. Only
  its **accuracy** against held-out ratings is.
- **Rating habits are confounded with everything.** 58 fives may mean a
  well-chosen week or an indifferent rater; the data cannot distinguish them.
  That question goes to the user, not to a probe.
- **The export is a snapshot.** It cannot show what the app displayed at the
  time, only what it would display now from the same state.

---

## 5. Deliverables and order

1. **`design/AUDIT-REAL-ML.md`** — Part A. Start with A-Q3, because it decides
   whether −0.198 means "the model is bad" or "the measurement is bad", and every
   other ML conclusion depends on which.
2. **`design/AUDIT-REAL-REPORT.md`** — Part B, one section per week, the sick
   week last and longest.
3. **A findings table** merged into `design/TODO.md` §1, in its existing ranked
   form, so the open work stays in one place.
4. **Probes kept** in `design/probes/`, re-runnable against any future export.

**Nothing is fixed during the audit.** Findings are recorded and ranked first, so
the fixing is prioritised rather than driven by whichever defect was found
earliest. That order is what `design/TODO.md` already does and it has worked.
