# Scheduling App — Specification

**Status:** DRAFT — use-case analysis in progress
**Method:** Each use case is analyzed against the current class design (Task / Schedule as specced in conversation). Coverage is classified, gaps produce proposed resolutions, and unresolved choices are logged as numbered Open Decisions (OD-n) requiring sign-off before build.

**Coverage classification:**
- ✅ COVERED — current spec handles it with no changes
- ⚠️ PARTIAL — mechanically possible but awkward, or handled only under assumptions
- ❌ GAP — requires new property, method, or behavior

---

## Baseline class design under test

```
Task {
  id, title, details, tags[], pinned, type ('fixed'|'flexible'),
  priority (1–5), startTime (Date), endTime (Date),
  recurring ([{day, start, end}] | null — see R-4), satisfaction (null | structured rating — see R-5),
  schedulingWarning (bool)

  bump(newDay), moveTo(newStart), getDuration(), getDayIndex(weekStart),
  clone(), overlaps(other), toJSON()
}

Schedule {
  tasks[], config { windows, breaks, breakThresholds, maxPlacementLookahead }

  addFixed(data), addFlexible(data), removeTask(id), updateTask(id, changes),
  getTasksForWeek(weekStart), getTasksForDay(date),
  autoSchedule(), findFreeSlot(day, durationMin)
}
```

---

# Situation 1 — Lunch with a friend

A single social commitment being renegotiated in five common ways. Tests: rescheduling, duration edits, availability queries, and priority-driven displacement.

## 1A — She moves lunch to tomorrow

| | |
|---|---|
| **User action** | Drag lunch card to tomorrow's column, or edit its date |
| **System must** | Move task to same time next day; re-render |
| **Coverage** | ✅ COVERED |

**Mechanism:** drag → `task.moveTo(newStart)` (fully-free drag, 15-min snap); or edit popover → `updateTask(id, { startTime, endTime })`. Time-of-day preserved automatically when dragging horizontally along the same row.

**No spec change.**

## 1B — Lunch shrinks from 1 hour to 30 minutes

| | |
|---|---|
| **User action** | Edit the task's end time (or duration) |
| **System must** | Shorten the block; keep start anchored |
| **Coverage** | ✅ COVERED (mechanically) — ⚠️ PARTIAL (ergonomically) |

**Mechanism:** `updateTask(id, { endTime })` via edit popover. Guards already specced: end ≤ start → swap/expand.

**Proposed resolution:** Edit popover gains **duration chips** (`15m · 30m · 1h · 2h · custom`) that set `endTime = startTime + chip`. One click instead of time-picker fiddling. Low cost, high frequency of use.

> **OD-1 — RESOLVED:** Resize-by-drag is in, via **themed edge borders** that double as the resize handles:
> - **Top border = "waves"** — a subtle wave-crest SVG strip. Dragging it adjusts `startTime` (end anchored).
> - **Bottom border = "sand"** — a golden-sand gradient strip (`--color-cta` tint). Dragging it adjusts `endTime` (start anchored).
> - Resize is **only** possible via these borders; grabbing the card body always means *move*. This cleanly separates the two drag modes with zero modifier keys, and the sand/waves motif matches the ocean palette (Alice Blue, sea glass, coral, golden sand).
> - Borders are ~8px tall, cursor `ns-resize` on hover, brighten on hover. Snap: 15 min. Min duration: 15 min (borders can't cross).
> - Keyboard: with card focused, `Shift+↑/↓` adjusts end time, `Alt+↑/↓` adjusts start, 15-min steps.
> - Popover duration chips remain as the fast-path alternative.

## 1C — She's unavailable; asks when works for ME, within lunch hours

| | |
|---|---|
| **User action** | Ask the system for free slots, constrained to a time-of-day window (e.g. 11:30–13:30), over some date range |
| **System must** | Return all free slots of ≥ the required duration inside that window, respecting existing tasks and breaks |
| **Coverage** | ❌ GAP |

**Analysis:** `findFreeSlot()` returns the *first* slot for placement. This case is an availability *query*: return *all* candidates, filtered by a time-of-day constraint the current config has no way to express per-query.

**Proposed resolution — new Schedule method:**

```js
findFreeSlots({
  from: Date,             // search range start (default: now)
  to: Date,               // search range end (default: from + 7d)
  durationMin: number,    // required slot length
  window: { start: 'HH:MM', end: 'HH:MM' } | null,  // time-of-day constraint
  respectBreaks: boolean  // default true — pad candidates with current break rules
}) → Array<{ start: Date, end: Date }>
```

- Pure/read-only. Shares the gap-walking core with `findFreeSlot` (refactor both onto one internal `_walkGaps()` so the logic can't diverge).
- `findFreeSlot` becomes `findFreeSlots({...})[0] ?? null`.

**UI surface:** detail modal gets a **"Find times"** action → duration + window inputs → renders the slot list; clicking a slot moves the task there.

## 1D — I'm unavailable; I give HER a few times I'm free

| | |
|---|---|
| **User action** | Same query as 1C, but output is for sharing |
| **System must** | Same as 1C + human-readable output |
| **Coverage** | ❌ GAP (resolved by 1C's method) |

**Proposed resolution:** Same `findFreeSlots()`. UI adds a **"Copy as text"** button on the results list producing e.g. `Tue 12:00–13:00, Wed 11:30–12:30, Fri 12:15–13:15`. Formatting is a pure UI function; no class changes beyond 1C.

## 1E — Lunch conflicts with studying; lunch wins, studying must reschedule

| | |
|---|---|
| **User action** | Place/drag lunch onto a time occupied by a flexible task (studying), with lunch marked higher priority (or pinned/fixed) |
| **System must** | Accept lunch at that time; evict studying; find studying a new valid slot automatically; never render a silent overlap |
| **Coverage** | ⚠️ PARTIAL → requires new behavior: **displacement** |

**Analysis:** Current `autoSchedule()` routes flexible tasks *around* anchors, which works if the user re-runs it after placing lunch. But the interaction is a drop event — the eviction must be immediate and scoped, not a full-week reshuffle side effect.

**Proposed resolution — displacement rule (new Schedule behavior):**

```js
resolveDropConflicts(droppedTask) → { displaced: Task[], warned: Task[] }
```

Called after any drop/placement. Logic:

1. Find tasks overlapping `droppedTask`.
2. For each overlap:
   - overlap is **flexible & unpinned** → evict it, re-place via slot search (same rules as autoSchedule, including 3-day lookahead → `schedulingWarning` on failure).
   - overlap is **pinned or fixed** → the *drop itself* is rejected: dropped card snaps back to origin with a shake animation + toast ("Conflicts with pinned: Gym").
3. Displaced tasks animate to their new slots so the user sees where studying went.

**Priority note:** the dropped task wins by virtue of the user's explicit action — priority values are not compared on manual drops (the human overrides the algorithm). Priority governs `autoSchedule()` ordering only.

> **OD-2 — RESOLVED:** Nearest valid slot, but "nearest" is a **weighted score**, not raw distance — otherwise displacement chains can pile one day sky-high. Every candidate slot is scored:
>
> ```js
> score(slot) = w.proximity  · proximityScore(slot)   // 1 − (|slot.start − original.start| / lookaheadHorizon)
>             + w.balance    · balanceScore(slot)      // 1 − dayFillRatioAfterPlacement(slot.day)
>             + w.stability  · stabilityBonus(task)    // small bonus for NOT moving a placedBy:'user' task at all
> ```
>
> - Defaults: `config.weights = { proximity: 0.5, balance: 0.35, stability: 0.15 }` — **explicitly tunable**; the weights live in config as data and are adjusted live via sliders in the **Cabana** (R-3).
> - Highest score wins; ties → earliest slot.
> - `balanceScore` is the overload guard: a slot on an already-full day scores low even if it's temporally nearest.
> - A manual **"Re-optimize week"** button remains for the global pass.

> **OD-3 — RESOLVED:** `placedBy: 'user' | 'auto'` is added, with **soft** semantics:
> - **Pinned/fixed = the hard lock.** Never moved by anything, drops onto them are rejected. This is the only true "fixed."
> - **Hand-moved ≠ fixed.** Dragging a flexible task sets `placedBy: 'user'`, which the scoring function rewards with a stability bonus (algorithm *prefers* not to move it) but does not forbid moving it during displacement or re-optimize.
> - **Explicit placement via popover:** the edit popover exposes exact start/end time fields plus the pinned toggle — so "put it exactly here and lock it" is a two-step popover action, no dragging required.
> - Editing a task's time in the popover also sets `placedBy: 'user'`.

---

## Situation 1 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| Duration chips in edit popover | UI | 1B |
| Themed resize borders: waves top (start), sand bottom (end) | UI + interaction | OD-1 |
| `findFreeSlots(query)` on Schedule | Method (new) | 1C, 1D |
| Refactor: shared `_walkGaps()` core | Internal | 1C |
| "Find times" + "Copy as text" in detail modal | UI | 1C, 1D |
| `resolveDropConflicts()` displacement rule | Method + behavior (new) | 1E |
| Weighted slot scoring: `proximity / balance / stability` in `config.weights` | Algorithm (new) | OD-2 |
| Cabana settings hub (absorbs weight tuning) | UI (R-3) | OD-2, OD-6 |
| Snap-back + toast on invalid drop | UI | 1E |
| `placedBy: 'user' \| 'auto'` on Task (soft; pinned is the hard lock) | Property (new) | OD-3 |
| Exact time fields + pin toggle in popover for explicit placement | UI | OD-3 |

**Rulings:**
> **R-1 — AGREED:** On manual drops, priority values are ignored — the user's action always wins. Priority governs `autoSchedule()` ordering only.

> **R-2 — Pinned visual treatment (frosted glass):** Pinned cards render with a diffusion-glass effect: `backdrop-filter: blur(3px)` + translucent wash `rgba(255,253,247,0.55)` over the card face, so grid lines and zone tints diffuse through. Reads as "behind glass — don't touch," doubling as sea-mist in the ocean palette. Rules: (a) the gold pinned badge and any warning/due chips render on a crisp layer *above* the glass — fog never carries meaning alone (no-color-alone rule) and never blurs a badge; (b) text on the foggy surface must pass WCAG AA; (c) `backdrop-filter` applies to pinned cards only; (d) `prefers-reduced-transparency` → flat pale wash, no blur.

> **R-4 — Unified windows schema (recurring ≡ zones):** `Task.recurring` adopts the same per-day window shape as `Zone.windows`, replacing the original `[[days[], 'HH:MM']]` form:
>
> ```js
> recurring: [
>   { day: 'mon', start: '07:00', end: '08:00' },
>   { day: 'fri', start: '18:00', end: '19:30' }
> ] | null
> ```
>
> - Each occurrence carries its **own time and duration** — gym can be an hour Monday morning and 90 minutes Friday evening, under one task.
> - One shared shape means one shared editor component (window-row list: day picker + start + end + remove), used in both the Cabana's zone builder and the task popover/detail modal's recurrence editor — build once, use twice.
> - Recurring expansion (materializing occurrences as fixed anchors for the visible week, per the autoSchedule spec) reads these windows directly; the task's own `startTime/endTime` are ignored for recurring tasks in favor of the windows.
> - Migration note for seed data: no `[[days[], time]]` form anywhere in the build — windows-form only.

**Open decisions:** OD-1 ✅ · OD-2 ✅ · OD-3 ✅ — Situation 1 closed.

---

# Situation 2 — Busy class schedule

A dense, deadline-driven week. Tests: protected time, placement constraints (zones), deadlines, and urgency-aware ordering. This situation produces the largest algorithm changes in the spec.

## 2A — Friend wants to meet on a non-negotiable gym day

| | |
|---|---|
| **User action** | Look for meeting times around an immovable commitment |
| **System must** | Protect gym; offer alternatives |
| **Coverage** | ✅ COVERED (by existing `pinned` + 1C's `findFreeSlots`) |

**Mechanism:** "non-negotiable" maps to `pinned: true`. The 1E drop-rejection rule already snap-backs anything dropped onto it. Finding alternatives is exactly `findFreeSlots({ durationMin, from, to })` — optionally window-constrained. **No new deltas** — this case validates that 1C/1E generalize.

## 2B — Burnout: schedule (i) study session (ii) movie night (iii) free-time chunk (iv) study block

| | |
|---|---|
| **User action** | Add recovery/rest tasks and expect them to survive the week |
| **System must** | Treat rest tasks as protected — not evicted by displacement, not squeezed as the week fills |
| **Coverage** | ⚠️ PARTIAL — mechanically just Tasks; the gap is semantic protection |

**Analysis:** Nothing stops a rest task from being created today. The failure mode is *later*: a P5 assignment displaces "movie night" via 1E's eviction rule, and the burnout mitigation silently dissolves. Rest tasks exist precisely to resist that pressure.

**Proposed resolution — protected tags (convention over new type):**

```js
config.protectedTags: ['rest', 'break', 'recovery']
```

- A task whose tags intersect `protectedTags` becomes **pinned-equivalent once placed**: `resolveDropConflicts()` will not auto-evict it (drops onto it snap back, same as pinned), and re-optimize will not move it.
- Manual drag by the user still wins (R-1) — you can always move your own movie night.
- **Visual:** protected tasks render with a **full-card sea-glass-green tint** (`--color-success` at low opacity over `--color-surface`) — no icon (the wave motif is already spoken for by the resize borders). Text uses `--color-dark` to hold WCAG AA on the green surface. The non-color indicator (per the no-color-alone rule) is the task's own rendered tag chip (`rest` / `break` / `recovery`), which is what makes it protected in the first place.
- A content-less blocker ("Free time", no details) is legal — title is the only required field (formalized in 7A).

**Deferred (adjacent to excluded scope):** proactively *suggesting* rest when overload is detected belongs to the excluded recommendation engine. The spec only guarantees rest survives once the user schedules it.

## 2C — Study zone: all homework routes into defined blocks this week

| | |
|---|---|
| **User action** | Define region(s) of the week; expect study-tagged tasks to auto-place only there |
| **System must** | Restrict placement of matching tasks to zone windows; render zones on the grid |
| **Coverage** | ❌ GAP — this is a placement *constraint*, not a Task |

**Proposed resolution — `Zone` becomes a third class (architecture is now Task / Schedule / Zone):**

The original schema (`days[] + one start/end`) cannot express "Thursday 6–8pm *and* Wednesday 7–9pm in one zone." Zones need per-day windows:

```js
class Zone {
  id            // auto-slug from label
  label         // 'Sports & Recovery'
  matchTags     // ['sports', 'rest', 'recovery']
  windows       // [{ day: 'thu', start: '18:00', end: '20:00' },
                //  { day: 'wed', start: '19:00', end: '21:00' }]
  exclusive     // boolean, default true (per OD-4)
  color         // optional tint override; defaults to soft aqua

  windowsForDay(day)        // → windows on that day (a day may have several)
  containsRange(start, end) // → boolean: does [start,end] fit inside one window?
  matches(task)             // → boolean: task.tags ∩ matchTags ≠ ∅
}

// Schedule gains:
zones: Zone[]
addZone(data), removeZone(id), updateZone(id, changes)
```

**Placement rules (unchanged in spirit, restated against the class):**
1. `zone.matches(task)` → slot search runs only inside that zone's windows (∩ deadline constraints, 2D).
2. `exclusive: true` (the default): zone windows are subtracted from general placement windows for non-matching tasks.
3. A task matching multiple zones → union of all their windows.

**Rendering:** each zone draws as a tinted background region behind the cards (zone `color` at ~12% opacity), label revealed on hover.

> **OD-4 — RESOLVED:** `exclusive: true` is the default.

> **OD-5 — RESOLVED:** A zone editor **is in scope** — it lives in the **Cabana** (see R-3), where users create zones, name them, pick match tags, and add/remove per-day windows.

## 2D — Assignment due Wednesday, but my study block is Saturday

| | |
|---|---|
| **User action** | Add a study task with a due date that precedes its zone's capacity |
| **System must** | Place it before the deadline even if that violates the zone |
| **Coverage** | ❌ GAP — no deadline concept exists |

**Proposed resolution — `deadline` property + constraint precedence:**

```js
deadline: Date | null      // new Task property
```

1. A task with a deadline may only occupy slots **ending ≤ deadline**.
2. **Precedence: deadline > zone.** If the matching zone has no capacity before the deadline, the zone constraint relaxes and the task places in general windows pre-deadline, flagged with an **info badge** ("placed outside Study zone — due Wed"). Deadlines are hard; zones are preferences.
3. No capacity *anywhere* pre-deadline → `schedulingWarning = true`, coral badge, task parks in the best pre-deadline gap even if break padding is violated. **Visible beats invisible** — a cramped warning on the grid is actionable; a vanished assignment is a catastrophe.
4. Popover/detail modal gain a deadline field; cards with deadlines show a small due-date chip.

## 2E — Assignments due Wed & Thu, different priorities, Monday packed

| | |
|---|---|
| **User action** | Rely on autoSchedule to order competing deadline work correctly |
| **System must** | Not let a high-priority Thursday task starve a lower-priority Wednesday one |
| **Coverage** | ❌ GAP — priority-DESC sorting alone fails this case |

**Analysis:** Pure priority order could burn Tuesday's remaining capacity on the Thursday assignment, leaving the Wednesday one unplaceable pre-deadline. The missing variable is **slack**: how much free capacity exists between now and each task's deadline, relative to its duration.

**Proposed resolution — urgency-aware sort:**

```js
slack(task) = freeCapacityBefore(task.deadline) − task.getDuration()
urgent(task) = task.deadline && slack(task) < task.getDuration() × config.urgencyFactor  // default 1.5
```

Sort order for placement candidates:
1. **Urgent tasks first**, ordered by slack ascending (most endangered first)
2. Then priority DESC (the normal rule — applies to all non-urgent tasks, deadline or not)
3. Then deadline ascending, duration DESC, title ASC (determinism)

- Slack is **recomputed after every placement** (greedy-with-recompute) — placing one task changes everyone else's free capacity.
- Effect on the example: Monday packed → Wednesday assignment's slack (computed over Tue only) trips the urgency test → it places first regardless of priority; the Thursday task follows; priority resumes control once nobody is endangered.
- `urgencyFactor` joins `config.weights` as a tunable — same "play with the weights" treatment.

> **OD-6 — RESOLVED → the Cabana (R-3):** The tuning drawer is absorbed into a single settings hub.

---

## R-3 — The Cabana (settings & configuration hub)

A slide-over panel, opened from a corner button (Lucide `Palmtree` icon), containing everything *meta-level* — configuration of the system rather than individual tasks:

| Section | Contents |
|---|---|
| **Zones** | Zone builder: create/edit/delete zones — label, match tags, per-day windows (add/remove window rows), exclusivity toggle, tint color |
| **Tag roles** | Assign behavior to tags: mark tags as protected (`protectedTags` editor), see which zones each tag routes to |
| **Tuning** | Sliders for `weights.proximity / balance / stability` and `urgencyFactor`, plus a "Re-optimize week" button for live experimentation against seed data |

**Design — the cozy brown surf shack:** the Cabana deliberately breaks from the cool ocean palette into warm driftwood tones — you step *off the beach and into the shack*:

```css
--cabana-bg: #4E3B2A;         /* dark driftwood */
--cabana-surface: #6B5138;    /* warm plank */
--cabana-trim: #8B6F52;       /* weathered wood trim */
--cabana-text: #F5E9D9;       /* sun-bleached canvas */
--cabana-accent: #FFD166;     /* CTA gold carries through */
```

Wood-plank feel via subtle horizontal border striping on section dividers (CSS only, no images) — **upgraded to real art if the sprite sheet lands (Appendix A): plank texture background, driftwood sign headers, surfboard dividers.** Controls inside use the same interaction patterns as the rest of the app (chips, toggles, sliders) restyled to the warm palette. Slide-in from the right, 250ms, same easing as the add-task panel; respects reduced-motion.

**Build order placement:** Cabana is built **after** the add-task panel. Internal priority if budget tightens: Tuning sliders → Zone builder → Tag roles.

---

## Situation 2 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| `config.protectedTags` + pinned-equivalent placement rule | Config + algorithm | 2B |
| Full-card sea-glass tint on protected tasks (tag chip as non-color indicator) | UI | 2B |
| **`Zone` class** (per-day windows, matchTags, exclusive default true) — architecture is now 3 classes | Class (new) | 2C, OD-4 |
| `Schedule.zones` + `addZone/removeZone/updateZone` | Methods (new) | 2C |
| Zone background rendering on grid | UI | 2C |
| **Cabana**: zone builder, tag roles, tuning sliders — warm surf-shack palette | UI hub (R-3) | OD-5, OD-6 |
| `--cabana-*` color tokens added to design system | Design | R-3 |
| `deadline: Date \| null` on Task | Property (new) | 2D |
| Constraint precedence: deadline > zone > preference | Algorithm rule | 2D |
| Info badge (outside-zone) & due-date chip | UI | 2D |
| `slack()` computation + urgency-aware sort | Algorithm (revised) | 2E |
| `urgencyFactor` tunable | Config | 2E |

**Open decisions:** OD-4 ✅ · OD-5 ✅ · OD-6 ✅ — Situation 2 closed.

# Situation 3 — My week gets disrupted

Reactive, mid-week chaos. Tests: bulk operations (a whole day at once), cascade effects (one delay rippling downstream), and reclaiming freed time. Situations 1–2 were about *placing* tasks; Situation 3 is about *re-flowing* them under pressure.

## 3A — Sick on Tuesday: everything moves somewhere later in the week

| | |
|---|---|
| **User action** | Clear an entire day with one action |
| **System must** | Relocate all movable Tuesday tasks to later slots; surface the immovable ones for a human decision; optionally block the day |
| **Coverage** | ❌ GAP — no bulk operation exists; task-by-task dragging is unacceptable UX for being sick |

**Proposed resolution — `Schedule.evacuateDay()`:**

```js
evacuateDay(date, { blockDay: boolean }) → {
  relocated: Task[],     // flexibles moved via scored placement, forward-only
  needsReview: Task[],   // pinned / fixed / protected — NOT auto-moved
  warned: Task[]         // no valid slot found in lookahead → schedulingWarning
}
```

1. **Movable** = flexible ∧ unpinned ∧ not protected-tag. Each relocates via the standard scoring function, with the search restricted to **after** the evacuated day (forward-only — you're sick *now*).
2. **Immovable** (pinned, fixed, protected) tasks are never silently moved: they're listed in a confirmation dialog — "These 2 need your call: Team standup (fixed), Gym (pinned)" — with per-task quick actions (move to next same-weekday / unpin & relocate / leave).
3. `blockDay: true` → after evacuation, a full-day protected blocker task ("Out sick", tag `rest`) is created so nothing flows back in via later displacement or re-optimize.

**UI:** each day column header gets a small `⋯` menu → **"Clear this day"** → confirmation dialog (shows counts + the needsReview list + a "block this day" toggle). Relocated cards animate to their new homes.

> **OD-7 — RESOLVED:** "Clear this day" opens a **Clear Day panel** (not a simple confirm dialog):
> - **Scope choice:** clear flexibles only, or **full clear** (everything).
> - **Full clear rule:** pinned/fixed tasks are never batch-moved — each one renders as its own row with a **"Reschedule" button that must be hit individually** (opens a mini slot-picker: next same-weekday / next free slot / pick manually via Find Times). The panel's main **"Clear day"** action stays disabled until every pinned/fixed row is resolved (rescheduled or explicitly marked "leave in place" / "skip this week").
> - **Block-day toggle** lives in the panel, default **on** (an evacuated day left unblocked silently refills — the balance weight loves an empty day). Flip it off for "clear but keep the day available."
> - Flexibles relocate on commit via scored forward-only placement, as specced.

## 3B — A meeting ran long: everything after it today shifts back an hour

| | |
|---|---|
| **User action** | Extend a task (sand-border resize) or report a delay; downstream tasks must absorb it |
| **System must** | Ripple the delay through the rest of the day — compressing breaks first, shifting tasks second, evacuating overflow last |
| **Coverage** | ❌ GAP — displacement (1E) handles *one* collision; this is a chain |

**Proposed resolution — `Schedule.rippleShift()`:**

```js
rippleShift(pivotTask, deltaMin) → { shifted: Task[], evacuated: Task[], absorbedByBreaks: number }
```

Three-stage absorption, in order:
1. **Breaks compress first**: the delta is absorbed by shrinking gaps between downstream same-day tasks, down to `config.breaks.minimum` (5 min). A 60-min delay into a day with 45 min of spare break padding only shifts tasks by 15.
2. **Remaining delta shifts tasks**: downstream *movable* tasks slide later by the residual, in order.
3. **Overflow evacuates**: tasks pushed past the day's window end (or into a pinned/fixed anchor with no gap) relocate forward via scored placement — same machinery as `evacuateDay`.

**Anchors don't move:** a pinned/fixed task downstream acts as a wall — flexibles between the pivot and the wall compress into the available space or evacuate; the wall and everything after it stay put.

**Trigger UX:** when a sand-border resize (or drag) creates downstream same-day overlap, a small inline choice appears on drop: **"Ripple day →"** (shift the chain) or **"Displace"** (1E nearest-slot for the collided task only). Escape = snap back.

> **OD-8 — RESOLVED (with magnitude nuance):** Cause sets the *bias*, magnitude can *flip* it. Rationale: a meeting overrunning is usually small (day runs a bit late → ripple), a dropped new task is usually a bigger intrusion (→ displace) — but a 4-hour overrun shouldn't shove the whole evening off a cliff, and a 15-minute drop shouldn't eject an existing task. So the default action is **computed, not fixed**:
>
> ```js
> chooseConflictStrategy(cause, deltaMin, dayState) → 'ripple' | 'displace'
> // cost(ripple)   = total minutes of downstream shift + (evacuationsForced × evacuationPenalty)
> // cost(displace) = Σ score-loss of displaced tasks (distance from original slot, balance hit)
> // bias: cause === 'resize' → ripple cost × 0.8;  cause === 'drop' → displace cost × 0.8
> // → pick the cheaper option as the highlighted default
> ```
>
> - The inline **"Ripple day → / Displace"** chooser still always appears — the heuristic only picks which option is pre-highlighted (and which fires on quick-confirm/Enter). Escape still snaps back.
> - `evacuationPenalty` and the 0.8 bias factor join the Cabana tuning sliders.
> - Worked examples encoded as test cases: +15min resize into a padded day → ripple (breaks absorb it entirely); +4h resize → displace (rippling would evacuate half the evening anyway); 15min task dropped into a tight cluster → ripple wins despite drop-bias; 2h task dropped mid-afternoon → displace.

## 3C — Event cancelled: backfill the freed time, or protect it as recovery

| | |
|---|---|
| **User action** | Delete/cancel a sizable task |
| **System must** | Offer — not impose — three fates for the gap: leave open, backfill, protect |
| **Coverage** | ⚠️ PARTIAL — `removeTask()` frees the time, but reclaiming it is manual |

**Proposed resolution — post-removal toast with three actions:**

On removal of a task ≥ 45 min (config: `backfillOfferThreshold`), a toast offers:
- **Leave open** (default; the toast auto-dismisses to this) — the gap simply exists.
- **Backfill** — a scoped placement pass over the gap, candidate order: (1) `schedulingWarning` tasks, (2) deadline tasks with slack below the urgency threshold, (3) auto-placed flexibles from later in the week *only if* moving them improves their score. User-placed tasks are never backfill candidates.
- **Protect** — creates a rest blocker ("Recovery time", tag `rest`) filling the gap.

**Boundary note:** this stays on the right side of the excluded recommendation engine — it never suggests *what* to do, it only re-runs placement rules on existing tasks when explicitly asked.

## 3D — Finished a task early: does anything move up, or do I just get the gap?

| | |
|---|---|
| **User action** | Mark a task done before its scheduled end |
| **System must** | Record completion; offer the same gap choices as 3C for the remainder |
| **Coverage** | ❌ GAP — no completion concept exists yet |

**Proposed resolution — pull `completion` forward from 6G (it's now load-bearing):**

```js
completion: null | 'done' | 'partial' | 'skipped'    // new Task property
```

- Card gains a check control (hover/detail modal). Marking `done` before `endTime` truncates the block visually (crosshatch on the unused remainder) and fires the **3C toast** for the freed remainder `[now → original end]`.
- Completed tasks stay on the grid (dimmed, struck title) — they're history, not deletions, and `satisfaction` rating attaches to them.
- No proactive "you could pull X forward" prompting — the toast only lists the same three mechanical actions. Anything smarter is recommendation-engine territory (excluded).

## 3E — It's Thursday, half the week incomplete: what carries to next week, what drops?

| | |
|---|---|
| **User action** | End-of-week triage |
| **System must** | Classify incomplete tasks and bulk-move survivors into next week |
| **Coverage** | ❌ GAP — depends on `completion` (3D) and week navigation (5A, unresolved) |

**Proposed resolution — `Schedule.carryOver()` (specced now, UI wired after 5A):**

```js
carryOver(fromWeekStart, toWeekStart) → { carried: Task[], missedDeadline: Task[], dropped: Task[] }
```

Classification of tasks with `completion === null` and `endTime` in the past:
- **Recurring** → never carried; next week's expansion regenerates them naturally.
- **Deadline passed** → not moved; flagged `missedDeadline` (coral, listed for the user — the system doesn't pretend a missed due date is reschedulable).
- **Everything else** → re-placed into the target week via scored placement (candidates re-enter as `placedBy: 'auto'`).

**Session-only caveat (recorded honestly):** with no persistence, carryover only matters within a single session where the user navigates weeks. The method is cheap because it reuses scored placement wholesale; the UI trigger (a "Wrap up this week" action) waits on Situation 5's navigation decisions.

> **OD-9 — RESOLVED (my call, per user delegation):** In plain terms, the question was: `carryOver()` needs a button somewhere, but where that button lives depends on how week-to-week navigation works — which we haven't designed yet (Situation 5A). Decision: **write and test the `carryOver()` function now** (it's cheap — it reuses scored placement wholesale), and **decide its UI trigger when we design week navigation** in Situation 5. Nothing is built twice; nothing blocks.

---

## Situation 3 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| `evacuateDay(date, {blockDay})` | Method (new) | 3A |
| Day-column `⋯` menu + **Clear Day panel** (per-pinned individual Reschedule required for full clear; block-day toggle default on) | UI | 3A, OD-7 |
| `rippleShift(pivot, deltaMin)` — breaks compress → tasks shift → overflow evacuates | Method (new) | 3B |
| `chooseConflictStrategy()` — magnitude-aware ripple/displace default; chooser always shown | Algorithm + UI | 3B, OD-8 |
| `evacuationPenalty` + strategy bias factor → Cabana tuning | Config | OD-8 |
| Post-removal toast: leave / backfill / protect (`backfillOfferThreshold: 45`) | UI + scoped placement | 3C |
| `completion: null \| 'done' \| 'partial' \| 'skipped'` on Task (pulled forward from 6G) | Property (new) | 3D |
| Check control, crosshatch remainder, dimmed done-styling | UI | 3D |
| `carryOver(from, to)` | Method (new; UI trigger decided at Situation 5) | 3E, OD-9 |

**Open decisions:** OD-7 ✅ · OD-8 ✅ · OD-9 ✅ — Situation 3 closed.

# Situation 4 — Recurring commitments collide with real life

Recurrence is easy until reality edits it. Tests: one-off exceptions, permanent changes, temporary changes, non-weekly cadence, and who wins when a one-off lands on a recurring slot. R-4's windows schema solved *multi-time* recurrence; this situation forces the rest of the recurrence model.

## Schema revision — `recurring` grows into `recurrence` (supersedes part of R-4)

R-4's windows shape survives intact, but it becomes one field inside a richer object — because 4A–4E all need things a bare windows array cannot express:

```js
recurrence: null | {
  periods: [{
    windows: [{ day, start, end }],   // R-4 shape, unchanged
    interval: 1,                       // every N weeks (4D: 2)
    effectiveFrom: Date | null,        // 4B, 4E
    effectiveUntil: Date | null
  }],
  anchorDate: Date,                    // week-parity reference for interval math
  exceptions: [{
    date: 'YYYY-MM-DD',                // identifies ONE occurrence
    action: 'skip'                      // 4A
          | 'move',                     // 4C — with new start/end
    start?, end?
  }]
}
```

**Occurrence identity & materialization:** occurrences are **virtual** — generated at read time by `getTasksForWeek()` expanding active periods (minus skips, plus moves), each with id `${taskId}@${date}`. They render and behave as fixed anchors. Per-occurrence lived data (`completion`, `satisfaction`, `history` counters — the ML training signal) is stored in an `occurrenceData` map on the parent task, keyed by date. Editing an occurrence never mutates the pattern; it writes an exception or occurrenceData entry.

> **OD-12:** Sign-off on virtual occurrences + `occurrenceData` map (vs. materializing occurrences as real persisted Tasks). Virtual is proposed: no duplication drift, patterns stay editable in one place, and serialization stays small.

## 4A — Class cancelled just this week: skip one instance, keep the pattern

| | |
|---|---|
| **Coverage** | ✅ COVERED by the revision — `exceptions: [{ date, action: 'skip' }]` |

Occurrence context menu / detail modal: **"Skip this occurrence"**. The slot frees; backfill toast (3C) applies. The pattern is untouched — next week materializes normally.

## 4B — Gym moves permanently from evenings to mornings, starting next month

| | |
|---|---|
| **Coverage** | ✅ COVERED by the revision — period splitting |

Editing a recurrence "from date X onward" closes the current period (`effectiveUntil: X`) and opens a new one with the new windows (`effectiveFrom: X`). One task, one history — the ML model keeps its accumulated signal for the gym rather than starting over on a "new" task. The recurrence editor asks the one crucial question on any pattern edit: **"From now on, or including the past?"** (default: from now on — rewriting history is almost never intended).

## 4C — A one-off appointment lands exactly on a recurring slot

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — conflict machinery exists (1E) but its options are wrong for recurring targets |

A materialized occurrence is a fixed anchor, so 1E as written would simply reject the drop. That's too rigid — sometimes the appointment legitimately wins. Dropping onto a recurring occurrence opens an **occurrence-scoped mini-menu** (no silent default — intent here is genuinely ambiguous):

- **Move this occurrence** → writes a `move` exception; the occurrence relocates via scored placement (same-day preferred); appointment takes the slot
- **Skip this occurrence** → skip exception; appointment takes the slot
- **Cancel** → snap back (Escape)

The *pattern* is never displaced by a drop — only the single occurrence. Cost-heuristic defaults (OD-8) don't apply here; recurring-vs-one-off is a judgment call the user makes.

## 4D — "Laundry Sunday," but only every other week

| | |
|---|---|
| **Coverage** | ✅ COVERED by the revision — `interval: 2` + `anchorDate` parity |

Materialization test: `weeksBetween(anchorDate, weekStart) % interval === 0`. The recurrence editor exposes interval as "every / every 2nd / every 3rd / every 4th week."

## 4E — Standup runs 30 minutes later during summer only

| | |
|---|---|
| **Coverage** | ✅ COVERED by the revision — a bounded period sandwich |

Three periods: normal (until June 1) → summer windows, +30min (June 1 – Sept 1) → normal again (from Sept 1). The editor supports this as "temporary change: from … until …", which builds the sandwich automatically — the user never hand-manages three period rows.

---

## Situation 4 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| `recurrence` object: periods (windows + interval + effective range) + exceptions + anchorDate | Schema (revises R-4's outer shape; windows shape unchanged) | 4A–4E |
| Virtual occurrences, id `taskId@date`, materialized at read time as fixed anchors | Architecture | OD-12 |
| `occurrenceData` map: per-occurrence completion / satisfaction / history (ML signal preserved per instance) | Property (new) | OD-12, R-5 |
| "Skip this occurrence" action + backfill hook | UI + method | 4A |
| Period-splitting edit: "from now on / including past?" prompt | Method + UI | 4B |
| Occurrence-scoped drop menu (move / skip / cancel — no silent default) | UI + conflict rule | 4C |
| `interval` + parity materialization; editor exposes every-Nth-week | Algorithm + UI | 4D |
| "Temporary change from–until" editor building period sandwiches | UI | 4E |

**Open decisions for sign-off:** OD-12 (virtual occurrences + occurrenceData map).

# Situation 5 — Planning ahead / multi-week

The engine was specced week-relative from the start (`getTasksForWeek(weekStart)`), so most of Situation 5 is about *navigation, spreading work over ranges, and load visibility* — plus finally paying the OD-9 debt (where carryOver's trigger lives).

## 5A — Schedule a task for a specific day two weeks out

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — engine ready (any `weekStart` works; recurrence materializes for any week), navigation UI missing |

**Proposed resolution — week navigation:**

- App state gains `currentWeekStart`; controls: **‹ prev / Today / next ›** + a date-picker jump. All grid rendering, autoSchedule scoping, and zone/recurrence materialization key off `currentWeekStart` (already true by design).
- Add-task panel gains a date field (defaults to a day in the viewed week).
- **Week `⋯` menu** (sibling to the nav controls) collects week-level operations: **Re-optimize week**, **Wrap up week** (see below), **Block days…** (5C).

**OD-9 debt paid — carryOver trigger:** two surfaces, same method:
1. **"Wrap up week"** in the week `⋯` menu — explicit, always available.
2. A **banner** when viewing a *past* week that still has incomplete tasks: "4 unfinished tasks this week — carry them forward?" One-click runs `carryOver()` into the current real week and shows the classified result (carried / missed-deadline / recurring-skipped).

> **OD-13 — RESOLVED, with a design principle attached:** Banner + menu approved, but shaped by the user's rule, now recorded as **P-1: the app never guilts.** Some things get skipped and never returned to, and that's okay — the system's job is memory, not pressure. Concretely:
> - The past-week banner appears **once**, is fully dismissible, and never re-nags for that week.
> - It offers two equal-weight actions: **"Carry forward"** (runs carryOver) and **"Let them go"** (marks them `completion: 'skipped'` — a clean, recorded, guilt-free end state, which also feeds the ML model honest data about what didn't fit).
> - No red badges, no streak-breaking language, no unfinished-count nagging anywhere in the app. Warnings exist for *scheduling physics* (coral = "this won't fit"), never for *moral bookkeeping*.

## 5B — Spread 10 hours of project work across the next two weeks in chunks

| | |
|---|---|
| **Coverage** | ❌ GAP — tasks are atomic; nothing expresses "this much total work, in pieces, over this range" |

**Proposed resolution — chunked tasks:**

```js
chunking: null | {
  totalMinutes: 600,
  minChunk: 60, maxChunk: 180,        // no 15-min crumbs, no 6-hour marathons
  range: { from: Date, until: Date }  // 'until' feeds slack math like a deadline
}
```

- On creation, the task **materializes as real child tasks** (`parentId` linking them), sized between min/maxChunk, placed by the normal scored pipeline across the range — spread-before-stack applies naturally, zones/protected rules apply per chunk.
- Children are ordinary tasks afterward: individually draggable, completable, rateable (each is an ML sample). Completing a chunk decrements the parent's remaining total; the parent is a bookkeeping record, not a grid object.
- **Re-optimize may re-slice unplaced/auto-placed chunks** (e.g., merge two 60s into a 120 if the week opens up) but never touches completed or user-placed ones.
- `range.until` enters the urgency computation (2E) as a deadline — a starving chunk set trips `schedulingWarning` per-chunk.

> **OD-14 — RESOLVED, expanded into Projects:** Materialized chunks approved, and chunked tasks get **their own creation flow: "Add project"** alongside "Add task" (total hours + min/max chunk + date range + tags/zone, instead of a single time slot). Two behavioral rules added:
>
> **Work conservation (resize redistributes, both directions):**
> - **Shrink a chunk by Δ** → Δ doesn't vanish: if siblings can absorb it (grow toward `maxChunk`, scored placement validates the growth), they do; any remainder ≥ `minChunk` spawns a new chunk in the range; a sub-`minChunk` residue merges into the nearest sibling. No capacity anywhere → parent gets `schedulingWarning` ("2h of Thesis has nowhere to go").
> - **Grow a chunk by Δ** → symmetric: future auto-placed siblings shrink toward `minChunk` or dissolve, since the total is conserved — you did more now, so there's less later.
> - **Delete a chunk** → asks once: **"Remove this work, or redistribute it?"** (delete = total shrinks; redistribute = conservation rules run).
> - User-placed and completed chunks are never auto-resized by conservation — only auto-placed siblings flex.
>
> **Early completion:** marking the **project** complete (or its last meaningful chunk, via "Finish project here" on any chunk) → all remaining incomplete chunks disappear, parent records `completion: 'done'` with actual-vs-planned minutes kept for the ML/stats layer. Per P-1: chunks that vanish this way are victory, not debris — no confirmation guilt, one-click undo toast instead.

## 5C — Friend visits next weekend: block the whole weekend now

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — protected blockers (2B) cover one day; multi-day needs a helper, not a new concept |

**Proposed resolution — `blockRange()`:**

```js
blockRange(fromDate, toDate, label = 'Blocked') → Task[]  // one full-day protected blocker per day
```

- Emits per-day blocker tasks (tag `rest`-family, protected) rather than one multi-day task — the grid renders day columns, and per-day blockers need zero new rendering logic; they also unblock individually ("actually Sunday evening is fine" = delete one).
- Trigger: **"Block days…"** in the week `⋯` menu (date range + label). Flexible tasks already in the range evacuate via the standard forward-only scored placement (evacuateDay machinery, iterated).

## 5D — Compare this week vs. next week's load before saying yes to something

| | |
|---|---|
| **Coverage** | ❌ GAP — no load metric exists |

**Proposed resolution — `getWeekLoad()`:**

```js
getWeekLoad(weekStart) → {
  scheduledMin, capacityMin,            // capacity = Σ day windows (config), zones included
  fillRatio,                            // scheduled / capacity
  perDay: [{ day, scheduledMin, capacityMin, fillRatio }],
  warnings: int                         // schedulingWarning count that week
}
```

- Pure query; also the engine behind 6C's per-day load indicator and 6H's chronic-overpack warning later — one metric, three consumers.
- **UI (deferred to the drawing):** minimum viable = a small fill bar beside the week nav; hovering ‹ › previews the adjacent week's bar so "can I take this on?" is answerable without navigating.

---

## Situation 5 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| `currentWeekStart` state + ‹ Today › nav + date-jump | UI + state | 5A |
| Week `⋯` menu: Re-optimize · Wrap up week · Block days… | UI | 5A, 5C |
| carryOver triggers: menu action + past-week banner | UI (pays OD-9) | 5A, OD-13 |
| `chunking` config on Task → materialized child tasks via `parentId`; re-slicing rules; range.until in slack math | Schema + algorithm (new) | 5B, OD-14 |
| `blockRange(from, to, label)` — per-day protected blockers + evacuation | Method (new) | 5C |
| `getWeekLoad(weekStart)` | Method (new) | 5D |

**Open decisions for sign-off:** OD-13 (carryOver banner+menu), OD-14 (materialized chunks).

# Situation 6 — Reviewing and adjusting

The retrospective loop. Much of this situation was written before the learning module (R-5), the Wrap report (R-7), persistence (OD-10), and `getWeekLoad` (5D) existed — so a large share now classifies as covered. The connective principle for everything new here, a corollary of P-1: **insights live in the Wrap report and the Cabana — never as in-app nagging.** The grid is for doing; the report is for reflecting.

## Rapid classification

| Case | Coverage | Mechanism |
|---|---|---|
| **6A** — do low-rated tasks share a pattern? | ✅ | R-5 feature vector *is* this (tag × time × day); surfaced in R-7 stats + Cabana insights ("learned preferences") |
| **6C** — per-day load indicator | ✅ | `getWeekLoad().perDay` (5D); UI = column-header fill tint, design at drawing time |
| **6E** — evenings rate 2/5, mornings 4/5 → prefer mornings | ✅ | Literally R-5's purpose — the `w.preference` scoring term |
| **6G** — done / partial / skipped | ✅ | Pulled forward at 3D |
| **6K** — real vs allocated duration | ⚠️ deliberate | `durationFit` facet already captures this qualitatively; report suggests ("homework runs long 70% of the time — consider 90m blocks"). Quantitative time-tracking **rejected**: logging actual minutes is friction that kills rating compliance (R-5's own rule) |

## 6B — I keep dragging my 8am workout to 10am

| | |
|---|---|
| **Coverage** | ❌ GAP — the model learns time preferences for *placement*, but recurrence windows are user-authored patterns it never touches |

**Resolution — pattern-drift detection:** `driftCheck(task)` computes the median signed move delta across the last N occurrences (from `occurrenceData` move exceptions + `moveCount`). Consistent drift (≥4 of last 5 moved, same direction, ≥30min median) → a **Wrap-report suggestion** with one-click apply: "Gym moved ~+2h in 4 of the last 5 weeks — update the pattern to 10am?" Applying runs the 4B period-split ("from now on"). Report-only per the corollary; the grid never pesters.

## 6D — A task keeps getting displaced and never actually happens

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — `displacedCount` exists per-task, but starvation spans weeks |

**Resolution:** `carryOver()` increments a new `history.carriedCount`; the report's **starvation detector** flags tasks with `displacedCount + carriedCount ≥ 3` lifetime: *"Guitar practice has been displaced 3× and carried 2 weeks."* Two equal-weight one-click actions per P-1: **Pin it next week** or **Let it go** (`skipped`). The system diagnoses; the human decides; neither choice is framed as failure.

## 6F — Where did my hours actually go, by tag?

| | |
|---|---|
| **Coverage** | ❌ GAP (small) — R-7 promised it; the query doesn't exist yet |

**Resolution:** `getTagBreakdown(weekStart) → [{ tag, scheduledMin, completedMin, avgShells }]`, pure query, completed-tasks based, multi-tag tasks count toward each tag (documented as such — no fractional splitting, it lies less than it seems). Consumed by R-7's stats section; also renderable in the Cabana.

## 6H — Breaks pinned at the 5-minute floor every day; warn me before the week, not after

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — R-7 flags it retrospectively; the ask is *prospective* |

**Resolution:** post-`autoSchedule()` check: if ≥3 days land with average break ≤ `breaks.minimum × 1.5`, a **one-time, non-modal, dismissible notice** appears: "This week is packed — breaks are compressed to near-minimum on 4 days." No red, no imperative, one suggestion at most ("Block some recovery time?" → 3C protect action). Fires only on full autoSchedule runs, never on individual drags. This is scheduling physics, so it's allowed on the grid (P-1 boundary: physics yes, morality no).

## 6I — I pinned 14 things; at what point does pinning defeat the purpose?

| | |
|---|---|
| **Coverage** | ❌ GAP (tiny) |

**Resolution:** `pinnedRatio` (pinned minutes / scheduled minutes) joins `getWeekLoad()`. Report-only observation when > 0.5, phrased as information, not correction: "62% of your week was pinned — the scheduler could only move things inside the remaining 38%." No in-app counter, no cap, no warning color. If someone wants to pin everything, that's a legitimate way to use a calendar.

## 6J — Planned vs. actual: the week autoSchedule built Monday vs. the week that happened

| | |
|---|---|
| **Coverage** | ❌ GAP — needs a snapshot, now cheap because persistence exists |

**Resolution:** `Schedule.snapshot()` captures a lightweight placement record (task id → start/end) at the week's first `autoSchedule()`; stored per-week via StorageAdapter. The Wrap report diffs snapshot vs. final: tasks moved, total drift minutes, biggest single change, days that survived intact. Framed as observation ("Tuesday went exactly to plan; Thursday reshuffled 4 times"), feeding self-knowledge, not compliance scoring.

## 6L — Skipped the gym three weeks running; flag it for renegotiation

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — skip data exists per-occurrence (`occurrenceData`), streak detection doesn't |

**Resolution:** skip-streak detector over `occurrenceData`: a recurring task with all occurrences skipped/unrated for ≥3 consecutive weeks gets a report line with the same P-1 pair: **Change the pattern** (opens recurrence editor) or **Let it go** (ends the recurrence via `effectiveUntil: now` — the pattern gets a clean, recorded end, not a lingering ghost).

---

## Situation 6 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| P-1 corollary: insights are report/Cabana-borne; grid nags never | Principle | all |
| `driftCheck()` + one-click pattern update from report | Method + report | 6B |
| `history.carriedCount`; starvation detector (pin it / let it go) | Property + report | 6D |
| `getTagBreakdown(weekStart)` | Method (new) | 6F |
| Post-autoSchedule overpack notice (non-modal, physics-not-morality) | Behavior + UI | 6H |
| `pinnedRatio` in `getWeekLoad`; report observation > 0.5 | Metric | 6I |
| `Schedule.snapshot()` + planned-vs-actual diff in report | Method + report | 6J |
| Skip-streak detector (change pattern / let it go via `effectiveUntil`) | Report + method | 6L |

**Open decisions:** none — all defaults follow P-1 and prior rulings; flag anything you'd tune (thresholds: drift 4-of-5/30min, starvation ≥3, overpack 3 days, pinnedRatio 0.5, skip-streak 3 weeks — all live in config regardless).

# Situation 7 — Quick capture / messy input

The smallest situation: constructor semantics and destructive-action flows. Quick capture must never punish incompleteness (P-1 adjacent: friction kills capture the way nagging kills honesty).

## 7A — Task with only a title: no time, no duration, no type

| | |
|---|---|
| **Coverage** | ⚠️ PARTIAL — defaults exist piecemeal; the cascade needs to be one documented contract |

**Resolution — the defaults cascade (constructor contract):**

```js
new Task({ title: "Call plumber" }) →
  type: 'flexible'          priority: 3           pinned: false
  duration: config.defaultDuration (60 min)       tags: []
  deadline: null            recurrence: null      placedBy: 'auto'
```

- **Placed immediately** on add via scored placement — no "unscheduled tray" (resolving the open question from the original spec discussion: a tray is UI surface + a limbo state; immediate placement means every task is always somewhere, and dragging it is cheap).
- Title remains the only required field; the add UI disables submit on empty rather than letting the constructor throw at a user.

## 7B — "Dentist, Friday 2pm" — fixed, but I forgot to pin it, and drag something onto it

| | |
|---|---|
| **Coverage** | ✅ COVERED — by the 1E drop rule, which protects fixed *and* pinned |

The dentist is safe: drops onto fixed tasks snap back. This case mainly demands the **semantics table** be explicit, since fixed/pinned confusion is the likeliest user misunderstanding in the app:

| | moved by autoSchedule? | evicted by displacement? | drop onto it? | draggable by user? |
|---|---|---|---|---|
| **flexible** | yes | yes | displaces/ripples it | yes |
| **fixed** | never | never | rejected (snap-back) | yes (user > all, R-1) |
| **pinned** (either type) | never | never | rejected (snap-back) | yes |
| **protected tag** | not after placement | never | rejected | yes |

Pinning adds over `fixed`: the frosted-glass "don't touch" signal, exclusion from Clear Day bulk moves (individual reschedule required, OD-7), and applicability to *flexible* tasks.

## 7C — Duplicate a task to do the same thing twice this week

| | |
|---|---|
| **Coverage** | ❌ GAP — and it exposes a latent bug in the original spec: `clone()` **keeps the same id** by design (ghosts, optimistic edits). Using it for duplication would create two tasks with one identity |

**Resolution — separate the two intents:**

```js
clone()       // same id — internal: drag ghosts, popover optimistic edit. Never enters tasks[].
duplicate()   // NEW id; resets completion, satisfaction, history counters, placedBy → 'auto';
              // recurrence NOT copied (duplicating "gym" shouldn't fork the pattern — copy is one-off);
              // placed via scored placement (next free slot)
```

UI: "Duplicate" in the card context menu / detail modal.

## 7D — Delete a recurring task: this instance, or all of them?

| | |
|---|---|
| **Coverage** | ✅ COVERED by the recurrence schema (Situation 4) — this is purely a flow decision |

Delete on a recurring occurrence opens three options, each mapping to existing machinery:
- **This occurrence** → skip exception (4A)
- **This and future** → `effectiveUntil: now` on the active period — pattern ends cleanly, history intact
- **Entire task & history** → true deletion; the one destructive path, so the one with a confirm — which honestly states the stakes: "removes N past occurrences and their ratings (the model forgets this task)."

---

## Situation 7 — resulting spec deltas

| Delta | Type | Source |
|---|---|---|
| Defaults cascade as constructor contract; `config.defaultDuration: 60` | Contract + config | 7A |
| Immediate placement on add — no unscheduled tray (resolves early open question) | Behavior ruling | 7A |
| Fixed/pinned/protected semantics table | Documentation (load-bearing) | 7B |
| `duplicate()` distinct from `clone()`; clone stays same-id internal | Method (new) + clarification | 7C |
| Recurring delete flow: occurrence / future / everything (only the last confirms) | UI flow | 7D |

**Open decisions:** none.

---

**ANALYSIS COMPLETE — Situations 1–7 closed, OD-1 through OD-15 resolved, principles P-1 and rulings R-1 through R-7 recorded.** This document becomes the secondary decision-record; the consolidated build spec supersedes it as the primary reference.

---

# Learning module — satisfaction → placement preferences (R-5)

**Scope boundary (explicit):** the excluded "What To Do" engine suggested *what to do*. This module only learns *where/when placements satisfy you* and feeds that into slot scoring. No task suggestions, ever.

## Satisfaction becomes structured (single shells score is not trainable data)

```js
satisfaction: null | {
  overall: 1 | 2 | 3 | 4 | 5,   // the shells
  timingFit: -1 | 0 | 1,        // too early / just right / too late
  durationFit: -1 | 0 | 1,      // too short / just right / too long
  energy: -1 | 0 | 1            // drained me / neutral / energized me
}
```

- **Rating UX = one tap + three optional taps.** Shells alone are a valid rating (facets default 0/unset) — friction kills data collection, so facets are never required.
- Prompted when a task is marked `done`/`partial` (3D check control); editable later in the detail modal.

**Implicit signals** (logged automatically, no user effort) — counters on Task:

```js
history: { moveCount, displacedCount, rippleCount }   // how contested was this placement
```

## Feature vector & model

Per rated task: tag indicators (top-N tags), time-of-day bucket (early-morning / morning / midday / afternoon / evening / night), day-of-week, duration bucket, priority, day-fill ratio at completion, placedBy, moveCount. Target: `overall` normalized to [0,1], with `timingFit`/`energy` as auxiliary signal (timingFit ≠ 0 doubles that sample's weight on time features).

**Model: ridge-regularized linear regression, plain JS gradient descent** (~30 lines, no TF.js). Chosen deliberately: weights are directly inspectable, so the Cabana can render learned preferences in human terms ("study scores +0.8 in mornings, −0.6 after 8pm"). Deterministic given the same data.

## Integration into placement

```js
score(slot) = w.proximity · proximityScore + w.balance · balanceScore
            + w.stability · stabilityBonus + w.preference · modelScore(task, slot)
```

- `w.preference` default 0.15 (weights renormalized); slider in the Cabana like the rest.
- **Cold start:** `w.preference` is forced to 0 until ≥ 10 rated tasks exist — the model never influences placement on noise.

## Retraining cadence

- **End of each week** — hooked to the week-rollover moment (same trigger surface as `carryOver()`), plus a manual **"Retrain now"** button in the Cabana (with sample count shown: "trained on 23 rated tasks").

> **OD-10 — RESOLVED: layered persistence (adapter + export/import + exit reminder).**
>
> **Constraint note (recorded honestly):** raw `localStorage` fails inside Claude.ai artifacts — the sandbox blocks browser storage APIs. It is therefore never called directly. Instead:
>
> **1. `StorageAdapter`** — one interface, feature-detected backends in priority order:
> ```js
> // tries each, falls through on failure (try/catch per backend):
> // 1. window.storage   — artifact persistence API (works on claude.ai, survives refresh)
> // 2. localStorage     — guarded; activates only if the code is run OUTSIDE claude.ai
> //                       (user's own environment) — this is the "backup" layer
> // 3. in-memory        — final fallback; app always works, persistence indicator shows 'session only'
> ```
> Auto-save: full state (tasks, zones, config, ratings, model weights) serialized via `toJSON()`, debounced 2s after any mutation. A small status dot shows which layer is live (green = persistent, amber = session-only).
>
> **2. Export / Import (the "footlocker", lives in the Cabana):**
> - **Export** → downloads `schedule-YYYY-MM-DD.json` (versioned schema, `{ schemaVersion: 1, ... }`) to the user's folder.
> - **Import** → file picker, validates schema version, dry-run parse with a summary ("42 tasks, 3 zones, model trained on 23 ratings — replace or merge?") before committing.
>
> **3. Exit reminder:** a `beforeunload` handler prompts when there are changes since the last export — with the honest caveat that sandboxed iframes may not always deliver the event. So it's backed by an in-app **unsaved-changes indicator**: the export button shows a badge counting mutations since last export, and a gentle toast reminder fires at 25+ unexported changes. The reminder is about *export* specifically (file in your folder = the durable copy you own); auto-save to `window.storage` continues regardless.

---

# R-6 — "What To Do" button (reinstated)

**History:** the original prompt excluded this ("out of scope for this build"). User has reversed that decision now that the learning module (R-5) exists to power it properly.

**Scope (deliberately narrow):** the button answers *"of my existing tasks, what should I do right now?"* It **ranks existing tasks — it never invents new ones.**

```js
whatToDo(now = new Date()) → Array<{ task, score, reasons: string[] }>   // top 3
```

Ranking inputs, all pre-existing machinery:
1. **Fits the current gap** — task duration vs. time until the next anchor (`_walkGaps`)
2. **Urgency** — deadline slack (2E), `schedulingWarning` tasks float up
3. **Learned preference** — `modelScore(task, now-slot)`: is *now* a time this kind of task rates well for you?
4. **Priority** — the manual signal, as tiebreaker weight
5. **Energy pattern** — if recent same-day ratings ran `energy: -1`, rest-tagged and low-demand tasks get a boost

Output is explainable, using the inspectable model weights: *"Review PRs — due tomorrow, fits your 45-min gap, you rate focused work highly at this hour."* Reasons are generated from the actual scoring terms, not decorative.

Cold-start behavior mirrors R-5: below 10 ratings, ranking runs on urgency/fit/priority only.

> **OD-11:** Where does the button live and what does it show — (a) a floating button over the grid opening a top-3 card stack, or (b) a persistent "Now" panel in a corner showing the single best pick with a "why" line? Decide with the frontend drawing.

---

# R-7 — Weekly Wrap report (end-of-week PDF / email)

At week rollover (same trigger as retraining and carryOver — one "week closes" moment), the app generates a **Wrap report**. Order of operations matters: retrain first, so the report includes the model's freshest insights.

**Contents — three sections:**
1. **What you accomplished** (P-1-compliant framing: leads with what happened, not what didn't): completed tasks and project-chunk progress ("Thesis: 6h of 10h done"), total focused hours, shells summary. Skipped items appear only as a quiet count, never itemized in this section.
2. **Statistics:** `getWeekLoad()` breakdown per day, completion by tag, satisfaction averages by tag × time-of-day, break-compression stats (how squeezed were your days), planned-vs-actual durations.
3. **Suggestions** (all mechanically derived, explainable): fresh model insights in plain language ("study rated highest before noon — next week's auto-placement will lean that way"), chronic-overpack flag if breaks pinned at minimum ≥3 days, chunk-starvation warnings for the coming week.

**Delivery — RESOLVED (OD-15): PDF only.** Email is cut entirely — no stub, no config slot, no third-party service. All effort goes into making the PDF genuinely nice:
- Rendered client-side from a dedicated print-styled report view; auto-offered at rollover, always available from the week `⋯` menu ("Wrap report").
- **Design:** a real document, not a data dump — Playfair Display headings, Nunito body, the full ocean palette on white; shells render as the satisfaction glyphs; sprite accents (surfboard divider, seashell, palm) if Appendix A lands; per-day load drawn as a small sand-bar chart; ~~one page if the week fits, never more than two~~.
  - **AMENDED 2026-07-15 (built & printed):** *no page budget.* The two-page rule had been implemented as silent content caps (top-8 tags, top-6 tag×time rows), which binned a busy week's quieter data precisely when there was most to report — so the rule was inverting its own purpose. Length is now a layout concern only; **the report never truncates to fit paper.** ~5 pages is unremarkable for a full week. Editorial limits that exist for signal (top-3 learned weights, in plain language) stand. See SPEC §7.1.
  - **As built:** typography is Rye + Special Elite, not Playfair (FRONTEND-SPEC §6 supersedes SPEC §10). **No sprites** — type and existing SVG only; Appendix A stays unwired per the "don't bulk-wire" decision. Shells always print a **numeral** beside the glyphs: five shapes with two tinted reads as "5" to a real reader, and tint alone dies on a greyscale printer (§10: never meaning by colour alone).
- Filename: `wrap-YYYY-'W'ww.pdf` (e.g., `wrap-2026-W29.pdf`) — sorts chronologically in the user's folder next to their `schedule-*.json` exports.

---

# Deployment — GitHub Pages (supersedes artifact-only assumptions)

Target: a static site on GitHub Pages, responsive + installable on mobile. This **changes several original constraints**:

| Original constraint | Status on Pages |
|---|---|
| Single .jsx file | **LIFTED (pending confirm)** — proper repo with modules; vastly better for the backend-first plan |
| No localStorage (artifact sandbox) | **LIFTED** — localStorage works on Pages; `StorageAdapter` stays but priority becomes environment-detected: on Pages → localStorage primary; in an artifact → window.storage primary; the adapter design already handles this with zero changes |
| No `<form>` tags | Lifted (was an artifact rendering constraint) — though onClick/onChange patterns are kept anyway |

**Proposed repo shape:**

```
/src
  /core        ← Phase 1: Task, Zone, Schedule, scoring, learning, StorageAdapter
                  — pure JS, zero DOM imports, enforced by lint rule
  /ui          ← Phase 2 components
  /assets      ← segmented sprites (real files now, no base64 budget anxiety)
/tests         ← Vitest replaces the "console harness": every worked example
                  in this spec becomes a named test case
vite.config.js ← base path for Pages
.github/workflows/deploy.yml  ← build + deploy to Pages on push to main
```

**Mobile integration = PWA:** `manifest.json` (name, palette theme color, icons — the palm tree sprite gets a second job) + a minimal service worker for offline caching. Installable from the browser on iOS/Android; offline-capable, which pairs naturally with localStorage persistence. The <768px single-day view specced in the original responsive rules becomes the primary mobile layout.

**Export/import & exit reminder (OD-10) carry over unchanged** — they matter *more* on a real deployment (device migration, backup hygiene). `beforeunload` also works reliably on Pages, removing the sandbox caveat.

---

# Build order — REVISED (backend first)

**Phase 1 — Backend (now):** Task class → Zone class → Schedule class (CRUD, `_walkGaps`, `findFreeSlots`) → scoring function (all four weights) → `autoSchedule()` (urgency sort, zones, deadlines, protected tags) → `resolveDropConflicts()` + `chooseConflictStrategy()` → `rippleShift()` → `evacuateDay()` → `carryOver()` → learning module (feature extraction, trainer, `modelScore`) → **`StorageAdapter`** (window.storage → guarded localStorage → in-memory) + serialization/import-export (`toJSON`/`fromJSON`, schema versioning) → **console test harness** exercising every worked example encoded in this spec (OD-8 cases, 2E slack case, 3B break-absorption case, adapter fallback chain, round-trip serialization).

**Phase 2 — Frontend (after the user's model-speccing drawing):** grid → cards → drag/resize → popover/modal → Clear Day panel → add-task panel → Cabana → sprite integration (Appendix A).

Nothing in Phase 1 may assume DOM — pure JS classes + functions, so the harness runs headless and the frontend binds to a finished engine.

---

# Appendix A — Sprite sheet plan

**Workflow:** spec writes the prompt → user generates the sheet → user uploads it → we segment programmatically (Python/PIL crop to cells) → embed slices as base64 data URIs in the .jsx → apply via `<img>` / `background-image`.

**Hard rule (accessibility + robustness):** sprites are **decorative only** — `aria-hidden="true"`, never load-bearing for meaning (badges/text carry meaning), and every sprite has a CSS fallback so the app is fully functional and presentable if the sheet is skipped or a cell fails. Art is a layer, not a dependency.

## A.1 — Asset inventory

| Cell | Asset | Used where | Notes |
|---|---|---|---|
| A1 | Wood plank texture | Cabana background | Must tile seamlessly horizontally & vertically; dark driftwood tones (`#4E3B2A`–`#6B5138`) |
| A2 | Wave crest strip | Top resize border of task cards | Horizontally tileable, works at ~8px display height, teal on transparent |
| A3 | Sand strip | Bottom resize border of task cards | Horizontally tileable, golden gradient (`#FFD166` family), transparent top edge |
| A4 | Palm tree | Cabana open button | Reads clearly at 24–32px |
| B1 | Beach umbrella | "Protect as rest" action icon (3C toast, blockers) | Closed or planted-open umbrella |
| B2 | Surfboard | Cabana section divider ornament | Horizontal orientation |
| B3 | Seashell | **APPROVED:** satisfaction rating unit (1–5 shells = the `overall` field of the structured rating, R-5) | Needs filled + outline readability at 16–20px |
| B4 | Starfish | Decorative accent (detail modal corner) | Coral-adjacent but NOT the warning color — warnings stay badge-borne |
| C1 | Driftwood sign board | Cabana section headers (label renders as HTML text on top) | Blank sign — **no text baked into the art** |
| C2 | Mist/cloud wisp | Decorative accent near pinned fog (subtle) | Very low-contrast white wisp |
| C3 | Message in a bottle | Empty-state illustration (empty day / no results in Find Times) | The one larger “scene” sprite |
| C4 | Small crab | Empty-state companion / 404-style moments | Friendly, not cartoonish-loud |

## A.2 — Sheet layout requirements (for clean segmentation)

- **Grid:** 4 columns × 3 rows, **uniform square cells** (ideally 512×512px each → 2048×1536 sheet), generous padding inside each cell (~10%), nothing crossing cell borders.
- **Background:** transparent if the generator supports it; otherwise **flat solid white** (we'll key it out — so no white elements touching edges; use cream `#F5E9D9` for any near-white details).
- **No text anywhere** in the sheet.
- Consistent style, lighting, and line weight across all cells — they'll sit in one UI.

## A.3 — Generation prompt (paste-ready)

> A 4×3 sprite sheet grid of 12 beach-themed UI illustrations, flat vector style with soft rounded shapes, subtle grain texture, consistent warm lighting, clean silhouettes, no outlines heavier than needed, no text, each sprite centered in its own square cell with clear margin, plain white background. Color palette strictly: teal #1A9BAB, turquoise #4ECDC4, soft aqua #A8DADC, golden sand #FFD166, sunset orange #F4A259, coral #FF6B6B, driftwood browns #4E3B2A #6B5138 #8B6F52, cream #F5E9D9, alice blue #F0F8FF.
> Row 1: (1) seamless tileable dark driftwood wood plank texture filling the whole cell, (2) a long horizontal ocean wave crest strip, tileable left-to-right, (3) a long horizontal golden sand strip with soft grain, tileable left-to-right, (4) a single palm tree.
> Row 2: (1) a planted beach umbrella, (2) a horizontal surfboard, (3) a single scallop seashell, (4) a starfish.
> Row 3: (1) a blank driftwood hanging sign board, (2) a soft white mist wisp, (3) a message in a glass bottle lying on sand, (4) a small friendly crab.

## A.4 — Integration notes

- Segmentation script crops cells, trims transparent margins, exports each at 2× display size, base64-encodes.
- **Size budget:** total embedded sprite payload target **< 300KB** base64 in the .jsx; A1 (wood) is the risk — if it's heavy, downscale to 256px tile (it's behind blur-free flat UI, it can take it).
- Tileables (A1–A3) applied via `background-repeat`; icons via `<img aria-hidden>`.
- The wave/sand resize borders were specced as CSS/SVG (OD-1); the sprites **replace their visuals only** — hit areas, cursors, and keyboard behavior are unchanged.
- If B3 shells are approved as the rating unit: filled/unfilled rendered as opacity + grayscale filter on the same sprite (no second asset needed).
- **Repo update (GitHub Pages):** assets ship as real files in `/src/assets` — the base64 size budget no longer applies; keep individual files < 200KB via export compression instead.

## A.5 — Background & standalone asset prompts

All prompts share the style line (prepend to each):

> Flat vector illustration style with soft rounded shapes, subtle grain texture, warm gentle lighting, clean silhouettes, no text, no people, no animals unless specified. Color palette strictly: teal #1A9BAB, turquoise #4ECDC4, soft aqua #A8DADC, golden sand #FFD166, sunset orange #F4A259, coral #FF6B6B, driftwood browns #4E3B2A #6B5138 #8B6F52, cream #F5E9D9, alice blue #F0F8FF.

| # | Asset | Size / constraint | Prompt body |
|---|---|---|---|
| 1 | Cabana interior (settings panel bg) | ~1024×1920 portrait; **center 70% must stay calm/low-detail** (controls sit on top) | Interior of a cozy wooden beach cabana viewed straight-on: warm dark driftwood plank walls, a shelf with folded towels and a few seashells, a surfboard leaning in the corner, soft golden light through a small round window, hanging rope details; decorative detail at top and bottom edges only; muted, low-contrast, cozy dusk mood. |
| 2 | Beach panorama (header / empty-week) | ~2400×600; extremely low contrast, dark text must read over it | Serene empty beach at midday: alice blue sky, calm teal sea with gentle wave lines, pale golden sand foreground, distant palm far left, tiny cabana silhouette far right; horizon in upper third; wide empty calm center. |
| 3 | Dusk variant (Wrap report cover strip) | ~2400×500; empty sky area for typeset title | Same beach at golden hour: sunset orange and golden sand sky gradient, teal sea darkening, long soft shadows, one palm silhouette; quiet end-of-week mood; banner composition. |
| 4 | Shallow-water texture (weekend tint / zone fill) | 1024², seamless tile, no focal objects | Seamless tileable top-down texture of shallow clear water over pale sand: soft aqua ripples, faint caustics, near-flat, extremely low contrast. |
| 5 | Dark plank texture (Cabana fallback) | 1024², seamless tile | Seamless tileable dark driftwood planks, horizontal boards, subtle grain and knots, warm browns only, low contrast, no strong shadows. |
| 6 | App icon / PWA logo | 1024², must read at 48px, generous margin | Circular icon: a tiny tide pool from above — ring of golden sand around teal water holding one coral starfish and one small seashell; bold, minimal, flat, centered on plain alice blue. |
| 7 | Empty-state scene | ~1200², single centered scene on white | Message in a glass bottle on pale sand beside a small friendly crab looking at it, gentle wave edge at top, calm negative space; sweet, not cartoonish-loud. |

**Workflow notes:** generate multiple variants per asset and pick at segmentation time; tileables that come back non-seamless get mirror-wrap fixed in post; if the cabana interior center is busy, regenerate rather than settle.
