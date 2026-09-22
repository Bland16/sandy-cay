# Exporting one tag to one calendar

**Session 9, 2026-09-22.** Status: **SPEC — then build.** The user's ask:
*"I want to export only things which have a specific tag to a specific calendar."*
Scoped to the **Cabana's one-shot calendar tool**, not the sync — their
clarification: *"The sync is okay. I'm talking about a one-time occurrence using
the other cabana tool for calendar."*

---

## 1. What is already true

| | today |
|---|---|
| target a specific calendar | ✅ **works** — `target` is picked from a dropdown, and writing to the app's own storage calendar is refused |
| filter by tag on **import** | ✅ works — `importEvents({ tagFilter })`, used by the `.ics` import and the Google pull |
| filter by tag on **export** | ❌ **nothing** — both export paths take everything |

```js
// Export → Google
const tasks = sched.getTasksForWeek(weekStart).filter((t) => !t.isOccurrence);
// Export .ics
const parents = sched.tasks.filter((t) => !t.isOccurrence && !t.chunking);
```

### 1.1 ⚠️ The tag box is already on screen and already ignored by export

`CalendarCard` holds one `tagFilter` state, rendered once, and **only the import
paths read it**. So a user who types a tag and presses Export gets everything,
silently, with no indication the box was irrelevant. That is a live wrong-looking
behaviour independent of this feature, and it is what prompted the question.

### 1.2 The two exports have different scopes, and that is not signposted

- **Export → Google** — the **displayed week**.
- **Export .ics** — **every non-occurrence task ever**, not the week.

They sit next to each other. Out of scope here, but recorded: `D-3`.

---

## 2. Why this is safe here and would not be in the sync

The sync was the wrong place to put a filter, and the reason is worth keeping:
`planSync` decides by comparing local against remote **plus a record of what it
synced before**, so a filtered `local` makes every non-matching task look
*deleted on this device* — `plan.deleteRemote` — and every never-synced one look
adoptable. A one-line filter there would empty the calendar and re-import it.

**The Cabana tool is one-shot and stateless.** There is no `entries` record and
nothing infers deletion from absence. Filtering the list is just filtering the
list.

---

## 3. Decided

- **Both export paths honour the tag box**, using the same parse the import side
  already uses (comma-separated, trimmed, case-insensitive, empty = everything).
- **A task matches if it carries ANY of the named tags** — the same
  any-of rule `importEvents` applies, so the box means one thing in both
  directions.
- **The label changes** to say it applies to both. It currently reads as an
  import setting because that is all it was.

## 4. D-1 — what "replace the week" means when a filter is on. **DECIDED: filtered clear.**

`pushToGoogle` clears the target range before writing, so a re-push is
idempotent rather than doubling everything. With a filter on, the question is
whether it clears *all* app-written events in the week or only the matching ones.

**Filtered clear**, and the deciding case is the one the feature is for: exporting
`study` to a calendar on Monday and `gym` to the same calendar on Tuesday. Under a
full clear the second export **silently deletes the first**, which is the whole
point of per-tag exports defeated. Under a filtered clear the two compose.

**It is implementable exactly, not approximately.** A pushed event already carries
its tags:

```js
extendedProperties: { private: { sandycayId, type, pinned, priority, tags: task.tags.join(',') } }
```

and `clearRange(token, calendarId, from, to, keepUnlessOurs)` **already takes the
predicate as an argument** — this is a predicate change, not surgery.

**⚠️ Events written before this shipped have no `tags` property.** An event with
no tags recorded is not evidence that it has none. So when a filter is on, the
predicate deletes **only events whose recorded tags match**; an app-written event
carrying no tag record is **kept**, and the existing "left N events alone" count
reports it. Deleting it would be inferring absence from silence, which is the
mistake `skipStreakCheck` already refuses to make.

Consequence, and it is the honest cost: **a re-push after upgrading may leave one
generation of duplicates** from events pushed before tags were recorded. The
toast says how many were left alone, so it is visible rather than mysterious.

## 5. Open

- **D-2. Should the filter apply to `.ics` export too, given its scope is the
  whole schedule rather than a week?** Yes by §3 — but note the combination
  "every task ever, filtered to one tag" is a much bigger export than the Google
  path's "one week, one tag", and the two buttons do not say so.
- **D-3. The scope mismatch in §1.2** — week vs everything, unsignposted.
  Pre-existing; not fixed here.

## 6. Build order

1. `matchesTagFilter(task, tags)` — one pure helper, used by both exports, with
   the same semantics as the import side.
2. Both export paths filter through it.
3. The filtered clear predicate for `pushToGoogle`.
4. The label.
