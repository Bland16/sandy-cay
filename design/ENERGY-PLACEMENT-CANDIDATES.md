# How should energy enter placement? — five candidate equations

**Session 8, 2026-08-13. STATUS: candidates for evaluation. Nothing built,
nothing decided.**

`design/ENERGY-AWARE-PLACEMENT.md` proves placement never reads the energy model
and proposes *one* equation. That is not enough to choose from — the same mistake
the session-splitting work avoided by writing seven candidates down first. These
five span the real design space, they are not five flavours of one idea, and two
of them are here because they might die on arithmetic.

## The acceptance fixture

The probe that found the problem, reused so every candidate is scored on the same
numbers. Fourteen days, **identical time occupancy** (one 2-hour block at 09:00
every day). Days 0–3 mentally brutal, days 4–13 mentally free. A 20-hour project,
five 4-hour sittings, `load.mental` +2/hour.

```
pre-existing deepest mental dip:  d+0..d+3 = -4.0     d+4..d+13 = 0.0
each 4h sitting costs:            4h x 2/h = -8.0
shipped placer puts:              960 of 1200 minutes on d+0..d+3
                                  dip on those days -4.0 -> -12.0
```

**The named failure is the shipped behaviour**: any candidate that still puts the
bulk of the work on d+0…d+3 is disqualified. Note this test discriminates
properly — unlike session 7's "20h must not be 2 sittings", which every candidate
passed and which therefore decided nothing.

## Notation

| | |
|---|---|
| `L(t)` | the task's load vector, per-hour rate per axis (`loadForTask`) |
| `dip(d)` | the day's deepest reserve dip per axis before placement (`energyTrajectory(…).low`), ≤ 0 |
| `dip⁺(d,t)` | the deepest dip **after** placing `t` on day `d` |
| `res(x)` | the reserve at an instant (`reserveAt`), ≤ 0 |
| `S(d)` | the day's already-spent vector — what the day's existing tasks cost, per axis |
| `C` | the set of candidate days for this task |

All five are **comparative**: they rank days against each other, never against a
capacity. `learnedCapacity()` returns `null` until calibrated and a placement
rule keyed to a ceiling would act on a number the app has not earned (P-2). The
learned upgrade is discussed once, at the end, for whichever wins.

---

## Candidate 1 — Relative depth

Score the state you end up in, normalised against the other days on offer.

```
score(d) = 1 − |dip⁺(d,t)| / max over c in C of |dip⁺(c,t)|
```

**On the fixture:** heavy day → `dip⁺` = −12, light day → −8, worst = 12.
`score(heavy) = 0`, `score(light) = 1 − 8/12 = 0.333`. Light days win, all five
sittings land on d+4…d+13. **Passes.**

The straightforward reading of "don't make a bad day worse", and the one already
written into `ENERGY-AWARE-PLACEMENT` §5. Zero constants.

**Against it: the score depends on the candidate SET, not just the day.** Add one
catastrophic day to the fortnight and every other day's score shifts, because the
denominator moved. That is the same instability class as session 7's band edges,
and it means re-planning after adding an unrelated heavy task can re-rank days
that did not change. It also throws away *when* in the day the slot sits.

## Candidate 2 — Marginal deepening

Score how much worse *you* make it, not how bad it ends up.

```
score(d) = 1 − ( |dip⁺(d,t)| − |dip(d)| ) / (normaliser)
```

**On the fixture:** heavy day −4 → −12, a deepening of **8**. Light day 0 → −8, a
deepening of **8**. *Identical.* The term cannot tell the two apart and
degenerates to a constant, which cannot change a ranking. **Fails, and it fails
on arithmetic rather than on judgement.**

**Why it degenerates is worth knowing before anyone proposes it again:** the
battery is *additive within a day* — reserve accumulates spend linearly and only
the cap at 0 is non-linear. So the marginal cost of a task is the same wherever
you put it, and only the *final depth* carries information.

**The one case where it is not degenerate:** a day containing genuine restoration
between blocks, where the 0-cap bites and the arithmetic stops being linear. That
makes this candidate a **diagnostic worth running** even though it is not a
design: if it discriminates at all on real data, the day had restoration in it,
which is exactly the thing the battery model was built to represent. Keep it as a
probe, not as a scorer.

## Candidate 3 — Reserve at the moment you sit down

Ignore the day as a unit; score how depleted you are **when the slot starts**.

```
score(slot) = 1 − |res(slot.start)| / max over C of |res(start)|
```

Uses `reserveAt`, which already exists and is already exported.

**On the fixture:** a sitting at 13:00 on a heavy day starts at `res` = −4; the
same slot on a light day starts at 0. Light wins. **Passes** — but with a twist
none of the others have: a sitting at **08:00 on a brutal day**, *before* the
09:00 block, starts at `res` = 0 and scores perfectly.

**That twist is the whole argument, both ways.** In its favour: it is the only
candidate that knows time-of-day, and "hard work first thing on a day that later
gets ugly" is genuinely different from "hard work at 9pm after that day". Against
it: it will happily wreck a day it can see is about to be terrible, because it
only looks backwards from the slot. It optimises the moment, not the day.

**It is also the only candidate that would interact with the learning module's
time-of-day features** rather than duplicating them — worth checking for overlap
before building, because a term that restates something `modelScore` already
learns is the `format.js` second-ISO-week mistake again.

## Candidate 4 — Axis complementarity

Do not measure depletion at all. Measure whether this task hits the axis the day
has *already* been hit on.

```
similarity(d,t) = cos( S(d), L(t) )          // 0 = different axes, 1 = same
score(d)        = 1 − max(0, similarity(d,t))
```

**On the fixture:** the thesis is `mental +2`; heavy days have spent mental
(similarity ≈ 1, score ≈ 0); light days spent *physical* on errands (similarity
= 0, score = 1). Light days win. **Passes.**

**This is the only candidate that expresses variety rather than volume**, and the
codebase already thinks this way: `suggest.js`'s `varietyPenalty` keys off the
dominant load axis of what you just finished. There is a precedent to reuse
rather than a concept to invent, and it captures something real that every other
candidate misses — a physically hard day is a fine day to do mental work, and
vice versa.

**Against it: it has no sense of scale.** A day already catastrophic on *every*
axis scores well for any task, because nothing is "different enough" to be
penalised and nothing measures how deep the hole is. It is a shape comparison
with the magnitude thrown away. Almost certainly wrong alone; possibly the best
thing to pair with candidate 1.

## Candidate 5 — Recovery spacing

The energy translation of the finding that burnout is **clustering**. Do not
score the day's state; score how long since the last day that was heavy *on this
task's axes*.

```
heavy(d)  = the day's spend on t's dominant axis exceeds the fortnight's median
score(d)  = the minimum gap, in days, from d to any other heavy day
            → choose the day that MAXIMISES that minimum gap
```

**On the fixture:** d+0…d+3 are already heavy, so the maximin walk picks
d+5, d+7, d+9, d+11, d+13 — spread, and away from the loaded front. **Passes.**

**It is the only candidate that fixes the clustering problem and the energy
problem with one rule**, which is a strong argument given §4.5 established that
clustering is the actual harm and that the scorer cannot express it. It is also
constant-free **in the ordinal form given above** — "maximise the minimum gap" is
a rule, not a threshold. An exponential decay version (`1 − e^(−Δ/τ)`) reads more
smoothly and immediately costs you `τ`, an invented constant with no path to
being learned. **If this candidate is built, build the ordinal form.**

**Against it:** "heavy" needs a definition, and the median-based one above is a
threshold wearing a disguise — it is scale-free and data-derived, which is much
better than a constant, but it still flips a day between heavy and not on one
minute of change. And it is *only* about spacing: it will happily choose a
poorly-spaced-but-fresh day over a well-spaced exhausted one, because it never
looks at depth.

---

## The obvious hybrid, stated so it can be judged too

**1 for depth, 4 for shape, 5 for spacing.** Depth says how bad the day is,
complementarity says whether this particular task makes it worse *in the way that
matters*, spacing says do not do this three days running. Each covers the others'
named blind spot, and none of the three needs a constant.

The cost is three terms where the app currently has none, and this codebase's
record with weights is two-for-two wrong on the first attempt. A defensible
smaller version is **1 + 5**: depth and spacing, leaving complementarity until
someone has felt the "physical day, mental task" case go wrong.

## How learning enters — for whichever wins

Identical for all five, and it is an **upgrade, not a redesign**:

- **Today:** every candidate is comparative and P-2-clean, needing no ratings.
  They rank days against each other and say nothing about limits. All five ship
  before any learning exists.
- **After calibration:** `learnedCapacity()` stops returning `null`, and the
  normaliser can move from "the worst candidate day" to "the depth you have
  demonstrably tolerated". That converts a *ranking* into a *scale*, and only
  then may anything say a day is too much — in the card and the report, never in
  the scheduler (P-1).
- **The dependency to state plainly:** calibration needs energy ratings, and
  **recurring sessions' ratings currently reach nothing**
  (`design/RATINGS-AND-LEARNING.md`). So the learned upgrade is blocked on that
  fix, while all five candidates are not. That is a point in favour of shipping
  one now rather than waiting for the honest version.

## What an evaluation has to answer

1. **Does it still put the bulk of the work on d+0…d+3?** Any candidate that does
   is disqualified — that is the shipped behaviour and the reason this exists.
2. **Is it stable under re-planning?** Candidate 1's denominator moves when an
   unrelated day changes; candidate 5's median moves when any day changes. Print
   the plan on each of days 0…10 and count how many sittings move for reasons the
   user did not cause.
3. **What does it do with a task that has NO load** — no matching bucket, or a
   neutral one? It must be provably inert, not merely small. A user with no
   authored loads must get byte-identical placement to today.
4. **What does it do on a day that is deep on every axis?** Candidate 4 approves
   it; the others do not. Decide whether that is a bug or the point.
5. **Does it fight the existing weights?** `balance` already spreads by minutes
   and `buffer` already forbids the last fifth of the runway. A term that mostly
   agrees with `balance` is not worth its risk — measure how often they disagree
   before shipping.
6. **Does it duplicate something `modelScore` already learns?** Especially
   candidate 3, whose time-of-day signal overlaps the learning module's. Two
   differently-shaped descriptions of one idea is the failure this project keeps
   paying for (`role`, the second ISO-week, the window-row that exists twice).
7. **Where does it act — weight, or generation-time day choice?** Orthogonal to
   the equation, and still open as D-1. The containment argument says generation
   first; the "every task deserves this" argument says weight. Answer it per
   candidate, because candidate 3 is slot-shaped and cannot live in a day chooser
   at all.
8. **Prove it by printing placements.** 573 tests pass with the rejected `spread`
   change and 573 without it. The suite cannot see any of this and never has.
