# Repeating projects & the Sunday planning ritual

**Session 6, 2026-08-11.** Status: **PARTLY BUILT.** Build step 0 — the `buffer`
scoring weight of §4.4 — is shipped and live, and applies to every deadlined
task, not just to this feature. **Corrected 2026-08-12** to measure one fifth of
the *runway* rather than of the task's own length; the shipped version was close
to a no-op, which a probe showed and 569 green tests did not. Steps 1–4 (the
repeating-project object, the Cabana card, the planning ritual, the wrap line)
are **still spec**, and every open decision on them is now answered (§6).

**Amended again 2026-08-13 (session 8), after a review that probed its claims.**
Three things changed and one was load-bearing: §4.1.1's "equalise" step is
**withdrawn** (it destroyed the property that made the chosen algorithm win),
§4.1.2 adds the **ordering rule** the spread needed to work across more than one
commitment, and §4.5's proposed `spread` scoring weight is **dropped rather than
deferred** — it was built and measured, and it makes the streak longer. §4.6 is
new: what happens when work runs longer than you booked.

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

### 4.1.1 The algorithm — DECIDED 2026-08-12. Build this one.

Chosen after seven candidates were written down (`design/SESSION-SPLITTING.md`)
and evaluated by two independent passes, one code-grounded and one scenario-driven
(`SESSION-SPLITTING-EVAL-ENGINE.md`, `-EVAL-LIVED.md`). **Six candidates lost. Do
not rebuild from the candidate list — build this.**

```
Given  A (amount owed, min), the period's end as deadline,
       s_min, s_max, maxPerDay, and the schedule.

1.  R*  = the period, ending one fifth of the runway early (§4.4's buffer)
2.  G   = open gaps per day inside R*, each clamped to s_max, from the
          REAL week — anchors, zones and break padding already subtracted
3.  n   = fewest gaps whose total ≥ A, taking longest first,
          never counting a gap below s_min, never more than maxPerDay a day
4.  s_i ← each sitting takes ITS OWN gap's length, clamped to s_max;
          the LAST one takes the remainder, A − Σ(the others).
          If that remainder < s_min, fold it into the previous sitting
          (up to s_max); if it still will not fit, drop a sitting and
          re-derive from step 3.
5.  days ← spread the n sittings EVENLY across the days of R* that can
          hold them — not the earliest n days — counting days already
          taken by ANOTHER commitment as taken (§4.1.2)
6.  place each sitting with placeTask({from: day, to: day})
```

**Why each line is there:**

- **Steps 2–3 are candidate 5**, and they are the reason it won: it is the only
  candidate that outputs sittings the week can actually hold, and the only one
  whose answer the placer cannot undo — because step 6 bounds each sitting to a
  single day using the idiom DATES-P1 already built (`from === to`).
- **Step 4 keeps sittings gap-shaped. ⚠️ Corrected 2026-08-13 — it previously
  read `s ← A / n`, "EQUALISE, do not skip this line", and that was wrong.**
  Equalising imports a fix for a disease candidate 5 does not have, and in doing
  so it destroys the one property that made candidate 5 win. Worked example:
  `A` = 5h with gaps of 4h / 1h / 1h. Step 3 takes the 4h and one 1h, so `n` = 2;
  equalising gives **two sittings of 2h30, and the second day's longest run is
  one hour.** The sitting no longer fits the gap it was selected for — exactly
  the "a number the week cannot honour" failure that eliminated candidates 2, 4,
  6 and 7.

  The bug equalising was meant to fix is real but belongs to those candidates:
  they fixed `s` *before* looking at `A`, so a 45-minute errand booked a 4-hour
  block. Candidate 5 cannot do that — it derives sittings *from* gaps and its
  last sitting is the remainder, so a 45-minute amount yields `1 × 45m` on its
  own. Note the lived evaluation's own H\* tables report **unequal** sittings
  ("3h07/1h21"); the equalise line contradicted the evaluation it cited.

  Equal-length sittings do have a legibility appeal — "four sittings of two
  hours" is easier to hold than "3h/2h/2h/1h". **Decided: fitting the week wins**
  (the user's call: it "feels easier to fit into a schedule"). Equal numbers are
  only tidy when the week is tidy.
- **Step 5 is the whole finding.** Burnout is **clustering**, not sitting length:
  5 × 4h taken greedily lands on five consecutive evenings, and shortening the
  sitting to "fix" it produces *nine* consecutive evenings. Spreading the same
  5 × 4h across alternate days gives a streak of one. See §4.5 for why the
  scorer will not do this for you — **that is now proven by probe, not argued.**
- **No `κ`, `δ`, `s_free` or `τ`.** Every invented constant is gone. What remains
  is `s_max` (the user typed it) and arithmetic over their own calendar. This is
  not tidiness: `learnedCapacity()` returns `null` and a prior stays *invisible*
  until calibrated, so shipping a constant that shapes the plan would be the app
  asserting something it has not earned (P-2).

**Learning is ADVISORY here, and never silently changes the plan.** The model
already learns satisfaction by sitting length, but the two evaluations disagreed
on whether that curve is stable enough to *set* `s` — one recovered the true peak
from 19 noisy ratings, the other got 5, 7 or 10 sittings for the same project
depending which ratings were in hand, still at sixty. Unresolved, so take the safe
reading of both: the curve earns **a Cabana line** ("your best sittings have been
about 2h") **and a one-time offer to raise `s_max`**, nothing more. Note also that
a short-only scheduler is self-confirming — it never offers a length it can then
learn from — so any future move here needs an exploration story, not just a gate.

**When it does not fit**, §4.3 still governs: state the shortfall as a fact and
stop. Do not let a shortfall grow each time the user merely *looks* at the week —
that was a real defect in three of the losing candidates, and it contradicts D-3
(opening a week is looking, not asking).

### 4.1.2 More than one commitment — order, and why the spread needs it

**Added 2026-08-13.** §4.1.1 as first written spread each commitment evenly across
`R*` **independently**, which means three commitments all aim at the same day
indices and collide on day 0, day 2, day 4. That is the identical flaw the engine
evaluation found in `scoring.js` — *"there is no sibling awareness anywhere"* —
relocated from the scorer into the generator, where it is just as wrong.

So generation is **sequential**, and each commitment sees the previous ones'
sittings as occupied. The occupied-set machinery already does this
(`redistribute` builds one at `projects.js:82`); what was missing is an order.

**The order is `ρ` descending, priority as the tiebreak.**

```
ρ = A / Ω        the amount owed, over the open time inside its own R*
```

- **`ρ` already combines the two things that make something hard to place** — a
  bigger amount raises the numerator, a nearer deadline shrinks the denominator.
  So 30h at P2 over six weeks and 2h at P5 due Friday sort the way intuition
  says: the 30h picks days first because it wants a bigger share of what it has,
  but move the 2h to *due tomorrow* and its `ρ` jumps and it goes first.
- **It invents nothing.** Both evaluations singled `ρ` out as the one quantity in
  the whole candidate document that is P-2-clean: arithmetic over the user's own
  calendar, no constant, nothing asserted. Using it as a *sort key* rather than
  as a *posture* also sidesteps the band-edge problem that sank candidate 4 —
  a sort has no thresholds in it.
- **Priority breaks ties only** (the user's call). Ordering decides who picks
  days first, not who gets good days; an urgent small commitment is already
  protected by its deadline and by the `buffer` weight wherever it lands.
- **Ties beyond that break on title**, so replanning an untouched week is
  idempotent — `redistribute` is already idempotent when nothing changed, and
  this must not be the thing that breaks it.

**`ρ` is per (task, day), never per day.** The engine evaluation proved this:
the same fortnight is 101h30 open for a study task and 33h30 for a work one,
because a zone routes matching tags *in* and carves itself *out* for everyone
else. So each commitment's `Ω` is computed against **its own** admissible time,
and two commitments' `ρ` values are not comparable as percentages of one week —
they are comparable only as what they are, a measure of how constrained each one
is. Never aggregate them, and never show them summed.

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

> Aim to finish **one fifth of the runway** before the deadline.

The runway is the time you actually have: from the moment the plan is being made
to the deadline. Due at the end of the week, planned on Monday — aim to be done
by Thursday evening. A task's own length does not enter into it.

**Corrected 2026-08-12, and step 0 was rebuilt to match.** This originally
specified one fifth of the *task's own length*, and shipped that way. The user's
intent was the runway all along — *"if it is due at the end of the week, you
should finish at least 1/5th of the runway early"* — and the shipped rule was not
a smaller version of that, it was **nearly inert.** Proven by probe against a
Friday 17:00 deadline planned on Monday:

```
finishing      OLD 20m  OLD 5h   NEW (any size)
Mon 17:00       1.00     1.00     1.00
Wed 17:00       1.00     1.00     1.00
Thu 20:12       1.00     1.00     1.00
Fri 09:00       1.00     1.00     0.38
Fri 15:00       1.00     1.00     0.10
Fri 16:45       1.00     0.25     0.01
Fri 17:00       0.00     0.00     0.00
```

The old term scored a 20-minute task **1.00 at Monday 17:00 and 1.00 at Friday
16:45** — it could not distinguish the start of the week from fifteen minutes
before the wire, which is the entire thing "finish early" means. It only ever
moved in the final minutes, and then only for large tasks. The runway version is
satisfied through Thursday evening and falls away across Friday.

### Why the runway, and why the original argument against it was wrong

The rejected reasoning was that a runway-proportional buffer *"just restates
earlier-is-better, which is what `proximity` already says."* It does not, and the
difference is the **saturation**:

- `proximity` is normalised by a **fixed horizon** and pulls toward the origin
  forever. Every minute earlier scores strictly better, for every task alike,
  deadline or no deadline. It expresses **haste**.
- `buffer` is normalised by **this task's own runway** and **stops** once the
  target is met. "Be clear by Thursday; past that I have no opinion." It
  expresses a **deadline**, and once satisfied it hands the choice among earlier
  slots back to the other weights.

Two differently-shaped terms, not one duplicated. The genuine risk the original
argument was groping for — that a long runway asks for an absurd cushion — is
real but bounded and correct: twenty days' notice asks for four days clear, which
is what a person with twenty days' notice should want.

**It also deletes a rule instead of adding one.** The target no longer scales
with duration, so the chunked case below needs no special handling: a 30-minute
sitting and the 2-hour project it belongs to aim at the same moment, and
`bufferDurationMin` stopped needing to be plumbed through `placement.js` at all.

**A preference, not a constraint** — per the user, "I don't think it's a must
but it should definitely have a high weight." So it becomes a **fifth scoring
weight**, `buffer`, renormalised with the others exactly as `normalizeWeights`
already does. That single decision is what makes the "obvious exceptions" fall
out for free: an overburdened week or a two-day deadline simply cannot score
well on it, and the other weights win. **No special-case logic for the
exceptions at all** — which is the strongest argument for making it a weight.

### ~~Why one fifth of the TASK, not one fifth of the runway~~ — SUPERSEDED

*Kept for the reasoning, because argument 2 is instructive in being wrong.*

> Both readings were on the table. Taking the task's own length, because:
> 1. **It is explainable in one sentence:** *if this runs 20% over, you still
>    make it.* It is an overrun allowance, and overrun scales with the size of
>    the job, not with how much notice you happened to get.
> 2. **The runway version collapses into something the app already does.** As a
>    *preference*, "finish 1/5 of the remaining runway early" just means "earlier
>    is better, proportionally" — which is what the `proximity` weight already
>    expresses.
> 3. **It is bounded.** It never asks to reserve more slack than the work is
>    worth, so it cannot dominate a tight week.

Argument 1 describes a real quality — but an overrun allowance is not what a
deadline preference is *for*, and at 1/5 of a short task it rounds to nothing.
Argument 2 is simply false (see the saturation point above). Argument 3 was
right about the mechanism and wrong about which behaviour was wanted.

**The lesson is the familiar one:** the term was reasoned about, agreed, built,
and shipped green — and one probe printing the score at nine finishing times
showed it did essentially nothing. `buildDeadlineBuffer` in the report had been
measuring the very quantity that would have exposed it.

### The chunked case — no longer a case at all

Under the task-length rule this needed its own paragraph: the buffer had to be
computed on a project's whole remaining amount, or 30-minute sittings each got a
6-minute cushion and the project itself got none. Under the runway rule the
target does not depend on duration, so **every sitting and the project aim at the
same moment automatically**. The `bufferDurationMin` parameter is gone.

**D-6 — RESOLVED, and dissolved.** The question was whether to floor the buffer
for very short tasks, since 1/5 of a 20-minute errand is four minutes, below the
grid snap. There is nothing left to floor: a 20-minute errand due Friday gets the
same Thursday-evening aim as a five-hour essay due Friday, because the runway is
the same. The rule keeps exactly one number.

---

## 4.5 ⚠️ Nothing in the scorer spreads work over a runway longer than 3 days

**Found 2026-08-12 by probe, and it reframes this whole feature.** Twenty hours
due in fourteen days, placed on an empty week by the shipped engine:

```
8h Monday · 8h Tuesday · 4h Wednesday · eleven days untouched
```

Forcing twenty chunks instead of five still gives 7h Monday + 7h Tuesday. Widening
`config.windows` to 06:00–23:00 — which the HANDOFF explicitly tells this user to
do — makes it **12 hours on Monday.**

**Cause, proven, not guessed.** `proximity` is normalised by
`maxPlacementLookahead = 3` days (`config.js:12`), so past day 3 it is
*identically zero* for every candidate slot. `buffer` **saturates at 1.000** for
12 of the 15 days once the runway target is met — by design, and §4.4 argues that
saturation is the virtue. But the two together mean that beyond day 3 **only
`balance` still discriminates between slots**, and ties break to the earliest.
So the scorer is flat across most of a long runway and everything slides forward.

### What this does to the session-splitting question

**The named acceptance test was measuring the wrong thing.** "20h in two weeks
must not be two sittings" cannot fail: `sliceChunks` needs `maxChunk ≥ 600` to
return n = 2, which no sane bound produces. All seven candidates pass it, so it
discriminates nothing.

The pathology was never the *number* of sittings — it is *where they land*. A
candidate that answers "five sittings of four hours" and hands those durations to
today's placer produces four-hour blocks on Monday, Tuesday and Wednesday, which
is precisely the burnout the user asked to avoid. **Choosing `n` well cannot fix
a placer that bunches.**

This is why candidate 5 (greedy fit over the week's real gaps) is structurally
different from the rest: it is the only one that outputs **days**, not durations,
and so is the only one that cannot be undone by the placer. `placeTask({from:
day, to: day})` bounds a task to a single day through the idiom DATES-P1 already
built, so it needs no new solver.

### The fix is NOT a scoring term — proven by probe, 2026-08-13

This section previously proposed a `spread` weight in `scoring.js`, or
renormalising `proximity` by the runway instead of a fixed 3 days, to ship
independently as the `buffer` weight did. **That was tested and it is the wrong
home. Do not build it.**

The experiment: `lookaheadHorizonMin` changed from
`config.maxPlacementLookahead * 24 * 60` to the actual search span
(`to − from`). Twenty hours, five 4h sittings, due in fourteen days:

| | days used | heaviest day | consecutive streak |
|---|---|---|---|
| shipped | 3 of 14 | 480m | 3 |
| span-normalised | 5 of 14 | 240m | **4** |
| widened windows, shipped | 2 of 14 | 720m | 2 |
| widened windows, span-normalised | 4 of 14 | 480m | **4** |

It does half the job: no day gets two sittings any more, and the heaviest day
halves. **But the streak gets LONGER, not shorter** — the work spreads over more
days and those days are still consecutive, because a weaker `proximity` still
prefers earlier. By the metric that actually names the harm, the change is a
regression dressed as an improvement. It is the same trap as shortening sittings,
reached by a different road.

**And the reason is structural, which is the part worth keeping.** The scorer
cannot tell *five chunks of one project* from *five unrelated tasks*, and the
right answer differs between them: bunching is the disease for a project, and
"as early as possible" is a **feature** for an ordinary task. Proven by the
control in the same probe — a one-hour task due in seven days drifted from
tomorrow 12:30 to Friday 08:00, later for no benefit to anyone. A scoring term
would impose the project's medicine on every deadlined task in the app.

**So spreading belongs at generation time (§4.1.1 step 5), where sibling
knowledge exists, and nowhere else.** That also means the feature needs no engine
change at all beyond the generator: step 6's `placeTask({from: day, to: day})`
bounds each sitting to the day the generator chose, and the scorer never gets the
chance to undo it.

**One more thing this probe settles, and it is the familiar one: 573 tests pass
with the change and 573 pass without it.** A change that relocates every
deadlined task with a runway longer than three days is completely invisible to
the suite — exactly as the inert buffer weight was. Any future work on placement
quality has to be proven by printing placements, not by going green.
*(Evidence: branch `worktree-spec-session8`, commit `dc75ab5`, and
`probe-horizon.mjs` at the repo root of that branch.)*

**Do not "fix" this by shortening sittings.** Ten 2-hour chunks bunch just as
hard as five 4-hour ones; the probe above shows 7h + 7h at n = 20.

---

## 4.6 When the work runs long — the duration margin

**Decided 2026-08-13.** The question: you think the essay is 2h but you are only
60% sure. Does the plan book 2h and let you find more time later, or book more
up front?

### The two cases are different and only one needs machinery

- **Bounded work you already know.** *"Econ has a timer on it, it can only take
  45 minutes."* Nothing to learn and nothing to offer — that is the sitting
  maximum, and the control exists (§4). State it, done.
- **Uncertain work.** The essay. This is where the margin lives, and it is the
  only case that needs anything built.

### The margin is part of the amount, not a reservation

The tempting design is to keep the tail of the runway free and borrow from it
when the work overruns. **That does not work, because the buffer is a preference,
not a reservation.** §4.4's weight makes *this* task aim earlier; it does not
hold the tail empty, and other work will fill it. Time you planned to borrow may
not be there.

So if the essay is really a 2h30 job, **2h30 is the amount**, and it flows
through §4.1.1 unchanged, aiming at the same finish-early target. There is no
second kind of time and nothing to reserve.

Whether the margin is contiguous or separate then answers itself through a
control that already exists: **under `s_max` it lengthens the sitting; over it,
generation splits it onto another day.** No new concept either way.

**Unused margin already comes back.** §3.9's early-done truncation crosshatches
the remainder and fires the removal toast (*leave open / backfill / protect*), so
an over-booking is returned the moment you finish, not lost.

### Where the number comes from — measured, never asked

A self-reported confidence field was considered and **rejected**: it is a control
you would fill in on every task, on the panel that the P4 cancellation already
ruled must not grow more dials, and it asks for a number people cannot produce
reliably. The app would be booking real time off a guess.

Instead the app watches what it can already see: **you extending a block, or
finishing well short of one.** Both are explicit actions you took, so this stays
inside the P-1 boundary that forbids inferring from what you *skipped*.

**This is a much safer thing to learn than the sitting-length curve the
evaluations fought over.** That curve is an argmax over seven jagged buckets,
confounded because the scheduler chose the lengths that then got rated. This is a
**residual**: the app proposed `P`, you moved it to `A`, and the difference is
entirely yours. Direct measurement, median estimator, no argmax, and not
confounded by the scheduler's own choices.

### The rules that keep it honest

1. **The estimate is two-sided; the offer is one-sided.** Overruns and under-runs
   both move the estimate, or the margin can only ever grow — a ratchet where one
   bad fortnight permanently inflates your econ. But the app **never offers to
   book less than the amount you typed.** Your number is the floor; under-runs
   only pull the *margin* back toward zero. *(The user's call, and the reason is
   good: an app that keeps shrinking your study time because you were quick
   trains a bad habit — and finishing early is already rewarded by getting the
   remainder back that same day. Shrinking the booking too would charge you twice
   for being fast.)*
2. **It offers; it never applies.** Same rule the evaluations landed on for the
   duration curve: a learned number must not silently change a plan. The margin
   is proposed inside the ritual's existing preview, where nothing is written
   until you accept.
3. **Cover most of your past sessions, not all of them.** Booking the full
   observed overrun every time buys insurance against your worst session and
   wastes time on every ordinary one, so the margin takes a conservative part of
   the observed distribution rather than its maximum. This is the honest version
   of "maybe half of it".
4. **Past tense, with the sample.** *"Your essay sittings have run about 25%
   long — 9 of the last 12. Book 2h30?"* Never *"essays take you 2h30."* The
   answer is remembered the way a dismissed detector is, so it asks once rather
   than every Sunday.
5. **Nothing is claimed before it is earned.** Below the sample threshold there
   is no factor, no line and no offer — the shape `learnedCapacity()` already
   uses by returning `null`.
6. **It lives in the Cabana, the wrap report and the plan preview. Never the
   grid** (locked: insights live in the report and Cabana; the grid stays quiet).

### The prerequisite, which is also a bug fix

**None of this is possible today, because nothing records what was planned.**
Resize a 2h block to 2h30 and the 2h is simply gone; `snapshot()` diffs
planned-vs-actual at *week* level only. So per-sitting planned-vs-actual has to
be recorded — additive fields, written in `toJSON` **and** read in the
constructor (the `freq` lesson: a field in only one of the two is silently
dropped), and stored on `occurrenceData[key]` for a recurring session.

That recording is worth doing on its own schedule, for the same reason
`energyAt` was: **every week used without it is data that cannot be
reconstructed afterwards.**

### Grain: tags

The factor is keyed on **tags**, not on the commitment. Two reasons, and the
second is the stronger:

1. The essay is a one-off, so a commitment-grained factor could never reach it.
2. **A tag is what makes a repeating commitment and a one-off task the same kind
   of work.** Ratings, energy character and zone routing already transfer through
   tags; keying the margin on them means "maths" learned from your standing
   commitment also informs the one-off maths essay, across the structural
   difference between them. It connects to the mechanism that exists rather than
   adding one.

**⚠️ Transfer is string-exact, so tag hygiene becomes load-bearing.** `maths` and
`math` are two different worlds, and nothing today stops the second being created
by typing it. Since commitments now carry tags precisely so data flows between
structures, **the commitment editor must offer existing tags rather than accept
free text silently** — the Tag Manager exists for this, and a typo otherwise
severs the link without any symptom.

---

## 5. What this does NOT do

- **No new placement algorithm.** Generated chunks are ordinary flexible tasks
  bounded to the period. `placeTask` scores them exactly as it does everything
  else, including the zone rule amended today (a zone defines the window for its
  own tags).
- **No catch-up debt — but it does ASK.** *Amended 2026-08-12 by D-1's answer
  below.* A week where you did 1h of the 2h does not silently roll the missing
  hour anywhere. What it does is **offer** it, once, in §3.6's existing
  equal-weight shape (*Carry forward / Let it go*), and take being ignored as an
  answer. The thing P-1 forbids is the app moving your work without asking and
  keeping a running ledger against you; a single symmetric question is neither.
  Note the consequence to state plainly in the offer: next week already owes its
  own 2h, so carrying makes it 3h.
- **No streaks, no completion percentage, no "you missed your target".** The
  wrap report may state the fact ("maths: 1h of the 2h set aside") and nothing
  more, per the locked no-judgement rule.

---

## 6. Open decisions — sign-off before build

- **D-1. RESOLVED 2026-08-12 — HOURS.** An amount is hours; "3 × 1h" already
  expresses a session count through §4.1's sitting bounds, and hours are what a
  week actually spends. No second unit, no mode switch.
- **D-6. RESOLVED 2026-08-12 — dissolved by the runway correction.** See §4.4:
  the target no longer scales with a task's length, so there is nothing left to
  floor.
- **D-2. RESOLVED 2026-08-12 — OFFER the shortfall forward.** In §3.6's existing
  equal-weight shape, once, ignorable. §5's "no catch-up debt" bullet is amended
  accordingly: no ledger and no silent move, but the app does ask. The offer must
  state that next week already owes its own amount, so carrying makes it more.
- **D-3. RESOLVED 2026-08-12 — EMPTY until asked.** Opening a future week is
  looking, not asking, and looking must not write tasks into a week. The week
  shows what it owes ("3 standing commitments, 6h") and a **Lay it out** button,
  which previews before writing. This is the same rule as the ritual itself (§3)
  and as rollover: offer, never impose. It also means a week you never planned
  stays honestly empty rather than filling with a plan you never saw.
- **D-4. CONDITIONAL 2026-08-12 — grouped only if it can be done tastefully,
  otherwise ordinary cards.** The bar is visual, so it is settled by eye and not
  by argument: `design/session7-mockups.html` renders the baseline against three
  candidates (a 3px edge + "1/2" counter; a dashed cross-column tether; a footer
  line under the grid). Two constraints for whoever judges it: the phone day view
  and the weekend drawer must be able to show the same thing, which rules out
  anything drawn *between* columns; and ROUTINES will later want a linked-chain
  marker for laundry's touchpoints, so whatever is chosen should be able to serve
  both rather than becoming a second vocabulary.
- **D-5. RESOLVED 2026-08-11** — they sit beside each other, and the boundary
  is **how much lead time the thing needs**:

  | | lead time | example | lives in |
  |---|---|---|---|
  | **Activity** | none — startable this second | "go for a hike" | the library; `suggest.js` ranks these |
  | **Repeating project** | plan it, then do it in pieces | "2h of maths a week" | a standing commitment |
  | **Planned event** | needs someone else to agree | dinner with a friend | an ordinary task; neither of the above |

  The user's framing, and it is sharper than "a task I do often": *"All of these
  are instant, they don't require anything and they can be unplanned. Social
  things require planning and attention."* The activity library is the answer to
  **"I have a free 30 minutes, what now?"** — so anything needing coordination
  is categorically excluded from it, not missing from it.

  **Consequence worth stating:** a bucket may legitimately hold tags and NO
  activities. `suggest.js` ranks `schedule.activities`, so such a bucket
  contributes energy character to planned tasks while offering nothing to
  suggestions. That is correct on both counts, and it is why a "People" bucket
  looks empty and should stay that way. Only the *initiating* action ("reach out
  to someone") is instant enough to be an activity; the resulting plan is not.

---

## 7. Build order, if signed off

0. **The `buffer` scoring weight** (§4.4) — ✅ **SHIPPED**, and corrected on
   2026-08-12 to measure the runway rather than the task's own length.
1. **Engine**: the repeating-project object + generation for a period, reusing
   `sliceChunks`/`redistribute`, with §4.1's "ask the week what it has" as the
   genuinely new part — **gap-shaped sittings per §4.1.1 step 4 (not equalised)**
   and **sequential generation in `ρ` order per §4.1.2**. Testable with no UI at
   all, and **no `scoring.js` change is needed or wanted** (§4.5).
2. **Record planned-vs-actual per sitting** (§4.6) — additive fields, both halves
   of the serialiser, `occurrenceData` for recurring sessions. Independent of
   everything else, and the cost of delay is permanent: unrecorded weeks cannot
   be reconstructed. Worth doing early even though the margin it feeds comes
   later.
3. **Cabana card**: list + editor on the `Drill` idiom, with tags offered from
   the existing set rather than free text (§4.6).
4. **The ritual**: planning-day banner, preview, accept/decline.
5. **Wrap report line**: the plain fact, no verdict.
6. **The duration margin** (§4.6) — only once step 2 has collected a term of
   data. Offer-only, one-sided, conservative.

Step 1 is worth doing first and alone — it is provable by probe, and it is where
the design will be found to be wrong if it is. **Prove it by printing the
placements**, not by going green: 573 tests could not see either of the two
defects this feature's own scoring found (§4.4, §4.5).
