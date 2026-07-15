# Sandy Cay — handoff

**Last updated:** 2026-07-15 (midday). Everything below is committed and pushed to
`main` (https://github.com/Bland16/sandy-cay). CI is green; Pages deploys on push.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173/sandy-cay/
npm run test:run # 122 tests, all green
npm run build    # verified passing
npx eslint src   # clean
```

Live (placeholder → real app on next deploy): https://bland16.github.io/sandy-cay/

---

## State of play

| Piece | Status |
|---|---|
| **Phase 1 engine** (`src/core`) | ✅ Done. 23 modules, pure JS, zero DOM imports (lint-enforced). |
| **Phase 2 M1** (UI shell) | ✅ Done. Week grid, day view, contextual right panel, Cabana page, persistence. |
| **Phase 2 M2 part 1** (physics) | ✅ Done. Drag-to-move, wave/sand resize, ripple⟺displace chooser. |
| **Phase 2 M2 part 2** | ❌ **Not started — this is the next job.** |
| **Sprites** | ✅ Segmented (`src/assets`) and wired — **deliberately only 3 of 57** (see below). |
| **Blind QA pass** | ✅ 40 independent use cases in `design/USE-CASES-BLIND.md`; top bets worked (below). |

### The grid is a 5am-anchored 24h day
`gridBounds()` returns rows **5 → 29**. The day runs 05:00 → 05:00, so a 02:00
task belongs to the **previous night's column at row 26**, not the next day. Use
`gridHour(date)` for positioning and `gridDayOf(date)` for column assignment —
never raw `getHours()`/`sameDay` on a task's start. `hourLabel` wraps past 24.
Windows (08–18 etc.) are **shading only**; every hour is a legal drop target.

### Only 3 sprites are wired, on purpose
`crab` (empty states), `shell` (ratings), `cabana` (settings) — in `Icon.jsx`'s
`SPRITES` map. The other 54 stay line-art SVG because badges render at ~11px
where hand-drawn art turns to mud, and chevrons/x/plus aren't beach metaphors.
**Don't bulk-wire the rest.** Add one only if it's big enough to read.

### Docs that matter
- `SPEC.md` — engine + data model, authoritative.
- `USE-CASE-ANALYSIS.md` — the decision record; **arbitrates ambiguity**. 75KB — grep it, don't read it whole.
- `FRONTEND-SPEC.md` — art direction (supersedes SPEC §10–11).
- `design/UI-CONTROL-MAP.md` — **every use case 1A–7D → the control that does it**, plus the §6 M1/M2 build checklist. Start here for Phase 2 work.

---

## NEXT JOB: M2 part 2

Everything marked **M2** in `design/UI-CONTROL-MAP.md` §6 that isn't drag/resize/chooser:

- **D — Clear Day panel** (3A/OD-7): Day header `⋯` → scope (flexibles-only vs full);
  full clear lists each pinned/fixed row with its own Reschedule, and the commit
  button stays disabled until each is resolved; block-day toggle default on → `evacuateDay`.
- **E — Removal / early-done toast** (3C/3D): delete ≥45min → Leave open / Backfill /
  Protect. Marking done early → crosshatch the remainder + same toast.
- **F — Occurrence-drop menu** (4C): drop onto a recurring occurrence → Move this /
  Skip this / Cancel. No silent default.
- **G — Overpack notice** (§7.3): after a full autoSchedule, ≥3 days with avg break
  ≤ minimum×1.5 → one-time dismissible line. The ONLY allowed grid-side nag.
- **H — Wrap-report PDF** (§7.1): Week ⋯ → print-styled view → `window.print()`.
  Sections: Accomplished / Statistics (`getWeekLoad`, `getTagBreakdown`, `snapshot`
  diff) / Suggestions (detectors). ≤2 pages. Biggest single item.

**Also outstanding:**
- **Scenes are raw.** `src/assets/scenes/*` still need the film-border crop and the
  Gemini watermark inpaint (the sparkle on the cabana's treasure chest). The beach
  scene isn't used as a backdrop yet, and the Cabana page doesn't use its interior.
- **Cross-day occurrence moves work; skip+relocate has no UI menu.** Dragging does
  it. The §4C drop-onto-an-occurrence menu (move/skip/cancel) is still M2.2.
- **8 sprites aren't from the green sheet** (they predate it and look slightly
  different): icons `key, ring, sun-face, hammock, whistle`; chrome `frame-square,
  input-rounded-2, input-rounded-3`. Add them to a green-screen sheet and re-run
  `tools/segment/finalize_cc.py` to match.
- **Keyboard drag** (Space/arrows/Enter, Shift+↑↓, Alt+↑↓ per SPEC §10) — never built.

---

## Sharp edges — read before touching the engine

1. **`rippleShift`'s caller contract is load-bearing.** It defines "downstream" as
   `start >= pivot.endTime`, so **you must call it with the pivot's ORIGINAL end**
   and apply the new end afterwards. Call it after mutating the pivot and the task
   you just grew over drops out of the chain and never moves → silent overlap.
   `src/ui/interaction.js#commitRipple` does this correctly (restores the old end,
   calls, then re-applies). Worth hardening in the engine one day.
2. **Break absorption cascades** (fixed 2026-07-15). Don't "simplify" it back to
   pooling the chain's slack into one residual — that was the bug: the head of the
   chain can only borrow from the first gap. `tests/ripple.test.js` has a multi-gap
   regression test guarding this.
3. **`src/core` must not import UI.** Enforced by an eslint override. `StorageAdapter`
   reaches globals only via guarded `typeof` checks.
4. **Tests inject fixed dates.** Never let the engine read the wall clock internally —
   `now`/`weekStart` are threaded in from the caller so the suite stays stable.
5. **Don't read `design/layout-*.html`** (~330KB each of base64 fonts). They killed a
   subagent's context. The styling that matters is already in `src/ui/styles.css`.

## Known engine simplifications (deliberate, from the Phase 1 build)
- Learning's `dayFill-at-completion` feature is fed `0` (history isn't persisted).
- `timingFit` doubles the whole sample's weight rather than only the time features.

---

## Decisions locked this session (don't relitigate)

- **Layout is B+C**: week grid + a contextual right panel that is **closed by default**
  and opens on what you pick; day headers open a **day view** with an ✕; the **Cabana
  is its own full page**, not a panel.
- Two separate header buttons: **＋Add task** and **Add project**. Find-times is
  header-only (plus per-task in the panel).
- **P-1 holds everywhere**: coral/warning is for scheduling *physics* only, never for
  moral bookkeeping. Insights live in the report and Cabana; the grid stays quiet
  (the overpack notice is the single exception).
- **Rating facets are tri-state** (`-1|0|1`) and cycle `=` → `↑` → `↓` with their
  meaning spelled out. Do not regress this to a checkbox — it silently threw away
  half the model's training signal.

## Blind QA pass — status of its top bets
`design/USE-CASES-BLIND.md` holds 40 use cases written by an agent that never saw
our code. **24 of 40 are UNSPECIFIED** — the specs are strong on placement, weak
on time edges, lifecycle and errors. Its 5 headline bets, all checked against the
real code:

| Bet | Verdict |
|---|---|
| B40 silent storage failure | ✅ **REAL — fixed.** save() demotes + the dot goes amber |
| B28 NaN weights poison scoring | ✅ **REAL — guarded.** (its premise was wrong: moveCount *is* normalized) |
| B18 ripple ignores deadlines | ✅ **REAL — fixed.** ripple.js had 0 deadline mentions |
| B26 future-schema import wipes data | ❌ **False positive.** `summarizeImport` already rejects `schemaVersion !== 1` |
| B8 protected-flexible never placed / reshuffled | ❌ **False positive.** Verified: placed on add, unmoved by re-optimize |

**Still open, and worth a look** (its two structural findings):
1. **§2.2's precedence binds only *automatic* placement.** Ripple now honours
   deadlines, but **displace and carryOver still don't inherit zones/deadlines** —
   so `exclusive` zones are a guarantee in one code path and a suggestion in two.
2. **`history` counters and `occurrenceData` grow forever**, no retention policy.
   Left alone this turns the starvation detector into a permanent nag (a P-1
   violation) and makes localStorage exhaustion the designed end state.
3. Three internal **spec contradictions** it flagged for the authors: §2.4
   protected-as-both-anchor-and-candidate (B8), §7.2 one-click pattern update vs
   §4.1's mandatory prompt (B17), F§6 fixed vs protected tints on one card (B7).

## Fixed this session (bugs worth remembering)
- **What To Do was measuring openings outside the working window** (claimed a
  430-minute opening at 00:50) and **suggesting anchors scheduled on other days**
  ("do Thursday's dentist now"). `currentOpening()` clamps to the window; candidates
  are movable work or an anchor happening right now. It also gained tag filtering and
  a **"Do it now"** that actually schedules the pick.
- **`rippleShift` pooled break slack** → silent overlaps. Now cascades.
- **Zone tags** needed comma-separated typing; **tag autocomplete** was a raw
  `<datalist>` (black OS box). Both replaced.
- **The grid only rendered 08–18**, so you couldn't drag anything to 02:00 —
  the mockup's legibility shortcut had leaked in as a real constraint, breaking
  §2.1's "users may drag anywhere". Now a 5am-anchored 24h day.
- **Rating facets were a 2-state checkmark** over a tri-state model, so "too
  early / too short / drained me" were *unreachable* and the learning model was
  fed a crippled signal. Now cycles `=` / `↑` / `↓` with its meaning spelled out.
- **Recurring occurrences were completely non-interactive** — you couldn't extend
  a gym session that ran long. They're virtual (regenerated on read), so the
  change has to become an exception on the parent. Now drag + resize both work.
- **Exceptions couldn't relocate or add a session** — "skip today, do it tomorrow"
  and "one extra gym this week" were inexpressible. Added `move {toDate}` and
  `add`, both keeping `taskId@originalDate` so ML history follows the session.

## Open question for the user
Nothing blocking. When they're back: **M2 part 2** (start with D/E, leave H last —
it's the biggest), or **wire the sprites in** if they want to see the art land.
