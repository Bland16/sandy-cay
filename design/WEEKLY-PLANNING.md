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
  chunking: {         // how the amount may be broken up
    min, max,         // e.g. 30–90 min per sitting
    maxPerDay,        // e.g. 1 — don't stack two maths sessions on one day
  },
  spread,             // 'even' | 'asap' | 'late'  — see §4
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

  Maths homework        2h / week · 30–90m sittings · spread even
  Reading               3h / week · 1 sitting       · spread late
  Gym                   3 × / week                  · spread even
```

Drilling into one:

```
NAME      [ Maths homework            ]
TAGS      ( maths ) ( coursework ) ＋

HOW MUCH  [ 2 ] hours   every  ( week ▾ )        ← P2's cadence vocabulary

SITTINGS  between [ 30 ] and [ 90 ] min
          at most [ 1 ] a day

SPREAD    ( even ) ( as early as possible ) ( leave it late )

          It will be planned on Sunday for the week ahead.
```

And a single global setting, on the existing Cabana tuning card:

```
PLANNING DAY   ( Sunday ▾ )     ☑ offer to plan the week ahead
```

**Why these particular knobs.** Each exists because leaving it fixed would be
wrong for someone: `maxPerDay` is what stops "2h of maths" becoming one
exhausting block or two sessions on the same evening; `spread` is the difference
between a person who front-loads and one who doesn't; the sitting range is the
same elastic `.rangefield` the activity editor already uses for duration, so it
is a control that exists.

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
  **sessions** (3 gym visits/week)? The sketch above shows both, which is
  probably one too many. Sessions are a natural fit for the gym; hours are
  natural for study. Supporting both is more UI; supporting one is a compromise.
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

1. **Engine**: the repeating-project object + generation for a period, reusing
   `sliceChunks`/`redistribute`. Testable with no UI at all.
2. **Cabana card**: list + editor on the `Drill` idiom.
3. **The ritual**: planning-day banner, preview, accept/decline.
4. **Wrap report line**: the plain fact, no verdict.

Step 1 is worth doing first and alone — it is provable by probe, and it is where
the design will be found to be wrong if it is.
