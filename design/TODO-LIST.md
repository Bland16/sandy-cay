# Todos — a one-shot activity, offered when you have the energy for it

**Session 9, 2026-09-21.** Status: **SPEC — nothing built.** Every decision here
is the user's, from the conversation of 2026-09-20/21.

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

## 4. Open

- **D-1. Deadlines?** The answer *"Yes, but just make it as I have the energy…"*
  ran the deadline question and the energy question together, and the energy half
  is unmistakable. Whether a todo carries a **due date** is therefore **not
  settled**. `Activity` has no deadline field, so this is the one place the reuse
  in §1 would need extending. It matters because a deadline is what would let a
  todo outrank a library activity when it is urgent. **Ask.**
- **D-2. Does a todo need a duration at all, or does it inherit `Activity`'s
  elastic range?** Reuse says the range comes free. A todo with no duration
  cannot be matched to an opening, which is most of what the picker does.
  **Recommend: inherit the range**, defaulting narrow (15–30 min), since the
  motivating examples are small ("email the registrar").
- **D-3. Is bucket-level energy good enough to gate on?** §3.3 — nine distinct
  vectors across a whole library. If not, this waits on the per-activity energy
  question that `PLAN-AUDIT-2.md` E-5/§2.1 left open.
- **D-5. Which Cabana idiom?** ⚠️ **I asserted the drill-in pattern and the user
  corrected me: *"The UI for cabana is different though."*** There are two
  established idioms and they are not interchangeable:
  - **Drill-in** (`EDITOR-REDESIGN.md`) — a list of rows, click through to an
    editor. Used by Zones, Buckets and Activities. Right if a todo is authored
    like a library item, and it is what "a todo is a kind of activity" implies.
  - **A self-contained `cabcard`** — how `CommitmentsEditor` and
    `RoutinesEditor` work. The user said "similar to commitments" **twice**
    (for how one is added, and for how it lives until done), which points here.
  - Or **neither**, if the Cabana's own layout is going somewhere I have not
    read.

  **This gates the mock-up**, which is step 1, so it gates the whole build.
  **Do not guess it a second time.**
- **D-4. What happens to a todo turned into a task that is then skipped?** It
  left the list when it became a task. Does it come back? **Recommend: no** — it
  is a task now, with its own record, and resurrecting it would be the app
  overruling a decision the user made. But it is a real case and it is theirs.

## 5. Build order

1. **The Cabana mock-up** (`design/todo-cabana-mockups.html`) — the user asked
   for this before any UI: *"we should do a mockup of how it looks in cabana."*
2. **The model** — `Activity` gains a one-shot marker; `placeActivity` deletes a
   one-shot in the same mutation that creates its task. Provable by probe, no UI.
3. **The Cabana card.** ⚠️ **Which idiom is NOT settled — see D-5.**
4. **The picker's todo filter**, beside the mood-tag chips.
5. **The energy weighting — ONLY after E-3.** §3.2.
