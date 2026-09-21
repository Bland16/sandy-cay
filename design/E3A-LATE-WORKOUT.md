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
