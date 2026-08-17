# Prompt for the next agent — Sandy Cay, session 9

Copy everything below the line into the next agent's first message.

---

You are continuing work on Sandy Cay, a scheduling app for one real person whose
term starts **Mon 31 Aug 2026**. They are the one who instructs you.

**Repo:** `C:\ACTIVE_Coding_Projects\tidepool-app`
**Work in:** the existing worktree `.claude/worktrees/proximity-horizon-probe`,
branch `worktree-spec-session8`. Run everything from there.
**Never merge or push to `main`** — it auto-deploys to Pages, so a merge is a
release and it is the user's call. 33 commits are local and unpushed; that is
fine and deliberate.

**Gates, every time:** `npm run test:run` (**860 green**), `npx eslint src`,
`npm run build`.

**A dev server may already be running on http://localhost:5175/sandy-cay/**
(5173 and 5174 are other worktrees — do not tell the user to use those).

---

## ⚠️ READ THIS PART TWICE. IT IS WHY THIS FILE EXISTS.

The previous agent (me) did good engine work and made **one repeated process
mistake**: I invented answers to questions I should have asked.

Twice I decided how the app should infer whether a routine step was "active" or
a "wait" — first a keyword list, then a grammar rule — and shipped both. The
user's reply was: *"Did I tell you to use verb tense? did you ask was it
specced"* and later *"who is in charge why didn't you ask this question"*.

Both times the answer was already in `design/ROUTINES.md` §UI ("add active / add
wait rows"), and both times I wrote the invention up in a commit message as
though the spec had said it. That is worse than the bug.

**The rules that follow from that:**

1. **When a design decision is not written down, ASK. One short question.** Do
   not pick "the sensible default" and mention it in passing. The user has
   corrected this three times in one session.
2. **Never describe your own invention as what the spec says.** If you are
   extending, say "this is not specced, here is what I propose."
3. **The user asked for less explanation, not more.** *"Don't overexplain. Wait
   for questions and ask questions."* Short reports. No re-litigating.
4. **They have overruled me and been right every time.** When they say the CSS
   is broken, or the button does nothing, or the model is wrong — it is. Go and
   reproduce it, do not explain why it should work.

## The standing rules that are load-bearing here

- **Prove it by execution.** Every serious defect in this repo lived in code the
  suite "covered". 860 green tests have missed: silent double-booking, sittings
  laid on top of a recurring gym, a disabled button that swallowed every click,
  and a CSS row that rendered as garbage. **Print what the thing actually does.**
  `design/probes/` holds 45 runnable probes; add to it.
- **A regression test that passes before the fix proves nothing.** Revert each
  fix and watch its own test fail. I caught two vacuous tests of my own that way
  this session, and one real bug my fix had introduced.
- **jsdom has no layout engine.** It cannot see a broken layout, ever. Anything
  visual goes to the user with a URL and a checklist.
- **Commit by explicit path, never `git add -A`** — `design/import/` and `*.ics`
  hold a real person's schedule and the repo is public.
- **`git reset --hard` and `git checkout <file>` are blocked/dangerous.** I lost
  an uncommitted fix to `git checkout` this session. Use forward commits.
- **Read `HANDOFF.md`'s "Sharp edges" list (~line 1298) before touching the
  engine.** Three of this session's bugs were re-introductions of #3 and #11.
- ⚠️ **Do not write `\n` inside a JS template string via a python/bash heredoc**
  — it becomes a real newline and breaks the file. I did this four times. Use
  the Edit tool for those.

---

## THE IMMEDIATE TASK — zoom the grid so short blocks are legible

The user's words: *"Can we make it so that if I zoom in on like a key pad it
extends the view so the hours have more pixels?"*

**Why it matters:** a routine touchpoint can be 2 minutes. At the current
34px/hour that is 1.1px, floored to 26px by `layoutDay` — so it is visible but
looks nearly as tall as an hour, which is its own lie. Zoom is the honest fix.

**The facts you need:**

| | |
|---|---|
| `src/ui/components/WeekGrid.jsx:11` | `const PXH = 34` |
| `src/ui/components/DayView.jsx:10` | `const PXH = 42` |
| `src/ui/layout.js` | already takes `pxh` as a PARAMETER — no change needed |
| `layout.js:110` | `Math.max(26, …)` — the floor that makes 2m visible-but-dishonest |

⚠️ **THE TRAP, and it is silent.** `useCardInteraction.js:64` reads
`pxh: Number(el.dataset.pxh)` from the day column **at pointer-down**, and uses
it for every drop calculation (`:85`, `:103`, `:804`). So:

- If PXH becomes state and `data-pxh` still emits the old constant, **every drag
  lands at the wrong time** and nothing will tell you.
- Both `WeekGrid` and `DayView` set `data-pxh`. Both must carry the live value.
- `WeekGrid` also uses `PXH` directly in `offWindowBands`, `zoneBands` and the
  new `waitBands` — all of them must take the live value, not the module const.

**Suggested shape (not specced — confirm with the user first):** a zoom level in
`App` state, passed down as a prop, persisted in `config` so it survives a
reload. Ask whether they want keyboard (`+`/`-`), pinch, a slider, or all three,
and whether zoom is per-view or shared between week and day.

**Prove it by:** printing the computed `top`/`height` for a 2-minute and a
60-minute block at two zoom levels, and checking a drop still lands on the
minute you dropped it at. That second one is the trap above.

---

## What is already built (this session, 33 commits)

**Standing commitments** — `2h/week` over a term, in the Cabana.
- `Commitment` (`src/core/Commitment.js`): `amountMinPerWeek`, term `from`/
  `until` as inclusive day keys, optional per-week `dueDay`, sitting min/max,
  `maxPerDay`. `engineInputForWeek(ws, now)` is the ONLY door to the engine.
- `commitmentWeek.js`: `previewWeek` / `planWeek` / `layOutWeek` / `owedThisWeek`
  — one implementation for all surfaces.
- `CommitmentsEditor.jsx` + "Lay out this week" with a confirm that names every
  block before writing.

**Routines** (`design/ROUTINES.md`) — R-A, R-B and most of R-C.
- `RoutineInstance.js` — the **frozen program** for one run, plus per-run tweaks.
- Touchpoint `Task`s carry `routineId` + `stepIndex` — the **placement**.
  ⚠️ That split is the user's decision: stored program, derived placement.
  Neither half alone works. Read the header of `RoutineInstance.js`.
- `routines.js` — `instantiateRoutine`, `reflowRoutine`, `suggestRoutineStart`,
  `routineWaits`.
- `RoutinesEditor.jsx` + `RoutineSteps.jsx` — the Cabana editor. **Two buttons
  side by side, `＋ timed step` and `＋ wait`; the kind is which one you pressed
  and is NEVER inferred from the label.** Do not add inference back.
- A **timed step is one time**; a **wait is a min and a max**. The min is
  PHYSICS (never place the next touchpoint earlier). The max is a PREFERENCE —
  **stated, never enforced**. Blank max = no ceiling.
- Wait bands render on the week grid (`.waitband`), `pointer-events: none`
  because a wait reserves nothing and the band must not eat the drop.

**Engine bugs fixed** (all found by probe agents, all mutation-tested): three
silent double-bookings, sittings laid on top of a recurring gym, step-5 pairing
sittings to days positionally, `maxPerDay > 1`, work placed in hours that had
already gone, and PLAN D-10 (R\* is a preference, not a wall — Sunday exists
again).

---

## Open, with work already done on it

**PROBE-B produced six verified diffs and ran the whole suite against them
(776/776 passed at the time).** Its full report is in this session's transcript;
the probes are in `design/probes/probe-b-*.mjs`. Two remain unapplied and are
worth doing:

1. **Task deadlines are off by a day.** `AddTaskPanel.jsx:129`,
   `TaskPanel.jsx:277` and `AddProjectPanel.jsx:33` store `dateFromKey(value)` =
   local midnight, and `computeWindows` clips to `end ≤ deadline` — so "due 20
   Aug" actually means "finish by the 19th", and the task parks with a coral
   warning while the 20th sits empty. Sharp edge #11; the zone editor and
   `Commitment` both get this right. **There is a genuine design fork here that
   the agent explicitly handed to the user** — convert at the UI edge (matches
   #11, but existing saved deadlines will display a day earlier) vs. teach the
   core to read midnight as end-of-day (kinder to existing data, but puts a
   magic rule inside the core). **Ask.**
2. **Reversed zone windows are silently inert**, and the last-resort park lands
   on a blocked day.

**Two the agent found and would not propose a fix for, correctly:**

- **A device timezone change silently rewrites the week.** Tasks are epoch-ms
  and move; `blockedDays`/`dayNotes` are `'YYYY-MM-DD'` strings and do not. A
  sitting ends up *on* a blocked day, evening sittings fall out of their zone,
  and a week that reported 420m laid out reports 300m. `probe-b-tz.mjs` proves
  it. Needs a decision, not a patch.
- **Deleting ALL of a week's sittings then pressing "Lay out this week" re-adds
  work you deliberately deleted**, while deleting ONE is never topped up. The
  two halves of the same gesture behave oppositely. `previewWeek` keys `done` on
  `sittings.length > 0`.

**Also open:** `chooseSittings` emits at most one sitting per free RUN, so
`maxPerDay > 1` is unreachable on an empty day — 266 of 3000 fuzzed weeks
reported an avoidable shortfall. Fixing it reshapes step 3; do not start it
without asking.

**Still to do on routines:** R-C's linked-touchpoint hairline, and R-D (finer
`DURATION_EDGES`, the sub-15 decision).

---

## Needs the user's eye, not yours

- The routine step rows in the Cabana at their window width.
- Whether the wait band reads as **free time** rather than a reservation.
- Whether dropping a task inside a wait feels natural, and whether dragging a
  touchpoint past its max toasts sensibly (it must warn, never block).
- The "Lay out this week" confirm and the Add-task routine ask.

Start by asking the user which zoom interaction they want. Do not guess.
