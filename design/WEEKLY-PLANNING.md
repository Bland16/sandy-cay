# Repeating projects & the Sunday planning ritual

**Session 6, 2026-08-11.** Status: **SPEC — awaiting sign-off. Nothing built.**

Two things the app can't say today:

1. **"Two hours of maths homework each week."** Not a block at a fixed time — an
   *amount* the week owes, placed wherever that week has room, possibly split.
2. **"Lay next week out for me on Sunday."** A planning moment, distinct from
   the week-close moment that already exists.

**Not the same as `design/ROUTINES.md`** (checked before writing this). That spec
is about an activity with internal structure — laundry's wash/dry waits, the
gym's travel overhead. This is about *how much* work a week owes and *when the
plan gets made*. No overlap.

---

## 1. Why a "repeating project" and not a recurring task

The obvious move is per-occurrence deadlines on a recurring task — "eleven
psets, each due its own Friday". The user's call was that this is the wrong
shape, and they're right:

- A recurring **task** says *when it happens*. "Maths, Tuesday 16:00, weekly."
- A repeating **project** says *how much the week owes*. "Maths, 2h, weekly —
  you decide when."

The second is what studying actually is. It also fits the machinery that already
exists: `projects.js` has `sliceChunks` / `redistribute` / `growChunk` /
`shrinkChunk` / `resizeChunk` / `deleteChunk` / `finishProject` — **all tested,
all with zero UI callers** (SPEC-COMB §6, the standing product call). A weekly
budget that splits across days is precisely a chunked project.

**So this feature closes an open product call rather than adding a parallel
mechanism.** That is the main argument for building it this way.

---

## 2. The model

A **repeating project** is a project template that refills on a cadence:

```js
repeatingProject = {
  id, title, tags,
  amountMin,          // 120 — what each period owes
  cadence,            // reuse the P2 recurrence vocabulary: weekly, monthly, …
  chunking: {         // BOUNDS, not a size — the week decides (§4.1)
    min, max,         // e.g. never under 30 min, never over 4 h
    maxPerDay,        // e.g. 1 — don't stack two maths sessions on one day
  },
  lastFilled,         // which period has already been generated
}
```

Each period it generates ordinary **child tasks** — nothing new to the grid, the
scheduler, the energy model or the wrap report. They are tasks. That is the
point: the feature is a *generator*, not a new kind of thing on the week.

**The period's end is the implicit deadline.** "2h of maths each week" means by
the end of that week. No separate deadline field, and no per-occurrence deadline
machinery — which is how this replaces that request rather than deferring it.

---

## 3. The Sunday ritual — planning, not a due date

**Decided by the user: Sunday is when the plan gets made, not when the work is
due.** On the planning day the app lays out the coming week so you start Monday
knowing where things sit.

**It must OFFER, never impose.** This is not a new judgement call — it is the
same decision already locked for the week-close moment:

> *Rollover retrains and OFFERS — it never carries over. […] relocating a real
> person's unfinished week while they were away is the surprise P-1 exists to
> prevent.* (HANDOFF, "Decisions locked")

So the planning ritual is the mirror image and must obey the same rule:

- On the planning day, a banner: **"Next week is ready to plan — 3 standing
  commitments, 6h. Lay it out?"**
- **Preview first.** Accepting shows where everything would go *before* anything
  is written, naming each block. Decline and nothing is created.
- **Ignoring it is a real answer.** If the week starts unplanned, the projects
  still generate on demand the first time you open that week — the ritual is a
  convenience, not the only path.
- **It never touches a week you have already started.**

**Open question D-3 below:** whether an unplanned week silently generates on open
or waits to be asked.

---

## 4. The Cabana surface — "make this configurable"

Per the user, the behaviour is a setting rather than a fixed choice. A new
Cabana card, on the existing `DrillList` → `DrillEditor` idiom the other three
editors share (EDITOR-REDESIGN §4), so it costs no new vocabulary:

```
STANDING COMMITMENTS                          ＋ new

  Maths homework        2h / week · sittings 30m–4h · max 1/day
  Reading               3h / week · sittings 1h–3h  · max 1/day
  Gym                   3h / week · sittings 1h     · max 1/day
```

Drilling into one:

```
NAME      [ Maths homework            ]
TAGS      ( maths ) ( coursework ) ＋

HOW MUCH  [ 2 ] hours   every  ( week ▾ )        ← P2's cadence vocabulary

SITTINGS  no shorter than [ 30 ] min · no longer than [ 4 ] h
          at most [ 1 ] a day
          Takes the longest run your week has room for, and
          splits only when it has to.

          It will be planned on Sunday for the week ahead.
```

And a single global setting, on the existing Cabana tuning card:

```
PLANNING DAY   ( Sunday ▾ )     ☑ offer to plan the week ahead
```

**Why these particular knobs.** `maxPerDay` stops "2h of maths" becoming two
sessions on the same evening, and the sitting range is the elastic `.rangefield`
the activity editor already uses, so it is a control that exists.

### 4.1 Sittings adapt to the week — they are not a fixed size

**Per the user: "I can work for four hours straight if my week has that chunk
open, otherwise it can break into multiple sessions depending on my time."**

So sitting length is an *outcome*, not a setting. Generation asks the week what
it actually has:

- Prefer the **fewest, longest sittings** the open time allows, up to the stated
  maximum.
- Split only when no single run is long enough, and into the **fewest pieces
  that fit** — not a fixed number.
- Never below the stated minimum. If even the minimum will not fit, that is the
  under-fill case (§4.3), not a reason to emit a five-minute fragment.

This is what makes the range mean something: "30 min – 4 h" says *never bother
me for less than half an hour, and I'll happily do four straight if the week has
it* — a real description of how a person works. `sliceChunks` already takes a
min and a max; what it does **not** do is look at the week's actual shape before
choosing. That is the engine work, and it is the interesting part of this build.

### 4.2 Placement: open slots always — until the deadline is at risk

**Per the user, the per-commitment mode knob is dropped.** There is one
behaviour: **fit into open slots, and never move anything.** Re-optimise already
exists as a button, and pressing it is the user's move to make.

**One exception, and it is an OFFER.** If the commitment cannot finish before
its deadline in the open time available, the app says so and offers to
re-optimise — and in that case it may take the place of **lower-priority
flexible work**.

Two load-bearing points:

- **Nothing moves until accepted**, with a preview naming what would move. Same
  shape as the ritual itself (§3), and inherited from the same rollover decision.
- **This is the first automatic use of `priority`.** `conflicts.js` deliberately
  does *not* compare priority (R-1: "the dropped task wins by the user's
  action"), and that stays true — R-1 governs the user's hand. An automatic
  re-optimise the user explicitly asked for is a different context, and ranking
  by priority there is exactly what the field is for. It has been close to
  decorative until now.

### 4.3 When it does not fit

Say it plainly and do nothing else: *"Maths homework — 1h 30m of 2h placed; the
week had no room for the rest."* No debt, no rollover, no red. §5 covers why.

---

## 4.4 Finish early on purpose — the deadline buffer

**This is not specific to repeating projects. It applies to every deadlined
task, and it closes a real gap.**

Today a deadline is only a **hard cap on the search window**
(`placeTask`: `searchOpts.to = task.deadline`). `scoring.js` has **no deadline
term at all** — its four weights are proximity, balance, stability and
preference, and proximity measures distance from an *origin*, not from a due
date. So a task due Friday 17:00 may legitimately be placed finishing 16:59, and
nothing prefers earlier.

Meanwhile `report.js#buildDeadlineBuffer` already computes
`deadline − scheduled end` and flags anything under 24 hours as close to the
wire. **The app reports on a quality it never optimises for.** This rule closes
that loop, and the existing report becomes the honest feedback on whether it
works.

### The rule

> Aim to finish **one fifth of the task's own length** before the deadline.

A 5-hour essay wants an hour spare; a 30-minute errand wants six minutes.

**A preference, not a constraint** — per the user, "I don't think it's a must
but it should definitely have a high weight." So it becomes a **fifth scoring
weight**, `buffer`, renormalised with the others exactly as `normalizeWeights`
already does. That single decision is what makes the "obvious exceptions" fall
out for free: an overburdened week or a two-day deadline simply cannot score
well on it, and the other weights win. **No special-case logic for the
exceptions at all** — which is the strongest argument for making it a weight.

### Why one fifth of the TASK, not one fifth of the runway

Both readings were on the table. Taking the task's own length, because:

1. **It is explainable in one sentence:** *if this runs 20% over, you still make
   it.* It is an overrun allowance, and overrun scales with the size of the job,
   not with how much notice you happened to get.
2. **The runway version collapses into something the app already does.** As a
   *preference*, "finish 1/5 of the remaining runway early" just means "earlier
   is better, proportionally" — which is what the `proximity` weight already
   expresses. It would be a second, differently-shaped copy of an existing
   term, and this codebase has been bitten by exactly that (`format.js` grew a
   second ISO-week implementation and the two disagreed).
3. **It is bounded.** It never asks to reserve more slack than the work is
   worth, so it cannot dominate a tight week.

Three weeks of notice on a 5-hour essay therefore aims at one hour early, not
four days early — and `proximity` is what pulls it earlier than that anyway.

### The chunked case, which is the one that matters here

**For a repeating project the buffer is computed on the whole remaining amount,
not per sitting.** Otherwise 30-minute sittings each get a 6-minute cushion and
the *project* has none. "2h of maths by Sunday" should aim to be done by roughly
Saturday evening, not to finish each half-hour six minutes early.

**Minor open point (D-6):** whether to floor the buffer for very short tasks. At
1/5, a 20-minute errand wants four minutes, which is below the 15-minute grid
snap and so effectively nothing. A floor of one break-padding (30 min default)
would make it meaningful, at the cost of a rule with two numbers in it.

---

## 5. What this does NOT do

- **No new placement algorithm.** Generated chunks are ordinary flexible tasks
  bounded to the period. `placeTask` scores them exactly as it does everything
  else, including the zone rule amended today (a zone defines the window for its
  own tags).
- **No catch-up debt.** A week where you did 1h of the 2h does **not** roll the
  missing hour into next week by default. That way lies a nagging ledger, which
  is a P-1 violation. §3.6's existing consented carry-forward already covers
  "actually, bring it with me" — see D-2.
- **No streaks, no completion percentage, no "you missed your target".** The
  wrap report may state the fact ("maths: 1h of the 2h set aside") and nothing
  more, per the locked no-judgement rule.

---

## 6. Open decisions — sign-off before build

- **D-1.** Does a repeating project's amount count **hours** (2h/week) or
  **sessions** (3 gym visits/week)? Hours are natural for study, sessions for
  the gym. Supporting both is more UI; supporting one is a compromise. §4.1's
  adaptive sittings lean toward **hours**, since "3 × 1h" expresses a session
  count anyway and hours are what the week actually spends.
- **D-6.** Floor the deadline buffer for very short tasks? At 1/5 a 20-minute
  errand wants 4 minutes, below the 15-minute snap and so effectively zero. See
  §4.4.
- **D-2.** Under-done week: silently let it go (the spec's default above), or
  *offer* the shortfall to next week the way §3.6 offers unfinished work? The
  offer is consistent with existing behaviour; the silence is kinder.
- **D-3.** Open an unplanned future week — generate its chunks immediately, or
  leave it empty until asked? Generating is convenient; leaving it empty means
  the plan only ever exists because you asked for it.
- **D-4.** Do repeating projects show in the grid **as a group** (one tinted
  band you can see is "the maths 2h") or just as ordinary independent cards?
- **D-5.** Should this replace `Activity`'s role as a template, or sit beside it?
  An activity is "a task I do often"; a repeating project is "work the week
  owes". Related but not the same — and two overlapping template concepts is
  exactly the design debt session 4 was called to clean up.

---

## 7. Build order, if signed off

0. **The `buffer` scoring weight** (§4.4) — independent of everything else here,
   useful on its own for every deadlined task, and provable by probe in an
   afternoon. Worth shipping first and separately.
1. **Engine**: the repeating-project object + generation for a period, reusing
   `sliceChunks`/`redistribute`, with §4.1's "ask the week what it has" as the
   genuinely new part. Testable with no UI at all.
2. **Cabana card**: list + editor on the `Drill` idiom.
3. **The ritual**: planning-day banner, preview, accept/decline.
4. **Wrap report line**: the plain fact, no verdict.

Step 1 is worth doing first and alone — it is provable by probe, and it is where
the design will be found to be wrong if it is.
