# The learning model — recommendations

**2026-09-02.** Consolidated from five independent analyses (feature set ·
learning equation · hyperparameters · gating & honesty · evaluation harness).
Four are in; the hyperparameter lens is still running and this file will be
amended.

Every claim below marked **✅ verified** was checked against source directly, not
taken from an agent report. Two agent claims were checked and **rejected**; they
are recorded at the bottom so nobody re-derives them.

**Anchor decisions (user, 2026-09-02):**

1. Remove the `moveCount` heuristic — *"sometimes I move the tasks when I make
   it, ie like 15 minutes earlier if it is placed late."*
2. **Use the energy trajectory in the actual rankings** — *"the fact that an
   event was unsatisfying is useless in the absence of my energy level prior to
   it."* See §0.0, which this promotes above everything else in the file.

---

## 0.0 The energy trajectory in rankings — directed, and already half-built

The user's argument is the correct one and it is the sharpest statement of the
model's central weakness: **a rating of 2/5 carries no information until you know
whether they arrived at that task already drained.** Without the prior state, the
model attributes to *the task, the tag, or the hour* what actually belonged to
*the day that led up to it*. Every weight in the vector is confounded by it.

Three facts make this cheaper than it looks.

**The training-side data is already being captured, and nothing reads it.**
✅ verified — `energyAt` is stamped at `Schedule.js:375` as
`reserveAt(this, startTime − 1ms)`: the reserve **one millisecond before the task
began**, i.e. genuinely prior state. Occurrences get it at `:412`, it rides
`ratedSamples` at `:455`, and it serializes at `Task.js:254`. Readers in `src/`:
**zero.** The only other mentions are comments explaining why it is recorded the
way it is — *"engine-recorded, never user-set, and never recomputed… recomputing
it later would be retroactive fiction."* The app has been diligently recording
exactly what the user just asked for and throwing it away.

**The inference-side twin already exists and is equally honest.**
`reserveAt(schedule, slot.start)` (`energy.js:201-205`) filters `startTime <= now`,
so it is prior state at both ends — train and serve agree, which is exactly what
`dayFill` gets wrong (§1.4).

**It is already a settled decision that was never built.**
`design/ENERGY-PLACEMENT-EVAL.md:433`:

> *"D-1 is settled on evidence: the energy term belongs in `scoring.js`,
> evaluated at the candidate slot."*

✅ verified — `scoring.js` and `placement.js` contain **no reference to energy,
reserve or `loadForTask`**. The decision was reached on evidence and the work
never landed.

### Why this outranks everything else in the file

It is **the only proposed feature that varies across candidate slots.** Per §1.1,
17 of the 30 columns are a constant offset added identically to every candidate
and can never move the arg-max — only `time` and `day` discriminate. So today the
preference term can do exactly one thing: pick an hour of day. Reserve-at-slot
lets it do the thing the app is actually for — *"not this slot, you'll arrive at
it wrecked."*

It also converts the confound into a control. Once the model can see the reserve,
the time-of-day weights stop absorbing "evenings are bad" when the truth is "the
end of a heavy day is bad" — which is the same fact the deleted day-shapes chart
was reaching for and could not express.

### Two ways to use it, and they are not exclusive

**(a) As a model feature — 1–2 columns.** Encode the deepest reserve across
spending axes, or `mental` and `physical` separately, normalized as
`min(1, −reserve/capacity)` against `config.energy.capacity`. Cost:
`featureVector(task, slot)` gains a `ctx` argument; three call sites
(`Schedule.js:151`, `openings.js:97`, `whatToDo.js:140`) pass it. ⚠️
`placement.js:308` calls `_modelScore` **inside the per-slot loop**, so a naive
`reserveAt` per candidate walks the day's tasks every time — precompute one
reserve walk per day outside the loop.

**(b) As an explicit scoring term — D-1's own answer.** A first-class `w.energy`
in `scoring.js`, evaluated at the candidate slot. More direct, narratable without
the model, works at n=0 ratings, and is what the eval doc actually settled on.

**Recommendation: build (b) first, then (a).** (b) needs no ratings at all, so it
helps a brand-new user and is not gated behind cold start; (a) then lets the
model learn *how much* the reserve matters for this particular person rather than
using a fixed weight. Doing (a) alone leaves the feature inert until n≥10 —
exactly when the user's complaint bites hardest.

⚠️ **Blocked on §3.5.** Both routes normalize against capacity, and
`learnedCapacity` currently walks `schedule.tasks` instead of `ratedSamples()`
*and* falls back to the invented config prior per axis. Fix that first or the
denominator is fiction.

⚠️ **Gate it.** `loadForTask` returns a zero vector when no bucket matches, so
for a user whose tags carry no load the column is constant — gate it silent
rather than let it contribute noise.

---

## 0. The three findings that reframe everything

### 0.1 What ships is not ridge regression ✅ verified

`config.js:73` — `lambda: 0.1, learningRate: 0.05, epochs: 400`.

Simulation against a replication of the exact `train()` loop (`learning.js:170-183`):

| epochs | distance from the ridge optimum |
|---|---|
| 100 | 63.5% |
| **400 (shipped)** | **63.5%** |
| 4,000 | 31.2% |
| 40,000 | 0.8% |

The shipped weight vector sits ~64% of a solution-norm away from the ridge
solution SPEC §5 names. **Early stopping, not λ, is the actual regularizer** —
and it is a data-dependent one: after the `/totalW` divide the per-epoch
contraction scales with a column's frequency, so a bucket seen twice in thirty
samples is shrunk enormously while a common one is barely shrunk at all.

That matters because **the Cabana ranks features by raw `|weight|`**. Magnitudes
are not comparable across columns, and the thing doing the shrinking is unnamed,
unlogged and untunable.

λ = 0.1 is roughly **100× too small**: against `Σwᵢ ≈ 40` at n=30 it is ~0.25% of
the data term. Measured ranking accuracy (0.5 = chance):

| | n=10 | n=30 | n=60 | n=200 |
|---|---|---|---|---|
| GD-400 (shipped) | 0.627 | 0.715 | 0.794 | 0.890 |
| exact, λ=0.1 | 0.641 | 0.673 | 0.773 | 0.906 |
| **exact, λ=8** | **0.661** | **0.735** | **0.816** | **0.911** |

Exact-λ=0.1 is *worse* than the un-converged loop at n=20–60 — direct
confirmation that early stopping is what's currently keeping the model alive.

### 0.2 The model as built loses to a smart average

Against per-cell empirical-Bayes shrinkage — which is `getSatisfactionMatrix`,
**the table the wrap report already prints**:

| | n=20 | n=30 | n=60 | n=200 |
|---|---|---|---|---|
| GD-400 (shipped) | 0.684 | 0.742 | 0.802 | 0.896 |
| EB-cell average | 0.695 | 0.750 | 0.808 | 0.903 |
| **ridge λ=8** | **0.709** | **0.766** | **0.825** | **0.918** |

**The model family was the right choice and the estimator threw the advantage
away.** Properly regularized ridge beats the average at every n — because it
de-confounds correlated columns (your gym is always 07:00, so a per-cell mean
cannot separate the tag from the hour; a joint fit can). As shipped, it loses.

This is the benchmark to build first. If a fixed model can't beat the shrunken
tag×time mean, the honest conclusion is that **the average should be the
preference term**: no gradient descent, no learning rate, no divergence guard,
and it explains itself in one sentence.

### 0.3 Most of what the app says it has learned is noise

Fraction of the top-3 narrated weights that correspond to a genuinely non-zero
effect:

| | n=10 | n=30 | n=60 | n=200 |
|---|---|---|---|---|
| GD-400 (shipped) | 27% | 49% | 64% | 89% |
| exact, λ=8 | 32% | 60% | 78% | 98% |

Largest weight landing on a feature whose true effect is exactly zero: **0.176 at
n=30** for the shipped fit, against a strongest-true-signal of 0.20.

**At n=10 — the threshold the app currently crosses to start speaking — roughly
two of the three sentences the Cabana and the wrap report state as learned
self-knowledge are noise, and the noise is the same size as the signal.** The
`|w| > 0.01` filter (`Cabana.jsx:177`, `report.js:324`) is ~20× below the noise
floor and filters nothing.

---

## 1. What to take into consideration — the feature set

### 1.1 Two structural facts

**The vector is ~30 columns and n is 10–30.** `6 tags + 6 time + 7 day + 7
duration + 4 scalars`. The model lives its entire realistic life at p ≈ n.
**Every column removed is worth more than any column added.**

**Only 13 of the 30 columns can change a placement.** `findBestSlot` scores one
fixed task at one fixed duration across candidate slots — only `time` (6) and
`day` (7) vary. Everything else is a constant offset added identically to every
candidate and cannot move the arg-max. The 17 constant columns still earn their
keep as **training-time confound controls**, but only if they are honest. Two are
not.

### 1.2 REMOVE — all three in one layout bump

| Column | Why | Verified |
|---|---|---|
| **`moveCount`** (`learning.js:83,86,96`) | User directive. **It counts only the user's own drags — never engine displacement** (§1.3b), so it is not *partly* contaminated by a creation-time nudge, it is entirely made of nudges. Inert at placement. In `whatToDo` it actively downranks repeatedly-shoved work — fighting `starvationCheck`, whose whole job is to surface it. | ✅ |
| **`placedByUser`** (`learning.js:82`) | **The same nudge sets it** — `Task.moveTo` writes `placedBy='user'` (`Task.js:135`) *and* increments `moveCount` (`:136`). **Plus real leakage:** completing a task from inside its block passes `endTime: cut` (`App.jsx:342`), and `updateTask` does `if (timeChanged) t.placedBy = 'user'` (`Schedule.js:346`) — **finishing early sets the feature.** Also forced constant for occurrences (`Schedule.js:451`), and double-counts `w.stability` (`scoring.js:116`). | ✅ |
| **`priority`** (`learning.js:78`) | User-controlled, defaults to 3 so near-constant (collinear with the intercept), inert at placement, and double-counted in `whatToDo` — which adds an explicit priority term *and* a preference term already containing one, possibly with opposite sign. | ✅ |

**One bump for all three.** A version bump costs exactly one retrain, so batching
is strictly cheaper than three separate ones.

### 1.3 The migration is already solved ✅ verified

- `MODEL_LAYOUT_VERSION = 4` (`learning.js:22`)
- `fromJSON` discards weights outright on mismatch, sets `needsRetrain`
  (`:253-256`)
- `Schedule` constructor retrains immediately (`Schedule.js:139`)
- Ratings persist on tasks and in `occurrenceData` — **weights are disposable**
- `tests/learning.test.js:121-133` asserts against the *constant*, not a literal,
  so no test edit is needed

**Discard-and-retrain is correct. Do not pad and do not build a name-keyed weight
store** — `train()` already rebuilds `w` from zeros on every call (`:137`), so
there is nothing to preserve.

⚠️ **`moveCount` is the last column, so a forgotten bump fails silently.**
`modelScore` walks 29 feature values against 30 stored weights; the first 29 still
align. No crash, no NaN, no error — just quiet drift in every placement, and a
phantom `moveCount` row still rendered in the Cabana because `inspect()` maps over
`labels`. **The guard must be structural:** assert `weights.length ===
labels.length` and snapshot the label array.

**Keep recording `history.moveCount`.** Only the *feature* goes. The field is in
`SPEC.md:40`, round-trips through `Task.toJSON`, is snapshotted by drag-undo
(`interaction.js:253-262`), and rides the Google encoding across four tests.
Removing it is a schema change with real blast radius for zero benefit — and it
is the raw material for an honest replacement later (an engine-only counter;
`placeAt(…, {countMove:true})` is already the engine-only door and nothing
currently passes it).

### 1.3b Considered and declined: gate `moveCount` instead of removing it

**Asked 2026-09-03:** *"can we instead alter it to only add if it is moved 10
minutes after initial placement?"* — i.e. keep the feature, but stop counting the
nudge-at-creation.

**Answer: gate the counter if you like, but the feature still goes.** The two are
separate decisions and they come out differently.

#### What `moveCount` actually counts ✅ verified

It is incremented only by `moveTo` (`Task.js:136`, `countMove` defaults **true**),
and `moveTo` has exactly **one caller in the codebase**:

```
src/ui/useCardInteraction.js:396   t.moveTo(newStart)   // R-1: manual action wins
```

`placeAt` defaults `countMove = false`, and **no caller anywhere passes `true`**:

```
placement.js:394    task.placeAt(best.slot.start)     // autoSchedule
ripple.js:144       t.placeAt(newStart)
gapActions.js:211   pick.task.placeAt(pick.slot.start)
```

**So `moveCount` does not mean "how often this got shoved around." It means "how
often the user dragged this."** It has never once counted engine displacement.
The column is not partly contaminated by creation-time nudges — it is entirely
made of user drags, of which the creation nudge is one kind.

#### Why the gate does not rescue the feature

Three reasons, none of which is contamination:

1. **Inert at placement.** `moveNorm` is a task-level constant — identical for
   every candidate slot — so it cannot move the arg-max (§1.1). A gated
   `moveCount` is a cleaner number that still cannot affect where anything goes.
2. **Harmful where it isn't inert.** In `whatToDo` it downranks work that has
   been moved often, fighting `starvationCheck`, whose entire purpose is to
   surface that work. The gate does not touch this.
3. **Narrating it is moral bookkeeping.** A learned weight on "how often you
   hand-move this," told back to the user, is a claim about their rescheduling
   behaviour — the P-1 line.

Plus §1.1: at p ≈ n, a column that cannot affect placement and cannot be safely
narrated is pure cost.

#### The gate itself: needs a timestamp the app does not have

✅ verified — **there is no creation timestamp on `Task`.** No `createdAt`, no
`addedAt`, no `Date.now()` anywhere in the file. A 10-minutes-since-placement
gate would require a new persisted field, touching both serialization halves —
the exact shape of the `freq`-loss sharp edge already recorded in this codebase.

#### The cheaper version of the same instinct

The distinction actually wanted — *"I tweaked this as I made it"* versus *"this
kept getting moved"* — is already available at the call site, with no clock and
no migration, because the two run through **two different doors**:

| Door | Who | Counts today |
|---|---|---|
| `moveTo` | the user's drag | `moveCount` |
| `placeAt` | the engine (autoSchedule, ripple, gap actions) | **nothing** |

And the engine-side signal partly exists already: `displacedCount`,
`rippleCount`, `carriedCount` — and `starvationCheck` reads
`displacedCount + carriedCount`, **not** `moveCount` (`detectors.js:61`).

**Recommendation:** drop `moveNorm` from the model as planned; keep recording
`history.moveCount`; and if the "app kept moving this" signal is wanted complete,
pass `{countMove: true}` from the three `placeAt` sites into an engine-side
counter. No timestamp, no migration.

If the creation-nudge-vs-later-reschedule distinction is still wanted as a stored
fact, it does need the timestamp — but the prior question is what would consume
it. It cannot help placement, and for detectors `displacedCount` is the better
input.

### 1.4 FIX — columns already present and already wrong

**Duration leakage — highest severity.** `featureVector` reads
`task.getDuration()`, i.e. the task's *current* `endTime`. But ticking a task done
from inside its block **writes a truncated `endTime`** (`App.jsx:342`). So the
column holds the *lived* duration for a task ticked during its span, the *planned*
duration for one ticked afterwards — and at inference it is always *planned*. The
column's meaning depends on when the user happened to press the check, and it is
a consequence of the outcome: "I finished early and rated it 5" trains
`dur:15-30 → +`, and the model then books 20-minute blocks for 60-minute work.
Fix by stamping `plannedDurationMin` at rating time alongside `dayFill`.

**`dayFill` train/serve skew.** At inference the task is unrated, so
`dayFillAtCompletion` is `null` and `?? 0` serves **0**, while training saw
0.2–0.6. With a negative learned weight, every inference prediction is inflated —
and combined with `clamp(pred,0,1)` this can pin the preference term at 1.0 across
all candidates, silently disabling `w.preference` for exactly the tags the user
likes most. Impute the training mean instead, and distinguish `null` from 0.

**`_dayFillAt` measures the wrong thing.** `Task.js:79` and `Schedule.js:378` both
say "how full the day was **when this task began**." The implementation sums
`getTasksForDay(date)` — the *whole* day as it stands at rating time, including
work scheduled after the rated task. Compare `reserveAt` (`energy.js:201-205`),
which correctly filters `startTime <= now`. `energyAt` is honest about cause and
effect; `dayFill` is not.

### 1.5 ADD

| Feature | Value | Cost |
|---|---|---|
| **Reserve-at-slot** (from `energyAt` / `reserveAt`) | **High — the only proposed feature that varies across candidate slots**, i.e. the only one that can make `w.preference` do more than pick an hour. Lets the model learn *"I rate things badly when I arrive already drained"* — a statement about the day's shape, not about the user. `energyAt` is engine-recorded and never recomputed, which is the app's own standard for an honest feature; nothing reads it today. | `featureVector` gains a `ctx` arg; 3 call sites; precompute one reserve walk per day outside the slot loop |
| **`isOccurrence`** | Free confound control, already on every sample (`Schedule.js:457`). Recurring life and one-off life are different experiences under the same tag. Recovers honestly what `placedByUser` was doing by accident. | 2 lines |
| **`isChunk`** (`parentId != null`) | Settles an open question — a 45-minute slice of a 4-hour project is not a standalone 45-minute task. | 2 lines; add only after the duration block is trimmed (collinear) |

**Rejected:** deadline proximity (`w.buffer` is already a first-class saturating
term — a learned duplicate could learn the opposite sign and silently fight it);
day notes / blocked days (fires on a handful of samples out of 30); zone fit
(near-constant at 1, since zones are already a hard upstream constraint).

### 1.6 RE-ENCODE

- **`day:*` 7 one-hot → weekday/weekend (+Sunday).** Saves 5 columns. For a
  recurring-heavy user, day-of-week is a proxy for *which recurring thing
  happens* and is near-totally confounded with tag. Loses the ability to say "you
  like Tuesdays" — which the data could never honestly support anyway.
- **`dur:*` 7 buckets → 4** (`[30, 60, 120]`). Real durations cluster on 30/60/90
  around `defaultDuration: 60`; three of seven buckets are permanently empty at
  n=30. Fix the truncation leakage first — trimming a contaminated column is
  polishing.
- **Keep one-hot over cyclic** for time-of-day. `sin/cos` would be the better
  estimator at n=30 and is **not narratable** — "+0.31·sin(2πh/24)" cannot become
  a Cabana sentence. This is the explainability constraint doing its job; record
  the trade rather than revisiting it.

**Net: 30 → 18 columns**, roughly halving p against an unchanged n.

### 1.7 Vocabulary

- **`retiredTags` is never consulted.** `Schedule.retiredTags` has a full
  retire/unretire API (`Schedule.js:813-830`) and `learning.js` has no reference
  to it. A tag the user explicitly retired can still hold a vocab slot on
  historical ratings and crowd out a live one. One-line fix, unambiguously
  correct.
- **No recency.** Vocabulary is lifetime frequency. A summer of `social` ratings
  holds a slot against a term's `pset` for months.
- **The 6th slot flaps.** At n=30 counts are single digits, so slots 5–6 change
  between weekly retrains — and the Cabana narrates a preference for a tag that
  has no column next week. Require a minimum count (≥3) for membership.
- **A fixed N is the wrong control.** Cap columns-*per-sample*, not columns:
  `min(topTags, floor(n/8))`.

---

## 2. What equation — keep ridge, replace the solver

**Recommendation: keep ridge linear regression. Swap gradient descent for a
closed-form Cholesky solve.**

At p ≈ 29 there is no argument for iterative optimization. Building `XᵀWX` is
~180k flops at n=200; Cholesky is `p³/3` ≈ 9k. **The exact solve is ~25× cheaper
than the 5M-flop loop it replaces, and it is exact rather than 64% of the way
there.**

What that buys, concretely:

1. **Determinism.** No dependence on `epochs`, `learningRate`, or float
   accumulation order across 400 epochs. A probe gets identical weights on any
   machine, forever.
2. **Divergence stops being a failure mode.** `XᵀWX + Λ` is positive definite, so
   Cholesky always factors. There is no learning rate to blow up. The
   `Number.isFinite` guard survives as a cheap assertion rather than the
   load-bearing safety net it currently is — which matters, because §4.2 shows it
   doesn't actually hold that weight.
3. **λ becomes measured, not guessed.** Ridge has an analytic leave-one-out:
   `LOO = (1/n)Σ[(yᵢ − ŷᵢ)/(1 − Hᵢᵢ)]²`, and `diag(H)` falls out of the
   factorization you already have. Sweeping 8 values costs ~1.5 ms and turns
   `config.learning.lambda` from a magic number into a measured one — which is
   what "prove by execution" asks for. Expect it to land near 8.
4. **Uncertainty is free.** `σ̂²·diag((XᵀWX + Λ)⁻¹)` from the same factor gives a
   **standard error per weight**. This is the tool P-2 has been asking for: the
   Cabana can say *"mornings, +0.20 ± 0.06, across 9 rated mornings"* and stay
   silent when `|w| < 2·se`.
5. **Block weights become true deviations.** With an unregularized intercept, the
   ridge optimum forces each one-hot block to be zero-mean — so "0 means neutral"
   becomes *literally true*, which both `inspect()`'s docstring and
   `openings.js:33-37` already lean on. The un-converged loop does not get there:
   measured, the time block carries a shared +0.041 of pure level and the bias is
   short by half.

**Rejected alternatives:** ordinal/logistic regression (adds 4 cutpoints at
exactly the n where parameters are scarce, forfeits the closed form and free LOO,
to buy a link function whose effect on *ranking* at n≤200 is within Monte-Carlo
noise); ensembles/trees/kernels (no per-feature sentence, and they'd lose on
accuracy at p≈n too); online/incremental updates (trades determinism for nothing —
a batch solve is sub-millisecond).

**Bayesian linear regression "survives" only in the sense that it *is* this
model** — ridge with an unpenalized intercept is exactly the MAP estimate under a
Gaussian prior. The posterior variance is one back-substitution away. Take the
standard errors; you don't need a different model.

### 2.1 The target

`(overall−1)/4` is fine. Per-user centering is a non-issue — one `Schedule` is one
person, and the unpenalized intercept absorbs their baseline exactly.

**Drop the `timingFit` ×2 sample weighting** (`learning.js:133`). Three problems:

1. **It doesn't match the spec.** SPEC §5 says "doubles sample weight *on time
   features*"; the code doubles the **whole sample** — tags, duration, `dayFill`
   and all. ✅ verified
2. **The spec's version isn't expressible.** Weighted least squares applies `W` to
   whole *rows*; there is no coherent way to weight column *j* of row *i*
   differently. The spec line should be retired, not implemented.
3. **It's semantically backwards and costs real sample size.** `timingFit ≠ 0`
   means *the timing was wrong* — so the doubled samples are the mistimed ones,
   while the target is `overall`. And doubling ~25% of samples cuts effective n to
   `(Σw)²/Σw² ≈ 0.89n`: **~11% of an already tiny dataset, thrown away.**

---

## 3. What weights to assign

### 3.0 The root cause — and it is one line ✅ verified

**Trained on 30 identical ratings — a person with no preferences whatsoever —
`inspect()` returns:**

```
bias = 0.176
tag:study = 0.165   priority = 0.099   time:morning = 0.042
day:mon = 0.024   day:tue = 0.021   day:wed = 0.024   day:thu = 0.024
```

`report.js:322-326` filters `|w| > 0.01`, takes the top 3, and the wrap report
narrates **"priority +0.099"** and **"tag:study +0.165"** as learned
self-knowledge — from data containing exactly one tag and one priority value. It
is one sentence away from *"you do better on Wednesdays."*

**Why:** the three one-hot groups each sum to 1, so each is exactly the intercept
direction. Nothing identifies the split, so intercept mass smears into the
columns — and the null-space direction converges ~400× slower than the signal
directions, so **`epochs: 400` is precisely the regime where the leak is
maximal**:

| epochs | 400 | 5,000 | 50,000 | 200,000 |
|---|---|---|---|---|
| bias | 0.176 | 0.259 | 0.483 | **0.500** ← honest |
| tag:study | 0.165 | 0.133 | 0.009 | **0.000** |
| priority | 0.099 | 0.080 | 0.006 | **0.000** |

**The fix is to initialize `b` to the weighted mean of `y` instead of 0**
(`learning.js:138`). Measured:

| | bias | tag:study | day:mon | time:morning | priority |
|---|---|---|---|---|---|
| flat data, as shipped | 0.176 | 0.165 | 0.024 | 0.042 | 0.099 |
| flat data, `b = ȳ` | **0.500** | **0.000** | **0.000** | **0.000** | **0.000** |
| real signal, as shipped | 0.212 | 0.156 | 0.021 | +0.471 | 0.119 |
| real signal, `b = ȳ` | 0.500 | 0.123 | −0.007 | **+0.372** | **0.000** |

Real signal survives and becomes *symmetric*; the spurious `priority` and `day`
weights vanish. Add group re-centering at train end (subtract each one-hot
group's mean from its weights, add it to the bias) — verified an **exact
reparameterization, max prediction change 1.11e-16**.

> **Synthesis note:** the closed-form solve in §2 gives both of these *for free* —
> the ridge optimum with an unpenalized intercept has zero-mean blocks by
> construction. So §3.0 is the cheap approximation and §2 is the real fix. Do
> §3.0 now (one line, ships today); do §2 when there's time. Do not raise
> `epochs` alone — at λ=0.1 that just moves the leak around.

### 3.1 The second-order harm: unobserved buckets are penalised forever

Because every *observed* bucket carries intercept mass, a bucket **never
observed** sits at exactly 0 and therefore scores *below* the others. Measured on
a real 10-rating model (mornings disliked, evenings liked):

```
09:00  morning, rated, DISLIKED  → 0.061
13:00  midday,  never rated      → 0.395
22:00  night,   never rated      → 0.395
17:00  evening, rated, liked     → 0.934
```

This is exactly the trap `learning.js:217-223` documents — and the gating built
to prevent it covers **only the 7 duration columns**. It is self-reinforcing:
never placed there → never rated → never observed → penalised.

### 3.2 The table

| Parameter | Now | Recommended | Basis |
|---|---|---|---|
| `lambda` | **0.1** (`config.js:73`) | **~8**, selected per-user by analytic LOO | Measured: λ=8–16 dominates at every n. 0.1 is ~100× too small |
| `learningRate` | 0.05 | **delete** | Dead under a closed-form solve |
| `epochs` | 400 | **delete** | Dead under a closed-form solve |
| `topTags` | 6 | `min(6, floor(n/8))` | Cap columns per sample, not columns |
| `w.preference` | 0.15, hard 0 below n=10 | **ramp with evidence** | See below |
| Narration floor | `\|w\| > 0.01` | **`\|w\| > 2·se`**, or one shell (0.25) | 0.01 is ~20× below the measured noise floor |
| `interactionMinSamples` | 4 | 4, **applied to every column** | Generalising a decision the project already made |
| **bias init** | 0 (`learning.js:138`) | **weighted mean of `y`** | §3.0 — highest-value single line in the file |
| `stabilityBonus` | 1 (`config.js:71`) | **wire it or delete it** | ✅ Dead config — see §3.4 |
| `reserveBias` | 0.2, `??` default only | **declare it in `defaultConfig`** | Largest nudge after `loadBias`, invisible to anyone reading config |

Two lenses measured λ independently and landed at **4** and **8**. Read that as
*"somewhere in 4–16, and 0.1 is wrong by 40–100×"*; the harness settles the rest.
At λ=0.1 the shrinkage factor for a bucket with 5 observations is `5/5.1 = 0.98` —
**functionally zero.** λ=4 has a narratable meaning: *a column speaks at half
strength once four ratings sit behind it* — the same evidence bar
`interactionMinSamples` already uses, so two config numbers collapse into one
idea.

### 3.3 The blend weight should scale with evidence

Three independent step functions fire at exactly `sampleCount === 10`:
`Schedule.js:145` (preference 0 → 0.15), `learning.js:208` (`modelScore` 0 →
live), `whatToDo.js:73` (0 → `0.3 × pref`). After `normalizeWeights`, **all five
scoring weights change discontinuously** at rating #10.

A floor is defensible — SPEC §5 states it as a product decision. What isn't is
that the floor is also the *ceiling*: **the eleventh rating buys the same
authority as the two-hundredth.**

Proposed ramp, keyed on a statistic the app already computes rather than a new
constant:

```
weeks = distinct ISO weeks containing a rating      (energyCalibration, energy.js:66)
a = 0                                if sampleCount < coldStartRatings (10)
    min(weeks / calibrationWeeks, 1) otherwise      (calibrationWeeks = 3)

w.preference = 0.15 × a
```

Why weeks and not a count: the same argument `energyCalibration` already makes for
capacity. Forty ratings from one frantic Sunday describe one Sunday. Using two
different answers to the same question in two modules is how the two ends of
`ratedSamples` drifted apart in the first place.

Measured authority, end to end with the real `score()`:

```
n       modelScore spread    contribution to total
 10          0.718                 0.0695
 30          0.748                 0.0724
200          0.752                 0.0728
```

**A model trained on 10 ratings already exercises 95% of the authority it will
ever have.** The spread is flat in n because λ is inert.

**And within a single day, the model decides outright.** `balance` is constant
per-day, `buffer` is constant, `stability` is binary on one slot — so only
`proximity` and `preference` discriminate between hours, and proximity's
per-hour force over a 4320-minute horizon is `0.3226 × 60/4320 = 0.0045` against
preference's full swing of 0.0968. **A ratio of 21:1.** Measured end to end with
a model trained on exactly 10 ratings: the task moves **nine hours** (08:00 →
17:00) — and those same 10 ratings produced `day:tue = +0.055` against
`day:mon = −0.019`, pure noise worth ~71 minutes of proximity, enough to change
the chosen day.

**The cliff is worse than "0 → 0.15."** Crossing `coldStartRatings` renormalizes
*every other weight down 9.7% simultaneously*:

```
n=9  : proximity 0.3571  balance 0.2500  stability 0.1071  preference 0       buffer 0.2857
n=10 : proximity 0.3226  balance 0.2258  stability 0.0968  preference 0.0968  buffer 0.2581
```

The tenth rating doesn't just switch the model on — it quietly weakens the
deadline buffer and day-balancing by a tenth, and nothing tells the user.

**Proposed:** `w.preference(n) = W_max · n/(n+k)` with `W_max = 0.30, k = 100`.
Today's 0.15 becomes the value at **100** ratings rather than 10; the cliff
disappears by construction; the ceiling rises for a well-evidenced model; and it
is narratable in one line — *"Your model has 30 ratings, so it's speaking at
about a third of full strength."* **High confidence on the shape, low on the two
constants** — these are the clearest thing for the harness to settle.

### 3.4 Dead and undeclared weights ✅ verified

**`stabilityBonus: 1` is never read.** Declared at `config.js:71` with the comment
*"raw bonus magnitude for a `placedBy:'user'` task (scaled by weight)"*, and
appearing in `scoring.js:6`'s formula docstring — but `placement.js:307`
hardcodes `? 1 : 0`. It is documented as Cabana-tunable and setting it does
nothing. Wire it or delete it.

**`whatToDo` has a second, undeclared weight vector** (`whatToDo.js:155-160`):
`0.4·fit + 0.35·urgency + 0.25·priority + (trained ? 0.3·pref : 0) + 0.15·energyBoost`.
None of it is in `config.js`, against SPEC §8's "all Cabana-tunable". And **the
sum changes with training state** — 1.00 untrained, 1.30 trained — so switching
the model on silently demotes fit, urgency and priority by 23%. The same
unannounced re-weighting as the placement cliff, in a second place. Note also
`0.3·pref` is **double** the placement weight, with no stated reason.

**`reserveBias: 0.2`** exists only as a `??` default at `suggest.js:24` and is
absent from `defaultConfig`.

**`generate.js:220` sums two incommensurate scales.** `distance − rank(d) × 0.25`
where `distance` is in *array indices* and `rank(d)` is a reserve depth in
*load-hours* (0–14). So `0.25 × 14 = 3.5` — energy can move a sitting **3.5 days**
off its ideal spread position, in a comb whose whole point is even spacing. The
comment says *"energy nudges, never overrides"*; the arithmetic disagrees on a
heavy week.

### 3.5 A P-2 hole in learned capacity ✅ verified

Two defects, thirty lines apart in the same file:

**`learnedCapacity` never got the `ratedSamples()` fix.** `energyCalibration`
reads `schedule.ratedSamples()` (`energy.js:73`) — with a comment citing
RATINGS-AND-LEARNING §3 for why. `learnedCapacity`, at `energy.js:220`, **still
walks `schedule.tasks`.** So for a recurring-heavy user the calibration gate now
opens while the estimator cannot see a single one of their ratings. *This is the
exact bug that document exists to fix, in the function it did not check.*

**And the per-axis fallback returns the invented prior inside a value presented
as learned.** `energy.js:235`:

```js
out[a] = okDips[a].length >= 2 ? Math.max(...okDips[a]) : prior[a];
```

With 3 mental-only ratings across 3 weeks, `calibrated: true` — and `physical`,
`social` and `creative` come back as **verbatim `config.energy.capacity`**. The
budget card then reports headroom for an axis the user has never spent a minute
on. The docstring at `energy.js:59-64` promises *"NEVER a fabricated ceiling"*;
the gate is global while the evidence is per-axis, so it does not deliver that.
**Fix: per-axis calibration — an axis with <2 evidence days returns `null` and
shows "still learning" for that axis.**

**Third: `Math.max` can only ratchet upward.** The maximum is the highest-variance
order statistic and is monotone non-decreasing in n, so capacity only ever grows
as the user logs more days and the `over` flag fires progressively less often
forever. It can never contract when a person's tolerance drops. Use a high
quantile with an evidence floor — the second-deepest tolerated dip, say.

### 3.6 The preference term is structurally weaker than its nominal weight

`scoring.js:110-119` sums terms each nominally spanning [0,1]. `proximityScore`
and `balanceScore` genuinely do. `modelScore` does not — its realized spread is
the spread of *predicted ratings*. A user who rates mostly 4s and 5s has
`y ∈ {0.75, 1.0}`, so predictions cluster in a ~0.25 band and the preference term
contributes at most ~0.025 against proximity's full 0.33. **3–4× weaker than its
weight implies.** This is arithmetic, not measurement — settle it with one probe
before concluding "the model has no effect."

---

## 4. Gating, cold start, and honesty (P-2)

### 4.1 The shipping bug — proven, not theorized

Probe at n=40: 30 daytime sessions rated 4, 10 late-night sessions rated 1.

```
time:morning   +0.2376
time:night     -0.4998   ← largest |weight|
REPORT PRINTS: "the model leans toward time:night"
```

**The report tells the user the app leans toward the one time of day they
consistently rated 1/5.** `Math.abs` in the *sort* is correct — magnitude is the
right ranking key — but the sentence was written for a signed list and survived
the rewrite that collapsed the list to one item.

It also prints raw labels (`dur:45-90`, `moveCount`), against SPEC §5's
"plain-language preferences" and §7.1's "plain language."

**The fix:** rank on a family-centered, evidence-shrunk, **signed** quantity in
the user's own unit.

```
centered_j = w_j − mean(w over OBSERVED members of j's one-hot family)
shells_j   = centered_j × 4          ← target is (overall−1)/4, so 0.25 = one shell
keep if |shells_j| ≥ 1.0 AND observations_j ≥ 4
rank by |shells_j|, CARRY THE SIGN
```

Family-centering kills the day-of-week noise for free and needs no tuned
threshold. One shell is *derived, not invented*: it is the smallest step the user
can actually express. Tags are the exception — they aren't an exhaustive one-hot,
so center them against 0.

> Across 40 ratings, **evenings** run about **2 shells below** your other times of
> day, and **45–90 minute sittings** about **1 shell above**.

### 4.2 Four verified defects around the guard

**`observations` is populated for 7 of ~30 columns.** ✅ verified — the loop at
`learning.js:154` is `for (const j of this.interactionIdx)`, and `interactionIdx`
is exactly the duration block (`:107-109`). Every tag, time, day and scalar keeps
its `fill(0)` initialization. `inspect()`'s docstring (`:220`) promises this
distinguishes *"0 because you have never tried this"* from *"0 because it is
genuinely neutral"* — for 18+ columns it delivers neither.

**`observations` is not serialized.** ✅ verified — `toJSON` (`:233-245`) omits
it, so after any reload every column reads as unobserved. **Nothing in §4.1 can be
built until both halves are fixed.**

**One NaN rating silently kills the model forever.** ✅ verified — both filters
test `typeof overall === 'number'` (`learning.js:117`, `Schedule.js:1068`), and
`typeof NaN === 'number'` is `true`. It propagates through `clamp`, every weight
goes NaN, the divergence guard fires and the model refuses to train — with no
error anywhere. The report then prints *"12 of 10 ratings so far — the model stays
quiet until it has enough to be worth trusting."* Fix: `Number.isFinite` at the
door, so a corrupt rating costs one sample instead of the model.

**`diverged` reaches no UI.** ✅ verified — written at `learning.js:194`/`:202`,
read only in `tests/learning.test.js`. It is not serialized either, so the reason
is lost on reload. A state the app knows and never says.

**And the divergence guard has a live blind spot.** Between `lr ≈ 0.6` and
`lr ≈ 2.0` at 400 epochs, weights blow to 10¹⁵–10²⁵⁰, **stay finite, pass the
`Number.isFinite` check, and set `trained = true`** — then `clamp` collapses every
slot to a constant. The existing test uses `learningRate: 1e9`
(`tests/learning.test.js:76`), which overflows all the way to Infinity: it tests
the far end and misses the entire realistic band. Add a magnitude bound
(`max|w| > 1e3` is impossible for a target in [0,1]).

### 4.3 Per-column confidence — shrink, don't cliff

```
c_j = n_j / (n_j + 4)        ← 4 = interactionMinSamples, an existing decision
w_eff_j = w_j × c_j          ← used by modelScore and inspect
narratable = n_j ≥ 4         ← separate, stricter, language-only gate
```

Two gates deliberately: the cost of a wrong ranking (a slightly worse slot) and
the cost of a wrong sentence (a printed claim about the user's life) are not
comparable. Note that zeroing thin-but-nonzero columns — what `learning.js:161`
does today — is the one option that actively *destroys* evidence.

### 4.4 Cross-validated R² as the authority gate

There is currently **no validation of any kind**. `trained` means "gradient
descent ran and produced finite numbers." A fit worse than predicting the mean
gets the same authority as a good one.

5-fold CV R² against the intercept-only baseline, computed inside `train()`
(sub-millisecond at this size):

```
cvR² ≤ 0  →  no skill on unseen data  →  authority 0, narration silent
cvR² > 0  →  authority per the §3.1 ramp
```

**The threshold is zero, and zero is not a tuning choice** — it is the definition
of "no better than assuming every sitting is average." This is the only proposed
gate that measures whether the model is *right* rather than how much the user has
typed, which is what P-2 actually asks for.

### 4.5 Quota language — the EnergyShape rule, applied everywhere

`EnergyShape.jsx:118-122` makes the sharpest P-2 argument in the codebase:

> *"Drawing no ring claims nothing… the forbidden thing was inventing a ceiling,
> **not declining to narrate its absence**."*

It is applied in exactly one place. Every other surface narrates the absence, as a
shortfall measured in the user's unfinished homework — `WrapReport.jsx:292`
("6 of 10 ratings so far"), `FindPanel.jsx:93` ("4 of 10 ratings"),
`EnergyCard.jsx:23` ("0 of 3 weeks rated") and `:40` ("Rate how your tasks leave
you and this becomes a real reserve"). `EnergyCard` and `EnergyShape` read the
*same* calibration pair and reach opposite conclusions.

> **A count of ratings is a fact about the model, and it belongs where the user
> went to look at the model.** In the Cabana it is diagnostics; in the report, the
> energy card or a find-a-time panel it is a bill. State the basis the app *is*
> using, never the distance to the one it would prefer.

### 4.6 Never narrate these, even carrying weight

`priority` (a claim about the user's own labelling), `dayFill` (its weight is
recorded as flipping sign four times — not a sentence), `placedByUser` (commentary
on the user's relationship with the app; the negative reading is a P-1 hazard).

The narratable set is exactly the four families a person can act on by choosing
**when** and **what** to schedule: tag, time of day, weekday, sitting length.

### 4.7 A separate `whatToDo` bug

A tag **not in `vocab` has no column at all**, so across *tasks* the model
systematically ranks familiar tags above unfamiliar ones by exactly `w_tag`, with
no evidence the unfamiliar one is worse. Probed: `whatToDo` printed *"you rate
this kind of work well right now"* for a tag the model has never seen, score
0.840.

Fix: wherever scores are compared *across tasks*, use `modelScore − bias`. Keep
the raw score where slots for one task are compared.

---

## 5. How to know any of this is an improvement

**Offline evaluation cannot establish that placements got better.** The data is
the policy's own footprint — ratings exist only for slots that were actually
chosen, the counterfactual is never observed, and there is one user, so no A/B is
ever available. It *can* establish four things, and those are enough to choose
between the proposals above:

1. The model recovers structure that provably exists (synthetic).
2. **It stays silent when no structure exists** — the P-2 guard, executable.
3. The fit is stable enough that its weights may be spoken aloud.
4. It beats simpler, more explainable estimators.

### 5.1 Protocol

**Leave-one-group-out, group = `parentId ?? id`.** ⚠️ **Naive LOO is invalid on
this user's data.** Twelve rated gym sessions share tag, weekday, hour and
duration; treating them as 12 independent samples measures "can you predict
Tuesday gym from eleven other Tuesday gyms." `ratedSamples()` already stamps
`parentId` — grouping is one line, and it is what makes the number mean anything.

**Refit the vocabulary inside every fold.** `train()` selects `topTags` by
frequency over all samples — fitting it before splitting is data-dependent feature
selection and leaks. A probe that does the naive thing will report a real-looking
improvement that doesn't exist.

**Report paired differences with a bootstrap CI.** Fold-to-fold variance is
enormous at this n and cancels in the pairing.

**The stopping rule, printed by the harness:** if the 95% CI on paired ΔMAE
crosses zero, the honest output is *"this dataset cannot distinguish these two
options"* — and the tiebreak is then **simplicity, explainability and P-2**, never
the point estimate. Write that into the eval doc so competing proposals cannot win
on the third decimal place.

### 5.2 The probes to write

Following the existing `design/probes/probe-*.mjs` conventions (ESM, direct core
imports, no build, fixed dates, seeded LCG):

| Probe | Answers |
|---|---|
| **`probe-learn-baselines`** ★ | Does the model beat B0 (no model), B1 (global mean), and **B4 (shrunken tag×time mean = `getSatisfactionMatrix`)**? If it can't beat B4, B4 should *be* the preference term. **The single most valuable experiment.** |
| `probe-learn-recovery` | 8 synthetic personas × 20 seeds. Does the pipeline recover known preferences? |
| `probe-learn-silence` | **P-2 in executable form.** A no-preference user must produce a model that moves *zero* placements — `autoSchedule` with and without, byte-identical `startTime`. Also produces the **empirical noise floor** that should replace the unmeasured `0.01`. |
| `probe-learn-flip` | Does `w.preference = 0.15` have any authority? Sweep 0 → 0.5 and count placement flips. Print `rankOpenings` too — there the model is the **sole sort key**, so a bad model is fully expressed with no dilution. |
| `probe-learn-cv-power` | *"At n=30, any ΔMAE below X is indistinguishable from noise."* Every other table gets read against X. |
| `probe-learn-convergence` | Solve the normal equations exactly; compare against the 400-epoch fit. Settles §0.1 on the user's real data. |
| `probe-learn-migration` | The `moveCount` removal migrates or discards, never half-loads. |
| `probe-learn-degenerate` | 2000 seeded fuzz cases: no NaN, no throw, no shipped diverged model. |

**Synthetic personas must be built through the real doors** — `addFixed` /
`updateTask({satisfaction})` / `rateOccurrence`. A harness that bypasses
`ratedSamples()` would have been blind to the recurring-ratings bug.

**Negative controls matter as much as positive ones:** a null-preference user must
produce silence; a label-shuffle control must land at chance — **and if the
shuffle passes, the metric is broken, not the model.**

---

## 6. Ordered recommendations

1. **Fix the sign** in `WrapReport.jsx:296-298`. It currently asserts a preference
   for the user's worst-rated time. Ships today.
2. **Populate and serialize `observations` for every column.** Nothing else in the
   honesty work can be built first.
3. **Validate ratings at the door** — one NaN should cost one sample, not the
   model.
4. **Remove `moveCount`, `placedByUser`, `priority`** in one layout bump, with a
   structural `weights.length === labels.length` guard.
5. **Build `probe-learn-baselines`** before changing the estimator. If a shrunken
   average wins, that is the answer.
6. **Swap GD for the closed-form solve**, select λ by analytic LOO, emit standard
   errors.
7. **Rewrite `buildInsight`** on family-centered, evidence-gated, signed shells
   with humanised labels generated from the feature constants.
8. **Per-column shrinkage** `c_j = n_j/(n_j+4)`; narration gate at `n_j ≥ 4`.
9. **cvR² > 0** as the authority precondition.
10. **Authority ramp** on distinct rated weeks, replacing the three simultaneous
    step functions at n=10.
11. **Strip quota language** from the report, find-a-time and the energy card;
    move counts to the Cabana.
12. **Surface `diverged`** — serialize it, retry on load, say it in the Cabana.

---

## Claims checked and rejected

- **"The gating machinery is no-opped after the role rip-out."** False. It was
  re-pointed at the duration columns and is live (`learning.js:107-109`), verified
  by probe: `dur:15-30` with 2 observations was gated to exactly 0. Only the
  *comment* at `:266` is stale, and it contradicts `:107-109`.
- **"`driftCheck` reads `history.moveCount`."** False — it reads recurrence `move`
  exceptions (`detectors.js:34-57`). `starvationCheck` reads `displacedCount +
  carriedCount`. After the removal, `moveCount` becomes a write-only counter.

## Documentation corrections to make in passing

- `learning.js:266` — "no interaction terms in the base model (role rip-out)" is
  stale and contradicts `:107-109`.
- `openings.js:33-37` — claims gated `modelScore` avoids the untried-column trap.
  True only for the seven duration columns; a disliked *time* bucket or *tag* is
  ungated, so an unrated tag still outscores a rated-and-disliked one.
- `SPEC.md:185` — the `timingFit` line describes per-feature sample weighting,
  which is not expressible in a single linear fit. Retire it.
- Names: `interactionIdx` / `interactionLambda` / `interactionMinSamples` govern
  the duration block, not interactions.
