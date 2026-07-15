# Tidepool — Scheduling App Build Specification

**Status:** PRIMARY spec, v2 (consolidated). Supersedes the conversational spec.
**Companion:** `USE-CASE-ANALYSIS.md` — the decision record. Every rule here traces to a use case (1A–7D), an open decision (OD-1…15), a ruling (R-1…R-7), or principle P-1 there. When this doc is ambiguous, the analysis doc arbitrates.
**Working title:** **Sandy Cay** (named by the art). Frontend note: §10–§11 below are SUPERSEDED by `FRONTEND-SPEC.md` (hand-tinted film direction, asset-grounded); engine and data-model sections remain authoritative.

---

## 0. Principles & scope

- **P-1 — The app never guilts.** Skipping things is a legitimate outcome. Insights and observations live in the Wrap report and the Cabana, never as grid nagging. Warning color (coral) is reserved for scheduling physics ("this won't fit"), never moral bookkeeping. Every diagnostic offers a graceful exit ("Let it go") with equal visual weight to the fix.
- **R-1 — Manual always wins.** A user drop/edit overrides the algorithm unconditionally; priority values influence `autoSchedule()` ordering only, never manual conflict outcomes.
- **Visible beats invisible.** A task that can't be placed well is parked with a warning badge — never hidden, never silently dropped.
- **In scope:** everything below. **Out of scope:** nothing formerly excluded remains excluded — "What To Do" is reinstated (§6).

---

## 1. Data model

Three classes. All date math local-time, minute precision, seconds zeroed. All classes implement `toJSON()`/`fromJSON()` with `schemaVersion: 1`.

### 1.1 Task

```js
class Task {
  id            // string; provided or auto: slug(title) + 4-char suffix
  title         // string, REQUIRED (only required field; UI blocks empty submit)
  details       // string = ''
  tags          // string[] = []
  type          // 'fixed' | 'flexible'
  pinned        // bool = false
  priority      // int 1–5 = 3 (clamped)
  startTime     // Date (day+time encoded)
  endTime       // Date; guard: end<=start → swap; equal → +defaultDuration
  deadline      // Date | null — hard "must end before"
  placedBy      // 'auto' | 'user' — soft; set 'user' on any manual drag/time-edit
  schedulingWarning // bool, set by engine when parked badly
  completion    // null | 'done' | 'partial' | 'skipped'
  satisfaction  // null | { overall:1–5, timingFit:-1|0|1, durationFit:-1|0|1, energy:-1|0|1 }
  history       // { moveCount, displacedCount, rippleCount, carriedCount }
  recurrence    // null | { periods:[{ windows:[{day,start,end}], interval, effectiveFrom, effectiveUntil }],
                //          anchorDate, exceptions:[{date, action:'skip'|'move', start?, end?}] }
  occurrenceData// { 'YYYY-MM-DD': { completion, satisfaction, history } } — per-occurrence lived data
  chunking      // null | { totalMinutes, minChunk, maxChunk, range:{from,until} }
  parentId      // string | null — set on materialized project chunks
}
```

**Defaults cascade (7A):** `new Task({title})` → flexible, priority 3, `config.defaultDuration` (60 min), no deadline, `placedBy:'auto'`, **placed immediately** via scored placement. No unscheduled tray.

**Methods:** `moveTo(newStart)` (preserves duration; what drag calls) · `bump(newDay)` (delegates to moveTo, preserves time-of-day) · `getDuration()` (min, null-safe→0) · `getDayIndex(weekStart)` · `overlaps(other)` · `clone()` (**same id** — internal only: ghosts, optimistic edits; never enters tasks[]) · `duplicate()` (**new id**; resets completion/satisfaction/history/placedBy; recurrence NOT copied; placed via scoring) · `toJSON()`.

**Semantics table (7B) — load-bearing documentation:**

| | autoSchedule moves it | displacement evicts it | drop onto it | user drags it |
|---|---|---|---|---|
| flexible | yes | yes | displaces/ripples | yes |
| fixed | never | never | rejected, snap-back | yes (R-1) |
| pinned (any type) | never | never | rejected, snap-back | yes |
| protected tag | not post-placement | never | rejected | yes |

### 1.2 Zone

```js
class Zone {
  id, label
  matchTags     // string[] — task.tags ∩ matchTags ≠ ∅ → task routes here
  windows       // [{day,start,end}] — per-day, multiple per day allowed
  exclusive     // bool = true — zone time reserved; non-matching tasks excluded
  color         // optional tint; default soft aqua
  windowsForDay(day); containsRange(start,end); matches(task)
}
```

### 1.3 Schedule

```js
class Schedule {
  tasks: Task[];  zones: Zone[];  config  // §8 reference
  // CRUD
  addFixed(data)  addFlexible(data)  addProject(data /* → chunking, materializes children */)
  removeTask(id)  updateTask(id, changes /* whitelisted keys */)
  addZone(d) removeZone(id) updateZone(id, ch)
  // queries (pure)
  getTasksForWeek(weekStart)   // expands recurrence → virtual occurrences (§4.4)
  getTasksForDay(date)
  findFreeSlots({from,to,durationMin,window,respectBreaks}) → [{start,end}]
  getWeekLoad(weekStart) → { scheduledMin, capacityMin, fillRatio, perDay[], warnings, pinnedRatio }
  getTagBreakdown(weekStart) → [{tag, scheduledMin, completedMin, avgShells}]
  whatToDo(now) → top-3 ranked existing tasks with reasons (§6)
  // engine
  autoSchedule()  resolveDropConflicts(dropped)  chooseConflictStrategy(cause, delta, dayState)
  rippleShift(pivot, deltaMin)  evacuateDay(date, {blockDay})  blockRange(from,to,label)
  carryOver(fromWeek, toWeek)  snapshot()
  // internal shared core
  _walkGaps(...)   // single gap-walker behind findFreeSlot(s), autoSchedule, backfill
}
```

---

## 2. Placement engine

### 2.1 Windows & capacity
`config.windows`: Mon–Fri 08–18, Sat 08–22, Sun 10–14 (`lightDay`, `maxTasks: 2`, used only when other days ≥ ~80% full). Windows bound **automatic** placement only — the grid is 24h and users may drag anywhere.

### 2.2 Constraint precedence
**deadline > zone > general windows.** Deadline tasks may only occupy slots ending ≤ deadline. If a matching zone lacks pre-deadline capacity, the zone relaxes (info badge: "placed outside Study zone — due Wed"). No pre-deadline capacity at all → park in best pre-deadline gap, `schedulingWarning`, coral badge.

### 2.3 Slot scoring (all placement flows share this)

```js
score(slot) = w.proximity · (1 − |slot.start − origin| / lookaheadHorizon)
            + w.balance   · (1 − dayFillRatioAfterPlacement)
            + w.stability · stabilityBonus(placedBy === 'user')
            + w.preference· modelScore(task, slot)          // §5; 0 until ≥10 ratings
// highest wins; ties → earlier. Weights renormalized; Cabana sliders.
```

### 2.4 autoSchedule()
1. Anchors: fixed, pinned, protected-tag (post-placement), materialized recurrence occurrences.
2. Candidates: flexible ∧ unpinned. Sort: **urgent first** (deadline ∧ `slack < duration × urgencyFactor`, ordered slack ASC; slack = free capacity before deadline − duration, **recomputed after each placement**) → then priority DESC → deadline ASC → duration DESC → title ASC.
3. Day order: load ascending (spread-before-stack), recomputed per placement; Sunday per §2.1.
4. Slot search honors current break padding: 30 min default → 15 at day-fill 0.5 → 5 at 0.7.
5. Failure → §2.2 parking rule.
6. Post-run overpack check (§7.3).
Runs on: initial load, explicit Re-optimize, week rollover. Never as a side effect of drags.

---

## 3. Interactive operations

### 3.1 Drop conflicts — `resolveDropConflicts`
Target flexible ∧ unpinned → evict via scored placement. Target fixed/pinned/protected → snap-back + shake + toast. Target recurring occurrence → **occurrence menu, no silent default**: Move this occurrence (writes `move` exception) / Skip this occurrence / Cancel.

### 3.2 Ripple vs displace — `chooseConflictStrategy` (OD-8)
Cause biases, magnitude flips: `cost(ripple)` = downstream shift minutes + forced evacuations × `evacuationPenalty`; `cost(displace)` = Σ score-loss of evicted. Resize → ripple cost ×0.8; drop → displace ×0.8. Cheaper option is pre-highlighted in the always-shown inline chooser (Enter = default, Esc = snap back). Encoded test cases: +15 min resize→ripple; +4 h resize→displace; 15 min drop into cluster→ripple; 2 h drop→displace.

### 3.3 `rippleShift(pivot, delta)` — three-stage absorption
(1) compress downstream breaks to `breaks.minimum`; (2) shift movable tasks by residual; (3) overflow evacuates forward via scoring. Fixed/pinned downstream = walls; flexibles before a wall compress or evacuate.

### 3.4 Clear Day (OD-7)
Panel, not confirm. Scope: flexibles-only vs full clear. **Full clear requires resolving each pinned/fixed row individually** (Reschedule → mini slot-picker / leave / skip) before commit enables. Block-day toggle default **on** → emits full-day protected blocker. Flexibles relocate forward-only via scoring.

### 3.5 `blockRange(from, to, label)` — one full-day protected blocker per day (individually deletable); existing flexibles evacuate forward.

### 3.6 `carryOver(from, to)` (OD-9/13)
Incomplete ∧ past → recurring: regenerate naturally; deadline-passed: flag `missedDeadline`, don't move; rest: re-place as `placedBy:'auto'`; increments `history.carriedCount`. Triggers: week `⋯` menu "Wrap up week"; past-week banner (once, dismissible) with equal-weight **Carry forward / Let them go** (marks `skipped`).

### 3.7 Projects & work conservation (OD-14)
`addProject()` materializes children (`parentId`), sized in [minChunk, maxChunk], placed by §2; `range.until` enters slack math. **Conservation:** shrink chunk → Δ flows to siblings (≤maxChunk) or spawns chunk (≥minChunk) or merges residue; none fits → parent `schedulingWarning`. Grow chunk → future auto-placed siblings shrink/dissolve. Delete chunk → ask: remove work vs redistribute. Completed & user-placed chunks never auto-flexed. Re-optimize may re-slice auto-placed chunks. **Finish project here** → remaining chunks vanish, undo toast, actual-vs-planned recorded.

### 3.8 Removal toast (3C)
On removing ≥ `backfillOfferThreshold` (45 min): **Leave open** (default) / **Backfill** (warned → urgent-deadline → auto-placed score-improvers; never user-placed) / **Protect** (rest blocker).

### 3.9 Completion (3D)
Check control → `done|partial|skipped`; early done truncates block (crosshatch remainder) + fires removal toast for remainder; completed cards stay, dimmed; rating prompt = shells + 3 optional facet taps.

### 3.10 Recurring deletes (7D)
This occurrence (skip exception) / This and future (`effectiveUntil: now`) / Entire task & history (only confirming path; states ML data loss).

---

## 4. Recurrence semantics

**4.1 Periods:** windows (R-4 shape) + `interval` (every Nth week, parity vs `anchorDate`) + `effectiveFrom/Until`. Permanent change = period split ("From now on, or including the past?" — default from now on). Temporary change = editor builds period sandwich from "from…until…".
**4.2 Exceptions:** per-date `skip` / `move`.
**4.3 Editor:** one shared window-row component (day+start+end+remove) used by zones and recurrence.
**4.4 Virtual occurrences (OD-12):** materialized at read time, id `taskId@date`, behave as fixed anchors; lived data in `occurrenceData`; editing an occurrence writes exceptions/occurrenceData, never the pattern. One task = one identity = continuous ML history across pattern changes.

---

## 5. Learning module (R-5)

**Boundary:** learns *where/when placements satisfy you*; never suggests tasks.
**Data:** structured satisfaction (§1.1) + implicit history counters. Facets optional always.
**Features:** top-N tag indicators, time-of-day bucket (6), day-of-week, duration bucket, priority, day-fill at completion, placedBy, moveCount. Target: overall∈[0,1]; `timingFit≠0` doubles sample weight on time features.
**Model:** ridge linear regression, plain-JS gradient descent, weights inspectable → Cabana renders plain-language preferences.
**Output:** `modelScore(task, slot)∈[0,1]` → `w.preference` (default 0.15; forced 0 until ≥10 ratings).
**Retraining:** week rollover (before Wrap report) + Cabana "Retrain now" (shows sample count).

---

## 6. What To Do (R-6)

`whatToDo(now)` ranks **existing** tasks for the current moment: gap fit (`_walkGaps`) · deadline slack/warnings · `modelScore(task, now)` · priority tiebreak · rest-boost when recent `energy:-1`. Returns top 3 with reasons generated from actual scoring terms. Cold start (<10 ratings): urgency/fit/priority only. Placement UI = **OD-11, decided at the frontend drawing.**

---

## 7. Reports & detectors

**7.1 Wrap report (R-7) — PDF only (OD-15).** Generated at rollover (post-retrain) + on demand. Sections: **Accomplished** (completed, chunk progress, hours, shells; skipped = quiet count only) · **Statistics** (`getWeekLoad`, `getTagBreakdown`, satisfaction by tag×time, break compression, planned-vs-actual via `snapshot()` diff) · **Suggestions** (all mechanical & explainable). Design: real document — Playfair headings, Nunito body, ocean palette, shell glyphs, sand-bar day-load chart, sprite accents if available. Filename `wrap-YYYY-'W'ww.pdf`.

**Length — amended 2026-07-15 (was "≤2 pages", R-7/OD-15).** No hard page budget; ~5 pages is fine, and a busy week is expected to be longer. **The report never truncates to fit paper** — the 2-page rule had produced silent caps (top-8 tags, top-6 tag×time rows) that dropped a real week's quieter data without saying so. Page-fitting is a *layout* concern (`@media print` avoids tearing rows and orphaning headings), never a *content* one. Editorial limits that exist for signal rather than space (top-3 learned weights) stand.
**7.2 Detectors (report/Cabana only — P-1 corollary):** drift (≥4/5 occurrences moved same direction ≥30 min → one-click pattern update) · starvation (`displaced+carried ≥ 3` → Pin next week / Let it go) · skip-streak (≥3 weeks → Change pattern / Let it go via `effectiveUntil`) · pinnedRatio observation (>0.5, informational) · duration-fit suggestion (qualitative; no time tracking, deliberately).
**7.3 Overpack notice** — the one grid-side notice (physics): post-autoSchedule, ≥3 days with avg break ≤ minimum×1.5 → one-time non-modal dismissible line, optional "Block recovery time?".

---

## 8. Config reference (all Cabana-tunable unless noted)

```js
config = {
  windows: { monFri:{start:'08:00',end:'18:00'}, sat:{start:'08:00',end:'22:00'},
             sun:{start:'10:00',end:'14:00', maxTasks:2, lightDay:true} },
  breaks: { default:30, medium:15, minimum:5 }, breakThresholds: { medium:0.5, minimum:0.7 },
  maxPlacementLookahead: 3 /*days*/, defaultDuration: 60,
  weights: { proximity:0.5, balance:0.35, stability:0.15, preference:0.15 /*renormalized*/ },
  urgencyFactor: 1.5, evacuationPenalty: /*tunable*/, strategyBias: 0.8,
  backfillOfferThreshold: 45, protectedTags: ['rest','break','recovery'],
  detectors: { driftN:5, driftHits:4, driftMin:30, starvation:3, skipStreak:3,
               overpackDays:3, pinnedRatioNote:0.5 },
  coldStartRatings: 10
}
```

---

## 9. Persistence (OD-10)

**StorageAdapter** (env-detected priority): GitHub Pages → localStorage primary; artifact → `window.storage`; final fallback in-memory. Auto-save full state debounced 2 s; status dot (green persistent / amber session).
**Export/Import** ("footlocker", Cabana): versioned `schedule-YYYY-MM-DD.json`; import = validate → dry-run summary → replace/merge.
**Exit reminder:** `beforeunload` on unexported changes + badge on export button + gentle toast at 25+ changes. Reminder concerns *export*; auto-save runs regardless.

---

## 10. Design system

**Palette (CSS custom properties):** `--color-bg #F0F8FF · surface #FFFDF7 · primary #1A9BAB · accent #F4A259 · cta #FFD166 · success #6BCB77 · warning #FF6B6B · muted #7A8C99 · dark #1E2D3D · badge-pinned #C9A96E · badge-fixed #4ECDC4 · badge-flexible #A8DADC · burnout-tint rgba(255,107,107,.12)` + Cabana: `--cabana-bg #4E3B2A · surface #6B5138 · trim #8B6F52 · text #F5E9D9 · accent #FFD166`.
**Fonts:** Nunito (UI), Playfair Display (app title + section headers only), Google Fonts.
**Card language:** frosted glass = pinned (R-2: blur 3px + wash rgba(255,253,247,.55); badges/chips on crisp layer above; AA contrast; reduced-transparency fallback) · full sea-glass tint = protected (tag chip is the non-color indicator; `--color-dark` text) · **wave strip top border** = resize start · **sand strip bottom border** = resize end (8 px, ns-resize cursor, 15-min snap, min duration 15; body drag = move) · coral badge = schedulingWarning · gold badge = pinned · due-date chip · info badge (outside-zone). Zones: tinted background regions (~12% opacity, label on hover).
**Rating glyphs: shells** (filled/outline via opacity+grayscale on one sprite).
**Motion:** ghost 0.85 opacity/scale 1.03/raw follow, 150 ms snap; hover lift 150 ms; panels 250 ms cubic-bezier(.4,0,.2,1); popover fade 120 ms; `prefers-reduced-motion` → 0 ms.
**Accessibility:** draggables `role="button" aria-grabbed tabIndex=0`; cells `role="gridcell"` labeled; keyboard: Space pick up, arrows move, Enter drop, Esc cancel; `Shift+↑/↓` end-resize, `Alt+↑/↓` start-resize; AA everywhere; meaning never by color alone; sprites decorative `aria-hidden` with CSS fallbacks.
**Sprites:** Appendix A of `USE-CASE-ANALYSIS.md` (12-cell sheet, prompt, segmentation workflow).

---

## 11. UI inventory (PROVISIONAL — final layout waits on the model-speccing drawing)

24 h × 7-day grid (responsive: ≥1280 full week · 768–1279 Mon–Fri + weekend drawer · <768 single-day, primary mobile layout) · week nav ‹ Today › + date jump + load bar (hover ‹› previews adjacent week) · week `⋯` menu (Re-optimize / Wrap up week / Wrap report / Block days…) · day `⋯` menu (Clear this day → panel) · TaskCard (badges, chips, check, context menu: duplicate/delete) · hover EditPopover (title, exact times, duration chips 15m/30m/1h/2h/custom, tags, pin toggle, deadline) · detail modal (all fields, recurrence editor, Find times + Copy-as-text, satisfaction, occurrence actions) · Add task / **Add project** panels · Cabana (Palmtree button; zones, tag roles, tuning sliders, retrain, insights, footlocker) · What-To-Do surface (OD-11 pending) · toasts/banners per §3, §7.

---

## 12. Deployment — GitHub Pages + PWA

Vite + React 18 repo; `src/core` **pure JS, zero DOM imports (lint-enforced)**; `src/ui`; `src/assets` (sprite files); `/tests` Vitest; GitHub Actions deploy on push to main; `manifest.json` + minimal service worker → installable, offline (pairs with localStorage). Lifted former artifact constraints: single-file, no-localStorage, no-form-tags (onClick/onChange patterns retained anyway).

---

## 13. Build order

**Phase 1 — backend (now):** Task → Zone → Schedule CRUD + `_walkGaps` + `findFreeSlots` → scoring (4 weights) → `autoSchedule` (urgency, zones, deadlines, protected) → `resolveDropConflicts` + `chooseConflictStrategy` → `rippleShift` → `evacuateDay` → `blockRange` → `carryOver` → recurrence expansion + exceptions + occurrenceData → projects/chunking + conservation → learning module → `whatToDo` → queries (`getWeekLoad`, `getTagBreakdown`, `findFreeSlots`, `snapshot`) → detectors → StorageAdapter + export/import → **Vitest suite: every worked example in the analysis doc is a named test** (OD-8 quartet, 2E slack, 3B break absorption, conservation cases, parity/period/exception expansion, round-trip serialization, adapter fallback).
**Phase 2 — frontend (after the drawing):** grid → cards → drag/resize → popover/modal → panels (add task/project, Clear Day) → Cabana → report view + PDF → sprites → PWA wrap.

**Seed data:** 8 realistic tasks (mix fixed/flexible, ≥2 pinned, ≥1 protected, ≥1 recurring w/ exception, 1 project, 1 deadline task), 1 study zone — chosen to exercise every badge and rule on first paint.
