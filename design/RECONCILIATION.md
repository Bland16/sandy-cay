# Reconciliation — a corrected model for tasks, activities, buckets & energy

**Status:** DRAFT spec (session 4, 2026-07-17). Written after real use exposed
design debt in the activity/energy/bucket features. This reconciles them into one
honest model before more code. Proposals are marked **▶ PROPOSAL**; genuine forks
that need your call are marked **⚑ FORK**.

> ### ⚠ AMENDED, session 5 (2026-07-20) — energy is derived from tags
>
> **Principles 1 and 2 below say load is "inherently user-authored" and must be
> editable on the task, on the schedule. That is reversed.** The user's call:
> *a task's energy is autocalculated from its tags — no energy control on the
> task UI, so the task page doesn't get overcrowded.*
>
> What this changes:
>
> - **No task-level energy control.** `EDITOR-REDESIGN.md` P4 is **cancelled**.
> - **The derivation is `energy.js#loadForTask`**, which already implements it:
>   every bucket sharing ≥1 tag with the task contributes; per axis, the positive
>   contributions are averaged among themselves, the negative ones averaged among
>   themselves, and the two means added. Spend and restore do **not** cancel
>   before averaging. (`task.load` remains as a data path but has no authoring
>   surface — and was never writable anyway: `load` is absent from
>   `UPDATE_WHITELIST`.)
> - **Buckets and activities keep their `<EnergyControl>`** (two homes, not the
>   three in §5.5). The per-activity control is *retained*; only its old
>   "customise / inherit" wall is replaced by the ghost-tube inherit mode.
>
> What still stands: no fabricated numbers, neutral-0 defaults, learned capacity
> behind the calibration bar, the `role` rip-out (Principle 3), unique ids
> (Principle 4), and one editor idiom (Principle 5).
>
> **Open, unresolved:** `loadForTask` uses *all* matching buckets while
> `Schedule.bucketForTask` returns only the *first* match. Two tag→bucket rules;
> now that tags are the sole source of energy, they should agree.

## What went wrong (so the fixes are principled, not patches)

The features shipped fast and accrued four kinds of debt:
1. **A fix wasn't generalised.** Task ids were made collision-proof; `Bucket`,
   `Activity` and `Zone` were not — their id is `slug(label) + '-suffix'` with no
   uniqueness, so two "New bucket"s collide (`new-bucket-bucket` twice) and editing
   one edits both. *This is the two-in-a-row bug.*
2. **A UI redesign wasn't applied consistently.** The Tag Manager became a
   drill-in list; the Activities editor kept the same "everything expanded" wall.
3. **A feature landed on the wrong object.** Energy override was built on
   *activities*, but **activities are preseeded tasks** — they must carry *nothing a
   task doesn't*. Energy belongs on the **task**, editable on the schedule; an
   activity inherits it as a template, not as a bespoke feature.
4. **Fabricated numbers were shown as truth.** The energy budget's capacities
   (8/6/5/5) and the per-role default loads are invented. An "accountant" that
   judges you against made-up capacities is dishonest.

Plus a real conceptual question: **buckets have a `role` enum** (rest/creative/
work/social/health/neutral) whose meaning ("Home = work") is opaque, and which
duplicates what the load vector already says.

## Principle 1 — Task is the atom; Activity is a thin task template

A **Task** is the only real object. An **Activity** is a *saved template for a
flexible task* — nothing more. It may hold **only** fields a task has:
`label→title`, `tags`, an elastic `durationMin/Max`, `priority`, and `load`. No
activity-only capabilities, ever. Instantiating an activity = creating a flexible
task from the template (it already does this via "Do it now").

**▶ PROPOSAL:** delete any activity feature that a task lacks. The
per-activity energy "override/customise" UI I built is wrong-object; replace it
with **energy editable on the task itself** (see Principle 2), and let an activity
simply carry a `load` like any task.

## Principle 2 — Energy is honest: user-authored loads, learned capacity, nothing fabricated

Two very different quantities got conflated:

- **Load** (how much a thing spends/restores per axis) is **inherently
  user-authored** — only you know a task is mentally heavy. So load is a value you
  set, **defaulting to neutral (0), never to invented role numbers**. It lives on
  the **task** (editable in the task popover/panel on the schedule), and an activity
  or bucket may carry a default the task inherits — but the *default is neutral,
  authored by you*, not a fabricated per-role guess.
- **Capacity** (how much of each reserve you *have* in a day) is exactly the thing
  that must be **learned**, from the `energy` satisfaction facet over time — not
  hardcoded.

**▶ PROPOSAL (your 3-week bar):** the **energy budget / "Energy today" card does
not appear until there are ≥ N weeks of energy ratings** (config, default 3) for
the model to calibrate capacity. Before that, the app never shows a capacity or an
over-budget verdict — because it would be fabricated. You can still *author loads*
(they're just data); the app just doesn't *judge* against a made-up ceiling yet.

**⚑ FORK — before it's learned, show nothing, or show a neutral "shape"?** Option
A: hide energy entirely until calibrated (cleanest, most honest). Option B: show
the day's *summed load lean* ("today leans mental-heavy") with **no** capacity /
pass-fail — descriptive, not judgmental. I lean **A** (honest > clever), but B is a
gentle middle.

## Principle 3 — Buckets are categories; the load *is* the character (drop the role enum)

`role` exists only to tell the steering/learning that "rest is restful, work is
demanding." But the **load vector already says that** — a restful bucket has
negative mental load; a demanding one positive. So `role` is a redundant, confusing
second description.

**▶ PROPOSAL:** remove `role` as a **user-facing** field. A bucket is just
`{ label, tags, colour, load }`. Steering and the learning read a bucket's
*character from its load* (restorative vs demanding, which axis), not from an enum.
Internally the model can still bin buckets (e.g. by dominant load axis) if it needs
a coarse category for `×time` interactions — but you never see or set "role".

**⚑ FORK — how far to take this now.** (a) Full: rip `role` out of the model and
rewrite steering/learning to key off load — cleaner, but reworks `suggest.js` and
the `role×time` learning feature. (b) Hide-only: keep `role` internal, *derived
from load*, remove it from the UI — smaller change, same user-facing result. I lean
**(b) now, (a) as the load-basis (L-2) lands**, so we don't rebuild the learner
twice.

## Principle 4 — Unique ids everywhere

Generalise the task-id fix to **`Bucket`, `Activity`, `Zone`**: on add, a new id
can't collide with an existing one (regenerate); on load, de-dupe. Same mechanism,
applied uniformly. Fixes the two-in-a-row bug and its siblings. *(This is a bug
fix — it goes on the bug-fix PR, not gated behind the redesign.)*

## Principle 5 — One editor idiom

Everything you edit as a collection uses the **compact drill-in list** (Zones,
buckets — and now **Activities**): a one-line row you click to open a focused
editor. The Activities editor gets the same treatment; nothing stays a wall.

## The corrected object model (concrete)

```
Task {
  title, tags, type, startTime, endTime, priority, deadline, pinned,
  completion, satisfaction, load?          // load: user-authored, editable on the schedule; null = inherit bucket
}
Activity {                                 // a saved flexible-task template — nothing a Task lacks
  label, tags, durationMin, durationMax, priority?, load?
}
Bucket {
  label, tags, colour, load               // load default is NEUTRAL and user-set; no `role`
}
```

- **Load resolution for a task:** its own `load` → else its bucket's `load` → else
  neutral. (Already how `loadForTask` works, minus the fabricated role defaults.)
- **Energy budget:** hidden until ≥ N weeks of `energy` ratings calibrate capacity.
- **Instantiating an activity** creates a flexible Task carrying the resolved load.

## What to build / rebuild (once the forks are settled)

1. **Bug (PR #4):** unique ids for Bucket/Activity/Zone; the audit's carryOver +
   iCal fixes.
2. **Task energy on the schedule:** an energy control in the task popover/panel
   (four dials, neutral default, "inherit bucket" reset).
3. **Activities editor:** redesign to the drill-in list; remove the activity-only
   energy override (activity just carries `load` like a task).
4. **Buckets:** remove the `role` UI (and neutral load defaults instead of role
   ones); character derives from load.
5. **Energy budget:** gate the "Energy today" card behind the ≥N-week data bar;
   until then, show nothing (Fork A) or a neutral shape (Fork B).
6. **Docs:** fold these into `ACTIVITY-LIBRARY.md` / `ENERGY-MODEL.md` and retire
   the contradicted parts (role enum, fabricated capacities, per-activity override).

## Forks — RESOLVED (session 4)

- **Energy before it's learned → a "still learning" state.** Show the day's energy
  *shape as it's forming* with a clear *"we're still learning — here's how your
  budget's shaping up"* caveat; **no hard capacity, no over/under verdict** until
  ~3 weeks of `energy` ratings calibrate it (`config`). Descriptive, never
  judgmental, never a fabricated ceiling.
- **Roles → full rip-out, now.** `role` leaves the model entirely; steering and
  learning are rewritten to key off **load**.
- **Load defaults → neutral 0, user-set.** No role-derived defaults presented as
  truth.

## The role rip-out — concrete plan (spec'd; build gated on review)

`role` is redundant with the load vector, so it goes. What changes, and what
replaces it:

| File | Change |
|---|---|
| `Bucket.js` | drop `role` + `BUCKET_ROLES`; a bucket is `{label, tags, colour, load}`; load default **neutral 0** |
| `energy.js` | drop `DEFAULT_LOAD_BY_ROLE` / `defaultLoadForRole`; bucket load defaults neutral |
| `index.js` | `STARTER_BUCKETS` lose `role`; `seed()` updated; drop `BUCKET_ROLES` export |
| `Schedule.js` | remove `roleOf` (keep `bucketForTask`) |
| `learning.js` | remove `role×time` (36) + `role×weekend` (6) interactions and the `roleOf` plumbing → revert to base features; **keep** the finer `DURATION_EDGES` + the layout-version migration; bump `MODEL_LAYOUT_VERSION`. *(Phase D.1's role feature is undone; per-position learning returns in L-2 keyed off **load**, not role.)* |
| `suggest.js` | rewrite `steerBias`/`suggestActivities` to key off **load character** — restorative (net-negative load) nudged up when you're running down, demanding (net-positive) when charged + pressured; `energyBalance` + `priorityPressure` unchanged; drop `roleOf`/`activityRole` |
| `TagManager.jsx` | remove the role `<select>` and role from the list summary |
| tests | update `learning` / `suggest` / `energy` / `activity-library` / `activity-cabana` |

## Consolidated findings — the master fix / redesign list (audits + map)

### A. Real bugs → the bug-fix PR (off `wrap-report`, PR #4)
1. **HIGH** — `resolveDropConflicts` silently double-books a displaced task onto
   **next week's** recurring pinned anchor (`conflicts.js` uses single-week
   `expandRecurrence` while the search crosses the week). Proven 800/800 silent.
2. **HIGH** — `carryOver` double-books **and places carried work outside the target
   week** (over-wide `to = toWs+9` + occupied filtered to days 0–6). `carryOver.js:22,42`.
3. **MED** — `addFlexible`/`addFixed` (`_occupiedExcluding`) same cross-week overlap
   when `to` is omitted. `Schedule.js:101`.
4. **MED-HIGH** — iCal export `UNTIL` at midnight drops the **final day's**
   occurrences on third-party calendars. `ical.js:71`.
5. **MED** — iCal `EXDATE`/`RECURRENCE-ID` use the wrong time after `splitPeriod`
   (`hhmmOf` reads `periods[0]`). `ical.js:174`.
6. **Your ripple bug** — a 5-min ripple flung the next task to the next day. Core
   `rippleShift` tested *clean*, so it's the **commit path** (`commitRipple`'s
   trailing `resolveDropConflicts` — which hits bug #1 — or the UI delta math).
   **Needs a repro** as step 1 of the fix.
7. **Unique ids** — `Bucket`/`Activity`/`Zone` collide (the two-new-buckets bug);
   generalise the task-id fix.
8. **LOW** — a recurrence `add` on a day the pattern already fills is silently
   dropped. `recurrence.js:62`.
9. cosmetic — wrong example in the `time.js:143` isoWeek comment.

### B. UI / design smells → reconciliation redesign (feature branch)
- **You can't edit a task's energy on the schedule** — `TaskPanel` has no load
  control; only buckets/activities do. (Fixed by Principle 1/2.)
- **Three editor idioms** — Zones (inline + bespoke `ZoneTags`) vs Buckets
  (drill-in + shared `TagEditor`) vs Activities (flat rows). Unify to drill-in +
  `TagEditor`.
- **Retire is half-wired** — `unretireTag` has UI, `retireTag` has **none**
  (orphaned). Decide: add a retire control, or drop both.
- **No project-management surface** — `growChunk`/`shrinkChunk`/`resizeChunk`/
  `deleteChunk`/`finishProject`/`redistribute` are all unreachable from the UI.
- **Dead bits** — TopBar `now` prop unused; prev-week load-hover preview can't
  fire; "stub" comment on the (finished) wrap report; `overpackCheck` detector
  never called.

## Build order (AFTER you've torn this apart — nothing before)
1. **Bug-fix PR:** #1–3 cross-week overlaps, #4–5 iCal, #7 unique ids, and #6
   reproduce-then-fix the ripple. (Off `wrap-report`; merges ahead.)
2. **Reconciliation redesign** (feature branch): role rip-out, task energy on the
   schedule, Activities drill-in, energy "still learning" state, editor-idiom unify.
3. **Two product calls needed:** retire (keep with a control, or remove) and
   project management (build a surface, or leave chunk ops internal).
