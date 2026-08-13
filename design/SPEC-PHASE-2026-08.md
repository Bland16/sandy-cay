# What is still spec — verified against the code, 2026-08-11

> ### ⚠️ The "If you want an order" list at the bottom is SUPERSEDED (2026-08-13)
>
> Use **HANDOFF's "START HERE — the build order"** instead. Two of this file's
> six items have since changed shape, and following them in this order would
> build them wrong:
>
> - **"`dayFill` in the snapshot — tiny"** is real but is no longer a standalone
>   item. It is one of three things the rating-context snapshot must stamp, and
>   the snapshot **does not currently fire for a recurring session at all**
>   (`design/RATINGS-AND-LEARNING.md`). Wiring `dayFill` alone would leave the
>   larger hole open and look finished.
> - **"Retention — before `history` gets big"** — `history` cannot get big; it is
>   four integers per task. And retention must land **with or after** the ratings
>   fix, or it prunes training data nothing is reading yet.
>
> The rest of this file — what is built, what is not, what needs a browser — was
> re-checked on 2026-08-13 and still holds.

**Method: check the code, not the banner.** Two status lines were lying when this
survey started — `DATES-AND-RECURRENCE.md` said "Nothing built" after all four
phases had shipped, and `WEEKLY-PLANNING.md` said the same with its step 0 live.
Both are corrected. This project's own lesson (HANDOFF: "P0 was recorded as
complete when it was not") is that a doc's self-assessment is worth nothing
without a grep.

Loose greps also mislead: `passive` matched a DOM event-listener option, and
`ArrowUp` matched the energy wave control rather than card drag. Every line below
was confirmed by looking at the actual symbol.

---

## Still entirely spec — nothing in `src/`

| Feature | Spec | Blocked on |
|---|---|---|
| **Routines, passive waits, travel** | `ROUTINES.md` | nothing — fully specified, decisions locked |
| **Repeating projects + Sunday planning** | `WEEKLY-PLANNING.md` steps 1–4 | 5 open decisions (D-1…D-5, two now resolved) |
| **Keyboard drag / resize** | SPEC §10 | nothing — it is an accessibility gap |
| **Retention policy** | HANDOFF open list | one decision: the horizon |
| **A surface for the chunk ops** | SPEC §1.3 / `projects.js` | product call — or `WEEKLY-PLANNING` absorbs it |

### Routines — the largest unbuilt spec

`Activity` has **`label · bucketId · tags · durationMin/Max · priority · load`**
and nothing else. No steps, no legs, no passive stretches, no travel overhead.
The whole doc — laundry's wash/dry waits, the dishwasher, the gym's travel
lead-in — is unimplemented, and its decisions were locked in session 4.

Its own core insight is why it may be cheaper than it looks: *"a routine is just
a chain of small anchored touchpoint tasks with gaps between them"*, and the
engine already routes flexible work around anchors. It needs a model and a
layout, not a new scheduler.

### Keyboard drag / resize — SPEC §10

The only key handling on a card is `TaskCard.jsx:99` — **Enter/Space to open**.
No arrows, no Shift+↑↓, no Alt+↑↓. The app is mouse-and-touch only, which makes
this an **accessibility gap** rather than a missing convenience.

### The chunk ops have no UI, still

`growChunk` / `shrinkChunk` / `resizeChunk` / `deleteChunk` / `finishProject` /
`redistribute` — six tested engine functions, **zero references in `src/ui`**.
Unchanged since the comb. `WEEKLY-PLANNING` argues this is the feature that
should finally consume them, which would close the standing product call rather
than answer it.

---

## Partly built

| Feature | Built | Still spec |
|---|---|---|
| **`WEEKLY-PLANNING.md`** | step 0 — the `buffer` weight, live for every deadlined task | the repeating-project object, Cabana card, planning ritual, wrap line |
| **`ACTIVITY-LIBRARY.md`** learning extension | D.1 — finer duration buckets, per-cell gating, grouped ridge, layout migration | **D.2 — the availability features** |
| **Starter buckets** | data + idempotent guard existed since s4; **wired to first run and given load values today** | — |

### D.2 is no longer blocked the way it was

`ACTIVITY-LIBRARY.md` defers `crunch`, `availabilityDeviation`, `weekFill` —
*"which need a completion-context snapshot the app doesn't record yet."*

**That snapshot now exists.** `task.energyAt` records the four-axis reserve a task
was begun under, captured at rating time, precisely because deriving it later
would train on a day that never happened. The same mechanism is what
`_dayFillAtCompletion` has been waiting for — it is still commented *"dead until
Phase D.2 wires it"* and still always 0.

So D.2 is now **one small change away**: record `dayFill` alongside `energyAt` in
`Schedule#_snapshotEnergy`. Worth doing soon for the same reason the energy
snapshot was — every week used without it is training data that cannot be
recovered. Note `role×dayFill` in the D.2 list is moot; `role` was ripped out.

### The parked time-of-day preference

Learning where an activity actually gets placed. `Task.activityId` exists (so it
is unblocked, as the handoff says), but `learning.js#featureVector` has **no
activityId and no time-of-day-preference term**. Still spec.

---

## Built but never exercised — needs a browser or a real account, not a terminal

| | State |
|---|---|
| **PWA install / offline** | `main.jsx:13` registers `sw.js` in PROD. Never installed, never tested offline. |
| **Export → Google** | `insertEvent` / `clearRange` / `taskToGoogleEvent` exist and are unit-tested. **Never run against the real account.** It *replaces* the target week, so the first real run wants a throwaway calendar. |
| **Touch drag on a phone** | Logic tested in jsdom, which has no touch and no layout. `LONG_PRESS_MS = 450` has never been felt. |

---

## Specced, and deliberately NOT built

Worth listing so nobody "fixes" them:

- **SPEC §4.3's shared window-row.** Verified again: `ZonesEditor.jsx` imports
  `TagEditor` and `Drill`, **not** `RecurrenceEditor`. The claim is marked NOT
  TRUE AS BUILT in the spec; the decision (extract it, or drop the claim) is
  **D-7** and still open. It is now more attractive than it was, because P2
  rewrote `RecurrenceEditor` once already.
- **EDITOR-REDESIGN P4** — an energy control on the task. Cancelled: energy
  derives from tags, and the task page must not grow dials.
- **Art.** 62 files under `src/assets/`, **7 distinct assets actually
  referenced**. The rest are deliberately unwired — badges render at ~11px where
  art turns to mud and SVG is clearer. Do not bulk-wire them.
- **Carry-over on rollover.** R-7 reads as one "week closes" moment, and the
  middle third is deliberately absent; §3.6 gives carryOver a consented home.

---

## If you want an order

1. **`dayFill` in the snapshot** — tiny, unblocks D.2, and the cost of delay is
   permanent lost data.
2. **D-7, the shared window-row** — decide before anything else touches
   `RecurrenceEditor` a third time.
3. **Repeating projects** (`WEEKLY-PLANNING` steps 1–4) — closes the chunk-ops
   product call as a side effect.
4. **Routines** — the biggest unbuilt spec, fully decided, and the one with real
   daily-life payoff (laundry, dishwasher, the gym's travel overhead).
5. **Keyboard drag** — the accessibility gap.
6. **Retention** — before `history` and `occurrenceData` get big enough to matter.
