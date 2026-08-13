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
