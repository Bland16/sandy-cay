# Session splitting — evaluation against the engine as built

**Session 7, 2026-08-12.** Evaluates the seven candidates in
`design/SESSION-SPLITTING.md` against `src/core` as it actually is. Everything
below is either a `file:line` citation or output from a probe run in this
worktree. Probe scripts were throwaway and have been deleted; their output is
pasted verbatim.

---

## 0. The finding that reorders the whole document

**The named failure case cannot happen, and something worse already does.**

`sliceChunks` cannot return `n = 2` for `A = 1200` at any sane bound. It needs
`maxChunk ≥ 600` (a ten-hour sitting the user would have had to type):

```
=== C. Can sliceChunks EVER return n=2 for A=1200? ===
maxChunk values giving n=2: 600..1199
```

So the acceptance test in `SESSION-SPLITTING.md` §"The ask" is already passed by
the shipped code, and it discriminates between none of the candidates. Every one
of the seven passes it.

Meanwhile, here is what the engine actually does with 20h / 14 days today, on an
empty week, at the default config:

```
=== A. THE NAMED CASE, as the engine actually runs it (20h / 14d) ===
  max=4h: n=5, sizes=240,240,240,240,240, warn=false
    Mon  7 08:00 → Mon  7 12:00  240m
    Mon  7 12:30 → Mon  7 16:30  240m
    Tue  8 08:00 → Tue  8 12:00  240m
    Tue  8 12:30 → Tue  8 16:30  240m
    Wed  9 08:00 → Wed  9 12:00  240m
    days touched = 3 / 14;  per-day = 480, 480, 240 min
    span used = day 0 .. day 2 of 14
```

**Eight hours on Monday, eight on Tuesday, four on Wednesday — and eleven days
of the fortnight untouched.** `n = 5` is the right answer to the question the
document asks, and the plan is still the burnout case the user named. `n = 2` was
never the disease; it was a symptom the user reached for to describe *"this app
put my whole project in the first two days."*

Forcing more sittings does not help, because the number of sittings is not the
lever:

```
=== C. same, forcing n=20 (max=60m) ===
    days touched = 5 / 14;  per-day = 420, 420, 240, 60, 60 min
```

Twenty sittings, and it is still seven hours on Monday and seven on Tuesday.

And the pathology gets **worse the more open your week is** — which is the exact
opposite of what §4.1 promises:

```
EMPTY week, monFri 08:00-18:00 (default):
  days touched=3/14   heaviest day=480m   last day used = day 2
EMPTY week, monFri 08:00-20:00 (widened):
  days touched=3/14   heaviest day=480m   last day used = day 2
EMPTY week, monFri 06:00-23:00 (very open):
  Mon 7 08:00+240  Mon 7 12:30+240  Mon 7 17:00+240  Tue 8 06:00+240  Tue 8 10:30+240
  days touched=2/14   heaviest day=720m   last day used = day 1
```

Twelve hours of the project on Monday. Note the widened window is exactly what
HANDOFF tells this user to do ("Widen `config.windows` past 18:00").

### Why, exactly

Three lines of `scoring.js` and one of `config.js`:

```
  normalized weights: {"proximity":0.323,"balance":0.226,"stability":0.097,"preference":0.097,"buffer":0.258}
  lookaheadHorizonMin = 4320 (3 days) — proximity is ZERO beyond day 3
  day  slotStart      proximity  balance  buffer   TOTAL
    0  Mon  7 08:00   1.000     0.600    1.000   0.7161
    1  Tue  8 08:00   0.667     0.600    1.000   0.6086
    2  Wed  9 08:00   0.333     0.600    1.000   0.5011
    3  Thu 10 08:00   0.000     0.600    1.000   0.3935
    4  Fri 11 08:00   0.000     0.600    1.000   0.3935
    7  Mon 14 08:00   0.000     0.600    1.000   0.3935
   10  Thu 17 08:00   0.000     0.600    1.000   0.3935
   13  Sun 20 08:00   0.000     0.600    0.298   0.2123
```

- `proximity` (`scoring.js:87–91`) is normalised by
  `config.maxPlacementLookahead * 24 * 60` (`placement.js:189`), and
  `maxPlacementLookahead` is **3** (`config.js:12`). Over a 14-day range it is a
  cliff, not a gradient: strong for three days, then **identically zero for the
  remaining eleven**. Days 3 through 12 are indistinguishable to the scorer.
- `balance` (`scoring.js:93–95`) is the only term pushing work off a loaded day,
  and it is the *smallest* of the three live weights (0.226). It loses to
  proximity for the second chunk of a day and only wins for the third.
- `buffer` (`scoring.js:79–85`) saturates at 1.000 for the first 80% of the
  runway and therefore cannot separate day 0 from day 10 at all.

**So the engine has no term that spreads work across a runway longer than three
days.** No equation over `(A, s_max, Ω, D, ρ, r)` fixes that, because every
candidate except 5 hands `placeTask` a bag of durations and lets it choose days.

**This is the single most important input to the decision, and it reframes
question 5.** The right question is not "does this candidate fit
`sliceChunks` + `placeTask`" but **"does this candidate produce DAYS, or only
durations?"** Only candidate 5 produces days.

> One caveat, stated honestly: on a *busy* week the bunching is masked, because
> long runs simply do not exist on the near days. Probe 9's realistic week
> (a Work zone + six anchors + a recurring gym) placed 5 × 4h across five
> separate days with today's shipped code. The pathology is specific to open
> weeks — which is where a 20h project is most likely to be planned, and where a
> four-hour block five times running is most likely to be *possible* and most
> damaging.

---

## 1. Ranked recommendation

| | Candidate | Verdict |
|---|---|---|
| **1** | **5 + a cap (the hybrid)** | **Build this.** The only candidate that outputs days. Proven end-to-end below in ~60 lines with no new solver. |
| **2** | **7 — learned `dayFill`** | **Build this too, and first — it is ~10 lines and it is losing data every week.** It is not a splitting rule; it is the only thing that can ever make candidate 2's `κ` legitimate. |
| 3 | **4, split in half** | Keep the **sentence** (`ρ = A/Ω` is arithmetic about the user's own calendar — P-2-clean and genuinely useful). Drop the **bands** (0.3/0.6 are invented, and probe 4 shows them flipping four times in eleven days). |
| 4 | 1 — cap and fill | The honest fallback. Zero cost, already shipped. It is not *wrong*, it is *insufficient*, and it is insufficient in the placement layer rather than the equation layer. |
| 5 | 6 — learned sitting length | Right instinct, wrong estimator. `argmax` over the `dur:*` one-hot is not usable (§7). Salvage it as a **ceiling** rather than a **choice**, later. |
| 6 | 2 — intensity-capped | `κ` is doing all the work and has no evidence behind it *today*. Becomes viable the moment candidate 7 has run for a few weeks. Its infeasibility verdict is its best idea and candidate 5 gets that for free. |
| 7 | 3 — fatigue-discounted | **Recommend rejecting outright.** Three invented constants, no learning path even in principle, and — proven below — its output does not depend on the week *at all*, so it emits `8 × 170` for a week with zero open minutes. |

### The single strongest objection to my own recommendation

**Candidate 5 is greedy over gap length, and gap length is not the same as
"spread out".** Nothing in it prevents taking the five biggest runs in the
fortnight when those happen to be five consecutive days — which is exactly the
plan that started this document. My probe 9 output shows it: at `cap = 150` it
picked **Wed 9 / Thu 10 / Fri 11 / Sat 12** back-to-back. The cap limits how long
a sitting is; it does nothing about how densely sittings cluster.

Fixing that requires a spacing rule, and a spacing rule requires a number
(minimum days between sittings, or maximum consecutive days), which is a
**fourth invented constant** — so candidate 5 does not actually escape question
4, and my recommendation is weaker on P-2 grounds than the ranking implies. The
mitigations I would accept: `maxPerDay` already exists in the model
(`WEEKLY-PLANNING` §2) and is user-set; and a deterministic "walk the sorted days
and skip a day when the previous one was taken" is a *rule*, not an assertion
about the user. But it is a rule someone chose, and the report should not pretend
otherwise.

A second objection worth recording: I recommend candidate 5 partly because it is
the only one that produces days — but one could instead **fix the placement
layer** (give `proximity` a runway-scaled horizon, or add a sixth "spread" weight
keyed on sibling chunks) and keep candidate 1's trivial equation. That would be a
smaller, more general change benefiting every deadlined task, not just projects.
I did not recommend it because a new scoring weight is a change to *every*
placement in the app, and this codebase's own history (the buffer weight,
HANDOFF "⚠️ The buffer weight shipped nearly inert") says weights are the thing
this team gets wrong. But it is a real alternative and it is cheaper than it
looks.

---

## 2. Question 1 — implementability, per candidate

### What exists

- `sliceChunks(total, minChunk, maxChunk)` — `projects.js:13`. Pure arithmetic.
  Takes no schedule, no dates, no config. Probe: `function sliceChunks(total, minChunk, maxChunk) {`.
- `redistribute(schedule, parent)` — `projects.js:68`. Removes all auto children,
  re-slices the remainder, places each with `placeTask`. Already builds the
  occupied set the week-shape candidates need (`projects.js:82–83`).
- `placeTask(schedule, task, {from, to, occupied})` — `placement.js:255`. Scored,
  zone-aware, with relaxation and parking.
- `computeWindows(schedule, task, date, {ignoreZone})` — `placement.js:94`.
  Returns the allowed **Date intervals** for a task on a day, zones and deadline
  applied. This is the primitive `O_d` needs.
- `walkGaps({windowStart, windowEnd, occupied, durationMin, breakMin})` —
  `gaps.js:40`. **Returns fixed-length slots, not gap extents** — `gaps.js:68`
  pushes `{start: usableStart, end: addMinutes(usableStart, durationMin)}`. This
  is the one real gap in the primitives, and it is the signature change every
  week-shape candidate needs.

### Per candidate

**Candidate 1** — already built. `sliceChunks` *is* `n = ceil(A/s_max); s = A/n`
(`projects.js:16–24`, with an even-split remainder distribution and a min-floor
fold at `:26–31`). Cost: **zero**. Signature changes: none.

**Candidate 2** — needs `O_d`. Signature:
`sliceChunks(total, minChunk, maxChunk)` → `sliceChunks(total, minChunk, maxChunk, shape)`
where `shape` is per-day open minutes. Plus a new return shape, because
`feasible ⟺ n ≤ D·m` has to be *reported*, and `sliceChunks` currently returns a
bare `number[]`. That is a breaking change to a function with existing tests.
Cheaper: leave `sliceChunks` alone and add `planSittings(...)` beside it.

**Candidate 3** — needs nothing from the schedule. It is pure arithmetic over
`A, s_free, δ, τ`. Cost: ~15 lines. **And that is its condemnation** — see §5.

**Candidate 4** — needs `Ω`, `D`, `r` and `Ō_d`, i.e. the same `shape` as
candidate 2. Same signature change.

**Candidate 5** — needs gap *extents*, so it needs a new export in `gaps.js`
(call it `walkGapRuns`, ~10 lines, or a `{returnRuns: true}` option). It also
needs to place each sitting on **its own day**, which looks like it needs a new
solver and does not: `findBestSlot`'s day loop is
`for (let d = dayStart(from); d.getTime() <= lastDay.getTime(); ...)`
(`placement.js:194`), so `{from: dayStart, to: dayStart}` bounds the search to
exactly one day. **This idiom already ships** — it is how session 6's DATES P1
places a flexible task on a picked date (`from === to`, HANDOFF §"Session 6 P1").
Proven in probe 9:

```
    PLACED with placeTask({from: day, to: day}) — no new solver:
      Wed 9 13:00 → Wed 9 15:30  150m  warn=false outsideZone=false
      Thu10 13:00 → Thu10 15:30  150m  warn=false outsideZone=false
      Fri11 13:00 → Fri11 15:30  150m  warn=false outsideZone=false
      Sat12 08:00 → Sat12 10:30  150m  warn=false outsideZone=false
      Tue15 14:30 → Tue15 17:00  150m  warn=false outsideZone=false
      Wed16 13:00 → Wed16 15:30  150m  warn=false outsideZone=false
      Thu17 13:00 → Thu17 15:30  150m  warn=false outsideZone=false
      Fri18 13:00 → Fri18 15:30  150m  warn=false outsideZone=false
    all landed on their intended day? true
```

**No new solver. `placeTask` unchanged. `redistribute` gains one call.**

**Candidate 6** — reads `schedule.learning.inspect()` (`learning.js:197`). No
engine change to *read* it. But it needs a per-bucket observation count that the
model does not expose, and a rule for turning a bucket into a number (§7).

**Candidate 7** — not a splitting equation. Wiring cost detailed in §7.

**Hybrid** — candidate 5 plus a `cap` argument. That is one parameter. Probe 9
ran it at `cap ∈ {∞, 240, 150}` with no other change.

---

## 3. Question 2 — the week's real shape. Is `O_d` cheaply derivable?

**Yes. ~25 lines on existing exports, 2.3 ms for 15 days.** I built it and ran it
against a schedule with an exclusive Work zone, six fixed anchors and a recurring
gym:

```
occupied intervals in R: 15

=== O_d for a NON-work task (Work zone is exclusive → carved out) ===
  day        O_d      longest run   runs
  Mon  7      5h00     3h30      1h00 3h30 0h30
  Tue  8      6h00     3h30      1h00 1h30 3h30
  Wed  9      6h00     4h30      1h00 4h30 0h30
  Thu 10      8h00     7h00      1h00 7h00
  Fri 11      6h00     4h30      1h00 4h30 0h30
  Sat 12     14h00    14h00      14h00
  Sun 13      4h00     4h00      4h00
  Mon 14      2h00     1h00      1h00 0h30 0h30
  Tue 15      6h30     5h30      1h00 5h30
  Wed 16      6h00     4h30      1h00 4h30 0h30
  Thu 17      8h00     7h00      1h00 7h00
  Fri 18      6h00     4h30      1h00 4h30 0h30
  Sat 19     14h00    14h00      14h00
  Sun 20      4h00     4h00      4h00
  Mon 21      6h00     4h30      1h00 4h30 0h30

  Omega = 101h30 (6090 min)   D = 15 days   A = 1200
  rho = A/Omega = 0.197    r = A/D = 80 min/day

  R* = 0.8 * R: the spec's effective runway
  inside R* (first 12 days): Omega=77h30  D=12  rho=0.258  r=100

  COST: 2.3123 ms for 15 days.
```

The composition is: `computeWindows` for the allowed intervals (zones, deadline,
exclusivity already applied) → `walkGaps` for usable runs → `breakMinForFill` for
the padding, with `dayCapacityMin` supplying the fill ratio. **All four are
already exported.** §4.1's admission that "`sliceChunks` does not look at the
week's actual shape" is accurate about `sliceChunks` and misleading about the
engine: the engine can see the shape perfectly well, `sliceChunks` just is not
told.

### The one genuine cost

`walkGaps` returns the earliest fitting slot per gap, not the gap
(`gaps.js:63–70`). My implementation recovers run lengths by re-scanning the
occupied blocks — correct, but a hack. A real build should add an export that
returns `{start, end}` extents. That is ~10 lines in `gaps.js` and is the **only
new primitive any candidate needs.**

### The finding the document does not anticipate

**`O_d`, `Ω`, `D`, `ρ` and `r` are properties of a `(task, day)` pair, not of a
day.** Same week, same probe, two different tasks:

```
=== the same for a WORK-tagged task (matches the zone → routed IN) ===
  day        O_d      longest run
  Mon  7      4h00     4h00
  Thu 10      1h00     0h30
  Fri 11      0h30     0h30
  Sat 12      0h00     0h00
  ...
  Omega = 33h30 — DIFFERENT SET OF DAYS. O_d is per (task, day), not per day.
```

101h30 for a study task, 33h30 for a work task, on the identical week — because
`computeWindows` routes a zone-matching task *into* the zone and carves the zone
*out* for everyone else (`placement.js:100–121`).

This matters for candidate 4's user-facing sentence. *"This wants 62% of your
open time"* is false as written; the true statement is *"62% of the time this is
allowed to use."* Two work projects and one study project would each report a
percentage of a different denominator, and those percentages **do not sum to
anything meaningful.** If the sentence ships, it must be phrased against the
task's own admissible time, and it must not be aggregated across tasks.

---

## 4. Question 3 — stability under re-planning

Two sweeps, re-planning on each of days 0…10 of the 14-day runway, against the
realistic week. Runway shrinks daily, so `R*`, `Ω`, `D`, `ρ`, `r` all drift.

### World (i): the user does nothing — `A` stays 1200

```
 d  A     R*d  Om     D  | C1 n/s   | C2 n/s  fit | C3 n/s   | C4 n/s  band  rho | C5 n/s cov | HYB n/s
 0  1200  11.2  4650 12  |  5/240   |  6/233  ok |  8/170   |  5/240 room   0.258 |  5/240 1200 |  8/150
 1  1200  10.4  4350 11  |  5/240   |  6/237  ok |  8/170   |  5/240 room   0.276 |  5/240 1200 |  8/150
 2  1200   9.6  3990 10  |  5/240   |  6/239  ok |  8/170   |  6/239 steady 0.301 |  5/240 1200 |  8/150
 3  1200   8.8  4470 10  |  5/240   |  5/240  ok |  8/170   |  5/240 room   0.268 |  5/240 1200 |  8/150
 4  1200   8.0  3990  9  |  5/240   |  5/240  ok |  8/170   |  5/240 steady 0.301 |  5/240 1200 |  8/150
 5  1200   7.2  3630  8  |  5/240   |  5/240  ok |  8/170   |  5/240 steady 0.331 |  5/240 1200 |  8/150
 6  1200   6.4  2790  7  |  5/240   |  6/239  ok |  8/170   |  6/239 steady  0.43 |  5/240 1200 |  7/154
 7  1200   5.6  2550  6  |  5/240   |  5/240  ok |  8/170   |  5/240 steady 0.471 |  5/240 1200 |  6/152
 8  1200   4.8  2670  6  |  5/240   |  5/240  ok |  8/170   |  5/240 steady 0.449 |  5/240 1200 |  6/170
 9  1200   4.0  2280  5  |  5/240   |  5/240  ok |  8/170   |  5/240 steady 0.526 |  5/240 1200 |  5/170
10  1200   3.2  1920  4  |  5/240   |  5/240 NO! |  8/170   |  5/240 tight  0.625 |  4/240  960 |  4/170

  CHURN over the 11 re-plans:
    C1: 0 n-changes, Σ|Δs| = 0 min
    C2: 3 n-changes, Σ|Δs| = 9 min
    C3: 0 n-changes, Σ|Δs| = 0 min
    C4: 4 n-changes, Σ|Δs| = 4 min
    C5: 1 n-changes, Σ|Δs| = 0 min
    HYB: 4 n-changes, Σ|Δs| = 24 min
```

### World (ii): the user keeps up — `A` shrinks

```
 d  A     R*d  Om     D  | C1 n/s   | C2 n/s  fit | C3 n/s   | C4 n/s  band  rho | C5 n/s cov | HYB n/s
 0  1200  11.2  4650 12  |  5/240   |  6/233  ok |  8/170   |  5/240 room   0.258 |  5/240 1200 |  8/150
 1  1091  10.4  4350 11  |  5/218   |  5/237  ok |  8/155   |  5/240 room   0.251 |  5/218 1091 |  8/136
 2   982   9.6  3990 10  |  5/196   |  5/239  ok |  7/160   |  5/240 room   0.246 |  5/240 1200 |  7/140
 3   873   8.8  4470 10  |  4/218   |  4/240  ok |  6/165   |  4/240 room   0.195 |  4/218  873 |  6/146
 4   764   8.0  3990  9  |  4/191   |  4/240  ok |  5/175   |  4/240 room   0.191 |  4/191  764 |  5/153
 5   655   7.2  3630  8  |  3/218   |  3/240  ok |  5/145   |  3/240 room    0.18 |  3/218  655 |  5/131
 6   546   6.4  2790  7  |  3/182   |  3/239  ok |  4/155   |  3/240 room   0.196 |  3/182  546 |  4/137
 7   437   5.6  2550  6  |  2/219   |  2/240  ok |  3/165   |  2/240 room   0.171 |  2/219  437 |  3/146
 8   328   4.8  2670  6  |  2/164   |  2/240  ok |  3/120   |  2/240 room   0.123 |  2/164  328 |  3/109
 9   219   4.0  2280  5  |  1/219   |  1/240  ok |  2/120   |  1/240 room   0.096 |  1/219  219 |  2/110
10   110   3.2  1920  4  |  1/110   |  1/240  ok |  1/120   |  1/240 room   0.057 |  1/110  110 |  1/110

  CHURN over the 11 re-plans:
    C1: 4 n-changes, Σ|Δs| = 412 min
    C2: 5 n-changes, Σ|Δs| = 9 min
    C3: 7 n-changes, Σ|Δs| = 130 min
    C4: 4 n-changes, Σ|Δs| = 0 min
    C5: 4 n-changes, Σ|Δs| = 412 min
    HYB: 7 n-changes, Σ|Δs| = 106 min
```

### Reading this

- **The document's suspects are the wrong ones.** `ceil()` boundaries are real —
  C1's `Σ|Δs| = 412 min` in world (ii) is entirely `ceil` re-sizing every
  surviving chunk each time `A` crosses a multiple of `s_max`. But **C4's band
  edges caused almost no churn at all** (`Σ|Δs| = 4 min` in world (i), `0` in
  world (ii)), because the band mostly changes *which formula* runs, and in this
  week the formulas agreed. The band edges are still a defect — see the
  discontinuity probe below — they are just not the *dominant* one.
- **The `ceil` boundary is quantified directly:**

```
=== ceil() boundary sensitivity: C1 with A drifting one minute at a time ===
  A=960  n=4  s=240   (A/S_MAX = 4.000)
  A=961  n=5  s=192   (A/S_MAX = 4.004)
  A=1199 n=5  s=240   (A/S_MAX = 4.996)
  A=1200 n=5  s=240   (A/S_MAX = 5.000)
  A=1201 n=6  s=200   (A/S_MAX = 5.004)
```

  And in the **shipped code**, not just in the equation:

```
=== E. THE CHURN THE SPEC IS WORRIED ABOUT: nothing lived yet, re-plan ===
    the amount changes by one minute (a chunk was resized 240 -> 239)
  A=1200: Mon 7 08:00+240m[auto]  Mon 7 12:30+240m[auto]  Tue 8 08:00+240m[auto]  Tue 8 12:30+240m[auto]  Wed 9 08:00+240m[auto]
  A=1201: Mon 7 08:00+201m[auto]  Mon 7 11:51+200m[auto]  Tue 8 08:00+200m[auto]  Tue 8 11:50+200m[auto]  Wed 9 08:00+200m[auto]  Sat12 08:00+200m[auto]
  entries unchanged: 0 of 5
```

  **One minute of extra work re-sizes and re-places every single chunk.** That is
  today's behaviour, independent of any candidate.
- **The band-edge discontinuity is real but small in `n`:**

```
=== C4 band-edge sensitivity: rho either side of 0.30 and 0.60 ===
  rho=0.299  A=1390  -> band=room   n=6 s=240
  rho=0.301  A=1400  -> band=steady n=7 s=233
  rho=0.599  A=2785  -> band=steady n=12 s=233
  rho=0.601  A=2795  -> band=tight  n=12 s=233
```

  Ten minutes of extra work at ρ = 0.30 costs you a sitting. At ρ = 0.60 the
  band flips and *nothing changes* — which is arguably worse, because the app
  changes its stated posture ("tight", "and SAY SO") without changing the plan.
  **A verdict that changes while the plan does not is precisely the P-1 failure
  mode: a mood, not a fact.**
- **C3 is flat at `8/170` for all eleven re-plans in world (i)** — perfectly
  stable, and perfectly useless, because it is a function of `A` alone.

### The stability the engine already has, which the document misses

`redistribute` **preserves anything the user has lived** (`projects.js:70`:
`completion !== null || placedBy === 'user'`). Proven:

```
=== C. mark chunk 1 DONE, then re-plan ===
  survivors (identical entries): 5 of 5

=== D. the user DRAGS chunk 3 to a day they like, then re-plan ===
  before: Mon 7 08:00+240m[auto]  Mon 7 12:30+240m[auto]  Tue 8 12:30+240m[auto]  Wed 9 08:00+240m[auto]  Tue15 09:00+240m[user]
  after : Mon 7 08:00+240m[auto]  Mon 7 12:30+240m[auto]  Tue 8 08:00+240m[auto]  Wed 9 08:00+240m[auto]  Tue15 09:00+240m[user]
  the user-placed chunk survived? true

=== B. re-plan with NOTHING changed (redistribute called again) ===
  identical? true
```

So "reshuffling a plan you have started living" is **already guarded**, and
`redistribute` is idempotent when nothing changed. The stability question is
narrower than the document frames it: it is about churn in chunks you have *not*
yet touched. That is a much weaker complaint, and it argues for accepting more
churn than the document assumes.

**Two incidental defects found while probing this:**

1. `resizeChunk` clamps to `Math.max(15, newDurationMin)` (`projects.js:114`) and
   **never checks `chunking.maxChunk`**. A user can drag one sitting to six hours
   and the app will keep it, silently violating the `s_max` every candidate here
   treats as the burnout guard. Probe: `Mon 7 08:00+270m[user]` with
   `maxChunk = 240`.
2. `config.js:14–20`'s comment on the `buffer` weight still says *"one fifth of
   the task's own length"*. That is the superseded rule; `scoring.js:79–85` and
   `WEEKLY-PLANNING` §4.4 were corrected on 2026-08-12 and this comment was not.

---

## 5. Question 4 — interaction with the corrected buffer weight

**It neither fights nor duplicates the spreading. It is inert across the region
any spreading rule would use.**

```
  All n chunks carry the SAME deadline (projects.js:92 `deadline: range.until`)
  and the SAME runwayStart (findBestSlot `from` = range.from). So every chunk
  gets an IDENTICAL bufferScore curve. Over a 14-day runway:
    d0:1.00 d1:1.00 d2:1.00 d3:1.00 d4:1.00 d5:1.00 d6:1.00 d7:1.00 d8:1.00 d9:1.00 d10:1.00 d11:1.00 d12:0.71 d13:0.36 d14:0.00
  => bufferScore is EXACTLY 1.000 on 12 of the 15 days.
```

`bufferScore` (`scoring.js:79–85`) is `clamp(slack / (runway/5), 0, 1)`. It
saturates. Its own doc comment (`scoring.js:80`) makes the point about the
no-deadline case — *"a constant cannot change a ranking"* — and the same is true
here across 12 of 15 days. So:

- **It does not fight any candidate.** Every candidate's spreading happens inside
  the saturated region.
- **It does not duplicate any candidate.** It expresses "not in the last fifth",
  which is a hard-ish boundary, not a distribution.
- **It complements candidate 5 exactly.** Candidate 5 already restricts itself to
  `R*` by construction, and `R* = 0.8·R` is the same fifth. They agree by design.

The shape is scale-free — identical at every runway length:

```
  runway  1d: buffer at 0,12.5%,...,100% of runway = 1.00 1.00 1.00 1.00 1.00 1.00 1.00 0.63 0.00
  runway 60d: buffer at 0,12.5%,...,100% of runway = 1.00 1.00 1.00 1.00 1.00 1.00 1.00 0.63 0.00
```

Worth stating plainly: **the buffer weight forbids the last 20% of the runway at
every scale, including a one-day runway where it discourages the last 4h48m.**
For a project due tonight, that is a real cost, mitigated only by the fact that
it is a weight and the other terms can outvote it.

### Does giving every chunk the same deadline cause bunching?

**Not through the buffer term** — a constant cannot bunch. But it does through a
related mechanism the document should record: `redistribute` gives every child
`deadline: range.until` (`projects.js:92`) and `placeTask` uses `opts.from` as
`runwayStart` (`placement.js:234`), so **chunk 1 and chunk 5 are scored
identically**. Nothing in the score expresses "chunk 5 may reasonably be later
than chunk 1". There is no sibling awareness anywhere in `scoring.js`. That is
the structural reason a spreading rule has to live *outside* the scorer — which
is another argument for candidate 5, whose spreading is decided before
`placeTask` is ever called.

---

## 6. Question 5 — P-2 compliance, and does the prior/assertion framing hold?

**The framing holds, but the code's standard is stricter than the document's
statement of it — and under the stricter standard, `κ`, `δ`, `s_free` and `τ`
still fail.**

The document (added 2026-08-12) claims:

> A documented **prior that learning overrides** is fine. A **stated fact** the
> app has not earned is not.

Checked against the code:

- `config.js:38–43` does document `energy.capacity` as *"only the PRIOR/fallback
  used for an axis that lacks enough evidence days"*. ✅
- `energy.js:125–126`: `if (!energyCalibration(schedule).calibrated) return null;`
  — **the prior is not used at all before calibration.**
- `energy.js:144`: `out[a] = okDips[a].length >= 2 ? Math.max(...okDips[a]) : prior[a];`
  — the prior only fills a per-axis hole *after* global calibration has already
  passed.
- `energy.js:159–171` (`energyBudget`): when uncalibrated it returns
  `capacity: null, over: false, remaining: null` — no ceiling, no verdict.

So the actual rule in the code is: **a prior may fill a gap in a body of evidence
that already exists; it may never be the sole basis of a user-visible claim.**
The document's phrasing ("a prior learning overrides") is a weaker rule that
would permit using the prior from day 0. The code does not do that.

Test each candidate's constants against the *code's* standard:

| Constant | Where used | Verdict |
|---|---|---|
| `s_min`, `s_max` | cands 1, 5 | **Clean, and not a prior at all.** The user typed them in the `.rangefield` (`WEEKLY-PLANNING` §4). A preference the user stated is categorically different from both a prior and an assertion. This is the honest answer to evaluation question 4: *a preference default the user can see and change is not the same sin at all.* |
| `ρ = A/Ω` sentence | cand 4 | **Clean.** It is arithmetic over the user's own calendar, exactly like `report.js#buildDeadlineBuffer`. No constant. **Keep this.** |
| `κ` | cands 2, 4 | **Fails today.** Used from day 0, sole basis of the plan shape *and* of an infeasibility verdict ("this does not fit"), with nothing learned behind it. Becomes clean once candidate 7 supplies evidence — that is candidate 7's whole value. |
| 0.3 / 0.6 band edges | cand 4 | **Fails.** They determine a *stated posture* ("tight… and SAY SO") with no evidence, and the probe above shows the posture flipping while the plan does not change. |
| `δ`, `s_free` | cand 3 | **Fails, and irredeemably.** They assert a productivity curve — that the second half of a long sitting produces 75% as much work. **Nothing in this codebase measures productivity.** `satisfaction.overall` is how you *felt*, not what you *produced*. There is no path from any stored quantity to `δ`, so it can never stop being an assertion. |
| `τ` | cand 3 | **Fails.** Same, plus it is an exchange rate between two things neither of which is measured. |
| dur:* curve | cand 6 | **Clean in principle** — it is read from the user's own ratings — **but only if gated per bucket**, which §7 shows it currently is not. |

**A note on the "wasted time" idea in candidate 3.** `waste(s) = n(s)·s − A` is
presented as "clock time bought that produced nothing." The app has no notion of
output. Displaying that number would be the app asserting the user was
unproductive for four hours — the clearest P-1 violation in the whole document,
and worse than the P-2 problem. **Candidate 3 should be rejected on this ground
alone**, before any of the arithmetic.

---

## 7. Questions 6 and 7 — candidates 6 and 7, the ML side

### 7.1 Verifying the claims about `learning.js`

Asked to confirm or refute, in order:

| Claim | Verdict |
|---|---|
| `DURATION_EDGES = [15,30,45,90,150,240]` at `learning.js:22`, 7 buckets | ✅ **Confirmed**, exactly. |
| labels `dur:<15 … dur:>240` at `:85` | ✅ **Confirmed**, exactly. |
| trains on `satisfaction.overall`, `timingFit` ratings count double, `:113–114` | ✅ **Confirmed.** `y = clamp((overall-1)/4, 0, 1)`, `weight = timingFit && timingFit !== 0 ? 2 : 1`. |
| `inspect()` at `:196` exposes them per-bucket | ✅ **Confirmed** (`:197–199`), and it returns `weight * gate`. |
| `modelScore` gated on `trained && sampleCount >= coldStartRatings` at `:184` | ✅ **Confirmed** (`:186`). Also gated a second time in `Schedule#_weights` (`Schedule.js:94`), which zeroes the `preference` weight below cold start, and in `_modelScore` (`Schedule.js:99`). Triple-gated. |
| `dayFill` is genuinely dead | ✅ **Confirmed, and more dead than stated.** `learning.js:71` reads `task._dayFillAtCompletion ?? 0`; a repo-wide grep for `_dayFillAtCompletion` returns **exactly one hit — that line.** It is never written, is not a `Task` field (`Task.js` constructor does not read it), and does not appear in `Task#toJSON` (`:183–210`). So even if something set it at runtime it would not survive a reload. |

**Where the brief overstates.** One claim needs correcting, and it is the load-bearing one:

> *"the model's `dur:*` weights ARE an empirical fatigue curve measured on this user"*

They are an empirical curve over the sitting lengths **the scheduler has
offered**, with unobserved buckets pinned at **exactly 0.0** — which is a
*meaningful* number on the same scale as the learned weights, not a null. That
is not the same object as a fatigue curve, and the difference is what breaks
`argmax` (§7.3). The rest of the brief's reading of the code is accurate.

### 7.2 Is the learned curve usable? Yes — better than I expected

Trained the **real** `LearningModule` on synthetic ratings whose ground truth is
a tent peaking at 120 minutes, with all seven buckets offered:

```
  n = 10 ratings
    dur:<15=+0.1012  dur:15-30=+0.0273  dur:30-45=+0.0940  dur:45-90=+0.1199  dur:90-150=+0.1248  dur:150-240=-0.0184  dur:>240=-0.1582
    ARGMAX = dur:90-150 (0.1248)
  n = 60 ratings
    dur:<15=+0.0104  dur:15-30=+0.0311  dur:30-45=+0.0725  dur:45-90=+0.0932  dur:90-150=+0.1460  dur:150-240=+0.0589  dur:>240=-0.1211
    ARGMAX = dur:90-150 (0.1460)   shape: peak at index 4; 0 direction reversals
  n = 350 ratings
    dur:<15=+0.0013  dur:15-30=+0.0381  dur:30-45=+0.0570  dur:45-90=+0.0869  dur:90-150=+0.1645  dur:150-240=+0.0571  dur:>240=-0.1102
```

And the argmax is remarkably stable:

```
  D. STABILITY of argmax as ratings arrive one at a time (all 7 offered)
  7:90-150  14:90-150  21:90-150  ...  203:90-150  210:90-150
  argmax changed 0 times over 30 re-trains from 7 to 210 ratings.
```

Under realistic skew (most sittings short) and ±1.5 rating points of noise, it
recovers the true peak from **19 ratings**:

```
  n = 19   <15=+0.000 15-30=-0.053 30-45=-0.062 45-90=+0.208 90-150=+0.209 150-240=+0.069 >240=-0.071
    argmax -> dur:90-150  => s* = 120 min
  n = 152  <15=+0.000 15-30=-0.035 30-45=+0.027 45-90=+0.171 90-150=+0.195 150-240=+0.115 >240=-0.153
    argmax -> dur:90-150  => s* = 120 min
```

**The jaggedness objection in the document is real but mild.** On deliberately
sparse, unbalanced data (n = 11–15, ±2.0 noise) I measured 0–2 direction
reversals away from a single-peaked curve, and the argmax was sane every time.
Ridge regularisation (`config.learning.lambda = 0.1`) is doing that work. So on
this evidence: **the unordered one-hot is not the problem the document fears.**

### 7.3 The real problem: unobserved buckets sit at 0, and 0 is not "unknown"

This is where candidate 6 breaks, and it is not the failure the document names.

I predicted the "zero-weight trap" — that untried buckets would win the argmax —
and **the probe mostly refuted me.** Because `y ∈ [0,1]` is non-negative and
weights are zero-initialised, an observed bucket almost always learns a positive
weight and beats the zeros:

```
  offered 20m+40m, all rated 5/5 (loved)     argmax = 30-45  OBSERVED
  offered 20m+40m, all rated 3/5 (meh)       argmax = 30-45  OBSERVED
  offered 20m+40m, all rated 2/5 (disliked)  argmax = 30-45  OBSERVED
  offered 300m×40                            argmax = >240   OBSERVED
```

It fires only in the fully degenerate case:

```
  offered 20m+40m, all rated 1/5 (hated)
    <15=+0.000 15-30=+0.000 30-45=+0.000 45-90=+0.000 90-150=+0.000 150-240=+0.000 >240=+0.000  bias=0.000
    argmax = <15  *** UNOBSERVED — trap fires ***
```

**But the general form of the defect is worse than the trap, and it is
everywhere.** Look at the mixed case:

```
  mixed: 20m hated (1), 120m loved (5)
    <15=+0.000 15-30=-0.365 30-45=+0.000 45-90=+0.000 90-150=+0.497 150-240=+0.000 >240=+0.000
    argmax = 90-150  OBSERVED
```

`argmax` is correct. **The rest of the ranking is nonsense.** Five never-tried
lengths score `+0.000`, above a length the user has demonstrably hated thirty
times at `−0.365`. Candidate 6 does not use plain argmax — its rule is

```
s* = argmax over buckets b of w[dur:b]   subject to  s_min ≤ s* ≤ s_max
                                         and  s* ≤ longest gap the week has
```

The moment that constraint binds — i.e. the moment the week is busy, which is
when you need the advice — you are choosing among the *surviving* buckets, and
the surviving buckets are ranked by a scale on which "never tried" outranks
"tried and hated." With a 45-minute longest gap in the case above, the choice is
between `15-30` (−0.365, observed) and `30-45` (+0.000, unobserved), and
candidate 6 picks the one it knows nothing about while presenting it as learned.

**This is fixable and the codebase already has the fix.** `learning.js:131–139`
implements exactly the right idiom — a per-column gate that zeroes a feature
until it has `config.learning.interactionMinSamples` (4) non-zero observations.
It is live machinery, `gates` is serialised (`learning.js:207`), and it currently
applies to an **empty set**, because `interactionIdx = []` after the role rip-out
(`learning.js:90`). Candidate 6 needs per-bucket *counts* exposed so a caller can
distinguish "0 because unobserved" from "0 because neutral". That is ~10 lines
and no layout change.

### 7.4 The second problem: a bucket is not a number

```
    dur:<15      = [0, 15)     width 15 min
    dur:45-90    = [45, 90)    width 45 min
    dur:90-150   = [90, 150)   width 60 min
    dur:150-240  = [150, 240)  width 90 min
    dur:>240     = [240, Infinity)  width Infinity min
```

The winning bucket is 60 minutes wide and the top bucket is unbounded.
Converting it to an `s*` requires a rule — midpoint? upper edge? — **which is an
invented constant, reintroduced at the last step.** Candidate 6 does not fully
escape question 4 either.

### 7.5 The confound, and whether the codebase can help

The document is right that it is real and it is not fixable by better fitting: a
length the scheduler never offers is never rated, so its column stays at exactly
0 forever. Probe section B above is that state, held stable through 200 ratings —
`<15`, `90-150`, `150-240` and `>240` all pinned at `+0.0000` regardless of
sample count.

**Does the codebase have an exploration mechanism to borrow? No.**

I checked `suggest.js`. `varietyPenalty` (`config.js:61`, used at
`suggest.js:175`) is `vAxis && axis === vAxis ? -cfg.varietyPenalty : 0` — a
deterministic penalty on the *dominant load axis* of the thing you just
finished, applied when ranking **activities for a free opening**. It is variety
in *what* you do, not in *how long*, it is not stochastic, and it never touches
placement. It cannot be borrowed. `train()`'s gating (`:131–139`) is the opposite
of exploration: it *suppresses* under-observed cells rather than seeking them.

So exploration would have to be built. The cheapest honest version, and the one I
would recommend, is **not** ε-greedy: it is to let candidate 5's greed do it for
free. Candidate 5 takes the longest run the week offers, so as the user's weeks
vary, the offered lengths vary with them, and the buckets fill naturally without
the app ever randomising a real person's calendar. **A scheduler that follows the
week's actual shape is its own exploration policy.** That is a genuine, and I
think under-appreciated, synergy between candidates 5 and 6.

### 7.6 Migration cost

**Neither candidate 6 nor candidate 7 needs a new `featureVector` term.**

- Candidate 6 reads existing `dur:*` columns. No layout change.
- Candidate 7's `dayFill` slot **already exists at a fixed index**
  (`learning.js:71, 76, 86`). Wiring it changes the column's *values*, not the
  vector's *layout*. So `MODEL_LAYOUT_VERSION` (`learning.js:17`) is not strictly
  required to change.

**But bump it anyway, 3 → 4.** A stored model's `dayFill` weight was trained
against a constant-zero column and is meaningless once the column goes live.
Bumping forces a clean retrain, and the migration is **already written**:
`LearningModule.fromJSON` sets `needsRetrain` on a layout mismatch
(`learning.js:221–225`), and `Schedule`'s constructor calls `retrain()` when it
sees the flag (`Schedule.js:88`). Ratings persist on the tasks, so nothing is
lost. Additionally `rollover.js:60` retrains every week anyway.

**Cost of candidate 7, in full:**

| Change | File | Size |
|---|---|---|
| `this.dayFillAtCompletion = data.dayFillAtCompletion ?? null` | `Task.js` (beside `energyAt`, `:78`) | 1 line |
| serialise it | `Task.js#toJSON` (beside `:206`) | 1 line |
| record it at rating time | `Schedule.js#_snapshotEnergy` (`:231–235`) | 2–3 lines |
| read it | `learning.js:71`, drop the `_` prefix | 1 line |
| `MODEL_LAYOUT_VERSION` 3 → 4 | `learning.js:17` | 1 character |
| **Total** | | **~7 lines** |

`_snapshotEnergy` is exactly the right home: it already fires only on first
rating (`:232–233`), already refuses to recompute (`:229` comment), and already
carries the argument for why — *"deriving it later from the current schedule
would train the model on a day that never happened."* `Task.js:76–77` names
`dayFill` as the very thing that motivated `energyAt`'s design. **This is a
seven-line change that the codebase has already designed and documented, and
every week it waits is training data that cannot be reconstructed.** It is the
clearest action item in this evaluation and it is independent of the splitting
decision entirely.

---

## 8. Question 2 — extremes

```
  case                                                  C1        C2            C3        C4               C5
  20h due in 3 days   (Om=1800,D=3)                     5×240     5×240 INFEAS  8×170     5×240 [tight]    3×240 covers 720/1200
  20h due in 6 months (Om=100000,D=150)                 5×240     5×240         8×170     5×240 [room]     5×240
  45-minute task, 2 weeks (Om=4650,D=12)                1×45      1×233         1×45      1×240 [room]     1×240
  week with NO open time (Om=0,D=0)                     5×240     40×30 INFEAS  8×170     5×240 [tight]    NOTHING FITS
  A > Omega (Om=900,D=6)                                5×240     14×90 INFEAS  8×170     6×200 [tight]    6×150 covers 900/1200
  fragmented week, longest run 40m (Om=2400,D=12)       5×240     10×120        8×170     10×120 [steady]  12×40 covers 480/1200
```

Four things jump out:

1. **C1 and C3 give the identical answer to every case, including a week with no
   open time.** C3 emits `8 × 170` for a week that has zero minutes available.
   Neither of them can distinguish "due in 3 days" from "due in 6 months", which
   is the exact thing the user asked for ("combine the task length with the
   runway").
2. **C2 and C4 produce sittings the week cannot hold.** In the fragmented case
   (longest run 40 min) both emit 120-minute sittings. `placeTask` would then
   park them with a warning (`placement.js:290–303`) or shove them past break
   padding (`:281`). Their numbers are wishes.
3. **C5 is the only one that reports a shortfall as a number** in three of the
   six cases, and the only one that says "NOTHING FITS" for the empty week rather
   than confidently emitting a plan.
4. **The 45-minute task exposes a bug in C2/C4/C5's naive form**: they emit a
   *233/240-minute* sitting for a 45-minute task, because they compute `s` from
   the week and forget to clamp to `A`. Trivial to fix (`min(s, A)`), but worth
   noting that three of five candidates as written get the simplest case wrong.

---

## 9. Question 6 — degrading honestly

`WEEKLY-PLANNING` §4.3 wants a plain statement of the shortfall, no debt, no red,
no verdict. Candidate 5 produces the number **at plan time**:

```
  DEGRADE-HONESTLY CHECK (question 6): A larger than the week can hold
  work-tagged, A=3000m (50h): n=9, placed=1740m, SHORTFALL=1260m
  => "29h of 50h placed; the fortnight had no room for the rest."
```

That is §4.3's sentence, generated before the week is lived rather than after.
Candidate 2's `feasible ⟺ n ≤ D·m` is trying for the same thing and is the best
idea in that candidate — but it delivers a **boolean** derived from `κ`, whereas
candidate 5 delivers **minutes** derived from the calendar. A number the user can
check against their own week is categorically better than a verdict from a
constant, and it needs no `κ` at all.

Candidates 1 and 3 cannot degrade honestly, because they never learn there is
anything to degrade about.

---

## 10. Question 7 — concretely, how learning enters the recommendation

For candidate 5 + cap:

```
cap = min( s_max , learnedCeiling(schedule) )     // s_max is user-typed
```

**Phase 0 (build now).** `learnedCeiling` returns `Infinity`. The only constant
in the whole feature is the user's own `s_max`. Nothing is asserted; nothing is
invented; the plan is derived entirely from the user's stated preference and
their real calendar. **This ships P-2-clean with no ML at all**, which is why it
is the recommendation.

**Phase 1 (after candidate 7 has run several weeks).** `learnedCeiling` reads
`schedule.learning.inspect()` and returns a **refusal**, not a choice:

> the lowest bucket edge `b` such that `w[dur:b]` is *observed* (≥
> `interactionMinSamples` non-zero rows) **and** `w[dur:b] < w[best observed
> bucket] − margin`.

i.e. *"you have told me, with evidence, that sittings this long go badly — so I
will not offer one."* This uses only observed buckets, so §7.3's defect cannot
bite, and it never needs the bucket→number rule of §7.4 because an edge is
already a number. Cold start is structural rather than a special case: with no
observed bucket meeting the bar, the expression is empty and `cap = s_max`.

**What becomes a prior overridden by learning:** nothing, because there is no
prior. `κ`, `δ`, `s_free` and `τ` are not needed by this design at all — which is
the cleanest possible answer to evaluation question 4.

**Which quantity is read from `inspect()`:** the `dur:*` rows only, plus a new
per-bucket observation count that `inspect()` does not yet return.

**Cold-start behaviour:** identical to phase 0, and stated in the UI the way
`learnedCapacity()`'s `null` is (`energy.js:125`) — no ceiling shown, no claim
made.

**`featureVector` change:** none. **`MODEL_LAYOUT_VERSION` bump:** not for this;
bump for candidate 7's `dayFill` (§7.6), which is a separate, independent, and
more urgent change.

**How the confounding is handled:** by candidate 5's own greed (§7.5). The
scheduler offers the longest run the week has, weeks differ, so the buckets fill
from lived variation rather than from randomisation. The app never has to
experiment on a real person's calendar to learn.

**And candidate 4's sentence, kept:** state `ρ = A/Ω` as a fact when it is high —
*"this wants 62% of the time it can use over the next fortnight"* — phrased
against the task's admissible time per §3's finding. No band, no posture, no
threshold. Just the number, which is arithmetic on the user's own calendar and
therefore says nothing the app has not earned.

---

## 11. What I could not determine

1. **Whether spreading is what the user actually wants.** Everything above
   assumes 4h × 5 on consecutive days is bad. The user said they *can* work four
   hours straight, and said the failure was "two sessions". I have inferred that
   "days touched" is the quantity that matters from the phrase "without burning
   out", but nobody has asked them whether five consecutive 4h days is better or
   worse than eight spread 2.5h days. **This should be asked before anything is
   built**, because it decides between candidate 5 with a cap and candidate 5
   without one, and the two produce visibly different fortnights (probe 9:
   5 sittings on 5 days vs 8 sittings on 8 days from identical inputs).
2. **Whether the real user's weeks are open or busy.** The bunching pathology is
   severe on an open week and invisible on a busy one (§0's caveat). I do not
   have their actual data — `design/import/` is gitignored. If their fortnights
   look like probe 9's realistic week, today's engine is already acceptable and
   the whole document is lower priority than it appears.
3. **Whether `maxPlacementLookahead: 3` is deliberate.** It is the direct cause
   of proximity's cliff, and it is also the default search horizon for every
   flexible task. Raising it would change placement app-wide. I could not
   determine from `SPEC.md` or the comments whether 3 was chosen for the horizon
   semantics or for search cost. **This is the single highest-leverage number in
   the file and it deserves its own investigation.**
4. **Real `dur:*` weights.** Every learned curve above is synthetic — I generated
   ratings against an assumed tent-shaped ground truth. The shapes are plausible
   and the *mechanics* (stability, gating, zero-pinning) are real properties of
   the code, but the claim "the model recovers the true peak from 19 ratings" is
   only as good as my noise model. **This needs one run against the user's actual
   rated history before candidate 6 is taken seriously.**
5. **Whether `satisfaction.overall` correlates with sitting length at all** for
   this user. Candidate 6's entire premise is that it does. If a person rates a
   session on whether the work went well rather than on how long they sat, the
   `dur:*` weights are measuring the task, not the sitting, and candidate 6 is
   measuring nothing. `timingFit` (`learning.js:114`) is the closer proxy and is
   used only as a sample weight, never as a target.
6. **The cost of the run-length primitive in `gaps.js` against the real UI.** I
   measured 2.3 ms for 15 days on a schedule with 15 occupied intervals. A real
   year of recurring tasks may be much heavier, and `recurrenceIntervals`
   (`placement.js:156–174`) expands week by week with a 60-iteration guard. I did
   not profile a realistic full-history schedule.
7. **Whether `resizeChunk`'s missing `maxChunk` clamp (§4) is deliberate.** It
   may be intentional user autonomy — the same R-1 principle that lets a manual
   drag override zones (HANDOFF, "Decisions locked"). If so it should be
   commented; if not it is a bug that undermines every candidate's `s_max` guard.
