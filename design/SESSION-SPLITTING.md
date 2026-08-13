# How many sittings, and how long? — candidate equations

**Session 7, 2026-08-12. STATUS: candidates for evaluation. Nothing built, nothing decided.**

`WEEKLY-PLANNING` §4.1 says sitting length is *an outcome, not a setting* — "prefer
the fewest, longest sittings the open time allows; split only when no single run
is long enough." That is a direction, not a rule. It never says how the number
falls out, and `sliceChunks` "does not look at the week's actual shape before
choosing" (§4.1's own admission). This document proposes five ways to close that,
so they can be evaluated against each other rather than argued about.

## The ask, in the user's words

> *"Combine the task length with the runway for deciding how many sessions and
> hours. My preference is to finish in as few sessions as possible without
> burning out. A 20 hour project with a deadline in two weeks should not be in
> two sessions."*

Two forces pointing opposite ways, and the whole design is where they balance:

- **Consolidation.** Fewer, longer sittings. Context-switching is a real cost, and
  the user has said plainly they can work four hours straight when the week has
  the room.
- **Sustainability.** A 20-hour project is not two ten-hour days. Something must
  cap a sitting, and something must cap a *day*, or "fewest sessions" degenerates
  into exactly the answer the user named as wrong.

**The named failure case is the acceptance test:** A = 20h, deadline 14 days out
must not produce n = 2. Any equation that can produce it is disqualified.

---

## Notation

| | |
|---|---|
| `A` | amount remaining, minutes (1200 for the 20h case) |
| `R` | runway: plan time → deadline, minutes |
| `R*` | **effective** runway after the finish-early buffer. The shipped rule is a fifth, so `R* = 0.8 · R` |
| `O_d` | genuinely open minutes on day `d` — after fixed anchors, zones and break padding |
| `Ω` | total open minutes inside `R*`, i.e. `Σ O_d` |
| `D` | count of days inside `R*` with `O_d ≥ s_min` |
| `s_min`, `s_max` | the user's sitting bounds (the existing `.rangefield`; e.g. 30m and 4h) |
| `m` | `maxPerDay` |
| `n`, `s` | what we are solving for: number of sittings, and their length |

Two derived quantities the candidates lean on:

- **Pressure** `ρ = A / Ω` — the fraction of your actually-open time this one
  thing wants. This is the honest difficulty number, and it uses `A` and `R`
  together, which is what the user asked for.
- **Required daily rate** `r = A / D`.

For the worked examples below: `A` = 1200 min, `R` = 14 d, so `R*` = 11.2 d;
assume 8 usable days inside it with 4h open each, so `Ω` = 1920 min, `D` = 8,
`ρ` = 0.625, `r` = 150 min/day. Bounds `s_min` = 30m, `s_max` = 4h, `m` = 1.

---

## Candidate 1 — Cap and fill (the baseline; roughly what `sliceChunks` does now)

```
n = ceil(A / s_max)
s = A / n
```

**20h case:** `n = ceil(1200/240) = 5`, `s = 4h`. Passes the acceptance test.

Its whole burnout defence is the single number `s_max`, and it never looks at the
runway or the week. So it gives the same 5 × 4h whether the deadline is in two
weeks or tomorrow, and it will happily hand you 4h on each of five consecutive
days that only had 4h open — consuming every free hour you had, which is a
different way to burn out than a ten-hour day but not a better one.

Worth keeping in the comparison precisely because it is the cheapest thing that
passes, and any more complex candidate has to justify itself against it.

## Candidate 2 — Intensity-capped

Add a ceiling on what a *day* may absorb, not just a sitting.

```
L_max = κ · O_d            // sustainable share of a day's open time, κ ≈ 0.5–0.6
s     = clamp( min(s_max, L_max / m), s_min, s_max )
n     = ceil(A / s)
feasible ⟺  n ≤ D · m
```

**20h case:** `L_max = 0.6 × 240 = 144 min`, `s = 144 min` (2h 24m), `n = 9`.
Nine sittings over eight usable days — *infeasible at m = 1*, and it says so
rather than quietly overrunning.

That honesty is the point: this is the first candidate that can tell you the
thing does not fit before you live it, which is §4.3's under-fill case arriving
at plan time instead of at the end of the week. The risk is that `κ` is a
fabricated constant doing very heavy lifting, and a wrong `κ` makes the app
refuse work that would have been fine.

## Candidate 3 — Fatigue-discounted (diminishing returns inside a sitting)

Model the thing that actually makes long sittings bad: the back half of a long
session is worth less than the front half.

```
E(s) = s                              , s ≤ s_free
     = s_free + (s − s_free) · δ      , s > s_free       // δ ∈ (0,1)

n(s) = ceil( A / E(s) )
waste(s) = n(s) · s − A               // clock time bought that produced nothing
```

Choose the **smallest n** whose waste stays inside a tolerance `τ` (say 15% of A).
With `s_free` = 90 min and `δ` = 0.75:

| s | E(s) | n | clock | waste |
|---|---|---|---|---|
| 90m | 90 | 14 | 21h | 1h (5%) |
| 2h | 112.5 | 11 | 22h | 2h (10%) |
| 3h | 157.5 | 8 | 24h | 4h (20%) |
| 4h | 202.5 | **6** | 24h | 4h (20%) |

**20h case:** at τ = 15% it lands on ~11 × 2h; at τ = 20%, 6 × 4h. Passes the
acceptance test at any tolerance.

This is the only candidate that expresses the user's sentence *directly* — "as
few sessions as possible" is the objective, "without burning out" is the
constraint, and `τ` is the exchange rate between them. It is also the only one
that admits a four-hour sitting is not four hours of work. Against it: three
invented constants (`s_free`, `δ`, `τ`), and P-2 has something to say about
asserting a fatigue curve the app has not learned.

## Candidate 4 — Pressure-banded

Let `ρ = A / Ω` choose the posture, so the same equation behaves differently for
a comfortable fortnight and a brutal one.

```
ρ < 0.3    "room"    s = s_max                      , n = ceil(A/s)
0.3–0.6    "steady"  s = min(s_max, κ·O_d/m)        , n = ceil(A/s)
ρ ≥ 0.6    "tight"   s = min(s_max, r/m) , n = ceil(A/s) , and SAY SO
```

**20h case:** `ρ = 0.625` → tight. `s = min(240, 150) = 150 min`, `n = 8` — one
sitting on each of the eight usable days, and a stated line: *"this wants 62% of
your open time for two weeks."*

Uses `A` and `R` jointly by construction, and the tight band produces the most
defensible behaviour of any candidate here: when something is going to dominate
your fortnight, spreading it thin and naming it beats pretending a 4h sitting
five times is comfortable. Against it: two more thresholds, and band edges cause
discontinuities — 0.599 and 0.601 give visibly different plans.

## Candidate 5 — Fewest-longest against the week's real gaps (§4.1, literally)

Do not compute `s` at all. Ask the week what runs it actually has, take the
longest ones, stop when the amount is covered.

```
G = { open gaps in R*, each clamped to s_max, sorted longest first }
take gaps greedily while Σ < A, honouring m per day and s_min
n = how many you took
```

**20h case:** with eight 4h gaps it takes five of them → 5 × 4h, same as
candidate 1 — but if the real week is 2h/3h/4h/1h/… it produces sittings that
*exist*, where every other candidate produces a number the week may not be able
to honour.

This is the one §4.1 actually described, and it is the only one whose output is
guaranteed placeable. Its weakness is that it is pure greed: no burnout guard at
all beyond `s_max`, and it will take the five biggest gaps in the fortnight even
if they are five consecutive days.

---

## Candidate 6 — Learned sitting length: measure the fatigue curve, don't invent it

**Added 2026-08-12 after the user asked whether any candidate considers the
machine-learning side. None did, and that was backwards** — the app is already
learning the exact quantity candidate 3 fabricates.

`learning.js` puts duration in the feature vector as a **one-hot over seven
buckets** (`DURATION_EDGES = [15, 30, 45, 90, 150, 240]`, `learning.js:22`,
labelled `dur:<15 … dur:>240` at `:85`) and trains on
`satisfaction.overall`, normalised to [0,1], with a rating that carries a
`timingFit` verdict counting double (`:113–114`). So the model's `dur:*` weights
already are, literally, **how satisfied you have been with sittings of each
length.** That is an empirical fatigue curve, measured on you.

And `inspect()` (`:196`) already exposes exactly those per-label weights — it was
built to say things like "study +0.8 mornings" in the Cabana. Nothing new is
needed to *read* the curve.

```
s* = argmax over duration buckets b of  w[dur:b]      // your own best sitting length
     subject to  s_min ≤ s* ≤ s_max  and  s* ≤ longest gap the week has
n  = ceil(A / s*)
```

**Before the model has earned an opinion** — `modelScore` returns 0 until
`trained && sampleCount ≥ coldStartRatings` (`:184`) — `s*` falls back to a stated
default and the app says which it is using. That is the same shape as
`learnedCapacity()` returning `null` until calibrated.

**What makes this the most P-2-native candidate:** it does not assert a fatigue
curve, it reports one. Candidate 3 tells you a 4-hour sitting is worth 3.4 hours
because a constant says so; candidate 6 says it because your own ratings said so,
and says nothing at all until they have.

**The honest objections.** The `dur` one-hot is *unordered*, so nothing stops the
learned curve being non-monotonic and jagged (`dur:45-90` high, `dur:90-150` low,
`dur:150-240` high again) — a real risk on sparse data, and `argmax` over a jagged
curve is unstable. It also learns from the sittings you actually *had*, which the
scheduler chose, so it is confounded: if the app never gives you a 4-hour block
you will never rate one, and the bucket stays empty forever. That is a genuine
explore/exploit problem and this document should not pretend otherwise.
`ROUTINES.md` R-D already proposes widening the low end of `DURATION_EDGES`; note
those edges were **already widened** from the `[45, 90, 150, 240]` that doc
describes to today's six-edge set.

## Candidate 7 — Learned daily intensity: κ from `dayFill`, not from a constant

Candidate 2's whole burnout defence is `κ`, the sustainable share of a day. The
feature vector **already has a slot for the evidence**: `dayFill` at
`learning.js:71` — and it is dead, hardcoded `?? 0`, commented *"dead until Phase
D.2 wires it"*.

`SPEC-PHASE-2026-08.md` says wiring it is **one small change**: record `dayFill`
alongside `energyAt` in `Schedule#_snapshotEnergy`, exactly as the energy snapshot
already does. Once live, the model learns how your satisfaction moves with how
full the day was — which is `κ`, measured.

**This is the one item here with a deadline attached.** Every week used without it
is training data that cannot be recovered later, because deriving day-fill after
the fact means reconstructing a day that never happened. That argument is already
made for `energyAt`; it applies identically here.

## What the ML angle does to the other candidates

It partly **dissolves the invented-constant objection** — and the codebase has
already settled how. `config.js:41–43` documents `energy.capacity` as *"only the
PRIOR/fallback used for an axis that lacks enough evidence days"*, while
`learnedCapacity()` returns `null` rather than a fabricated ceiling. So the
project's own answer to evaluation question 4 is:

> A documented **prior that learning overrides** is fine. A **stated fact** the
> app has not earned is not. The sin P-2 names is the assertion, not the number.

Which reframes `κ`, `δ`, `s_free` and `τ` from "fabricated constants" into "priors
awaiting evidence" — *provided* each has a real path from prior to learned, and
the app never presents one as a finding about you. Candidates whose constants have
no such path stay guilty.

---

## The obvious hybrid, stated so it can be judged too

**5 for feasibility, 3 or 4 for the cap.** Compute a burnout-aware ceiling `s*`
(fatigue tolerance, intensity cap, or pressure band), then run candidate 5's
greedy fit with `s_max` replaced by `s*`. Fewest-longest, but never longer than
is good for you, and never a sitting the week cannot hold.

## What an evaluation has to answer

1. **Does it fail the named case?** Any path to n = 2 on 20h/14d disqualifies it.
2. **What happens at the extremes** — 20h due in 3 days; 20h due in 6 months;
   a 45-minute task; a week with no open time at all; `A` larger than `Ω`.
3. **Is it stable?** Re-planning tomorrow should not reshuffle a plan you have
   started living. Band edges and `ceil` boundaries are where this breaks.
4. **What does it invent?** P-2 forbids the app asserting what it has not
   learned. `κ`, `δ`, `s_free`, `τ` are all fabricated until ratings inform them —
   is that the same sin as a fabricated capacity ceiling, or is a *preference
   default* categorically different from a *stated fact about you*?
5. **Does it fit the engine we have** — `sliceChunks`, `placeTask`, `computeWindows`,
   the `buffer` weight as corrected today — or does it need a new solver?
6. **Does it degrade honestly** when it cannot fit, per §4.3: state the shortfall
   plainly, no debt, no red, no verdict.
7. **How does LEARNING enter it?** For whichever candidate you recommend, say
   concretely how the machine-learning side gets incorporated — which constants
   become priors the model overrides, which quantity is read from `inspect()`,
   what the cold-start behaviour is before `coldStartRatings`, whether
   `featureVector` needs a new term (and therefore a `MODEL_LAYOUT_VERSION` bump
   and a retrain-on-load migration), and how the confounding in candidate 6 is
   handled — the scheduler chooses the sitting lengths that then get rated, so
   a length never offered is never learned.

---

# What the two evaluations found

Reports: `SESSION-SPLITTING-EVAL-ENGINE.md` (code-grounded, probe-proven) and
`SESSION-SPLITTING-EVAL-LIVED.md` (scenario corpus, human-side). They ran
independently and could not see each other's conclusions.

## They converged, from opposite directions, on the same thing

**The question in this document was aimed at the wrong variable.** Neither `n`
nor `s` is where burnout lives.

- **Engine:** nothing in `scoring.js` spreads work over a runway longer than
  **three days**. `proximity` is normalised by `maxPlacementLookahead = 3`, so it
  is identically zero past day 3; `buffer` saturates at 1.000 for 12 of 15 days.
  Beyond day 3 only `balance` discriminates, ties break earliest, and 20h/14d
  places as **8h Mon + 8h Tue + 4h Wed with eleven days untouched.**
- **Lived:** the burnout mechanism is **clustering**, and *no candidate looks at
  it.* On an even 4h/day fortnight, C1 and C5 give 5 × 4h on **five consecutive
  evenings** — and the candidates that "fix" this by shortening the sitting turn
  it into **nine consecutive evenings.** Shortening the sitting makes the streak
  *longer.*

Two methods, one answer: **the placer, not the split.** Every candidate that
fights sitting length instead pays in unplaced work, invented constants and
unstable plans. Lived's `H*` — candidate 5's sizing plus an even spread across
the runway, zero invented constants — gives the same 5 × 4h on days 0, 2, 4, 6, 8:
streak of one.

**Both first choices contain candidate 5.** Engine ranked `5 + cap`; lived ranked
`H*` (5 + spread) above plain 5. So the sizing question is settled and the open
work is the spreading rule, which belongs in `scoring.js` and applies to every
deadlined task — it should ship independently, exactly as `buffer` did.

**Both rejected candidate 3.** Its output is identical in every extreme (`8×170`
even for a week with zero open minutes), and `waste(s)` would have the app assert
you had been unproductive — a P-1 breach reached before P-2 is even in play.

## Where they disagree, unresolved

**Candidate 7 (learned `dayFill`).** Engine ranked it **second** (~7 lines, no
`featureVector` change). Lived ranked it **last** and says it *cannot work as
written*: `dayFill` is a single linear scalar whose learned weight **flips sign
four times** and never yields a level, so no κ falls out of it. Lived trained the
real model to show this; engine costed the wiring without testing whether the
output is usable. **Lived's evidence is the stronger claim here** — but note both
agree on the action anyway: **wire `dayFill` now** for the unrecoverable-data
reason, just don't use it as an intensity cap. Banding it recovers κ at the cost
of a `MODEL_LAYOUT_VERSION` bump.

**Does the learned duration curve stabilise?** Engine: yes — stable, recovers the
true peak from 19 noisy ratings, argmax unchanged over 30 retrains. Lived: the
same 20h project comes out as **5, 7 or 10 sittings depending on which ten
ratings you have — and still 5, 7 or 10 at sixty.** These are different
experiments (engine varied noise around one generating distribution; lived varied
the rating history itself), so they are not strictly contradictory — but they
support opposite conclusions about whether the curve can be trusted to *set a
plan*. **Unresolved, and it is the crux of whether candidate 6 is usable.** Lived's
conclusion — learning must never silently change the plan; it belongs in a Cabana
line plus a one-time offer to raise `s_max` — is the safe reading of both.

**The ML defect both found, stated two ways.** Engine: unobserved buckets sit at
exactly `+0.000`, so a never-tried length **outranks a tried-and-hated one**
(−0.365 vs +0.000). Lived: a short-only scheduler still reports "your best
sittings are 2h" after **400 ratings**; ε-exploration finds the truth at 10 weeks,
loses it at 15, holds after a year. So the confound is worse than this document
described — unoffered lengths are not merely unlearned, they are **actively
preferred**. The per-column gate that fixes it already exists at
`learning.js:131–139`, applied to an empty set.

## Errors in this document, found by the evaluations

1. **The acceptance test is dead.** `sliceChunks` needs `maxChunk ≥ 600` to
   return n = 2, which no sane bound produces. All seven candidates pass it, so
   "20h/14d must not be two sittings" discriminates *nothing*. It should never
   have been the gate.
2. **`Ω` and `ρ` are per-(task, day), not per-day** — zones filter by tag, so the
   same week is 101h30 open for a study task and 33h30 for a work one. Candidate
   4's headline sentence, *"this wants 62% of your open time"*, is **false as
   written**: there is no single "your open time".
3. **Candidates 2, 4, 6 and 7 fix `s` before looking at `A`**, so a 45-minute task
   books a 4-hour block and three commitments totalling 8h book 12h of the week.
   One missing line — `s ← A/n` after `n` is known. My formulations, my bug.
4. **Candidate 3's worked table is wrong on a 15-minute grid** (τ = 15% gives
   9 × 2h30, not 11 × 2h), and `waste(s)` is non-monotonic, so "smallest n inside
   a tolerance" is not even well-defined.
5. **The stability suspects were backwards.** I named candidate 4's band edges;
   they cause near-zero churn. The real one is `ceil()` — **one extra minute
   re-sizes and re-places every chunk** in the shipped code. (Though `redistribute`
   already preserves lived chunks, `projects.js:70`, so the blast radius is
   narrower than feared.) Candidate 4's edge is real but smaller: +48 minutes
   flips 4 × 4h into 6 × 2h24.
6. **The prior-vs-assertion framing holds, but the code is stricter than I said.**
   `learnedCapacity` returns `null` and the prior is *invisible* until calibrated —
   so κ, δ, `s_free` and τ still fail P-2. What passes: `s_max` (user-typed) and
   `ρ = A/Ω` (arithmetic over their own calendar).

Also found, incidental to this question and untouched: `resizeChunk` never clamps
to `chunking.maxChunk` (`projects.js:114`), so a user can silently exceed their
own stated maximum sitting; and `_dayFillAtCompletion` is deader than documented —
one repo hit, not a `Task` field, not serialised.

## What is NOT settled, and needs the user

Lived's own strongest objection to its recommendation: **`H*` still eats five
whole evenings**, and no amount of analysis can establish whether that is
acceptable — only this person's ratings can. That is the one place both reports
agree learning genuinely belongs.

Also open: whether the app may ever *try* a longer sitting than it has evidence
for, in order to learn whether you can do them. Without that, a short-only
scheduler is self-confirming forever.
