# Sandy Cay — handoff

**Updated:** 2026-08-13, session 8. **`main` is the trunk and is live on Pages**
(https://bland16.github.io/sandy-cay/). **573 tests green** — measured, not
quoted; the "569" this file carried since session 6 was stale.

**⚠️ Two branches exist and NEITHER is merged. Read this before anything.**

| branch | holds | state |
|---|---|---|
| `worktree-spec-signoff-session7` | session 7: every open decision answered, the buffer-weight correction, the session-splitting evaluations | pushed, **not merged** |
| `worktree-spec-session8` | **everything in session 7, plus session 8's review and corrections** | contains session 7 by merge — **this is the branch to build from** |

`main` auto-deploys on push, so merging is a release and that is the user's call.
`worktree-spec-session8` is a strict superset of session 7; merging it merges
both. The engine on it is byte-identical to session 7's — session 8 changed
**specs only** (one experimental code change was made, measured, and reverted;
see §4.5 of `WEEKLY-PLANNING`).

The spent worktrees and all six merged branches were removed at the end of
session 6, each verified at **0 unmerged commits and 0 dirty files** first.
Every commit remains reachable from `main`; the tips were
`dates-and-recurrence 010e258`, `worktree-activity-library 4e472e6`,
`worktree-bugfix-sweep d97c38d`, `worktree-core-bugfixes f2db179`,
`worktree-precedence-zones 0628dd4`, `wrap-report d97c38d`, recorded here so a
branch can be recreated by SHA if it is ever wanted.

**`public/` holds only what the app ships** (`icon.svg`, the manifest, `sw.js`).
The design viewers moved to `design/` — `dates-mockup.html` and
`wave-handle-viewer.html` — because anything in `public/` is served publicly
from the Pages site, and a working mockup is not something to publish. Open
them from disk, or copy one into `public/` temporarily while iterating.

That covers: the wrap report, recurrence/zones, responsive, the past-placement
floor, unique ids, the de-flaked suite, ripple/zone exclusivity, the whole
Activity Library / Tag Buckets / energy line, the editor redesign (P0–P5), the
carryOver + iCal fixes, and **session 6's dates-and-recurrence work**.

```bash
npm install
npm run dev      # http://localhost:5173/sandy-cay/
npm run test:run # 573 tests, all green any day of the week (flaky tests fixed)
npm run build
npx eslint src
```

## Every open decision — ANSWERED, 2026-08-12 (session 7)

The user walked the whole table. **Every row is now decided**, and each decision
lives in full in its own spec; this is the index. Four answers went *against* the
default, and one of them was a correction to shipped code.

| # | Question | Answer |
|---|---|---|
| **COMB D-7** | Extract SPEC §4.3's shared window-row, or delete the claim? | **EXTRACT** — forced by DATES D-5. The claim becomes true instead of being deleted, and it lands *before* the zone work. ⚠️ against default |
| **COMB D-8** | Retention horizon | **Keep rated `history` + all `dismissed`; prune unrated history, `occurrenceData`, `snapshots` at 12 months.** Two stores are kept because deleting them changes behaviour. Prune on load, idempotent. *(my call, delegated)* |
| **DATES D-2** | "Add on this day" from a day header? | **No for tasks, yes for notes.** One place adds a task and it is the Add-task panel. The header's single `＋` means *note*. |
| **DATES D-5** | Do Zones get monthly/yearly frequencies? | **YES**, the same vocabulary as tasks. ⚠️ against default — and it decides D-7 |
| **NOTES D-2** | Block-at-import, or silent? | **Neither — the import CONFIRMS DATES, on pages of 7–10, and it is the SAME form as an ask pack.** Blocking is not asked at import at all. ⚠️ against default, and it collapses two designs into one |
| **NOTES D-6** | Tint replaces the blocker card, or accompanies it? | **Replaces.** The reason matters: tasks can still be scheduled on a blocked day, so a full-height protected card is a lie about the day. |
| **NOTES D-8** | Year-less **range**? | **Supported** — no year means every year whatever the shape. Yearly window gains `spanDays`. ⚠️ against default |
| **PLAN D-1** | Hours or sessions? | **Hours.** |
| **PLAN D-2** | Under-done week | **Offer the shortfall forward** once, in §3.6's equal-weight shape. §5's "no catch-up debt" bullet amended. ⚠️ against default |
| **PLAN D-3** | Unplanned future week | **Empty until asked.** Looking is not asking; a week shows what it owes and a **Lay it out** button. ⚠️ against default |
| **PLAN D-4** | Chunks grouped on the grid? | **Only if it can be done tastefully** — a visual bar, mocked three ways in `design/session7-mockups.html`, awaiting your eye |
| **PLAN D-6** | Floor the buffer for short tasks? | **Dissolved** by the runway correction below — nothing left to floor |
| **EDITOR D-4** | physical/social critters | **RESOLVED BY THE BUILD** — surfboard + beach-ball are already wired (`EnergyControl.jsx:14–15`). Fourth stale "open" decision this session |
| **EDITOR D-2/D-5** | sparkline on the bucket row; scalloped frame stretch | **Mocked, awaiting your eye** — `design/session7-mockups.html` |

**Still genuinely open, and both need your eyes rather than an argument:**
`design/session7-mockups.html` (PLAN D-4, EDITOR D-2, EDITOR D-5), and the
**desktop day view** — you said it isn't good and are sending a screenshot;
removing it would reverse the locked Layout B+C decision, so it is parked until
then. Phone keeps the day view as its primary layout regardless.

### ⚠️ The buffer weight shipped nearly inert — corrected 2026-08-12

`WEEKLY-PLANNING` §4.4 specified, and step 0 shipped, "finish one fifth of the
**task's own length** early". The user's intent was **one fifth of the runway**.
These are not two flavours of the same thing — the shipped one barely functioned.
Probe, deadline Fri 17:00, planned Monday:

```
finishing      OLD 20m  OLD 5h   NEW (any size)
Mon 17:00       1.00     1.00     1.00
Thu 20:12       1.00     1.00     1.00
Fri 09:00       1.00     1.00     0.38
Fri 16:45       1.00     0.25     0.01
```

A 20-minute task scored **identically at Monday 17:00 and Friday 16:45**. The
term could not tell the start of the week from fifteen minutes before the wire.

**Fixed:** `bufferScore(slotEnd, deadline, runwayStart)`, target =
`runway / 5`, with `runwayStart` = `findBestSlot`'s `from`. Neutral (1) for no
deadline, no runway start, or overdue work. `bufferDurationMin` is gone from
`placement.js` — the target no longer depends on duration, which also dissolves
the chunked-project special case and PLAN D-6.

**The lesson, again:** it was reasoned about, agreed, built, and shipped with 569
green tests. One probe printing the score at nine finishing times exposed it in a
minute. And `report.js#buildDeadlineBuffer` had been measuring the exact quantity
that would have shown it all along — *the app was already reporting the evidence
against its own scoring.*

## ▶▶▶ START HERE — five items, ONE AT A TIME (written 2026-08-13, end of session 8)

> ### The rule that matters more than any item below
>
> **Do ONE item. Finish it. Run `npm run test:run` and `npx eslint src`. Commit
> it on its own. Then STOP and report before starting the next.**
>
> Do not batch two because they touch the same file. Do not start item 2 while
> item 1 is "basically done". Every defect this project has had to dig out —
> the inert buffer weight, the energy-blind placer, the invisible bucket tint,
> P0 being recorded complete when it wasn't — came from work that was reasoned
> about in a batch and verified as a batch. One at a time is how they get caught.

### What is different now: there is a real user with a date

The schedule below is not a fixture. **Classes start Monday 31 August 2026** and
the user intends to run their term on this.

Already imported and live in their browser: **11 buckets with real authored
loads · 49 activities · 1 zone (TA session, Wed 16:30–18:50, matches
`light-work`) · 21 day notes · 37 tasks** (8 courses, 3 gym, 14 club events,
12 blockers). The generator that built it is **not** in the repo and the file
lives in their Downloads — it holds a real person's schedule and this repo is
public.

Two anonymised real weeks are checked in as fixtures at `design/probes/`
(`probe-real-weeks-uc.mjs`) — a dense term week and a sparse one. **Prove
placement work against those, not against invented calendars.**

### ITEM 1 — day notes need a surface ✅ BUILT 2026-08-13

`src/ui/components/DayNotes.jsx` is the single component D-5 asked for: it owns
the only `notesForDate` call site in the UI and exports `<DayNoteLine>` (the
header line) and `<DayNoteList>` (the day view's full list). `WeekGrid` drops the
line into `.dayhead`, which gives the **weekend drawer the third surface for
free** — it renders a real `<WeekGrid>`, so nothing was reimplemented and sharp
edges #14/#17 have nothing to drift. `DayView` renders the list under its header.

Multi-day notes come out right without special-casing, because `notesForDate`
asks each note whether it *covers* the date: Thanksgiving 25–27 Nov draws on all
three days.

**The bar is TREATMENT C, chosen by eye** from `design/day-header-mockups.html`
(six treatments at the three real column widths). It is a tinted bar,
**full-bleed** along the header's bottom edge — and the bleed is load-bearing,
not decoration: the negative margins let neighbouring days' bars touch, so a
multi-day note reads as one run across the week (§4's "a band across the week")
with **no span machinery**, and with nothing for the weekend drawer's edge to
cut in half. It also cannot stack — five notes on a day is one bar and "+4",
exactly as tall as a quiet day.

**The bar is a button, and it opens the day's notes in the right panel**
(`design/day-note-panel-mockups.html`, the user's design). That is what keeps
the bar honest: it only ever says HOW MANY, because the panel says WHAT. The
panel is a normal mode (`DAY_NOTES_MODE`, `dayNotesIndex` — both exported from
`DayNotes.jsx` so `App` and `RightPanel` cannot drift on a literal), so opening
one replaces whatever the panel held, and clicking the same bar again closes it.

⚠️ **The bar must stay a SIBLING of `.dhopen`** — a button inside a button is
invalid HTML and unreachable by keyboard, the same reason `.dhdots` sits outside
it. A test locks this.

**Tinting the bar is the allowed half of D-1**, which refuses a tint on the
*column* but keeps tags for tinting "its own chip". Nothing is coral.

**610 tests green** (was 594), eslint and build clean.
`tests/ui-day-notes.test.jsx` locks all three surfaces, the `+N` count, the
untouched clear-day header, the year-less "every year" readback, the panel's
open/replace/toggle behaviour and the sibling rule. Verified by **rendering and
dumping the headers and the panel**, not only by going green.

**Not built here, on purpose:** "Block this day". That is a model change (D-6,
`blockedDays` subtracted in `computeWindows`) and it is ITEM 2, so the panel
states facts only and carries no actions. Truncation of a long label is CSS
(`text-overflow: ellipsis`) and jsdom has no layout — **it wants an eye on a real
browser**, along with how the bar reads in a 74px phone-overview column.

The original brief:

**Do this one alone, and do it first.** The user has 21 day notes — Thanksgiving,
both finals periods, every add/drop deadline, the Make-a-thons — and
`notesForDate`/`dayNotes` appear **nowhere** in `src/ui` or `App.jsx`. The data
is live and completely invisible.

- **Spec:** `design/DAY-NOTES.md` §4 (header line) and §7 (the day list).
- **Build:** one line under the day's date in the sticky header — label,
  truncated, "+1" when there are several; the day view lists them in full.
- **⚠️ D-5 already decided the hard part:** ONE `notesForDate` call site rendered
  by ONE component, dropped into each header. Three surfaces render day headers
  (week grid, day view, weekend drawer) and `zoneBands` proves a third copy
  drifts (sharp edge #14, #17).
- **A multi-day note draws on every day it covers**, so Thanksgiving reads as a
  band across three days, not a mark on the 25th.
- **Not coral.** A holiday is not a scheduling problem (P-1).
- **Done when:** loading their file shows Thanksgiving across 25–27 Nov, both
  finals periods, and the Make-a-thon on 20–21 Mar, on all three surfaces.

**STOP. Report. Wait.**

### ITEM 2 — blocked days become a real state, not 12 giant cards

Their file contains **12 full-day protected blocker tasks** which currently
render as cards spanning 08:00–23:00 across Thanksgiving, spring break and 4 Oct.

- **Spec:** `design/DAY-NOTES.md` D-6, rewritten in session 8 — read the whole
  entry, its original reason was wrong and the correction is the point.
- **Build:** a `blockedDays` collection beside `dayNotes`, subtracted from the
  legal windows in `computeWindows`. The tint carries the meaning; the blocker
  card goes.
- **The behaviour, which is a CHANGE and was decided by the user:** blocked means
  *the autoscheduler stays out*, not that you may not go there. A manual drop
  must be **allowed** (today it is rejected), and What-To-Do must still answer
  when asked — opening the picker is asking.
- **⚠️ One automatic path does NOT route through `placeTask`:** ripple's plain
  shift branch. It was caught by exactly this once before with exclusive zones.
  Blocked days must join that check or a ripple will slide work onto Christmas.
- **`createBlocker` survives only** for the explicit "protect this gap" case
  (§3.9), which is a genuine appointment.
- **Done when:** Thanksgiving shows a tint and no card; `autoSchedule` places
  nothing there; a hand drop lands; the ripple test passes.

**STOP. Report. Wait.**

### ITEM 3 — `resizeChunk` never clamps to `chunking.maxChunk`

One line and a test. `projects.js:114` clamps to `Math.max(15, newDurationMin)`
and never checks the user's own stated maximum sitting, so dragging a chunk
past it silently succeeds.

- **Decide and comment it either way:** it may be deliberate R-1 autonomy (the
  hand wins). If so, say so in the code. If not, clamp it.
- **Done when:** a test locks whichever answer you chose.

**STOP. Report. Wait.**

### ITEM 4 — the generation engine (the actual feature)

Right now the app shows commitments and nothing else. This is what places
coursework.

- **Spec:** `design/WEEKLY-PLANNING.md` §4.1.1 and §4.1.2. **Read §4.1.1 before
  writing anything** — six of seven candidates lost, and step 4's "equalise" line
  was withdrawn in session 8; sittings stay gap-shaped.
- **Build the engine ALONE first**, with no UI, and prove it by printing
  placements against `design/probes/`. Then the Cabana card (steps 2–3).
- **No `scoring.js` change** is needed or wanted here (§4.5).
- **⚠️ It will move the user's gym and be wrong to.** They deliberately placed
  Mon 16:15 / Wed 19:00 / Sat 14:00 against their hard days; the generator
  spreads evenly. Keep the gym hand-placed, or give a commitment a way to say
  "position me against demand, don't spread me" — that gap is real and unwritten.
- **Done when:** a commitment generates sittings the week can actually hold, in
  ρ order across several commitments, printed and eyeballed on both real weeks.

**STOP. Report. Wait.**

### ITEM 5 — record planned-vs-actual per sitting

Cheap, and the cost of delay is permanent: unrecorded weeks cannot be
reconstructed, the same argument that made `dayFill` urgent.

- **Spec:** `design/WEEKLY-PLANNING.md` §4.6.
- **Build:** additive fields, written in `toJSON` **and** read in the
  constructor, and on `occurrenceData[key]` for a recurring session. A field in
  only one of the two is silently dropped — that is how `freq` was lost.
- **Do NOT build the margin offer yet.** It needs a term of data first.
- **Done when:** a resized or early-finished sitting stores what was planned
  alongside what happened, and survives a footlocker round-trip.

**STOP. Report.**

### Deliberately NOT in this list, so nobody quietly starts one

- **The energy term in `scoring.js`** — settled by evidence (D-1) and the
  riskiest change available, because it touches every placement. It has nothing
  to act on until item 4 exists: the user currently has no flexible tasks at all.
- **Retention** — zero history. Months away.
- **Routines, zone frequencies, `<WindowRow>`** — real, none of them hit this term.
- **Keyboard drag (SPEC §10)** — a genuine accessibility gap that happens not to
  affect this user. Deferred for that reason, not because it does not matter.

### Standing rules for every item

- `npm run test:run` (**594 green** at the end of session 8) and `npx eslint src`.
- **Commit by explicit path**, never `git add -A` — `design/import/` and `*.ics`
  hold a real schedule and this repo is public.
- **Never merge to `main` or push to it.** `main` auto-deploys, so a merge is a
  release and it is the user's call. Work stays on `worktree-spec-session8`.
- **The suite cannot see placement or presentation.** Four things this session
  were carefully reasoned, shipped, fully green and wrong. Print placements;
  look at the screen.

---

## Reference — the fuller reasoning behind the build order (session 8)

**Every spec is signed off and every premise in them has now been probed.** This
supersedes session 7's todo below, which it contains. Build top to bottom; each
step is provable without the one after it.

### Step 0 — four small fixes, no design risk

1. **`ratedSamples()`** — the one door into everything the model learns from.
   Today a rating on a recurring session reaches **nothing**: `retrain()` and
   `energyCalibration()` both walk `schedule.tasks`, where a materialized
   occurrence has never existed. **Proven: 12 rated sessions → sampleCount 0.**
   Spec: `design/RATINGS-AND-LEARNING.md`. Do this first — every learning-shaped
   feature below is dead without it, and it fails *closed and silently*, so
   nothing will tell you.
2. **Stamp the rating context in `_snapshotEnergy`** — `energyAt` (never captured
   for occurrences today), `dayFill` (session 7's item, absorbed here — same
   hook, same reason), and the session's own start/end. Route occurrence
   lived-data through a real `Schedule` method so the hook can fire at all;
   `TaskPanel` and `App`'s completion path currently hand-write
   `parent.occurrenceData` in two places.
3. **`resizeChunk` never clamps to `chunking.maxChunk`** (`projects.js:114`) — a
   user can silently exceed their own stated maximum sitting. One line + a test.
4. **Gate the duration buckets** in `learning.js`. The per-column gate at
   `:131–139` exists and is applied to an empty set (`:90`), so an untried
   sitting length outranks a tried-and-hated one (+0.000 vs −0.365). Do it before
   ratings accumulate — and note it only starts mattering once step 1 lands.

### Step 1 — the generation engine (`WEEKLY-PLANNING` steps 1, §4.1.1 + §4.1.2)

Gap-shaped sittings (**not** equalised — that line was withdrawn, see §4.1.1),
sequential generation in `ρ` order with priority breaking ties, spread across
`R*` counting other commitments' days as taken. **No `scoring.js` change is
needed or wanted** — §4.5 records the experiment that proves a scoring-level
spread makes the streak *longer*.

Testable with no UI. **Prove it by printing placements**, not by going green.

### ⚠️ Step 1b was RE-DECIDED at the end of session 8 — read this box, not the text below

The energy term does **not** go in step 5's day chooser. It goes in
`scoring.js`, **evaluated at the real candidate slot.** Four independent findings
forced it, the last from the user's own calendar: on their real week Wednesday
reads −2.5 at 13:00 (fourth-best day) and −10.6 at 20:00 (worst day of the
week). A nominal sit-down hour is not a parameter to tune — it *is* the answer,
and a day chooser has to invent one.

**The term, in full, after everything that was tested and dropped:**

```
energy(slot) = |L(task)| = 0            ? 0                    // gated: no load, no opinion
             : sign(L[dominant axis]) > 0
                 ? 1 − |reserve(slot.start)| / worst           // spending seeks shallow
                 :     |reserve(slot.start)| / worst           // restoring seeks deep
```

plus **sibling spacing** at generation time (a separate concern, seeded with the
previous period's sittings). Everything else proposed was built and rejected:
C1 (day depth) lost to C3 on the real week · a `spread` scoring weight lengthens
the streak · C6 (forward load) sums with C3 to reconstitute C1 exactly.

**The risk this carries, stated plainly:** it is an app-wide change to placement,
which is what this codebase has twice got wrong. The mitigation is the standing
rule — prove it by printing placements, not by going green. `design/probes/`
holds the fixtures to prove it against.

### The original step 1b text (kept for its reasoning)

**Placement is energy-blind and always has been.** Probed 2026-08-13: across a
fortnight with *identical time occupancy every day*, a 20h project put **960 of
its 1200 minutes on the four mentally heaviest days**, tripling their dip from
−4.0 to −12.0, while ten mentally-free days took 240m between them. `balance`
counts minutes, so a day holding two hours of the hardest work you do reads as
83% empty.

Build it **inside step 5's day choice**, not as a scoring weight — same
containment argument as §4.5, and D-1 in that doc explains why the general weight
should wait until this has been lived with. It must be **comparative only**: rank
days against each other, never against a capacity, because `learnedCapacity()`
returns `null` until calibrated and a placement rule keyed to a ceiling would act
on a number the app has not earned.

### Step 2 — record planned-vs-actual per sitting (`WEEKLY-PLANNING` §4.6)

Additive fields, both halves of the serialiser, `occurrenceData` for recurring
sessions. Independent of the margin feature it eventually feeds, and the cost of
delay is permanent — unrecorded weeks cannot be reconstructed.

### Step 3 — the surfaces

Cabana card on the `Drill` idiom (tags offered from the existing set, never free
text — §4.6's transfer is string-exact), the Sunday ritual with preview, the wrap
line. Every decision on these is answered.

### Step 4 — day notes, the visible half (`DAY-NOTES` §9 steps 2–4)

Header line + day list, then **blocked days as a model change**: a `blockedDays`
collection subtracted in `computeWindows`, so the autoscheduler stays out while
your hand and What-To-Do stay free (D-6, rewritten — its original reason was
false as built). **Remember ripple's plain-shift branch**, which bypasses
`placeTask` and was caught by exactly this once before with zones.

### Step 5 — `<WindowRow>` extraction, then zone frequencies

COMB D-7 decided EXTRACT because DATES D-5 gives zones the monthly/ordinal/yearly
vocabulary. The extraction is a **prerequisite** of the zone work, not a
speculative refactor — do it before `RecurrenceEditor` is rewritten a third time.

### Step 6 — retention (COMB D-8, table corrected)

Keep rated `occurrenceData` and all `dismissed`; prune unrated occurrence rows
and `snapshots` at 12 months. `history` needs no policy — it is four integers per
task. **Must land with or after step 0**, never before: today the prune would
delete training data nothing is reading yet, so nothing would notice.

### Still needs your eyes, not an agent

- **`design/session7-mockups.html`** — PLAN D-4 chunk grouping, EDITOR D-2
  bucket-row sparkline (its §10 objection was struck as wrong — judge it on
  legibility at 20px), EDITOR D-5 scalloped frame.
- **The desktop day view.** You said it isn't good and were sending a screenshot;
  removing it reverses locked Layout B+C, so it stays parked. Phone keeps its day
  view regardless.
- **Whether five whole evenings is acceptable** for a 20h project. Only your
  ratings can settle it, and step 0 is what makes those ratings count.
- **Touch drag on a real phone**, **PWA install/offline**, **export → Google**.

---

## Session 7's todo — kept for its reasoning, superseded by the order above

**Branch `worktree-spec-signoff-session7`, pushed, NOT merged.** `main`
auto-deploys on push, so merging is a release — the user's call, not yours.

The design is decided and written down: **`WEEKLY-PLANNING` §4.1.1** has the
algorithm, §4.5 has the placement finding behind it, and
`design/SESSION-SPLITTING.md` has the seven candidates plus what two independent
evaluations found. **Read §4.1.1 before building anything here** — do not
reconstruct the design from the candidate list, six of the seven lost.

### Step 0 — three small fixes, no design risk, all provable by probe

1. **`resizeChunk` never clamps to `chunking.maxChunk`** (`projects.js:114`) — a
   user can silently exceed their own stated maximum sitting. One line + a test.
2. **Wire `dayFill`** in `Schedule#_snapshotEnergy` (~7 lines), the way `energyAt`
   already is. **Not** as an intensity cap — that was tried and refuted (§4.5) —
   but because every week without it is training data that cannot be
   reconstructed afterwards. `_dayFillAtCompletion` currently has one repo hit,
   is not a `Task` field and is not serialised, so this is more than flipping a
   flag.
3. **Gate the duration buckets** in `learning.js`. The per-column gate at
   `:131–139` already exists and is applied to an empty set (`:90`), so
   unobserved buckets sit at exactly `+0.000` and a **never-tried sitting length
   outranks a tried-and-hated one** (−0.365 vs +0.000). Do it before ratings
   accumulate; the trap only fires once the model trains.

### Step 1 — the generation engine (`WEEKLY-PLANNING` step 1)

Candidate 5 sizing + the spread rule, per §4.1.1. **Testable with no UI at all**,
and it is where the design will be found wrong if it is. Do this alone and prove
it by probe before any surface is built.

### Step 2 — the surfaces (`WEEKLY-PLANNING` steps 2–4)

Cabana card on the `Drill` idiom, the Sunday ritual with preview, the wrap line.
Every open decision on these is now answered — see the decision table below.

### Deferred deliberately

A general **`spread` weight in `scoring.js`**. §4.5 found that nothing spreads
work past three days, but the effect is largely *latent*: the default search
window is `maxPlacementLookahead = 3` days, so ordinary tasks rarely see it, and
§4.1.1 sidesteps it entirely by assigning days at generation time. A scoring-level
fix changes how **everything** is placed and should not ride along with a feature.

### Needs the user, not an agent

- **`design/session7-mockups.html`** (gitignored, also copied to the main
  checkout) — PLAN D-4 chunk grouping, EDITOR D-2 bucket-row sparkline, EDITOR
  D-5 scalloped frame. All three are judged by eye.
- **The desktop day view.** The user says it isn't good and is sending a
  screenshot. Removing it would reverse locked Layout B+C, so it is parked. Phone
  keeps its day view regardless.
- **Whether five whole evenings is acceptable** for a 20h project. No analysis can
  settle it; only their ratings can, and it is the one place both evaluations
  agree learning genuinely belongs.

## Session 8 — the review: four decisions were right for reasons that were not

**2026-08-13.** The specs were read end to end and their *claims* probed rather
than their conclusions argued with. Full record: the session-8 addendum in
`design/SPEC-COMB-2026-08.md`. Headlines:

- **A rating on a recurring session reaches nothing that learns.** `retrain()`
  and `energyCalibration()` walk `schedule.tasks`; occurrences live only in
  `occurrenceData` and are materialized fresh on every read. **12 rated sessions
  → sampleCount 0.** For a user whose week is gym, classes and a standing
  commitment, most of their rated life trains nothing — and it fails closed and
  silently, so `w.preference` is simply always 0 and the energy card is stuck
  "still learning" forever. The wrap report and the detectors read occurrence
  data correctly, which is precisely what hid it. → `RATINGS-AND-LEARNING.md`.
- **The `spread` scoring weight was built and measured, and rejected.** It halves
  the heaviest day but **lengthens the consecutive streak** — the same trap as
  shortening sittings, reached from the other side — and drifts ordinary
  deadlined work later for no benefit. The scorer cannot tell five chunks of one
  project from five unrelated tasks, and the right answer differs. Spreading
  belongs at generation time. → `WEEKLY-PLANNING` §4.5.
- **`WEEKLY-PLANNING` §4.1.1's "EQUALISE — do not skip this line" was wrong** and
  is withdrawn. It destroyed the placeability property that won candidate 5:
  A = 5h over gaps of 4h/1h/1h equalises to two 2h30 sittings, the second on a
  day whose longest run is an hour.
- **"Tasks can still be scheduled on a blocked day" was false as built** — the
  blocker spans the whole day window and a manual drop is rejected. D-6's
  decision survives, but as a *model* change: blocked means the autoscheduler
  stays out, not that you may not go there.
- **`history` does not grow.** Four integers per task. It has been on the
  retention list since session 2 and never belonged there; the rated rows that
  actually need protecting are in `occurrenceData`, which the first version of
  D-8 pruned.
- **The zone-outside-`config.windows` warning is deleted, not built** — SPEC
  §2.1's amendment superseded it and a re-probe places the 06:00 gym inside its
  zone, unflagged.

**The method lesson, sharpening session 6's.** That comb found docs lying about
what was *built*. This one found something subtler: the conclusions were mostly
right, but four rested on premises nobody had run. **A right answer with a wrong
reason survives review — and then someone builds from the reason.** Probe the
premise, not just the conclusion.

**And the suite still cannot see any of it.** 573 tests pass with the rejected
`spread` change and 573 pass without it, while every deadlined task with a runway
over three days moves. Placement quality has to be proven by printing
placements. That is now three sessions in a row.

### Shipped this session (engine, not just spec)

- **`config.windows` widened to 23:00.** The 18:00 weekday end meant the
  scheduler could not see the evening at all, while the real week it schedules
  for did most of its studying 20:00–24:00.
- **`config.sleep.minHoursBeforeNextDay` (default 8).** Nothing may be
  *automatically* placed so late that it leaves under 8 hours before the next
  day's first commitment. Clips the window rather than scoring, because it is
  physics; recurrence-aware; clips zones too; exempt from the user's own hand.
  **It rarely fires as configured** — with a 23:00 window it only bites when
  tomorrow starts before 07:00. That asymmetry is deliberate.
- **581 tests green**, 8 of them new. Four pre-existing tests tracked the old
  window rather than the engine and were fixed at the level each meant to test —
  including the urgency-sort test, which now pins its own 08:00–18:00 week
  because fifteen-hour days legitimately stopped its task being endangered.

### What changed on disk this session

| Doc | Change |
|---|---|
| `design/RATINGS-AND-LEARNING.md` | **NEW** — the ratings-plumbing bug, the one-door fix, what is recoverable (nothing) and why |
| `design/ENERGY-AWARE-PLACEMENT.md` | **NEW** — placement never reads the energy model; 80% of a project lands on the worst days. Why it is a legitimate scoring term where `spread` was not, and why it must compare rather than judge |
| `design/ENERGY-PLACEMENT-CANDIDATES.md` | **NEW** — five candidate equations, written so they could be evaluated rather than argued |
| `design/ENERGY-PLACEMENT-EVAL.md` | **NEW** — all five run, then the two owed tests, then the blind scenarios against two real weeks. Carries the decision trail and the numbers |
| `design/ENERGY-PLACEMENT-C6-FORWARD.md` | **NEW** — the forward-looking candidate, written and rejected the same day: `C3 + C6` is identically `C1` |
| `design/probes/` | **NEW** — 13 probes + a README. Kept (unlike session 7's) because several carry re-runnable fixtures, including two anonymised real weeks |
| `design/WEEKLY-PLANNING.md` | §4.1.1 step 4 withdrawn · §4.1.2 ordering **new** · §4.5 rejects the spread weight on evidence · §4.6 the duration margin **new** · restores the eaten `## 5` header |
| `design/DAY-NOTES.md` | D-6 rewritten (model change, not rendering) · D-8 gains the `spanDays` validation + overlap rules |
| `design/SPEC-COMB-2026-08.md` | D-8 retention table rewritten against real fields · session-8 addendum |
| `design/USE-CASE-RUN-2026-08.md` | the zone warning marked superseded, with the re-probe |
| `design/EDITOR-REDESIGN.md` | D-2's §10 objection struck as inapplicable |
| four spec files | stray `</content>` / `</invoke>` tags removed |

**Engine untouched.** One experimental change to `placement.js` was made,
measured and reverted; the evidence is commit `dc75ab5` and `probe-horizon.mjs`.

## Session 7 — how work splits into sittings, and the placer that undoes it

Branch `worktree-spec-signoff-session7`, not merged. Read in this order:
`design/SESSION-SPLITTING.md` (seven candidate equations + what the evaluations
found), then `SESSION-SPLITTING-EVAL-ENGINE.md` and `-EVAL-LIVED.md` (~49KB each,
independent, they could not see each other).

**⚠️ The headline: the splitting question was aimed at the wrong variable, and
both evaluations found this independently.** Neither `n` nor sitting length is
where burnout lives.

- **Nothing in `scoring.js` spreads work over a runway longer than 3 days.**
  `proximity` is normalised by `maxPlacementLookahead = 3` so it is identically
  zero past day 3, and `buffer` saturates at 1.000 for 12 of 15 days. Past day 3
  only `balance` discriminates and ties break earliest. **20h due in 14 days
  places as 8h Mon + 8h Tue + 4h Wed, eleven days untouched** — and 12h on Monday
  if you widen `config.windows` as this handoff tells you to.
- **The burnout mechanism is CLUSTERING, and no candidate looked at it.** 5 × 4h
  lands on five consecutive evenings; candidates that shorten the sitting to fix
  that produce **nine** consecutive evenings. Shortening makes the streak longer.

**So the sizing question is settled and the real work is elsewhere.** Both
first choices contain **candidate 5** (greedy fit over the week's real gaps —
the only one that outputs *days*, so the placer cannot undo it; ~60 lines, no new
solver, uses `placeTask({from: day, to: day})` from DATES-P1). The open piece is
a **spreading term in `scoring.js`** — or making `proximity`'s horizon the runway
rather than a fixed 3 days. It applies to every deadlined task and should ship
independently, exactly as `buffer` did.

**Candidate 3 (fatigue curve) is rejected by both** — identical output in every
extreme, and `waste(s)` would have the app assert you had been unproductive.

**The ML picture, which is worse than it looked.** Unobserved duration buckets sit
at exactly `+0.000`, so a never-tried sitting length **outranks a tried-and-hated
one** (−0.365 vs +0.000). A short-only scheduler still reports "your best sittings
are 2h" after 400 ratings. The fix is the per-column gate already built at
`learning.js:131–139` and applied to an empty set. **Unresolved disagreement:**
whether the learned duration curve is stable enough to set a plan — engine says
yes (recovers the peak from 19 noisy ratings), lived says the same project comes
out as 5, 7 or 10 sittings depending which ratings you have, *even at 60*. Safe
reading: learning never silently changes the plan; it earns a Cabana line and a
one-time offer to raise `s_max`.

**`dayFill` — do this soon regardless.** It is hardcoded `0` in `featureVector`
and deader than documented (`_dayFillAtCompletion`: one repo hit, not a `Task`
field, not serialised). Wiring is ~7 lines in `_snapshotEnergy`. Every week
without it is training data that cannot be reconstructed. But **do not use it as
an intensity cap** — its learned weight flips sign four times and yields no level.

**Two incidental defects, neither fixed:** `resizeChunk` never clamps to
`chunking.maxChunk` (`projects.js:114`), so a user can silently exceed their own
stated maximum sitting; and `config.js`'s weights comment described the
superseded buffer rule (fixed here).

## Session 6 — specs written this session (read before building)

| Doc | State |
|---|---|
| `design/DATES-AND-RECURRENCE.md` | **BUILT** — P1–P4, every day, several times a day, occurrence identity |
| `design/DAY-NOTES.md` | **model + .ics import BUILT**; Cabana card, day-header line, export are steps 2–4. Ask packs and the optional year are specced, unbuilt |
| `design/WEEKLY-PLANNING.md` | step 0 (`buffer` weight) BUILT; repeating projects + Sunday ritual still spec |
| `design/SPEC-PHASE-2026-08.md` | what is still spec, verified against code — start here |
| `design/SPEC-COMB-2026-08.md` | spec-vs-code audit; D-7 (shared window-row) still open |
| `design/USE-CASE-RUN-2026-08.md` | 73 use cases from six blind sources, run by probe |
| `design/day-notes-mockup.html` | Cabana mockup: packs, ask packs, paste, per-source toggles |

## Session 6 — you can put an event on a DATE

Spec: `design/DATES-AND-RECURRENCE.md`. Audit: `design/SPEC-COMB-2026-08.md`.

- **P1 — "When" is a date, not a weekday.** The Add-task panel resolved a
  weekday `<select>` against the *viewed* week, so "Orientation, 3 September"
  could not be added from an August view. Now: a **fixed** task takes a date and
  a time; a **flexible** one shows nothing until you tick **"pick a date"**, and
  is then placed *on that day* (`from === to` bounds the scored search to one
  day) with the time **optional** — blank means "that day, you choose when".
  A repeating task shows the date as **"Starts"**. A readback names the weekday
  and distance ("Thursday · 7 weeks ahead"); the toast names the day and offers
  **Go there** when it lands off-week. `＋ more options` holds the wider
  placement range, collapsed.
- **P2 — monthly, ordinal weekday, yearly.** A period gains an optional `freq`
  (absent = weekly, so old saves are untouched and still serialize with no
  `freq` key). Windows are `{monthDay}`, `{day,nth}` (`nth: -1` = last) or
  `{month,monthDay}`. **A month without the requested day is SKIPPED, never
  clamped** — hence separate always-fire "last day" / "last Tuesday" options.
- **P3 — `.ics` stops losing your repeats.** `FREQ=MONTHLY`/`YEARLY` read and
  written, RFC's `-1` mapped both ways, and anything still unreadable is
  **reported** via `importEvents(...).dropped` instead of vanishing.

**The repeat control is two levels:** `every day · every weekday · every week · every month ·
every year · other…`, with the detail folded inside the branch you pick. Options
are **generated from the chosen date as finished sentences** ("on the first
Tuesday"), never a by-date/by-position mode picker — the user rejected that as
confusing and was right. A **live preview runs the real engine** and shows four
real dates plus any months skipped.

### ⚠️ The lesson of this session — verify a panel by RENDERING it

Three P1 defects shipped past **484 green tests**: the whole "When" block
vanished when Repeats was on (reading as "never built"), a flexible task's date
control only chose the *week* while claiming a day, and the label rendered as
**"Whenpick a time"**. Behaviour tests cannot see a missing field, a
run-together label, or a control that lies about its own effect.

**So: dump what the panel actually renders, in every state, before believing
it.** A throwaway jsdom test that walks the panel and prints each label/input is
enough, and it is how all three were found. Same for the engine: `freq` was
being **silently dropped by both `reviveRecurrence` and `recurrenceToJSON`**
(they rebuild periods from a field whitelist), so monthly patterns expanded as
weekly with no error — found by probe, invisible to tests. **Any new period
field must be added to BOTH.**

---

## The design specs — read in this order

`SPEC.md`, `FRONTEND-SPEC.md` and `design/UI-CONTROL-MAP.md` are the standing
contract. The Activity Library / energy line of work is specified across five
docs in `design/`, and **they are a stack of corrections — later docs overrule
earlier ones**:

1. `design/ACTIVITY-LIBRARY.md` (s4, 07-16) — buckets, activities, steered
   what-to-do. ⚠ partly superseded (banner at top).
2. `design/ENERGY-MODEL.md` (s4, 07-17) — the four-axis load basis. ⚠ partly
   superseded (banner at top).
3. `design/ROUTINES.md` (s4, 07-17) — routines, passive waits, travel. Unbuilt.
4. **`design/RECONCILIATION.md` (s4, 07-17)** — corrects 1 and 2. The forks in
   it are RESOLVED. Start here for the model.
5. **`design/EDITOR-REDESIGN.md` (s5, 07-18)** — the current build spec: one
   drill-in idiom, the form vocabulary, the wave `<EnergyControl>`, and the
   **P0–P5 phased plan**. Build is *gated on sign-off*; D-1…D-5 are still open.

All of it is on `main` and built. `EDITOR-REDESIGN.md` carries the authoritative
phase table at the top — **P0–P5 are closed, P4 cancelled** — plus §7.1 (filter /
sort / pages), §7.2 (paste dedupe + cross-bucket headings), §7.3 (the 15-minute
floor decision), §8 (retire) and §9.1 (the card tint).

---

## ⚠️ READ THIS FIRST

### The model was reconciled in session 4; session 5 respec'd the editors and reversed the energy-authoring call.

Read `design/RECONCILIATION.md` (the corrected model) then
`design/EDITOR-REDESIGN.md` (the current build spec, P0–P5). The reading order
for all five design docs is in the section above.

**Where the build stands (all on `main`):**

- ✅ **Role rip-out.** `role` is gone from `Bucket.js`, `energy.js`, `index.js`,
  `Schedule.js`, `learning.js` (role×time / role×weekend removed,
  `MODEL_LAYOUT_VERSION` → 3), `suggest.js` (steering keys off load character)
  and `TagManager.jsx`. The only `role` left in `src/` is DOM/ARIA.
- ✅ **Unique ids** for Bucket/Activity/Zone (`_uniqueInColl` / `_dedupeIds`).
- ✅ **Energy gating** — `config.energy.calibrationWeeks` (default 3);
  `learnedCapacity()` returns `null` until calibrated; the card shows a "still
  learning" shape with **no ceiling and no over/under verdict**.
- ✅ **P0** — §4's CSS vocabulary and `Drill.jsx` (`DrillList` / `DrillEditor` /
  `DrillRow` / `Field`). The three editors went from **67 inline `style={{…}}`
  blocks to 3**, and those three are data-driven, which §4 allows.
- ✅ **P1/P2/P3** — the wave `<EnergyControl>` with §5.3's inherit/ghost mode,
  the Activities drill-in, Zones on the shared idiom.
- ✅ **P5** — `retireTag` has a control on bucket tag chips, distinct from
  "remove from bucket".
- ❌ **P4 cancelled** — no energy control on the task; see the box below.

**Lesson from this session:** P0 was recorded as complete when it was not — the
drill-in *navigation* had shipped and was mistaken for the whole phase. Verify
against `styles.css` and the components, not the commit messages. Relatedly, a
CSS-only refactor broke the energy control's layout in three ways (collapsed
track width, collided restore/spend labels, right-aligned axis names) while all
455 tests stayed green, because none of the *behaviour* changed. **Presentational
work needs eyes on it; the suite cannot see it.**

### ⛔ Session-5 decisions that OVERRULE the specs below — do not build the old way

1. **Energy is autocalculated from tags. There is NO energy control on the task
   UI.** The task page must not be crowded with dials. The live calculation is
   `energy.js#loadForTask`: every bucket sharing ≥1 tag with the task
   contributes, and per axis the *positive* contributions are averaged among
   themselves, the *negative* ones averaged among themselves, and the two means
   added — so spend and restore do **not** cancel before averaging.
2. **`<EnergyControl>` keeps two homes, not three:** the bucket editor and the
   activity editor (inherit mode). The activity's control is *correct* — only its
   presentation is outstanding (P2 above).

**This kills `EDITOR-REDESIGN.md` P4 and reverses `RECONCILIATION.md` P-1/P-2's
"energy is authored on the task, on the schedule."** Both docs carry a banner
saying so. Note `task.load` was never writable anyway — `load` is absent from
`UPDATE_WHITELIST` (`Schedule.js`), so `updateTask` silently drops it.

**That divergence is resolved.** `loadForTask` uses every matching bucket, and
`Schedule.bucketsForTask` now does the same, so a task's colour and its energy
derive from the same set (§9.1). `bucketForTask` (first match only) is still
there for older callers — prefer the plural. `dominantBucketForTask` is the
tiebreak when exactly one bucket must win.

### The original session-4 framing (kept for the reasoning)

Real use exposed that the activity / energy / bucket features accrued design debt
(a fix that wasn't generalised, a UI redesign applied to one editor not all, a
feature on the wrong object, fabricated energy numbers, a redundant `role` enum).
So this session shipped **no features** — it wrote a corrected model and a
consolidated fix/redesign plan. **Read `design/RECONCILIATION.md` first.** State:

- **Forks are RESOLVED.** `role` gets **ripped out of the model entirely** (a
  bucket's character IS its load vector — the enum was a redundant second
  description); the energy budget shows a *"still learning"* state until ~3 weeks
  of ratings calibrate capacity (no fabricated ceiling before that); bucket/task
  load defaults to **neutral 0, user-set**.
- **Task is the atom; Activity is a thin task template** (nothing a task lacks).
  ~~So energy becomes editable **on the task, on the schedule**; the
  per-activity energy override is wrong-object and gets removed.~~
  **↑ REVERSED in session 5 — see the decisions box above.** Energy is derived
  from tags; there is no task-level control, and the activity keeps its own.

**Build order — step 1 is DONE and merged** (PRs #1/#2/#4 are on `main`; the
cross-week `conflicts.js` double-book, `_occupiedExcluding`, the past-placement
floor, unique ids and the de-flake all shipped). What remains:

1. ~~`carryOver` double-books and places outside the target week~~ **FIXED** —
   the search window is now exactly the target week, because `to` is inclusive
   of its day and `occupied` only ever covered days 0–6.
2. ~~iCal `EXDATE`/`RECURRENCE-ID` wrong time~~ **FIXED** — `hhmmOf` uses the
   period *in force* on that date. `splitPeriod` makes `periods` non-chronological,
   so `periods[0]` was simply the oldest window.
3. ~~Finish the editor redesign~~ **DONE** — P0–P5 closed, P4 cancelled.

**Genuinely still open:**

- ~~`recurrence.js` drops an `add` exception on a day the pattern fills~~
  **FIXED 2026-08-11.** The occurrence key gained a suffix (§4.4): first session
  of a day keeps the bare `YYYY-MM-DD`, later ones get `#2`/`#3`, an extra
  session gets `#add`. The same limitation had also been silently dropping the
  second session of any **twice-a-day** pattern, so one fix bought both. Back
  compatibility verified against a real export: 15 occurrences, zero suffixed.
- ~~`time.js` isoWeek comment~~ **FIXED** — it gave two dates in the *same* week
  (2026-W53) as examples of different ISO years. The function was always right.
- **SPEC §4.3's shared window-row component does not exist** — `ZonesEditor`
  never imports `RecurrenceEditor`, so the weekday affordance exists twice. The
  spec now says NOT TRUE AS BUILT. Extract it or drop the claim (D-7); it is
  worth settling because P2 has already touched that component once.
- **SPEC §10 keyboard drag/resize is not built** (an accessibility gap), and
  there is still **no retention policy** for `history` / `occurrenceData` /
  `snapshots` / `dismissed`.
- **Product call:** project management — build a surface for the chunk ops
  (`growChunk`/`shrinkChunk`/`resizeChunk`/`deleteChunk`/`finishProject`/
  `redistribute`, all unreachable from the UI), or leave them internal.
- **Parked, now unblocked:** activity time-of-day preference, to be learned from
  where instances actually get placed. It was blocked on knowing which task came
  from which activity; `Task.activityId` (§7.1) supplies exactly that.
- **Never run:** verify touch drag on a real phone (`npm run dev -- --host`, or
  the Pages site).

**Same lesson as session 2, reinforced:** every HIGH bug this session found is in
code the green suite "covers." The cross-week double-books are *proven* by probe
yet no test caught them. Drive the real app on real data; don't trust green.

---

**Wrap report (§7.1 / R-7) and Responsive (§11) are DONE. The date-flaky tests
are FIXED and ripple now honours zones (session 3).** Still unrun: **verify touch
drag on a real phone**, and drive a ripple near the work zone.

**✅ The 11 date-flaky UI tests are fixed (session 3).** `tests/ui-drag.test.jsx`
and `tests/ui-bulk.test.jsx` seeded with `new Date()` and hardcoded weekday
columns ("Read novel → Wed col 2"). A fresh flexible's placement origin is "now",
so proximity lands the seed's flexibles on now's own weekday (Mon→col0, Tue→col1,
Wed→col2). The columns assume **Wednesday** (also the day the seed skips the gym,
freeing Wed morning) — so the suite was red Thu–Sun, green only mid-week. Both
files now `vi.setSystemTime` a fixed **Wednesday** (2026-07-15) before the seed,
faking only `Date` so async timers live. **Note: this handoff previously advised
a fixed *Monday* — that's wrong, Monday lands Read novel on col0.** `test:run` is
now trustworthy every day (299 → 308 with new tests, green on a Thursday).

**Never trust an agent's "it passes" — run it yourself.** Every background agent
in session 1 reported green: one genuinely was, one was 11 tests red mid-flight,
and one silently broke 34 that it never ran. `npm run build && npm run test:run
&& npx eslint src` before you believe anything, and **commit by explicit path**
(`git add src/… tests/…`), never `git add -A` — see the privacy note below.

**Session 2's lesson: the user found four bugs by USING it that a green suite
never would.** The report shipped tested and passing, then real use turned up: a
break scheduled into Monday, a 2-shell rating that read as 5, lunch recurring
back through all of history, and work-zone bands painted in weeks the zone
didn't run. Every one was in code the tests "covered". **Drive the actual app on
real data before believing a feature is done** — and note that three of the four
were the UI disagreeing with an engine that was right all along.

---

## State

| Piece | Status |
|---|---|
| **Phase 1 engine** (`src/core`) | ✅ Done. Pure JS, zero DOM imports (lint-enforced). |
| **Phase 2 M1** (shell/panels/Cabana) | ✅ Done. |
| **M2.1** (drag, resize, ripple⟺displace chooser) | ✅ Done. |
| **M2.2** (Clear Day, gap toast, occurrence menu, overpack notice) | ✅ Done. |
| **Calendar interchange** (`.ics` + Google) | ✅ `.ics` done & tested. Google import **works** (proven against the real account). **Export → Google NEVER RUN.** |
| **Wrap-report PDF** (§7.1 / R-7) | ✅ **Done.** Printed and checked by the user. All 5 detectors surfaced (their only home). No page budget — see Decisions. |
| **Week rollover** (R-7) | ✅ Done. Retrains + offers the report. Deliberately does **not** carryOver — see Decisions. |
| **Responsive** (§11) | ✅ Built, tests green. ⚠️ **Touch drag UNVERIFIED on a real device** — see below. Phone <768 (day + picker), tablet 768–1279 (Mon–Fri + weekend drawer), desktop ≥1280. |
| Sprites | ✅ segmented; only **3 of 57** wired, deliberately. Scenes raw. |

**Docs:** `SPEC.md` (engine, authoritative) · `USE-CASE-ANALYSIS.md` (decision
record, arbitrates — 75KB, **grep it, never read it whole**) · `FRONTEND-SPEC.md`
(art) · `design/UI-CONTROL-MAP.md` (every use case → its control).

---

## Where the work is — all of it is on `main` (as of 2026-08-11)

**`main` is the only branch, local and remote.** Everything ever built here is
an ancestor of it. The old branches and their worktrees were removed in session
6 after each was verified fully merged; their tips are listed at the top of this
file if one ever needs recreating.

**Start new work from `main`.** Note that `main` auto-deploys to Pages on push
(`.github/workflows/deploy.yml`, gated on `npm run test:run`), so a push is a
release — branch for anything you don't want live.

**Commit by explicit path, never `git add -A`.** The repo is public and
`design/import/` + `*.ics` hold a real person's schedule. The activity library
itself is user data in `localStorage`, not in the repo — keep it that way.

## PENDING (pre-reconciliation): verify touch drag on a real phone

**Responsive (§11) is built and tested** — phone <768 (day view + `DayPicker`
strip), tablet 768–1279 (`WeekGrid days={[0..4]}` + `WeekendDrawer`), desktop
≥1280 unchanged. `useViewport` is the single breakpoint source; CSS and JS share
its numbers (767/1279).

**But the touch-drag gate is UNVERIFIED on a real device**, exactly like the
print check was before the user ran it — and the print check found a real bug.
jsdom has no touch and no layout, so the tests prove the *logic* (hold arms the
drag, moving first scrolls instead, `pointercancel` abandons it, mouse still
picks up instantly) and nothing about the *feel*. Two specific risks:
- **`LONG_PRESS_MS = 450`** may feel slow or fast (`useCardInteraction.js`).
- **`touch-action: manipulation` + a non-passive `touchmove` `preventDefault`**
  is the standard "hold to drag, otherwise scroll" pattern, but browsers differ
  on when they commit to a scroll. If a drag still scrolls the day, that's where.

To test: `npm run dev -- --host`, open from a phone on the same network, try
dragging a card (hold ~½s first) and scrolling the day (just swipe). Sharp
edges #5/#6 still apply.

### Then, roughly in order
1. **✅ §2.2 precedence — DONE (session 3).** The old claim that "displace and
   carryOver don't inherit zones/deadlines" was **stale**: displace, carryOver,
   autoSchedule and ripple-*overflow* all route through `placeTask`, which is
   zone- and deadline-aware (proven by probe, not read). The one real leak was
   ripple's plain-*shift* branch — pure arithmetic that could slide a non-work
   flexible into an exclusive zone silently. Fixed: it now treats "enters a
   forbidden exclusive zone" like a broken deadline and hands the task to
   `placeTask`. Decision locked (per the user): **automatic re-optimizing carries
   the guarantee; a manual drag/drop keeps its autonomy** (R-1 — a person may
   drop a non-work task into the work zone and it stays). SPEC §2.2 + the
   USE-CASE-ANALYSIS 2D-precedence note now say who the rule binds. Regression
   tests lock displace/carryOver/ripple + manual autonomy.
   **An adversarial sweep then caught a second, deeper leak (also fixed):**
   `computeWindows`'s *matching* branch never subtracted *other* overlapping
   exclusive zones, so a `work` task routed into the Work zone could be dropped
   inside an overlapping exclusive Study block (reachable in the real config —
   Work 09:00–18:30 and the seed Study zone Tue/Thu 18:00–21:00 overlap at
   18:00–18:30). Fixed in `placement.js` (exclusivity is symmetric). A third,
   *accepted* edge: when there's genuinely no non-zone time in the whole lookahead
   a no-deadline task parks inside the zone with a warning — the §2.2
   "visible beats invisible" last resort, left as-is. See the 2D-precedence note.
2. **`history`/`occurrenceData` grow forever.** No retention policy → the
   starvation detector eventually becomes a permanent nag (a P-1 violation) and
   localStorage exhaustion is the designed end state. `_snapshots` and
   `_dismissed` (both new, both persisted) now grow forever too — same policy
   should cover all four.
3. **Keyboard drag/resize** (§10: Space/arrows/Enter, Shift+↑↓, Alt+↑↓) — never
   built. The app is mouse-only.
4. **Zones don't share the recurrence editor.** SPEC §4.3 claims "one shared
   window-row component… used by zones and recurrence". **They don't** — the
   Cabana has its own `.zonewin` rows and never imports `RecurrenceEditor`. So
   the weekday affordance exists twice (`toWeekdayWindows` in the editor, an
   "＋ every weekday" button in the Cabana). Extract the row for real, or delete
   the claim from the spec.
5. **Art** — scenes (`src/assets/scenes/`) still need the film-border crop + the
   Gemini watermark inpaint (the sparkle on the cabana's chest); the Cabana page
   doesn't use its interior. 8 sprites predate the green sheet and look different
   (`key, ring, sun-face, hammock, whistle`, `frame-square`, `input-rounded-2/3`).
   The Wrap report deliberately uses **no** sprites (type + existing SVG only).
6. **PWA** — manifest + SW scaffolded, install/offline never verified.
7. **Export → Google still never run.** Unchanged from session 1.

---

## The user's real setup (this is a real person's schedule now)

- **Personal Gmail** (a school account risks admin-blocked OAuth). Client ID is
  pre-filled in `CalendarCard.jsx` — public by design, origin-locked.
- Their calendars: `Class Schedule`, `Important Immovables`, `Imported from
  Sandy Cay` (the export target), Family, Birthdays, primary.
- **Summer job**: Work at Rockefeller, weekdays **09:00–18:30, ends Fri Jul 24**.
- **`design/import/` and `*.ics` are gitignored** — they hold a real schedule and
  other people's names, and this repo is public. **I nearly published it with
  `git add -A`; a guard stopped me.** Commit by explicit path here, always.

### Two things they still need to do
- **Work zone**: Cabana → Zones → `Work`, tag `work`, `Mon 09:00→18:30`, hit
  **＋ every weekday**, exclusive ✓, **runs → 2026-07-24**.
  ⚠️ **This date changed.** End dates are now **inclusive — the last day it
  runs** (was exclusive, "the day it stops", which said `2026-07-25`). See
  Sharp edges #11.
- **Widen `config.windows`** past 18:00 (default Mon–Fri is 08:00–18:00, so
  evenings don't exist for general work).
  ⚠️ **Narrowed 2026-08-13.** This used to be phrased as needed for the 18:30
  workday. It is **not** — SPEC §2.1's amendment means a zone defines the window
  for its own tags and is no longer clipped by `config.windows`, so the Work zone
  runs to 18:30 whether or not the day window does (re-probed: a 06:00–08:00 gym
  zone places at 06:00, unflagged). Widening still matters for every task that
  does **not** match a zone, which is most of them.

**Work is a ZONE, not a block** — this was a real modelling error, corrected. A
pinned 09:00–18:30 event *consumes* the day so nothing can be scheduled inside
it, including the work. Class is different (you attend it, you don't plan it), so
a block is honest there.

---

## Sharp edges — read before touching the engine

1. **`rippleShift` requires the pivot's ORIGINAL end.** Call it after mutating
   the pivot and the task you grew over drops out of the chain entirely.
   `interaction.js#commitRipple` honours this. Worth hardening someday.
2. **Break absorption cascades** — don't "simplify" it back to pooling the
   chain's slack; that was the bug (the head can only borrow from the first gap).
3. **Building an occupied set? Use `placement.recurrenceIntervals()`.** Filtering
   `!t.recurrence` drops the *parent* (right) but also its **occurrences**, which
   are `fixed` anchors — four functions did this and scheduled straight through a
   pinned gym.
4. **`<input type="date">` → use the engine's `dateFromKey()`.**
   `new Date('2026-07-20')` is **UTC midnight** → deadlines land a day early.
5. **The grid is a 5am-anchored 24h day.** `gridBounds()` = rows **5→29**; a
   02:00 task belongs to the *previous* night's column at row 26. Use
   `gridHour()` / `gridDayOf()` — never raw `getHours()`/`sameDay` on a start.
6. **z-index on a positioned element makes a stacking context.** `.topbar` is
   `--z-topbar` (8) *above* the sticky headers (5) on purpose — tie them and an
   open dropdown paints underneath.
7. **`src/core` must not import UI** (lint-enforced). Storage touches globals
   only via guarded `typeof`.
8. **Tests inject fixed dates.** Never let the engine read the wall clock.
9. **Don't read `design/layout-*.html`** (~330KB base64 fonts) — it killed a
   subagent.
10. **The app ships with NO TASKS, but WITH starter buckets.** `seed()` is a
    **test fixture**; UI tests hand it to `<App/>` via
    `localStorage.setItem(STORAGE_KEY, …)`. Don't reintroduce demo tasks on
    first run — that rule stands, and it is about *content*: a showroom week you
    must clear out before your own life fits.
    **Amended 2026-08-11:** a new schedule now seeds `STARTER_BUCKETS` (via the
    existing idempotent `seedStarterBuckets`, which no-ops the moment any bucket
    exists). Buckets are *vocabulary*, not content — no tasks, no times, nothing
    to delete — and **without them the energy model is inert**: `loadForTask`
    returns all zeros, so the battery, deepest-dip, reserve-aware suggestions and
    card tints silently do nothing. A real user was found in exactly that state
    after weeks of use: 16 tags, 0 buckets, no sign the feature existed. The set
    also now **ships load values**, reversing "load defaults to neutral (0)" —
    because a neutral bucket computes to zero and so seeding one never switched
    anything on. This does **not** breach P-2: what P-2 forbids inventing is
    *capacity* (what you can handle), which is still learned and still `null`
    until calibrated.
11. **Ranges are HALF-OPEN inside, INCLUSIVE at every edge.** `effectiveFrom` is
    inclusive, `effectiveUntil` is **exclusive** — and must stay so:
    `splitPeriod` ends the old period exactly where the new one begins
    (`until === from`), so periods tile with no gap or overlap. Make the core
    inclusive and every seam grows a ±1-day fudge. Users and RFC 5545 mean the
    opposite ("ends Friday the 24th"), so **`time.js#lastRunDay` /
    `untilAfterLastRun` convert at the boundary — and every edge must use them**
    (recurrence editor, zone editor, `.ics` in *and* out). `toRRULE` handed
    Google the raw exclusive bound for months: an extra day of work, every export.
12. **Setting `startTime` opts a new task OUT of placement.** `addFixed`/
    `addFlexible` only place `if (!data.startTime)`. Pre-computing a slot and
    passing it *looks* helpful and silently bypasses scored placement (7A) — this
    is how "add a break" landed on Monday. **Pass `durationMin` instead**: it
    sets the span without pinning a start.
13. **`findFreeSlot` is UNSCORED** — it returns the first gap after `from`, not
    the best one. Fine for "show me openings" (Find Times), wrong for placing.
    `findBestSlot`/`placeTask` are the scored path.
14. **The engine knows about bounded zones; the UI has to be told.** Placement
    checks `zone.activeOn(date)`, but the grid's `zoneBands` took no date and
    painted every zone into every week — showing reserved time in weeks the
    scheduler correctly saw as free. `WeekGrid` and `DayView` each have their own
    band walk; both now check `activeOn`. **A third copy will drift.**
15. **New `Schedule` state is additive, `schemaVersion` stays 1.** `snapshots`,
    `lastSeenWeek`, `dismissed` all persist; absent keys load clean, so old saves
    are fine. `useEngine#replace` (footlocker import) must copy them too — it
    silently dropped them once already.
16. **Cards are `touch-action: manipulation`, drag arms on a long-press.** It was
    `none`, which made a card swallow every touch gesture — so on a phone (where
    the grid is mostly cards) scrolling the day was impossible and any swipe flung
    a task (the 4px mouse threshold is nothing to a finger). Now: hold ~450ms to
    pick up (`LONG_PRESS_MS`), else the browser scrolls. Once a drag is live a
    **non-passive `touchmove` `preventDefault`** stops the scroll — vertical drag
    IS how you change a time, so a passive listener would lose the gesture. Don't
    revert `touch-action` to `none`.
17. **`[data-dropzone]` is global; a hidden drawer must be truly inert.** The drag
    code finds columns by querying the whole document. The tablet weekend drawer
    is a real `<WeekGrid days={[5,6]}>`, so when CLOSED it must carry `inert` +
    `pointer-events:none` + `visibility:hidden`, or its Sat/Sun columns sit behind
    Friday silently eating drops near the right edge. Same UI-vs-engine shape as
    #14. **The drawer renders a real grid, never a lookalike** — reimplementing
    those columns drifts from the drop-geometry contract and mis-places drops.

---

## Decisions locked (don't relitigate)

- **Layout B+C**: week grid + a contextual right panel **closed by default**; day
  headers open a day view with ✕; **Cabana is its own full page**.
- **Responsive is three layouts, not one grid squeezed** (§11): phone shows a
  single day (the *primary* mobile layout, per spec — not a fallback), tablet
  shows Mon–Fri with the weekend in a drawer, desktop shows the week. **The phone
  opens on TODAY**, and narrowing to phone width while on the week grid drops you
  into today's day; widening does *not* force the reverse (you asked for that
  day). ✕ is absent on phone — the day isn't a mode there, so there's no week
  behind it to return to; the `DayPicker` navigates, and its calendar button
  reaches the week overview.
- **Full-bleed**: the app fills the viewport (`min-height:0` on
  `.frame`/`.body`/`.main` is load-bearing, not decoration).
- **P-1 everywhere**: coral/`--warning` is for scheduling **physics** only, never
  moral bookkeeping. Insights live in the report/Cabana; the grid stays quiet
  (the overpack notice is the single exception).
- **Rating facets are tri-state** (`-1|0|1`), cycling `=` → `↑` → `↓`. A
  checkbox threw away half the model's signal.
- **Only 3 sprites wired** (crab/shell/cabana). Badges render at ~11px where art
  turns to mud and SVG is clearer. **Don't bulk-wire the rest.**
- **Neither calendar path syncs.** A push sends, a pull reads, nothing
  reconciles. Export **replaces** the target week (safe only against a dedicated
  calendar). Tags come from a `#hashtag`, `CATEGORIES`, or the source calendar's
  name — calendars have no tags.
- **Google scopes**: `calendar.readonly` + `calendar.events`. Deliberately *not*
  blanket `auth/calendar` — hence no `createCalendar`; the user points us at a
  calendar they made.
- **Rollover retrains and OFFERS — it never carries over.** R-7 reads as one
  "week closes" moment bundling retrain + carryOver + report, and this
  deliberately does **not** do the middle one: §3.6 already gives carryOver a
  consented home (the past-week banner's equal-weight *Carry forward / Let them
  go*), and relocating a real person's unfinished week while they were away is
  the surprise P-1 exists to prevent. Don't "fix" this back.
- **Rollover offers the last week LIVED, not literally last week.** Away three
  weeks → one offer, for the last week with data in it. A report on the fortnight
  you were on holiday is an empty page.
- **Detector answers are permanent** (`schedule.dismissed`, persisted). "Let it
  go" that only hid the card would re-raise the identical observation next
  Monday — nagging with extra steps.
- **Report length: no page budget** (SPEC §7.1, amended 2026-07-15; was ≤2).
  **It never truncates to fit paper.** The old rule had produced silent caps
  (top-8 tags, top-6 tag×time) that binned a busy week's quieter data. Editorial
  limits for *signal* (top-3 learned weights) are fine; caps for *space* are not.
- **Shell ratings always print their numeral.** Five glyphs with two tinted reads
  as "5" — it did, to the user, on the first print. Tint alone also violates §10
  (never meaning by colour alone) and dies on a greyscale printer.
- **"every weekday" is derived, not stored.** The Repeats dropdown reads the
  windows back (`isWeekdayPattern`); change one day's time and it honestly stops
  claiming to be a weekday pattern. No flag to fall out of sync.

---

## Audit passes — and the lesson

| Pass | Method | Hit rate |
|---|---|---|
| Blind #1 (`design/USE-CASES-BLIND.md`) | spec only | 3 of 5 real |
| Blind #2 (`design/USE-CASES-BLIND-2.md`) | spec only | 1 real, 1 false |
| **Code audit** | read the code, ran probes | **6 of 6 real, 5 proven** |

**Grounding the auditor in the implementation beat reasoning from the spec.**
Spec-only agents invent plausible bugs the code already guards. Run future audits
against the code, and make them prove findings by execution.

### Bugs fixed in session 2 (all with regression tests)
**All four were found by the user driving the real app, not by the suite.**
- **"Add a break" landed on Monday** (it was Wednesday). `AddTaskPanel`
  pre-computed a slot with the **unscored** `findFreeSlot({from: weekStart})` —
  the week's first gap, two days gone — and by setting `startTime` made
  `addFlexible` skip scored placement entirely. See sharp edges #12/#13.
- **`findBestSlot` could place in the past.** It only clamped a window's start
  when `from` fell *inside* it, so a window already behind `from` was walked from
  its own start: searching from 19:00 returned 08:00 that morning.
- **A 2-shell rating read as 5.** Data was always right; the report's empty
  shells were `--hair` (a sand tint) at full opacity, so all five shapes read as
  present, and nothing carried the value but colour.
- **Lunch recurred back through all of history.** `buildRecurrence` emitted
  `effectiveFrom: null`, and its "temporary" branch built a 4E-style *sandwich*
  (base period from forever + a second with identical windows) — meaningless for
  a *new* pattern, and it re-opened the unbounded past. Now one bounded period.
- **Zone bands painted in weeks the zone didn't run** — see sharp edge #14.
- **`toRRULE` claimed an extra day** on every export — see sharp edge #11.
- **Footlocker import dropped `snapshots`/`lastSeenWeek`** — see #15.
- **`format.js` had a second ISO-week implementation**, so the week sign could
  read "2027 · wk 53" instead of "2026 · wk 53". Now delegates to the engine's.

### Bugs fixed in session 1 (all with regression tests)
- **Displacement double-booked** — occupied set built once outside the loop;
  `intervalsOf` snapshots Date *objects* and `placeTask` assigns fresh ones.
- **Post-midnight resize made a 22-hour task** (my own regression from the 5am
  grid — calendar minutes vs grid minutes).
- **Work scheduled through a pinned gym** — see sharp edge #3.
- **Deadlines a day early** — see sharp edge #4.
- **Ratings wrote to the pattern** — Friday's gym overwrote Monday's, and
  `retrain()` saw one sample however many sessions were rated.
- **`autoSchedule` erased `placedBy:'user'`**, killing the stability weight.
- **`whatToDo` couldn't see the session you're in**; **re-optimize placed into
  the past**.
- **`rippleShift` pooled slack** → silent overlaps; **ripple ignored deadlines**.
- **Storage lied** — the dot stayed green while every save failed.
- **A diverged model poisoned every score** with NaN.
- **The grid only rendered 08–18**, so you couldn't drag to 02:00.
- **Exceptions couldn't relocate or add a session** — "skip today, do it
  tomorrow" and "one extra gym this week" were inexpressible. Added
  `move {toDate}` + `add`, both keeping `taskId@originalDate` so ML history
  follows the session.
- **A fixed task couldn't be given a time** — "Dentist, Friday 2pm" (7B's own
  example) auto-placed itself somewhere else.
