# Routines, passive waits & travel time

**Status:** ✅ **BUILT** (sessions 8–9). Written as a draft spec in session 4
(2026-07-17); the header said "Not built" until 2026-08-21, long after it was.

Shipped: `core/routines.js` (instantiate, re-flow, suggest),
`core/RoutineInstance.js`, `ui/components/RoutinesEditor.jsx`, the Cabana button,
the grid rows and the wait band. Routine steps are ordinary tasks carrying
`routineId` + `stepIndex`, so they sync to Google like anything else; the
PROGRAMS live in the library event.

**Still not built:** the reorder suggestion ("shower first, then waffles") — see
the note at §Reorder. Extends `design/ACTIVITY-LIBRARY.md`.

## The ask

Two real cases that today's one-block-per-task model can't hold:

- **Laundry.** Load (~2m) →[ wash 45m ]→ switch to dryer (~2m) →[ dry 60m ]→
  fold (~10m). The washes are *passive* — you're free to eat dinner or go to the
  gym while the machine runs — and the steps are *sequenced* (you can't switch
  before the wash is done).
- **Gym.** A 60-minute workout really needs changing + travel first, so "45 min
  free" isn't enough and you "can't just go whenever." The activity carries a
  fixed **overhead** the schedule has to account for.
- **The everyday family (the real target).** Dishwasher (load → ~90m run →
  unload), oven (preheat → cook → remove), slow cooker, laundry — all the same
  shape: a short touchpoint, a passive machine run you're free during, another
  short touchpoint. Laundry is just the two-run version; the gym adds travel. Not
  lab protocols — ordinary household machines.

Both say the same thing: **an activity is not always a single block of your
attention.** It can be a sequence of *active* stretches (they occupy you) and
*passive* stretches (time that must pass, but you're free), and it can carry a
travel/prep lead-in.

## The core insight (why this is tractable)

The engine already routes flexible work **around anchors** (fixed/pinned tasks
are walls; flexibles flow past them — §3.1). So a routine is just **a chain of
small anchored "touchpoint" tasks with gaps between them**. The gaps are ordinary
free time the scheduler *already* fills. We don't need a new "fill the wait"
scheduler — we need to (1) model the structure, (2) lay the touchpoints down
linked, and (3) keep the passive gaps honest when one moves. Dinner and gym get
flexed into the day by the placement engine that exists.

## Model — steps on an Activity

An `Activity` (design/ACTIVITY-LIBRARY.md) gains two optional pieces:

```
Activity {
  …label, tags, priority,
  durationMin, durationMax,     // the CORE active block (unchanged; simple case)
  travelMin?,                   // active lead-in: change + travel ("can't just go") — the gym case
  steps?: [                     // present ⇒ this is a ROUTINE; overrides the single core block
    { label, kind: 'active' | 'passive', durationMin, durationMax }
  ]
}
```

- A **simple activity** has no `steps` — it's one implicit active block. Adding
  `travelMin` prepends an active lead-in (gym = travel 15 + workout 45–60 → a
  75–90m contiguous footprint; the picker then needs a ≥75m opening, which is
  exactly "can't just go whenever").
- A **routine** lists `steps`. Laundry =
  `[load active 2–5][wash passive 45][switch active 2–5][dry passive 60][fold active 10–15]`.
- `travelMin` is sugar for a leading active step — same machinery, one-field UI
  for the common case.

Active-step durations have min–max like everything (a workout is 45–60; a wash is
a fixed 45–45). Passive steps carry the **wait**.

## Program once, adjust per run (the preset model)

A routine is authored **once in the Cabana** (in the Activity Library): its steps,
durations and waits are the saved *program*, reused every run — like a saved
thermocycler protocol, an oven preset, or the dishwasher's cycle.

At the moment you **run** it, an optional **one-time adjustment** tweaks *this
instance* — stretch a wash to 60m, skip the fold, add travel — **without touching
the saved routine**. The placed touchpoints reflect the tweak; the library
template is unchanged.

This is the same **"this one vs the saved pattern"** split the app already has for
recurrence occurrences (§4C: change this session, or the pattern), so it reuses an
existing mental model:
- **Edit the routine** (Cabana) → every future run changes.
- **Adjust this run** (at placement) → a per-instance override, stored on the
  instance only.

## Scheduling semantics

**Instantiating a routine at time `T`** (the "Do it now" / start-laundry action)
lays down one anchored task per **active** step:

```
load   @ T
switch @ T + load.dur + wash.wait
fold   @ T + load.dur + wash.wait + switch.dur + dry.wait
```

- Active touchpoints are **anchors** (like fixed tasks), so the existing engine
  flexes dinner / gym / everything else around them — no new logic.
- Passive steps are **not tasks**; they're the enforced gaps. They are **free and
  fillable**: because they're empty, `autoSchedule` / placement already drop other
  work into them. (A ½-optional nicety: paint the wait as a faint, non-blocking
  band so you can *see* "washing 17:15–18:00" without it consuming capacity.)
- The touchpoints are **linked** by a `routineId` + order. Move or delay one and
  the chain re-flows, honouring each passive **min-wait** (you can switch *later*
  than 45m if you're busy — the dry just starts later — but never *earlier*).
  This is the one genuinely new engine primitive: a sequenced group with min-gaps.

**Travel** (`travelMin`) is a leading active segment fused to the core, so it's
one contiguous anchor — no gap, no linkage needed for the simple case.

## Durations (the "<45 minutes" limitations, option 2)

- **Finer learning buckets.** `learning.js` `DURATION_EDGES = [45, 90, 150, 240]`
  makes "< 45" a single bucket, so the model can't tell a 15m task from a 40m one.
  Widen the low end (e.g. `[10, 20, 30, 45, 90, 150, 240]`). Lands with **Phase D**
  (the learning-feature rework); free to migrate (retrain on load).
- **Sub-15 steps.** A 2-minute "switch" can't exist at today's 15-minute grid
  floor (`MIN_DURATION = 15`, `SNAP_MIN = 15`). Routine steps are *programmatic*
  (auto-placed), so they can go below 15 without touching manual drag. Whether the
  **manual** grid floor also drops (finer hand-resizing, denser grid) is an open
  question — see below.

## UI

- **Library editor** (`ActivitiesEditor`): a `travel: __ min` field beside
  min/max, and a "＋ make it a routine" affordance that opens a small **steps**
  editor (add active / add wait rows, each with a label + min/max).
- **Grid**: active touchpoints render as normal (small) cards linked by a hairline;
  passive waits optionally show as a non-blocking tinted band.
- **"Do it now" / Add**: instantiates the whole routine from the chosen start,
  then the day's flexibles settle around its anchors.

### ⚠️ The bar for the routine editor: SEAMLESS (added 2026-08-16, the user's word)

A steps editor is one wrong turn away from being a thermocycler programmer —
rows of `kind`/`durationMin`/`durationMax` that make you hold the active/passive
distinction in your head before you can say a thing you already know.

**This project has been here and the answer is written down.** The first monthly
recurrence control asked the user to choose "by date" or "by position" in the
abstract; they called it confusing and were right, and the fix was to generate
**finished sentences** from what they had already chosen ("on the first Tuesday")
with a live preview of real dates settling whatever the wording could not. The
same standard applies here:

- Say it the way a person says it: *"waffles in the air fryer · 2 min · then wait
  5 min · then eat · 10 min"* — one line you read, not a grid you fill.
- **Never make them name `active` vs `passive`.** A wait is the thing with no
  verb; if a row has "I do this" in it, it is active. Infer it, the way
  `isWeekdayPattern` reads a pattern back rather than storing a flag that can
  drift.
- A **live preview of the real touchpoint times** ("load 07:00 · switch 07:47 ·
  fold 08:52") is what settles an argument the wording cannot — the recurrence
  editor's preview runs the real engine and this should too.
- Authoring a routine you already do should take one sentence and no decisions
  about scheduling.

## Decisions locked (session 4)

1. **Passive wait = min-only.** A wait has a floor (switch *≥* 45m after load);
   being later is fine (you're busy), the next stretch just starts later. Matches
   how appliances behave — the dishwasher/oven/PCR "it's done, deal with it when
   you're free" *is* a min-gap (the 4 °C hold, the keep-warm setting).
2. **Sub-15 for routine steps only.** The 15-minute floor stays for *manual*
   drag/resize (grid geometry unchanged); auto-placed routine steps may go smaller
   — a 2-minute switch is fine because you never hand-resize it.
3. **Placement — set a time OR take a suggestion.** You can start it *now* or at a
   chosen time, and your other tasks **ripple/adjust** around its touchpoints (an
   active touchpoint lands like any drop: flexibles route around it, conflicts
   ripple/displace/warn). The engine can also **suggest** a best-fit start you take
   or override. Both share the same lay-the-chain-forward mechanics.
4. **Travel is lead-in only for v1.** `travelMin` before the core; a trailing
   overhead (travel home, cool-down) waits until something needs it.

**Concurrency falls out for free:** run the dishwasher while the oven preheats and
the two passive waits overlap with no special handling — only the tiny active
touchpoints are anchors, and they simply mustn't collide.

## ✅ R-1 RESOLVED 2026-08-16 — waits get a MAX alongside the MIN, and it never refuses

**Decision 1 above says passive waits are min-only, and the user's own test case
breaks it.** Their morning:

```
put waffles in the air fryer   ~2m active
air fryer                       5m passive      <- five, not fifteen
eat waffles                   ~10m active
quick shower                   30m              <- a SEPARATE activity
```

Min-only handles "the wait can run long", which is right for the machines the
decision was argued from — the dishwasher's 4 °C hold, the oven's keep-warm.
**Food is not one of those.** A five-minute wait cannot host a thirty-minute
shower, so the interleave the user described does not fit, and under min-only the
app would place it anyway and produce cold waffles in silence.

Two things fall out, and they are separate:

1. **A ceiling.** An optional `maxWaitMin` on a passive step — "and get back to
   it within this". Absent ⇒ today's min-only behaviour exactly, so it is
   additive and does not reopen Decision 1 for appliances. When the chain cannot
   honour it, **warn, do not refuse** (visible beats invisible, §2.2's last
   resort). This is the one that makes waffles expressible.
2. **Ordering is a real answer the app could give.** With a 5-minute cook and a
   30-minute shower, the feasible routine is *shower first, then waffles* — not
   "waffles, shower during". A routine that cannot interleave as written is worth
   SAYING so, because the fix is usually a reorder rather than a compromise.
   Out of scope for R-A/R-B; note it and move on.

**The user's answer: add the max alongside the min, and let the waffles go cold.**
*"I think it is fine though if there is cold waffles, as long as I have the
ability to place it there."*

**The two bounds are NOT the same kind of thing, and that is the whole decision:**

| | means | binds |
|---|---|---|
| `minWaitMin` | the machine is not finished | **physics** — the scheduler may never place the next touchpoint earlier, full stop |
| `maxWaitMin` | it degrades after this | **preference** — stated, never enforced |

So the max **never blocks a placement and never refuses a drop**. It is a
statement about the food, not a constraint on the person: you may always put the
shower there and eat cold waffles, and that is R-1's manual autonomy in its
plainest form — a rule you wrote about your own breakfast is the clearest
possible case of one you are entitled to overrule.

What the max IS for: saying so. When a chain cannot honour it, surface it the way
§2.2's last resort does (visible beats invisible) — a note that the waffles will
be sitting for 25 minutes, not a refusal and not a nag. And it gives the reorder
idea below something to reason from later.

**Not built yet:** the reorder suggestion ("shower first, then waffles") stays
out of R-A/R-B. It is a feature, and the max is the field it would need.

## Build phases (later, after the opens close)

- **R-A — model.** `travelMin` + `steps` on `Activity`; a `RoutineInstance`
  (linked touchpoint group with min-gaps); JSON round-trip; validation.
- **R-B — engine.** Instantiate a routine (lay linked anchors), re-flow on move
  honouring waits, delete-as-a-group. Reuses anchor-routing for the fill.
- **R-C — UI.** Steps editor + travel field; linked touchpoints + optional wait
  band on the grid; "Do it now" for a routine.
- **R-D — durations.** Finer `DURATION_EDGES` (with Phase D) + the sub-15 decision.
