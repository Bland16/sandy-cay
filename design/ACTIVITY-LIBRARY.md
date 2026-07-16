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
- **P-1:** skipping is never tracked; steering never judges; user-authored only.

**The spec is fully settled — Phases A, B and C are all specified.** Remaining
choices (exact bias weights, the aggregation window N, cold-start count) are
ordinary Phase-C implementation values in `config`, tunable later, not open
design questions.
