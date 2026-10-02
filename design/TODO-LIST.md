# Todos — a one-shot activity, offered when you have the energy for it

**Session 9, 2026-09-21.** Status: **SPEC — nothing built.** Every decision here
is the user's, from the conversation of 2026-09-20/21.

**2026-10-01:** all five open questions settled (§4, the user took every
recommendation). §6 adds a sync prerequisite found while reading the code, and
§7 replaces the build order. Next step: the agent audit.

---

## 1. The shape, in the user's own words

> *"It is kinda just a different kind of activity, pretty similar."*

That sentence is the design. A todo is **not a new entity**: it is an `Activity`
that is **one-shot** — it exists until it is done and then it is gone.

| | Activity | Todo | Commitment |
|---|---|---|---|
| what it is | a template you may instantiate many times | a single thing that needs doing once | an amount owed per week |
| lifetime | permanent | **until done, then it disappears** | until the term ends |
| reaches the grid | via "Do it now" | **via "Do it now" only** | via generated sittings |
| lives in | the Cabana's buckets | the Cabana, beside them | the Cabana |

**Why reuse matters here.** `Activity` already carries a label, tags, a bucket,
an elastic duration range, an optional priority and an optional load override —
which is every field a todo needs. This project's recurring debt is *two
descriptions of one idea drifting apart* (`role` was ripped out for it; SPEC §4.3's
window-row exists twice and has already diverged). A `Todo` class would be a
third copy of `Activity` with one flag's difference.

### 1.1 ⚠️ This does NOT reopen SPEC §1.1's "no unscheduled tray"

Ruling 7A refused a tray because *"a tray is UI surface + a limbo state;
immediate placement means every task is always somewhere."* A todo is not in
limbo, because **it was never trying to be on the grid.** It has no placement, no
slot and no start time to be wrong about. The ruling is about *tasks*, and a todo
only becomes a task at the moment it is placed — at which point 7A applies to it
in full and it is placed immediately.

---

## 2. Decided

- **It never reaches the grid by itself.** *"Never unless a what to do."* The only
  path onto the calendar is the picker's "Do it now", which is already how a
  library activity is instantiated (`placeActivity`).
- **You can add one from the todo list itself**, the way commitments are added
  from theirs — not only from a task panel.
- **It is not ticked off. It is REMOVED and becomes a task.** *"It isn't ticked
  off, it is removed from the list and added as a task."* So there is no
  `completion` on a todo at all: doing it is the act of turning it into a task,
  and the task then carries the completion, the rating and the lived record.
  ⚠️ **This means `placeActivity` must delete the todo in the same mutation that
  creates the task**, or a closed tab leaves a duplicate.
- **It persists until done and then disappears** — like a commitment, unlike an
  activity.
- **A todo filter in the picker**, beside the existing mood-tag chips.
- **It lives in the Cabana** — mock-up required before any UI is built (§5).

## 3. The interesting half — offered only when you have the energy

> *"Just make it as I have the energy. If I'm burnt mentally don't offer a mental
> todo, if I am burnt socially etc etc… as I have the energy to complete them."*

**This is per-axis, and it is the first feature in the app to gate on a specific
axis's remaining headroom** rather than on the day's total. The quantity already
exists: `reserveAt(schedule, now)` gives the per-axis reserve, and
`learnedCapacity` gives the per-axis ceiling, so "how much mental have I got
left" is `capacity[axis] + reserve[axis]`.

### 3.1 ⚠️ It must be a RAMP, never a predicate

The adversarial review of E-3a (`E3A-LATE-WORKOUT.md` §3b) measured what an axis
predicate costs: a binary gate worth 0.30 against a score range of 1.90 is a
**16% discontinuity**, and a duration predicate produced a **0.039 score jump for
one extra minute** — 81% of `proximity`'s entire fifteen-hour swing. That is
precisely the sign-quantisation the picker rewrite exists to remove.

So: a todo's score is **weighted down in proportion to how little headroom
remains on the axes it draws on**, and is never switched off. "Don't offer a
mental todo when I'm burnt" is expressed as *the mental todo sinks*, not as *the
mental todo is hidden* — and a day where everything is spent still offers
something rather than an empty panel.

### 3.2 ⚠️ This DEPENDS on the picker rewrite (E-3) and cannot ship before it

The picker's score is **sign-quantised**: every load-derived term is a predicate
on sign or argmax, and nothing multiplies by a magnitude (`PLAN-AUDIT-2.md` §1,
confirmed three ways). Measured, giving activities distinct loads leaves the
number of distinct scores within a bucket at **one**.

**So an energy-weighted todo would be authored, computed, and then invisible** —
exactly the trap that nearly cost a 48-activity authoring programme. E-3 must
land first. A todo list can ship *before* that with no energy weighting at all;
the weighting is a second step, and the spec should not pretend otherwise.

### 3.3 The axis a todo draws on

Via the same path everything else uses — `loadForTask` on its tags, or its own
override. ⚠️ **But note the measured problem**: the user's 49 activities produce
only **9 distinct load vectors**, one per bucket, because every activity inherits
its bucket's entire tag list. A todo authored the same way inherits the same
flatness, and "don't offer a mental todo" degrades to "don't offer anything from
the Classes bucket". Whether that is good enough is **D-3 below**.

---

## 4. Decided 2026-10-01 (were open)

The user's words, in full: *"Go with your recommendations on all five."*

- **D-1. Deadlines: YES, optional.** A todo may carry a due date (a date key,
  like a commitment's `due by`). It is the one field `Activity` lacks, so it is
  added there, meaningful only when the activity is one-shot. What it does in
  the picker is §4.1.
- **D-2. Duration: inherit the elastic range.** A todo is sized like any
  activity (`durationFor(opening)`), and one made from the todo card defaults
  to **15–30 min**, not the activity default of 15–60.
- **D-3. Bucket-level energy is good enough for now.** A todo's load comes from
  the same `loadOf` path as an activity (an override, else its bucket, else its
  tags). The per-axis ramp in §3 still waits on E-3.
- **D-4. A todo-task that is skipped does NOT come back.** It left the list when
  it became a task; from then on it is a task with its own record, skipped like
  any other.
- **D-5. Its own Cabana card, built the way Commitments is.** ⚠️ **§4 as first
  written had the premise wrong.** It set "drill-in (Zones, Buckets,
  Activities)" against "a self-contained cabcard (Commitments, Routines)" as two
  idioms. They are one: `CommitmentsEditor` and `RoutinesEditor` are each their
  own `cabcard` with a `DrillList → DrillEditor` inside, and their headers say
  so (*"a fourth shape for 'edit one of a collection' is a fourth thing to
  learn"*). So "like commitments" means **a Todos card of its own, listing
  todos as `DrillRow`s, opening a `DrillEditor` for one**. Not a section inside
  the Buckets card. The mock-up still comes first (§7 step 1); the user asked
  for it in so many words.

### 4.1 What a deadline does in the picker, before E-3

The picker's score is sign-quantised (§3.2), so a deadline cannot be a smooth
urgency term yet without being the only magnitude in the function. v1:

- The pick shows **"due Fri"** the way a task shows "has a deadline".
- A todo **due today or overdue** is lifted above the library activities —
  the one discrete rule, and it is honest about being discrete: the reason line
  says *"due today"*, not a made-up score.
- Anything further out ranks as a plain activity. A graded urgency term is an
  E-3 question and is listed there, not invented here.

---

## 5. What "a todo is an Activity" touches

`schedule.activities` is read in many places that assume it is a permanent
library. Every one has to decide what a one-shot does there. **The audit (§8)
enumerates them**; the ones known before it:

| reader | what it must do with a todo |
|---|---|
| `TagManager` (Buckets card) | **not list it** — it lives on the Todos card, and showing it in both is two homes for one thing |
| `suggestActivities` | offer it (§4.1), and offer it **regardless of bucket** |
| `placeActivity` | create the task **and remove the todo in the same mutation** (§2) |
| `activityUsage` / "most used" sort | a one-shot is used once by definition; exclude it |
| `libraryMerge` (add what's missing) | do not import another save's todos as "missing activities" |
| `googleLibrary` | carries it with no change, since it is in `activities` (but see §6) |

---

## 6. ⚠️ PREREQUISITE: the library gate freezes on every cross-device edit

Found while reading the sync for this spec, 2026-10-01. **It is not a todo
bug; todos make it daily.**

Todos ride in `activities`, and `activities` live in the library: one hidden
event, compared WHOLE (`useGoogleSync`, GS-8). On the first pass of a session:

- library same as the calendar's → carry on;
- this device's library is the fresh-install one → take the calendar's;
- **anything else → FREEZE the whole sync** until you pick a side in the Cabana.

There is no third case for *"I have not touched my library since my last sync,
the other device has"*. So: add a todo on the phone, the phone syncs, open the
laptop, and the laptop's library differs from the calendar's → sync paused. The
same is already true of editing a bucket or an activity on one device; it has
been tolerable because the library rarely changes. A todo list changes daily,
so every add and every "Do it now" on one device would freeze the other.

**The fix is a three-way check, using a value the sync already stores.**
`libHash` is the hash of the library as of this device's last sync. If the
local library still hashes to `libHash`, this device has not changed it since,
so the calendar's newer copy is safe to take, exactly like the fresh-install
case. Only when **both** sides changed is it a real conflict, and only then
does it freeze.

⚠️ **To prove before building on it:** that `libHash` is saved across sessions
(it is in the stored sync record), and set at every point the library is pushed
or adopted. A `libHash` that lags would make this adopt over a real local edit.
⚠️ **Also prove:** that `model`, `snapshots` and `dismissed`, which are in the
library and change on their own, do not make *both* sides differ all the time,
which would leave the freeze firing anyway.

---

## 7. Build order (replaces the 2026-09-21 order)

0. **The library gate's three-way check (§6).** Its own commit and its own
   tests, including a repeated-pass test (`HANDOFF`: convergence is invisible
   to any single-pass test).
1. **The Cabana mock-up** (`design/todo-cabana-mockups.html`, gitignored like
   every mock-up). The user reviews it before step 3.
2. **The model.** `Activity` gains `oneShot` and `deadline`, serialised;
   `placeActivity` removes a one-shot in the same mutation that creates its
   task; every reader in §5 decides. Provable with no UI.
3. **The Todos card**, as approved in step 1.
4. **The picker:** a "todos" chip beside the mood tags, "due Fri" on the pick,
   due-today lifted (§4.1).
5. **The energy ramp: ONLY after E-3** (§3.2).

Each step: build, then a bug-check by agent, then commit.

---

## 8. Audit (2026-10-01): three agents, sync / model / picker+UI

Probes ran the real core code against `schedule-2026-09-18.json`. **Headline:
§6's fix is not enough, and the library is the wrong home for todos.**

### 8.1 Sync

- **S-1 BLOCKER: every Monday already freezes, on ONE device.** Rollover
  (`App.jsx:393-417`) retrains `model` and sets `lastSeenWeek` on mount,
  before the sync can pull, so the first pass of each week sees a library
  that differs from the calendar's. Probe: `single device Monday, current
  code: FREEZE model,lastSeenWeek`. **Existing bug, not a todo bug.** Needs a
  browser check to confirm in the real app.
- **S-2 BLOCKER: §6's three-way check is one-directional.** It must be
  symmetric: local = `libHash` → take the calendar's; calendar = `libHash` →
  push ours; both differ → only then freeze. `model` is derived from ratings
  and should not be compared at all.
- **S-3 BLOCKER: two OPEN sessions resurrect a finished todo.** The gate runs
  once per session; after that the library is last-writer-wins on the whole
  blob. Probe: A does a todo, B (still open) edits a bucket and pushes →
  `cal has T? true (resurrected)`, and it can then be placed twice. Today
  this freezes, so it is at least noticed; §6's fix would make it silent.
- **S-4 must-fix:** `libHash` is saved at once but the schedule 1.5 s later,
  so a tab closed right after an adopt pushes the stale library back.
- **S-5 must-fix:** a failed delete in `pushLibrary` leaves two library sets;
  `pull` then returns `library: null` and the gate is skipped, silently.
- **S-6 must-fix:** tasks are written before the library within a pass.
- **S-7 note:** no bulk-delete guard on the library; a stale bundle strips new
  fields on push; `ids.js` counters reset per page load, so two devices can
  mint the same task id.

### 8.2 Model

- **M-1 BLOCKER: the new fields freeze every user's sync on deploy.**
  `diffLibrary` compares JSON; `"oneShot":false,"deadline":null` on every
  activity on one side only = differ = freeze. Emit them only when set.
- **M-2 must-fix: ids recycle.** `slug(label)+'-act'` is unique only among
  CURRENT activities; every "New todo" gets `new-todo-act`. Use a unique id.
- **M-3 must-fix: `placeActivity` is not idempotent.** A double "Do it now"
  makes two tasks. Return early if the todo is already gone.
- **M-4 must-fix:** a todo may not have `steps` or `travelMin`.
- **M-5:** the reader table is longer than §5's: also `TagManager`'s orphans
  view and `bulkDrafts`, `RoutinesEditor`, `summarizeImport`, `applyLibrary`
  restore, `libraryMerge` (exclusion must be explicit — the spread carries
  `oneShot` through). Dangling `activityId` is already normal and harmless.
- **Existing bugs found:** routines (`bucketId: null`) show under
  "Unbucketed activities" as well as on their own card; the picker offers a
  routine as one flat block, ignoring its steps.

### 8.3 Picker and UI

- **P-1 BLOCKER: todos are never offered.** Ranked as plain activities with
  `limit: 5`, three test todos made the top 5 in **0 of 70** openings (median
  rank 20-50). Reserve one of the five for the best fitting todo — a rule
  about the list's make-up, like "tasks first", not a score term.
- **P-2 must-fix:** the due-today lift is a sort TIER inside
  `suggestActivities`, before the limit — never a score bonus. With that
  wording §4.1 does not break §3.1 (a due date is discrete in the user's own
  terms). It is lifted above activities, not above waiting tasks.
- **P-3 must-fix:** "todos" is its own toggle, not a pseudo-tag (collision,
  and the tag row is hidden when no task has tags).
- **P-4 must-fix, missing cases:** no opening (todos vanish; the empty line
  lies); a todo longer than every opening (filtered out silently); a deadline
  long past (lifted forever).
- **P-5 must-fix:** build `TodosEditor` on `DrillEditor`/`Field` like
  Commitments; do not reuse `ActivityEditor` (bucket, priority, energy dial,
  and an `onBack()` during render that misfires when sync removes the todo).
  No bucket field: with `bucketId` null the load comes from the todo's own
  tags, which partly fixes §3.3's flatness for free.
- **P-6:** routines are already "an Activity sub-kind with its own card"
  (`RoutinesEditor` filters `isRoutine`). Todos copy that, with `isTodo`.
- **P-7:** D-1's "like a commitment's due by" is wrong — that is a weekday
  select. A todo's deadline is a real date.
- **P-8:** `TagEditor` accepts free text, so "existing tags only" is not
  enforced anywhere.
- **P-9:** §1's "not only from a task panel" implies a quick add outside the
  Cabana, and §7 has no step for it. The Cabana replaces the week view, so
  adding a todo from there means leaving the schedule.
- **P-10:** the card belongs first (after Tuning) — on a phone, card order is
  scroll distance.

### 8.4 What this changes

S-3 is the deciding finding. Todos are created and deleted ONE AT A TIME,
which is exactly what `planSync` handles per item and what a whole-blob copy
cannot. Day notes were moved out of the library for the same reason (GS-11).
**Proposal: a todo is still an `Activity` in the model, but it is stored and
synced in its own collection, per item, not in `activities`/the library.**
That also dissolves M-1, M-5's library rows and most of §6 for todos. S-1/S-2
remain as existing bugs worth fixing on their own. **Awaiting the user.**
