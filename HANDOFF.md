# Sandy Cay — handoff

**Last session ended:** 2026-07-15. Everything below is committed and pushed to
`main` (https://github.com/Bland16/sandy-cay). CI is green; Pages deploys on push.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173/sandy-cay/
npm run test:run # 110 tests, all green
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
| **Sprites** | ✅ Segmented (`src/assets`), ❌ not wired into the UI yet. |

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
- **Wire the sprites in.** `src/assets/manifest.json` maps 57 named PNGs; the UI
  currently uses inline-SVG fallbacks in `src/ui/Icon.jsx` (that's the swap seam).
  Chrome sprites are outline-on-transparent — bucket-fill with `--paper` (#F1E9D8),
  recorded as `chromeChassisFill` in the manifest.
- **Scenes are raw.** `src/assets/scenes/*` still need the film-border crop and the
  Gemini watermark inpaint (the sparkle on the cabana's treasure chest).
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

## Fixed this session (bugs worth remembering)
- **What To Do was measuring openings outside the working window** (claimed a
  430-minute opening at 00:50) and **suggesting anchors scheduled on other days**
  ("do Thursday's dentist now"). `currentOpening()` clamps to the window; candidates
  are movable work or an anchor happening right now. It also gained tag filtering and
  a **"Do it now"** that actually schedules the pick.
- **`rippleShift` pooled break slack** → silent overlaps. Now cascades.
- **Zone tags** needed comma-separated typing; **tag autocomplete** was a raw
  `<datalist>` (black OS box). Both replaced.

## Open question for the user
Nothing blocking. When they're back: **M2 part 2** (start with D/E, leave H last —
it's the biggest), or **wire the sprites in** if they want to see the art land.
