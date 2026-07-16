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
gives a set of tags a shared identity and a **kind** that the steering reasons
about.

```
Bucket {
  id,
  label,                 // "Rest", "Work / School", "Creative", "Around the house"
  tags: string[],        // the tags that belong to this bucket
  kind: 'restorative' | 'productive' | 'neutral',   // drives steering
  color?,
}
```

- A tag belongs to **at most one** bucket (or none → "unbucketed").
- `kind` lets steering reason about complement/reinforce **without hardcoding tag
  names** — a draining run of `productive` work invites `restorative`/creative
  time; a restful, energised run invites `productive` work.

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

| Bucket | kind | seeds (tags it grabs if present) |
|---|---|---|
| Rest | restorative | `rest`, `leisure`, `nap` |
| Work / School | productive | `work`, `study`, `thesis`, `admin` |
| Creative | restorative* | `creative`, `music`, `art`, `personal-project` |
| Home | productive | `chores`, `errand`, `home` |
| Social | neutral | `social`, `family`, `friends` |
| Health | restorative | `health`, `sports`, `exercise`, `gym` |

\* Creative is *active* restoration — the antidote the user named for flat rest.
The three-`kind` taxonomy may be too coarse to separate "passive rest" from
"active/creative restoration"; whether `kind` needs a finer axis (or an extra
`passive|active` flag) is part of **OPEN #1**. Seeding is idempotent and only
runs when there are no buckets yet, so it never clobbers an edited set.

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

### The steering heuristic — v1 proposal (OPEN #1)

Inputs, all already in the model — **no new tracking**:
- **Recent per-bucket satisfaction:** over the last N rated tasks (proposal:
  N = 10, or trailing 2 weeks), per bucket compute `avgOverall` (1–5) and
  `netEnergy` (Σ of the tri-state `energy` facet).
- **Priority space:** how much of your *committed high-priority* time is already
  handled vs open (proposal: sum of unmet P4–P5 task-minutes still unplaced or
  still ahead this week). Covered priorities → genuinely free time → lean
  restorative/creative; open priorities → lean productive. (Exact definition is
  **OPEN #2**.)
- **Opening fit:** prefer activities whose range fits the opening comfortably.

Mapping (each yields an invitation-phrased reason):
- Recent run **productive & draining** (low `netEnergy` on productive buckets) →
  surface **restorative** activities. *"You've been running hard — something
  restful?"*
- A **restorative** bucket you've leaned on is **low `avgOverall`** (rest isn't
  landing) → surface **creative / personal-project** activities. *"Rest's felt flat
  lately — a creative project?"*
- Recent work **high `avgOverall` & energising** → offer **more productive**
  activities. *"Work's been landing — keep the momentum?"*
- **Priority space open** → weight `productive` up regardless of mood.
- Neutral / cold start (<10 ratings) → fit-first spread, no mood claim.

All reasons are invitations, explainable from the actual numbers, never a
judgement. This mapping and its weights are the part to co-design.

## Build plan (author + wire together, per the user's choice)

- **Phase A — model + persistence.** `Bucket` + `Activity` classes, `Schedule`
  collections + CRUD, `toJSON/fromJSON`, `replace`/footlocker copy, `schemaVersion`
  1. Unit tests (round-trip, CRUD, replace-copies-them).
- **Phase B — Cabana.** Tag Manager (bucket assign, create/rename/recolor, kind,
  retire/un-retire, unbucketed surfacing) + Activities editor. Component tests.
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
- **P-1:** skipping is never tracked; steering never judges; user-authored only.

## Open — settle before Phase C (the picker wiring), NOT blocking A/B

1. **Steering mapping, weights & the `kind` taxonomy** — the v1 above; refine the
   bucket→bucket rules, how hard satisfaction vs priority-space vs fit each pull,
   and whether `kind` needs a finer passive/active axis for rest-vs-creative.
2. **"Priority space" precise definition** — unmet P4–P5 minutes this week? free
   capacity? something else?

Phase A (model + persistence) and Phase B (Tag Manager + Activities editor) are
fully specified and can proceed now; Phase C waits on #1–#2.
