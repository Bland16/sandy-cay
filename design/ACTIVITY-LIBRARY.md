# Activity Library, Tag Buckets & a satisfaction-steered "What to do"

**Status:** DRAFT spec (session 4, 2026-07-16). Not built yet. Open questions at
the end. Sits alongside SPEC §6 (What To Do) and the Cabana.

## The ask

In the Cabana, let the user author **categories** and many **activities** with a
duration **min/max**, and use them to *populate* "what to do". Then steer what the
picker offers — past the user's own waiting tasks — by **priority space** and by
**how the user has recently been rating their tasks** (satisfaction), so a run of
unsatisfying rest nudges toward creative/personal work, a good run of work invites
more, etc. Plus a **Tag Manager** in the Cabana to sort tags into buckets as they
appear and to retire tags that fall out of use.

## Load-bearing boundaries (do not cross)

1. **User-authored only — the recommendation-engine stays excluded.** The app
   never invents activities or judges what you *should* do (USE-CASE-ANALYSIS
   lines 495 / 931: "No task suggestions, ever"). Every activity in the library is
   one *you* wrote; the picker only surfaces *your* items that fit. Steering
   reorders your own menu; it never manufactures advice.
2. **P-1 — skipping is never avoidance.** Cycling/skipping past a suggestion is
   **never recorded, never fed to the model, never surfaced as "you're
   procrastinating".** The learning module keeps training only on explicit
   satisfaction ratings of tasks you *actually did*, exactly as today — no new
   behavioural tracking is introduced. Every steered suggestion is phrased as an
   invitation ("some creative time?"), never a reproach. This directly answers the
   user's worry: it *cannot* tell you you're procrastinating on school, because it
   never watches what you skip.
3. **Your real tasks come first.** The picker still answers "what now?" with your
   waiting tasks (`whatToDo`). Library activities are a **fallback** — they appear
   when nothing waiting fits, or once you cycle past the real picks. A deadline is
   never crowded out by a library suggestion.
4. **Additive persistence.** New state (`buckets`, `activities`, tag metadata)
   persists; `schemaVersion` stays 1; `useEngine#replace` and the footlocker
   export/import copy it (engine sharp edge #15). Absent keys load clean, so old
   saves keep working.

## Data model

Mirrors the existing **Zone** pattern (a class + a collection on `Schedule` +
`add/remove/update` + `toJSON/fromJSON` + a Cabana editor).

### Bucket (a category = a named group of tags)

The one concept behind both "activity categories" and "tag buckets". A bucket
gives a set of tags a shared identity and a **role** that the steering reasons
about.

```
Bucket {
  id,
  label,                 // "Rest", "Work / School", "Creative", "Around the house"
  tags: string[],        // the tags that belong to this bucket
  role: 'rest' | 'creative' | 'work' | 'social' | 'health' | 'neutral',  // drives steering (LOCKED)
  color?,
}
```

- A tag belongs to **at most one** bucket (or none → "unbucketed").
- `role` lets steering reason about complement/reinforce **without hardcoding tag
  names**, and maps 1:1 onto the six starter buckets. It's a single readable
  enum, not a two-axis dial — chosen for legibility over expressiveness. (LOCKED,
  was OPEN #1's taxonomy question.)

### Activity (a template you drop into an opening)

```
Activity {
  id,
  bucketId,              // the category it lives under
  label,                 // "Read", "Dishes", "Sketch"
  tags: string[],        // defaults to the bucket's tags; may add specifics
  durationMin,           // minutes — the elastic range
  durationMax,
  priority?,             // optional default when instantiated
}
```

Instantiating an activity into an opening creates an ordinary **flexible Task**:
tags from the activity, start = the opening's start, and — per the user's choice —
**duration fills the opening**: `clamp(openingMinutes, durationMin, durationMax)`.
So "Read 15–90" becomes 30 min in a 30-min gap and 90 in a two-hour one. It goes
in via the existing "Do it now" path (`resolveDropConflicts`), so displacement /
snap-back behave exactly as they do for a real task.

### On `Schedule`

`schedule.buckets: Bucket[]`, `schedule.activities: Activity[]`, plus per-tag
metadata (bucket assignment + retired flag) — either on the buckets or a small
`tagMeta` map. `add/remove/update` methods; classes with `toJSON/fromJSON`;
`schemaVersion` unchanged.

## Tag Manager (new Cabana section)

- **Lists every tag** (`tagsInUse` ∪ bucketed ∪ historical), grouped by bucket,
  with an **"Unbucketed"** group for tags that have appeared but aren't assigned.
- **Bucket a tag** (dropdown/drag). Create / rename / recolor a bucket; set its
  `kind`.
- **Retire a tag** — archive it so it stops appearing in tag pickers for *new*
  tasks, in chips, and in the library, **without touching historical tasks** that
  carry it (their data and insights survive). Retired ≠ deleted; un-retirable.
- **"Bucket tags as they appear."** A new tag on a task lands in *Unbucketed* with
  a small count badge on the Cabana's Palmtree — an invitation to sort it, never a
  forced step, never a nag (P-1).
- **Absorbs the existing "Tag roles" section** (RESOLVED): protected is just one
  *role* a tag can carry, so the Tag Manager is the single place per tag — its
  bucket, whether it's protected, and retire/un-retire. The old "Tag roles"
  section folds in here.
- **Retire semantics** (RESOLVED): a retired tag disappears from *new*-task tag
  pickers, chips, and the library; it stays on historical tasks and in insights;
  it is un-retirable; **zones matching it keep working** (retire is about authoring
  new work, not rewriting the schedule).

### Starter buckets (RESOLVED — propose a set the user edits)

Seed these on first run (each editable, renamable, deletable), pre-assigning
existing tags where obvious; the user reshapes from there:

| Bucket | role | seeds (tags it grabs if present) |
|---|---|---|
| Rest | `rest` | `rest`, `leisure`, `nap` |
| Work / School | `work` | `work`, `study`, `thesis`, `admin` |
| Creative | `creative` | `creative`, `music`, `art`, `personal-project` |
| Home | `work` | `chores`, `errand`, `home` |
| Social | `social` | `social`, `family`, `friends` |
| Health | `health` | `health`, `sports`, `exercise`, `gym` |

Roles map 1:1 onto the starter buckets, so "passive rest" (`rest`) and "active
creative restoration" (`creative`) are distinct — which is what makes the "rest
flat → creative" rule expressible. Seeding is idempotent and only runs when there
are no buckets yet, so it never clobbers an edited set.

## Activity Library (new Cabana section)

Section "Activities": buckets as groups, activities listed beneath each; add / edit
/ remove (label, tags, min/max duration, priority). Same editor idiom as Zones.

## "What to do" integration

Today's Right-Now panel: opening line → ranked existing tasks → "Do it now" →
"Another →". Changes:

1. **Existing tasks rank first, unchanged** (`whatToDo`).
2. **Library fallback.** Once the waiting tasks are exhausted (you cycle past them)
   or none fit the opening, the panel offers **library activities that fit**
   (`durationMin ≤ openingMinutes`), labelled *"from your library"*.
3. **Steered ordering** (the heuristic — see below), each with an explainable,
   mechanically-derived reason.
4. **"Do it now"** instantiates the pick into the opening (fill-the-opening
   duration).
5. Still never auto-opens; skipping still never tracked (P-1, boundary #2).

### The steering heuristic (LOCKED)

Inputs, all already in the model — **no new tracking**:
- **Recent per-role satisfaction:** over the last N rated tasks (N = 10, or the
  trailing 14 days, whichever yields more — else cold start), aggregate by the
  task's bucket `role`: `avgOverall` (1–5) and `netEnergy` (Σ of the tri-state
  `energy` facet).
- **energyBalance:** Σ `energy` across all recent rated tasks — are you charged or
  running down?
- **priorityPressure (= "priority space", LOCKED):** the summed minutes of
  **incomplete P4–P5 tasks due within `config.maxPlacementLookahead`**, normalised
  against that window's capacity. High → important work looms; ~0 → genuinely free
  time.
- **Opening fit:** prefer activities whose `[min,max]` fits the opening
  comfortably. **Fit dominates** — steering is a gentle additive bias, so a
  well-fitting activity always beats a poorly-fitting one whatever the mood.

Mapping → a small bias per bucket `role` (each yields one invitation-phrased
reason, derived from the actual numbers):

| Condition | biases up | reason |
|---|---|---|
| `energyBalance` ≤ 0 (net-draining lately) | `rest`, `health` | "You've been running down — something restful?" |
| `rest` role `avgOverall` low *and* you've been resting | `creative` (shifts the rest bias here) | "Rest's felt flat lately — a creative project?" |
| `energyBalance` high **and** `priorityPressure` high | `work` | "Momentum and things due — a focused block?" |
| `energyBalance` high **and** `priorityPressure` low | `creative`, `social` | "Nothing pressing — time for something you enjoy?" |
| < 10 ratings (cold start) | none — fit + variety only | — |

Plus a small **variety** nudge away from the role of the task you just finished,
so it doesn't offer more of the exact thing you just did.

Final order = `fit (dominant) + roleBias + variety`. All reasons are invitations,
explainable from the numbers, never a judgement. Thresholds/weights live in
`config` (Cabana-tunable later); starting values are a design detail for Phase C,
not a reopened decision.

## Learning extension — per-bucket position & availability (LOCKED)

`learning.js` today is a flat ridge regression whose features are all **additive
and independent**: tag, time-of-day (6), day-of-week (7), duration (5), day-fill,
priority, placed-by-user, move-count. So it can learn "mornings are good" *and*
"work is good" as separate weights, but **not** "work is good *in the morning*" —
a linear model with independent tag and time features cannot represent the
combination. Two additions fix that, both enabled by the bucket `role`.

### 1. Per-bucket position (the "where tasks sit, by bucket" ask)

Add **interaction features** on the task's bucket `role`:
- `role × timeOfDay` — one-hot(role) × one-hot(6 time buckets) = 36 binary terms.
- `role × weekend` — 6 scalar terms (isWeekend bit per role).
- `role × dayFill` — 6 scalar terms (day-fill scalar per role).

Inspectable, so the Cabana can finally say *"work · morning +0.6"* honestly
(SPEC §6's promised "study rated highest before noon" needs exactly this).

### 2. Availability (the "time I normally have" ask — all three senses, own weights)

Global scalar features, each with its own learned weight:
- `crunch` = clamp(taskDuration / openingSize, 0, 1) — how tightly the task filled
  the free block it sat in (1 = crammed). Snapshotted at completion, like
  `_dayFillAtCompletion`.
- `availabilityDeviation` = (freeAtSlot − typicalFreeAtSlot) normalised — *"unusually
  free vs a normal busy Tuesday."* Needs a rolling **baseline of your usual free
  minutes per (time-bucket, weekday)**, computed from schedule history.
- `dayFill` (exists) + new `weekFill` — busyness of the day and the week.

### Keeping it honest on sparse data (the load-bearing part)

Interactions add ~50 features; on 10–50 ratings a naive fit hallucinates patterns
from single data points. Contained by:
- **Base + refinement:** the existing global terms stay as the backbone;
  interactions only adjust them, so thin data still behaves like today.
- **Per-cell gating:** a `role×position` term contributes **0** until that cell has
  ≥ `config.learning.interactionMinSamples` (~4) ratings. One grumpy Saturday can't
  mint "work is bad on weekends".
- **Grouped ridge:** interaction terms get a heavier `lambda` than base terms.
- **Roles (6), not tags,** bound the cross-term count.
- Whole-model cold start (`coldStartRatings`) still returns 0 until enough total
  ratings — unchanged.

### Migration (free)

Changing the feature layout invalidates stored `weights`, but weights are
**disposable** — derived from ratings, which persist on tasks. Bump a model
**layout version**; on load, if it differs, discard weights and **retrain from the
rated tasks**. No data loss. `role` for a rated task is derived from its tags via
the bucket map (`roleOf(task)`; first matching bucket wins, else `neutral`).

### Feeds the steering

Once trained past cold start, the Phase-C steering prefers the *learned* per-role
positional preference (`modelScore` for the role at this slot) over the recent-
satisfaction heuristic — the heuristic is the cold-start fallback.

## Build plan (author + wire together, per the user's choice)

- **Phase A — model + persistence.** `Bucket` + `Activity` classes, `Schedule`
  collections + CRUD, `toJSON/fromJSON`, `replace`/footlocker copy, `schemaVersion`
  1. Unit tests (round-trip, CRUD, replace-copies-them).
- **Phase B — Cabana.** Tag Manager (bucket assign, create/rename/recolor, role,
  protected-role, retire/un-retire, unbucketed surfacing) + Activities editor.
  Component tests.
- **Phase C — "What to do".** Library fallback + steered ordering + "Do it now"
  instantiation (fill-the-opening). Tests: fit filter, fallback only after real
  tasks, steering reasons, and a **P-1 test that skipping records nothing**.
- **Phase D.1 — per-bucket position learning (DONE).** `role×time` (36) +
  `role×weekend` (6) interactions + finer `DURATION_EDGES` (7 buckets, splits the
  old single "< 45" bucket); per-cell gating (`interactionMinSamples`), grouped
  ridge (`interactionLambda`), `MODEL_LAYOUT_VERSION` + retrain-on-load migration;
  the diverged-guard and cold-start still hold; Cabana insight shows the new
  `role×time` terms. `role` is resolved by the caller (`Schedule.roleOf`) and
  threaded through `train`/`modelScore`. Tests: opposite per-role time patterns a
  base-time model can't represent, one rating can't move a gated cell, old-layout
  save retrains cleanly, sub-45 duration buckets exist.
- **Phase D.2 — availability (DEFERRED, with reason).** `crunch` /
  `availabilityDeviation` (vs a per-(time,weekday) baseline) / `weekFill` +
  `role×dayFill`. These need a **completion-context snapshot** recorded at rating
  time — which the app does **not** have: the existing `_dayFillAtCompletion` was
  read by the model but **never set anywhere** (the dayFill feature has been dead).
  Wiring the snapshot subsystem (record day/week-fill + crunch + a rolling
  availability baseline at the moment a task is rated, plus prospective
  computation so they rank slots) is its own phase, not a bolt-on. D.1 ships the
  position half (the "where tasks sit by bucket" ask) cleanly; D.2 is the "time I
  normally have" half.

## Decisions locked (session 4)

- **Integration:** library is a *fallback* in "what to do" — real tasks first,
  library surfaces when nothing waiting fits or you cycle past them.
- **Duration:** dropping an activity fills the opening, `clamp(opening, min, max)`.
- **Scope:** author + wire together (Phases A–C in one feature line).
- **Tag Manager** absorbs "Tag roles"; **retire** = hide-from-new, keep history,
  zones unaffected, un-retirable.
- **Starter buckets:** seed the 6-bucket set above, editable.
- **Bucket role:** a single enum per bucket (`rest`/`creative`/`work`/`social`/
  `health`/`neutral`), not a two-axis dial.
- **Priority space:** looming P4–P5 minutes due within the placement lookahead.
- **Steering:** the mapping table above; fit dominates, role-bias is gentle.
- **Learning extension:** split into **D.1 (built)** — `role×time` + `role×weekend`
  position interactions, finer duration buckets, per-cell gating, grouped ridge,
  layout-version migration — and **D.2 (deferred)** — the availability features
  (`crunch`, `availabilityDeviation` vs a baseline, `weekFill`, `role×dayFill`),
  which need a completion-context snapshot the app doesn't record yet.
- **P-1:** skipping is never tracked; steering never judges; user-authored only.

**The spec is fully settled — Phases A, B and C are all specified.** Remaining
choices (exact bias weights, the aggregation window N, cold-start count) are
ordinary Phase-C implementation values in `config`, tunable later, not open
design questions.
