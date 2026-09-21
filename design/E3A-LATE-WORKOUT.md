# E-3a — "early in the morning or last thing at night"

**Session 9, 2026-09-20.** Status: **FINDINGS — nothing built, nothing decided.**
Two of four commissioned designs have reported; the remaining-day candidate and
the adversarial review are still out. Everything below is measured against the
user's real export, anonymised.

---

## 0. The problem

> *"I like working out either early in the morning or last thing at night, so
> yes. Do the workout while rested is accurate since I am rested in the morning —
> but it also applies to at the end of the day prior to resting."*

At 22:00 the reserve is deep, so every term the engine has ranks a demanding
block badly — exactly when the user wants it. `arrivalDepletionFor` asks how
spent you are when you sit down; `dipIfPlaced` asks what the block costs the rest
of the day. Neither asks what makes a late workout fine.

The user's own framing for the answer:

> *"I was thinking about proximity to rest. It might not make sense for anything
> but physical, but being close to rest on either side can sometimes be okay for
> short durations of pure exertion."*

---

## 1. ⚠️ The premise needs checking before anything is built

**Two agents, working independently on different designs, measured the same
thing and it does not match the brief.** The user's 16 physical sessions in the
lived window start at:

```
07:30 ×3 · 09:00 · 12:00 · 13:15 · 14:15 · 15:20 · 16:00 · 16:30
17:30 · 18:00 ×2 · 18:15 · 18:30 · 21:25
```

- **Exactly one session in five weeks starts after 20:00.**
- The evening mode is **18:00–18:30**, with three to four hours of day still to
  come.
- **Only 2 of 6 evening sessions were the last item of their day.**

**So "last thing at night" may describe how it feels — the last demanding thing
on the schedule — rather than when it happens.** The two readings produce
materially different designs, and an engine built for the literal reading would
rank 22:00 above 18:00, which this record says is wrong for this user.

**OPEN — D-1. Which does the user mean?** *"When you say last thing at night, do
you mean the last thing on your schedule, or literally before bed?"* **Ask; do
not infer.** Availability and preference are indistinguishable in an export — a
gym's closing time and a class ending at 17:30 look exactly like a choice.

---

## 2. Candidate A — proximity to rest (the user's own framing)

### 2.1 The evening half is the strongest signal in the file

Against `overall`, on the 47 items whose nearest rest edge is the evening one:

```
r(b, overall)                        = −0.417
partial | recomputed prior spend     = −0.406
partial | Δ (the energy term)        = −0.427
partial | net load                   = −0.405
```

**Stronger than anything `PLAN-AUDIT-2.md` E-4 identified for the preference
model** (position-in-day −0.261, recomputed prior spend −0.215), and it survives
every control tried. The gradient is a clean slope rather than a cliff:

```
minutes of day remaining   0–30   31–90   91–180   181–300   301+
mean overall               4.43    4.50     4.00      3.79    3.00
n                             7       6        7        14      13
```

### 2.2 ⚠️ A Simpson's paradox trap — record this before anyone re-measures it

Measured **unconditionally** across all rated items, the correlation comes out
**+0.168** — the opposite sign. Within the evening arm it is **−0.417**. Morning
items have a large "distance to evening rest" *and* are fresh and well-rated, and
pooling the two arms inverts the finding.

**Anyone who checks this the obvious way will conclude the opposite of the
truth.** The split by which arm binds is not optional.

### 2.3 Three of the user's four intuitions are refuted by their own data

| the intuition | measured | verdict |
|---|---|---|
| **symmetric** — rest on either side | morning arm partial r **−0.017** after controlling for prior spend | **refuted.** The morning arm IS arrival freshness, which `arrivalDepletionFor` already carries |
| **physical only** | evening arm: physical spenders **−0.135**, non-physical **−0.689** | **refuted, and backwards** — physical is where it matters least |
| **short durations** | no decay in rating up to two hours; near-rest physical durations run 30–90 min, median ~60 | **no ceiling needed.** The real defect is the opposite — see §2.5 |
| **proximity to rest matters** | −0.41, surviving every control | **supported**, for the evening arm only |

### 2.4 Why an ungated term cannot work in the picker — structural

**In the picker, proximity is a function of the clock alone.** Within one moment
it is identical for every candidate, so an ungated term is a constant offset and
cannot reorder anything. Measured: ungated churn 0.171/cell against 0.544 gated.

**The gate is the entire term** — and the gate measurement supports (non-physical)
would tell the user at 22:00 to do something social or restorative, which
`dir·tanh(Δ)` already does. **The picker may simply be the wrong place for this
idea:** the quantity is per-slot, and the picker's slot is fixed.

### 2.5 What it does wrong, concretely

- **It is a chores machine.** "Pure exertion" resolves to bucket-level purity, and
  the user's **Chores bucket scores 0.694 against Exercise's 0.593** — taking the
  bins out is purer exertion than the gym. Measured: five of the top six gated-in
  picks at 20:00 are chores; the 08:00 top pick flips from restorative to Chores.
- **It rewards the LONGEST thing.** With `b = E − t_end`, duration *is* proximity.
  The highest score measured went to a 3-hour hike ending at the window close —
  the literal inverse of "short durations".
- **The real failure mode is not "a workout at 1 a.m."** That is blocked today by
  accident: `currentOpening` returns null past 23:00 and `computeWindows` clips
  there. The term has no anchor of its own — it inherits the **user-editable
  window**. Widen it to the truth (11 of 27 days run past 22:00) and the measured
  result is **vacuuming recommended at 05:00**.
- **It cannot reach what it was designed for.** The 07:30 sessions fall outside
  `config.windows` (08:00), so `currentOpening` clamps them away. The term
  rewards 08:00, which is not when the user goes.
- **It adds no resolution**: distinct scores 34 before, 34 after.
- **It reintroduces a cliff** — a binary gate worth 0.30 against a score range of
  1.90 is a 16% discontinuity, which is the sign-quantisation E-3 exists to remove.

### 2.6 The one piece worth building

**Proximity-modulated recovery capacity**, for the sick-day tail only:

```
C_eff[x] = C[x] · ( 1 − (1 − σ[x])·(1 − PR) )
```

where σ is the recovery scale and PR the proximity quantity. Measured against the
requirement *"a recovery day must not push out a late workout"*:

```
                     well   plain per-axis σ   modulated C_eff
day A 22:00 gym       #17          #38               #16
day B 22:00 gym       #25          #43               #25
day C 22:00 gym       #31          #36               #27
day B 13:00 gym       #42          #47               #47   ← correctly still pushed out
```

A plain recovery scale costs a late workout **10–21 ranks**; the modulated
capacity holds it to **0–4** while still penalising a 1 p.m. workout, which *is*
part of what overloads a recovery day. **No additive term, no new weight, no
cliff.** It still needs a defensible evening boundary, which §4 says does not exist.

---

## 2b. Candidate B — "how much day REMAINS after the block": **REJECTED as stated**

Its author's own headline: *the framing is sound but most of its natural
implementations are a "do it last" machine, and the one that is safe buys much
less than hoped.*

**Any clock-based measure fails catastrophically.** With day-remaining measured
as `(windowEnd − slotEnd)/windowLength`, **22:00 becomes the unique strict best
hour on 27 of 27 days for a study block** and 25 of 27 for a workout — not a tie
broken by earliest-first, a strict monotone preference for lateness. The 07:00
study slot falls from mean rank 1.9 to **13.4 of 16**.

**And the thing it moves is study, not workouts** — which is the opposite of what
the user asked for, and collides with a preference they have stated elsewhere
(that the app should push them to finish work *earlier*).

Three findings from it worth keeping regardless of the verdict:

- **⚠️ E-3's recommended picker score is time-of-day-BLIND for spending work.**
  For a spender `r'[x] = min(0, r[x] − L[x]h)` never clamps, so `Δ` is
  independent of the reserve — measured, the top exercise activity's Δ is
  **−0.3534 at 08:00, 12:00 and 21:00 alike**. So the premise "every term ranks a
  late block badly" is true of `w.energy` and **false of the picker**. E-3a is a
  *placement* question, not a picker one. This belongs in `PLAN-AUDIT-2.md` E-3.
- **The 02:00 problem is already answered, for free.** `currentOpening` returns
  null past 23:00, and at 00:30–02:00 the midnight-anchored day treats the small
  hours as the *start* of a full day, so a demanding block there is maximally
  expensive. ⚠️ **This only holds because `dayStart` is midnight-anchored.** If
  any day-remaining measure were ever computed on *grid* minutes (5am-anchored),
  01:00 would read as 25:00, past the close, and **02:00 would become the best
  slot in the schedule.** Written down because it is a one-line trap.
- **An axis restriction to physical is justified by measurement, for a reason
  the user did not have in mind:** it is the containment boundary that stops a
  term built for one stated preference from silently granting the opposite one.
  Restricted to physical, a pure-mental block is byte-identical to today on every
  statistic. Un-gated, it promotes late study on 14 of 27 days.

## 3. Candidate C — the day boundary as a modelled event: **REJECTED**

Verdict from its own author: *the surgery does not earn itself.*

- **Re-anchoring the engine's day changes 0 of 26 days.** Exactly one task of 150
  moves day, and its load is all-zero because it carries no bucket — it is one of
  the items F-11 just surfaced. The effect is nil, *because of a different bug*.
- **The brief's premise was false.** Midnight-crossing work is **not** invisible
  to the battery: `getTasksForDay` selects by start day and `reserveWalk` charges
  atomically, so the whole block lands on its start day. `energyBudget`,
  `learnedCapacity` and the placement terms all see it correctly today.
- **What IS broken is the drawing**, and it is a `report.js` bug. The day strip
  builds its row relative to local midnight, so a point stamped 01:00 lands at
  minute 1500 in a 1440-minute row. Measured: on the deepest day in the record the
  wash tops out at 24.8 load-hours against a true depth of 34.9 — **2 of 10 shade
  steps missing** — and two rows overrun their box.

**Action, and it is cheap:** anchor the *report row* at 05:00. ~20 lines, one
file, no engine change. **Closes `TODO.md` R-2 completely.** Blast radius of the
engine version, for comparison: twelve files and five of the most re-derived
arithmetic sites in the codebase, for zero measured change.

---

## 3b. The adversarial review — what no formulation escapes

Commissioned separately, to be answered rather than admired. The failures it
ranks as **inherent to the whole idea** are the ones that matter:

- **⚠️ THE WITHIN-DAY SCORE BUDGET IS 0.048, AND ANY [0,1] TERM IS TWICE
  EVERYTHING ELSE COMBINED.** `findBestSlot` computes `dayFillAfter` ONCE per
  day, outside the slot loop, so `balance` is constant across every slot on that
  day. `stability` is nonzero only at the task's own current start, `buffer`
  saturates, `preference` is 0. **The only term that discriminates between 08:00
  and 22:00 today is `proximity`, and its whole swing is 0.048.** Measured, a
  remaining-day term moves 0.080 and a proximity term 0.085 — each **1.7× as
  much score as every other term put together.** They do not contribute to the
  time-of-day decision, they *become* it.
  **Immunity: no design ships without printing its own measured within-day
  spread beside 0.0484.**
- **The exemption being asked for already exists TWICE.** `reserveWalk` restarts
  each day at zero, so a 20:00–23:00 block changes the next day by *exactly*
  `0.000` on all four axes — the engine already grants "nothing left to protect"
  in full at the day boundary. Anything new pays for it a second time.
- **⚠️ THE FEEDBACK LOOP RUNS THROUGH `learnedCapacity`, NOT THE PREFERENCE
  MODEL.** Everyone assumed `modelMaySpeak() === false` blocked it. It does not.
  Measured: planting one 90-minute demanding block at 21:30 into each rated day
  moves capacity from `{4.354, 3.075, 8.438, 1.575}` to
  `{5.500, 3.330, 9.368, 1.575}` — **mental +26%, social +11%.** The chain closes:
  late work → deeper days → higher ceiling → `spent/capacity` falls → late work
  looks cheaper. And `energyBudget().over` stops firing, so the surface that
  would say "this is a lot" goes quiet exactly when it shouldn't.
  **The p70 quantile is what makes this recoverable rather than a ratchet,
  because it can move down — a property `Math.max` did not have.** That is an
  unplanned benefit of the E-1 change already shipped.
  **Immunity: days whose shape the term chose must not be evidence for the
  ceiling the term divides by.**
- **Leakage into automatic movers is the DEFAULT, not a risk.** There is one
  `scoring.js#score`, and `placeTask` is called from eight places —
  `autoSchedule`, `carryOver`, `conflicts`, `evacuate`, **`generate`** (commitment
  sittings), `projects`, `ripple`, `Schedule`. Anything in `w.energy` is in all
  of them on the commit that adds it, including displacement: dragging one task
  onto another would silently re-place the evicted one through a lateness term.
  **Immunity: the term lives in a function only the picker calls, with a test
  asserting `findBestSlot`'s output is byte-identical before and after.**
- **It becomes health advice the moment it produces a sentence.** And there is a
  live example of the defect already: `rankOpenings` prints
  *"costs your day nothing"* whenever `impact === 0` **regardless of rank** —
  measured on the real save, that praise lands on the **last** row of six. A
  lateness term promotes exactly those rows to first and makes the sentence the
  headline. *"Costs your day nothing"* on a 22:30 hard workout is a sleep claim
  the app is not entitled to make.
  **Immunity: every string the term can cause is attributable to something the
  user typed. The app may repeat their claim; it may not generate one.**
- **⚠️ The picker already half-recommends the gym late at night, by
  misclassification.** `suggest.js#isRestful` tests `L.mental < 0`, and the
  exercise vector is `{mental −1, physical +2}` — so the gym counts as *restful*.
  Measured: `suggestActivities` at 22:00 returns it under the reason *"You've been
  running down — something restful?"*. A lateness bonus would double an effect
  that is already there for the wrong reason.
- **The sick-day tail cannot restrain a lateness term and makes it STRONGER.** B
  and C read no capacity at all, so a 60% ceiling changes them by zero — while
  the term beside them goes blind (saturated axes: 18 → 26 → 38 of 80 axis-days
  at 100% → 80% → 60%). The lateness term's *share* of the decision grows on
  exactly the days the feature exists to protect.
  **Immunity: `SICK-DAYS.md` §4's "one scalar, one place" rule must reach it.**
- **Both gates are cliffs.** A duration gate at 60 minutes produces a **0.039
  score jump for one extra minute** — 81% of `proximity`'s entire 15-hour swing.
  That is the knife-edge E-3 exists to remove, reintroduced by the gate rather
  than the term. **Immunity: every gate is continuous — a ramp, or an axis
  *weight*, never a predicate.**
- **⚠️ `tests/sleep-guard.test.js` is not the backstop it looks like.** It binds
  on **1 of 27** real nights, and its last test is written
  `if (endsMonday) expect(…)` — **vacuous whenever the task lands on another
  day**, which is precisely what a term reshuffling days would cause. It would
  stay green through the whole failure. A test asserting the chosen *slot* rather
  than the legal *window* belongs in that file before any term ships.

**Verdict across the four:** proximity-to-rest (A) is the only one with a
defensible shape, and only its evening arm, un-gated from physical, outside the
picker — **provided the boundary is not user-authored.** B is a do-it-last
machine. C reverses its own sign or invents a refused constant.

## 4. ⚠️ The blocker under all of it: there is no honest evening boundary

Every proximity quantity is measured against a rest edge, and the engine has none.

| source | what it gives | verdict |
|---|---|---|
| `dayWindowBounds` | 08:00–23:00 (Sun 10:00) | **wrong at both ends** — 4 of 27 days start before it, 11 of 27 end after it |
| `sleepCutoff` | lands at 07:00 / 01:00 / 23:30 on sampled days | **binds on 0 of 5.** Inert |
| the day's own last-end | median 21:15, p90 **midnight**, range 16:50–25:00 | ±3 h. Too dispersed to key a term on |
| an adjacent restorative task | present on **10 of 27 days** | not available often enough |

**And the window is user-editable**, which is what turns the failure mode into
"vacuum at 5 a.m." the moment the user records their real hours. Pinning the edge
to something that is neither user-editable nor invented is an **unsolved
sub-design**, and nothing should ship on top of it until it is solved.

---

## 5. Open

- **D-1 (§1). What does "last thing at night" mean?** Blocks the whole design.
- **D-2.** Does anything ship in the *picker* at all, given §2.4 shows the
  quantity cannot reorder there without a gate the measurements do not support?
- **D-3.** The evening boundary (§4).
- **D-4.** Whether to take the cheap `report.js` row fix (§3) on its own merits.
  It is independent of everything else here and closes R-2.
- **Still out:** the remaining-day candidate, and the adversarial review whose
  failure list all three designs are to be tested against.

## 6. Limits on every number above

One user, five weeks. The evening arm rests on **47 rated items**, the axis
conclusion on **28 against 19**. `overall` is 58 fives out of 101 and is itself
fatigue-contaminated, so −0.41 against it is the ceiling of what is knowable here
rather than a strong result. **0 of 153 tasks carry an `activityId`**, so no
suggestion has ever been joined to an outcome — every ranking judgement in these
reports is an agent reading labels.
