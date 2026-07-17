# Routines, passive waits & travel time

**Status:** DRAFT spec (session 4, 2026-07-17). Not built. Extends
`design/ACTIVITY-LIBRARY.md` (an activity gains internal structure). Decisions
locked below; ready to turn into a build spec when scheduled.

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

## Build phases (later, after the opens close)

- **R-A — model.** `travelMin` + `steps` on `Activity`; a `RoutineInstance`
  (linked touchpoint group with min-gaps); JSON round-trip; validation.
- **R-B — engine.** Instantiate a routine (lay linked anchors), re-flow on move
  honouring waits, delete-as-a-group. Reuses anchor-routing for the fill.
- **R-C — UI.** Steps editor + travel field; linked touchpoints + optional wait
  band on the grid; "Do it now" for a routine.
- **R-D — durations.** Finer `DURATION_EDGES` (with Phase D) + the sub-15 decision.
