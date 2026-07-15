# Sandy Cay — handoff

**Updated:** 2026-07-15, end of a long session. Everything described as done is
committed and pushed to `main` (https://github.com/Bland16/sandy-cay). CI green.

```bash
npm install
npm run dev      # http://localhost:5173/sandy-cay/
npm run test:run # 207 tests, all green
npm run build
npx eslint src
```

---

## ⚠️ READ THIS FIRST

**The tree is clean and everything below is pushed.** A Wrap-report agent was
started and stopped before it wrote anything — the PDF is **not started**. Begin
it from scratch (brief in "Next job").

**Never trust an agent's "it passes" — run it yourself.** Every background agent
this session reported green: one genuinely was, one was 11 tests red mid-flight,
and one silently broke 34 that it never ran. `npm run build && npm run test:run
&& npx eslint src` before you believe anything, and **commit by explicit path**
(`git add src/… tests/…`), never `git add -A` — see the privacy note below.

---

## State

| Piece | Status |
|---|---|
| **Phase 1 engine** (`src/core`) | ✅ Done. Pure JS, zero DOM imports (lint-enforced). |
| **Phase 2 M1** (shell/panels/Cabana) | ✅ Done. |
| **M2.1** (drag, resize, ripple⟺displace chooser) | ✅ Done. |
| **M2.2** (Clear Day, gap toast, occurrence menu, overpack notice) | ✅ Done. |
| **Calendar interchange** (`.ics` + Google) | ✅ `.ics` done & tested. Google import **works** (proven against the real account). **Export → Google NEVER RUN.** |
| **Wrap-report PDF** (§7.1) | ❌ **The next job.** May be half-built — see above. |
| Sprites | ✅ segmented; only **3 of 57** wired, deliberately. Scenes raw. |

**Docs:** `SPEC.md` (engine, authoritative) · `USE-CASE-ANALYSIS.md` (decision
record, arbitrates — 75KB, **grep it, never read it whole**) · `FRONTEND-SPEC.md`
(art) · `design/UI-CONTROL-MAP.md` (every use case → its control).

---

## NEXT JOB: the Wrap report (§7.1 / R-7)

Week ⋯ → "Wrap report (PDF)" is a **stub toast** in `src/App.jsx` (`wrapReport`).
Build a print-styled view; `window.print()` is the renderer — **no PDF library**.

Three sections: **Accomplished** (leads with what happened; skipped = a quiet
count, never a list) · **Statistics** (`getWeekLoad` sand-bar chart,
`getTagBreakdown`, planned-vs-actual via `snapshot`/`snapshotDiff`) ·
**Suggestions** (the detectors). ≤2 pages. Set `document.title` to
`wrap-YYYY-'W'ww` before printing so "Save as PDF" defaults to it; restore after.

**This is the app's most dangerous surface for P-1** — a weekly report is exactly
where a scheduler starts scolding. Observation, never a score. Every suggestion
gets a graceful exit of equal weight ("Let it go" beside "Pin it next week").

**It's also the only home for the detectors** — `driftCheck`, `starvationCheck`,
`skipStreakCheck`, `pinnedRatioNote`, `durationFitSuggestion` all exist in
`src/core/detectors.js`, are tested, and are surfaced **nowhere**.

**Empty/thin weeks must render with dignity** — zero tasks, zero ratings (the
model is untrained below 10, so `inspect()` is meaningless), no snapshot. No
`NaN`, no `0/0`. Blind QA flagged exactly this. Test it.

### Then, roughly in order
1. **Responsive** — SPEC §11 wants **<768 single-day** (the primary mobile
   layout) and **768–1279 Mon–Fri + weekend drawer**. Neither exists; it's
   desktop-only.
2. **Week rollover has no trigger.** R-5/R-7/§3.6 all fire "at rollover" —
   retrain, wrap report, carryOver — but nothing detects a week turning over.
3. **§2.2 precedence binds only automatic placement.** Ripple now honours
   deadlines, but **displace and carryOver still don't inherit zones/deadlines**
   — so a zone is a guarantee in one code path and a suggestion in two.
4. **`history`/`occurrenceData` grow forever.** No retention policy → the
   starvation detector eventually becomes a permanent nag (a P-1 violation) and
   localStorage exhaustion is the designed end state.
5. **Keyboard drag/resize** (§10: Space/arrows/Enter, Shift+↑↓, Alt+↑↓) — never
   built. The app is mouse-only.
6. **Art** — scenes (`src/assets/scenes/`) still need the film-border crop + the
   Gemini watermark inpaint (the sparkle on the cabana's chest); the Cabana page
   doesn't use its interior. 8 sprites predate the green sheet and look different
   (`key, ring, sun-face, hammock, whistle`, `frame-square`, `input-rounded-2/3`).
7. **PWA** — manifest + SW scaffolded, install/offline never verified.

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
  **＋ every weekday**, exclusive ✓, **runs → 2026-07-25** (the day it *stops*).
- **Widen `config.windows`** past 18:00 (default Mon–Fri is 08:00–18:00, which
  ends before their 18:30 workday, so evenings don't exist).

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
10. **The app ships EMPTY.** `seed()` is a **test fixture**; UI tests hand it to
    `<App/>` via `localStorage.setItem(STORAGE_KEY, …)`. Don't reintroduce
    demo data on first run.

---

## Decisions locked (don't relitigate)

- **Layout B+C**: week grid + a contextual right panel **closed by default**; day
  headers open a day view with ✕; **Cabana is its own full page**.
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

### Bugs fixed this session (all with regression tests)
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
