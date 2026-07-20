# The Energy Model — a load basis & the daily budget

**Status:** DRAFT spec / brainstorm (session 4, 2026-07-17). The keystone the
frontier map (`the brink` discussion) pointed at: *the bottleneck is data, not the
model, and the one change that buys the most is giving activities a **load vector**
instead of a tag soup.* Everything ambitious we're excited about — the energy
budget, week-forecasting, the P-1-safe "read my day" — hangs off this one primitive.

> ### ⚠ PARTLY SUPERSEDED — read [`RECONCILIATION.md`](RECONCILIATION.md) first
>
> The core idea (a four-axis load vector as the representation basis) stands and
> is built. The *defaults* and the *accountant* described below do not:
>
> | In this doc | Superseded by |
> |---|---|
> | Role-derived bucket defaults ("Work → mental +2; Rest → mental −2") | RECONCILIATION P-2/P-3 — `role` is gone; bucket load defaults to **neutral 0**, user-authored. Fabricated per-role numbers were the dishonesty this reconciliation exists to fix. |
> | "**Activity override.** An activity tweaks its bucket's default" | RECONCILIATION P-1 — wrong object. An activity carries a `load` like any task, not a bespoke override capability. |
> | The order-blind accountant (`mentalLeft(day) = capacity.mental − Σ …`) | Replaced in code by the **time-ordered battery / deepest-dip** model (`energy.js`). |
> | A hardcoded daily capacity | **Learned.** `learnedCapacity()` returns `null` until `config.energy.calibrationWeeks` (default 3) of `energy` ratings exist; until then the app shows a "still learning" shape with **no ceiling and no over/under verdict**. |
>
> The current tag→load resolution actually implemented is `energy.js#loadForTask`.

## The one idea

Today the learning model represents a task by its **tags** (top-6 one-hot). That's
the sparsity trap: every new tag is a fresh cold-start column, and a tag you've
rated twice teaches almost nothing. Replace that soup with a small, **named
load-space** every activity lives in:

```
load = { mental, physical, social, creative }   // signed: + spends, − restores
```

- **+ = demands** that reserve (deep work: `mental +2`), **− = replenishes** it
  (a nap: `mental −2, physical −1`; the gym: `physical +2, mental −1` — it costs
  legs, pays back focus).
- Four axes, not six-plus sparse tags → dense, learnable, and **a brand-new
  activity gets a sensible prediction on day one** from its coordinates. "I like
  mentally-heavy mornings" becomes *one* coefficient that generalises across every
  demanding task, instead of a per-tag weight you'll never gather data for.

Tags don't die — they still drive zones, buckets, and organisation. Load is a
*second, denser* representation, derived once and reused everywhere.

## Where the load vector comes from

A cascade, cheapest first — no axis is ever mandatory:
1. **Bucket default.** Each bucket carries a default load profile for its role
   (Work → `mental +2`; Rest → `mental −2, physical −1`; Health → `physical +2,
   mental −1`; Creative → `creative +2, mental +1`; Social → `social ±1`; …).
2. **Activity override.** An activity tweaks its bucket's default (a Cabana slider
   row beside min/max: four small −2…+2 dials).
3. **Learned refinement (later).** The `energy` satisfaction facet
   (drained/neutral/energized) is the *label* — if you rate tasks "drained" on days
   heavy in mental load, the model nudges your mental capacity and the loads that
   drain you. The data you already give teaches it.

**The sign is personal.** Socialising *spends* social energy for an introvert and
*restores* it for an extrovert — so the values are yours to set (with defaults),
and the learning refines them. That personalisation is the point, not a bug.

## Two things it powers

### 1. The daily energy budget (an accounting layer, NOT a predictor)

Distinct from preference prediction. Each axis has a daily **capacity**; a day's
net spend is `Σ load.axis` over what's placed; if it exceeds capacity → overdraft.

```
mentalLeft(day) = capacity.mental − Σ over placed tasks of load.mental
```

Surfaced as a gentle band ("Thursday's mental budget is overspent") in the report
and Cabana — **physics, never a scold** (P-1): the same voice as "this won't fit
the time," applied to "this won't fit your energy." It captures the one thing
per-task ratings *can't*: **accumulation and sequence** across a day. Capacity is
set by you (defaults), refined from the `energy` facet over time.

### 2. The model pivot (the sparsity kill)

`featureVector` swaps the tag one-hots for the 4 load scalars, and adds a
`load×time` interaction (the general form of role×time): *"high-mental slots rate
well in the morning, poorly in the evening"* — learned once, applied to everything.
Fewer features, denser data, immediate generalisation to new activities.

**Keep a small per-tag residual.** The basis trades tag-identity for
generalisation — two activities with the *same* load vector you feel oppositely
about are literally indistinguishable to it. So retain a tiny gated per-tag term
for idiosyncratic favourites; the load basis carries the generalisation, the
residual carries the quirks.

### The accountant and the model close a loop (train the model on the budget)

The budget isn't only a warning light — it's a **feature the model trains on**.
Snapshot *how much of each axis's budget was already spent* at the moment a task
happened, and the model learns fatigue/accumulation directly: *"I rate work lower
once my mental budget is ~80% gone."* That is the honest, P-1-clean **"read my
day"** — computed only from what you *did*, never from what you skipped.

It runs both ways: your **`energy` ratings calibrate the accountant's capacity**.
Rate "drained" on days it called over-budget and it learns your real mental ceiling
(the per-user scaling factor). *Accountant → budget-state feature → model; model's
ratings → capacity → accountant* — each makes the other personal.

Caveat, unchanging: it inherits the hand-authored load error until calibrated, and
it's **correlational** — an over-budget day might *cause* the low rating, or you
might just pack hard days when you're already stretched. Narrate "tends to," offer
the experiment, never assert.

## Why this is the keystone — three primitives, one graph

Turning the whole "over-the-top" list into buildable kernels, they collapse onto
**three primitives** — and the load vector is the one that multiplies most.

```
  PRIMITIVE I — the load vector (author once → four things light up)
     ├─► daily budget accountant     (sum + threshold; zero ML)
     ├─► model basis (load×time)     (denser inputs, day-one generalisation)
     ├─► week forecast               (roll the budget/model forward)
     └─► routines feed load/segment  (active spends, passive is free)

  PRIMITIVE II — the completed-task timeline (P-1-clean: only what you DID)
     ├─► chronotype curve            (ratings × time-of-day, as a picture)
     ├─► "read my day" sequence/fatigue (predecessor role, minutes-on-task)
     └─► steerer recency             (what you've done lately)

  PRIMITIVE III — per-cell rating counts (already exists: the ≥4 gate)
     ├─► active elicitation          (ask where you're THIN + influential)
     └─► causal nudge                (offer to test where you're CONFIDENT)
```

One humble 4-number vector and half the wild list becomes arithmetic: the energy
budget is the digital twin in tractable form; rolling it forward is forecasting;
routines sum it per segment. The *other* half of the dream — the honest "read my
day" — rides Primitive II (sequence/fatigue from **completed** tasks, never skips),
and the "ask the right question / test my assumptions" pair rides Primitive III.

**Two ideas have no honest version under our constraints — ship the humble
cousin and name it:** predicting Friday's *feeling* (compounding correlational
error → render load/balance *shape* instead, a mood-ring never a promise), and
real client-side language understanding with no LLM (→ a deterministic
parse-from-your-known-activities, autocomplete not comprehension).

## Build path (validate the axes *before* betting the model on them)

- **L-1 — the vector + the deterministic budget, together. ✅ BUILT.** `load`
  {mental,physical,social,creative} on `Bucket` (default per role) and `Activity`
  (optional override); Cabana load dials with critter glyphs (🐦 mental · 🐬
  physical · 🐠 social · 🦀 creative); `energy.js` sum-and-threshold accountant
  (`schedule.energyBudget(date)`); an "Energy today" Cabana card with a gentle
  over-budget flag (physics-framed). Zero ML — it *validates the four axes* before
  any model depends on them. Tests: load defaults/round-trip, budget sums +
  overdraft + restore, the dial + the card. (Capacities in `config.energy`.)
- **L-2 — the model pivot.** `featureVector` uses load dims + `load×time` (keep the
  gates, grouped ridge, and a small per-tag residual). Generalisation and cold-start
  improve for free — and the week-forecast falls out of running this same model
  forward (shape, not mood).
- **L-3 — close the loop / personalise.** Add the Primitive-II sequence & fatigue
  features (P-1-clean), and learn **one per-user scaling factor** on the
  hand-authored loads from the `energy` facet — turning a generic accountant into
  *your* economy. Then the cheap add-ons: chronotype view, active elicitation, the
  causal nudge, the seeded-ε steerer.

## Sleep — a capacity input, not a fifth axis

Sleep is the biggest single lever on the budget, but it's the wrong *shape* to be a
load axis or an activity: it isn't a demand dimension like mental/physical, and a
night's sleep isn't a daytime task you drop into a gap. Two honest roles instead:
- **A capacity modulator (L-3 personalisation).** *How you slept sets today's
  budget.* A rough night → lower today's mental/physical capacity. Highest-value,
  but it needs an *optional* daily "how rested?" input (no wearable — client-side
  only) and must stay physics ("lower capacity today"), never "you're overtired,
  slow down" (P-1). It's an input to the per-user scaling factor, not a new axis.
- **Protected time.** A nightly *sleep window* the scheduler won't pack past —
  already expressible as a zone or a nightly routine, not ML.

Deferred, on purpose: it earns its place once L-1's axes are validated and L-3's
calibration exists to consume it.

## The brink, kept honest

- Load estimates are only as good as your dials + the `energy` label; role defaults
  bootstrap them, but a mis-set vector mis-schedules. Keep it correctable in one tap.
- Capacity **drifts** (a good week's mental capacity ≠ a sick week's) — L-2 should
  recency-weight, not average all history.
- It must stay **physics, not morality**: "your Thursday is over budget" is help;
  "you're overcommitting" is the guilt P-1 forbids. Same coral-for-physics rule.
- It does **not** predict how you'll feel — it shrinks sensible defaults toward a
  few robust tendencies and *narrates them gently*. That's the ceiling, and it's
  plenty.
