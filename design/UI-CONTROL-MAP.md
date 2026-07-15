# Sandy Cay — UI Control Map & Use-Case Walkthroughs

**Status:** Phase 2 pre-build alignment doc. Enumerates every engine function
(SPEC §1.3 + situations) and the control/surface that triggers it, then proves
coverage by walking **every use case 1A–7D as a concrete "how does someone do
this?" flow.** If a case has no gesture path, that is a missing control — called
out in §5.

**Precedence:** SPEC.md (engine authoritative) → USE-CASE-ANALYSIS.md (arbitrates)
→ FRONTEND-SPEC.md (Phase 2 art/layout). Layout direction chosen so far: **B+C**
— week grid with a **contextual right panel that is closed by default** and opens
differently depending on what you pick; **day headers click into a day view with
an ✕**; full control cluster **in the top bar**; task panel does **full inline edit**.

---

## 1. Surfaces — where controls live

| # | Surface | Holds |
|---|---|---|
| S1 | **Film-strip chrome** | decorative only (sprocket strips); `aria-hidden` |
| S2 | **Header top bar** (on the beach strip) | week sign, nav cluster, load meter, action cluster (§2) |
| S3 | **Week ⋯ menu** | week-level ops: Re-optimize · Wrap up week · Wrap report · Block days… |
| S4 | **Day header** | click → **Day view** (✕ to exit); own **⋯** → Clear this day |
| S5 | **Week grid** | drag / drop / resize; overpack notice (the one grid-side physics notice) |
| S6 | **Task card** | body-drag (move), wave/sand borders (resize), check control (complete), context menu (Duplicate / Delete / Skip occurrence) |
| S7 | **Contextual right panel** | one docked panel, 3 modes: **Task detail-edit** · **What To Do** · **Cabana** |
| S8 | **Add panel** | Add Task / Add Project (type toggle) |
| S9 | **Toasts / choosers / banners** | ripple-vs-displace chooser, removal toast (leave/backfill/protect), past-week carry banner, occurrence drop menu, undo toasts |
| S10 | **Wrap report view** | print-styled → PDF |
| S11 | **Persistence status dot** | green persistent / amber session (StorageAdapter) |

---

## 2. Header top-bar button set (decided)

Left → right. Sprites per FRONTEND-SPEC §3; every button has an SVG/text fallback.

| Control | Sprite | Action | Engine |
|---|---|---|---|
| **Week sign** | wooden post | shows range "July 13–19"; not a button | — |
| **‹ / Today / ›** | chevrons | change `currentWeekStart` (hover ‹›=preview) | `getTasksForWeek` |
| **Date-jump** | calendar | mini-month popover → jump to any week | — |
| **Load meter** | sand-fill | this-week fill; hover previews adjacent week | `getWeekLoad` |
| **＋ Add task** | plus | opens Add **Task** panel | `addFixed` / `addFlexible` |
| **Add project** | sandcastle | opens Add **Project** panel (total/min/max/range) | `addProject` |
| **Find times** | spyglass | global free-slot query (duration + window + range) | `findFreeSlots` |
| **What To Do** | compass | opens right panel in **What-To-Do** mode | `whatToDo(now)` |
| **Week ⋯** | dots | Re-optimize · Wrap up week · Wrap report · Block days… | see §3 |
| **Cabana** | cabana hut | **navigates to the Cabana page** (full-screen, replaces the schedule) | zones / tuning / footlocker / insights / retrain |

---

## 3. Full engine surface → UI trigger

### CRUD (SPEC §1.3)
| Method | Trigger / surface |
|---|---|
| `addFixed` / `addFlexible` | Add panel (type toggle), submit blocked on empty title (7A) |
| `addProject` | Add panel → Project (total hrs, min/max chunk, range, tags/zone) |
| `updateTask(id, changes)` | Task panel inline edits; hover popover; drag `moveTo`; resize borders |
| `removeTask(id)` | Card context menu → Delete → **removal toast** (S9); recurring → delete flow (§4 / 7D) |
| `duplicate()` | Card context menu → Duplicate (new id, resets lived data) |
| `addZone`/`updateZone`/`removeZone` | Cabana → Zones (window-row editor) |

### Placement engine (SPEC §2–§3)
| Method | Trigger |
|---|---|
| `autoSchedule()` | Week ⋯ → Re-optimize; auto on load & week rollover (never on drag) |
| `findFreeSlots(query)` | Header spyglass (global) **and** panel "Find times" (per-task) → list; click slot = move; "Copy as text" (1D) |
| `resolveDropConflicts(dropped)` | any drop; flexible target → displaces; fixed/pinned/protected → snap-back + toast |
| `chooseConflictStrategy(...)` | drop/resize collision → inline **Ripple ⟺ Displace** chooser (Enter=default, Esc=snap back) |
| `rippleShift(pivot, Δ)` | "Ripple day →" in the chooser (breaks compress → shift → evacuate) |
| `evacuateDay(date, {blockDay})` | Day ⋯ → **Clear this day** → Clear Day panel (scope + per-pinned Reschedule + block toggle) |
| `blockRange(from,to,label)` | Week ⋯ → **Block days…** (range + label) |
| `carryOver(from,to)` | Week ⋯ → **Wrap up week**; past-week **banner** (Carry forward / Let them go) |

### Recurrence (SPEC §4)
| Behavior | Trigger |
|---|---|
| recurrence editor (periods/interval/effective) | Task panel → Recurrence section (shared window-row component) |
| "From now on / including past?" | prompted on any pattern edit (4B) |
| temporary change (period sandwich) | editor "temporary: from…until…" (4E) |
| skip / move occurrence | occurrence context menu; drop-onto-occurrence menu (4A/4C) |
| delete: this / this+future / all | recurring delete flow (7D; only "all" confirms) |

### Projects (SPEC §3.7, §5B)
| Behavior | Trigger |
|---|---|
| materialize chunks | on `addProject` |
| work conservation (shrink/grow) | drag-resize a chunk (Δ redistributes to siblings) |
| delete chunk → remove vs redistribute | chunk context menu prompt |
| Finish project here | chunk/project menu → remaining chunks vanish + undo toast |

### Queries (SPEC §5D, §6F, §6J)
| Method | Trigger |
|---|---|
| `getWeekLoad` | header load meter · adjacent-week hover · Cabana insights · report |
| `getTagBreakdown` | Cabana insights · report |
| `snapshot()` | auto at week's first `autoSchedule` (no button) → report planned-vs-actual |

### Completion & learning (SPEC §3.9, §5)
| Behavior | Trigger |
|---|---|
| `completion` = done/partial/skipped | card **check control**; early-done → crosshatch + removal toast |
| `satisfaction` (shells + 3 facets) | rating row in panel, prompted after done; editable later |
| retrain | Cabana → **Retrain now** (shows sample count); auto at rollover (before report) |
| `modelScore` | internal (slot scoring `w.preference`; forced 0 <10 ratings) |

### Reports / detectors / persistence (SPEC §7, §9)
| Behavior | Trigger |
|---|---|
| Wrap report (PDF) | Week ⋯ → Wrap report; auto-offered at rollover |
| detectors (drift/starvation/skip-streak/pinnedRatio/duration-fit) | **report + Cabana only** (P-1: never grid nags) |
| overpack notice | the one grid-side notice, post-autoSchedule (physics, dismissible) |
| auto-save + status dot | automatic (debounced 2s); dot in header/footer |
| export / import (footlocker) | Cabana → treasure chest (versioned JSON; import = dry-run summary) |
| exit reminder | `beforeunload` + export badge + toast at 25+ unexported changes |

---

## 4. Use-case walkthroughs — "how does someone do this?"

Each row: the concrete gesture → engine → outcome. This is the coverage proof.

### Situation 1 — Lunch with a friend
| Case | How the user does it | Engine → result |
|---|---|---|
| **1A** move lunch to tomorrow | drag lunch card one column right (15-min snap) — or panel → edit date | `moveTo` → same time next day |
| **1B** shrink 1h→30m | grab card's **sand (bottom) border** and drag up — or panel duration chip **30m** | `updateTask{endTime}` |
| **1C** when am I free (11:30–13:30)? | header **spyglass** → duration 1h, window 11:30–13:30, range → slot list | `findFreeSlots` → click slot to place |
| **1D** give her my times | same query → **Copy as text** on the results | pure format → clipboard |
| **1E** lunch beats studying | drag lunch onto the study block | `resolveDropConflicts` → study evicted & re-placed (animated); priority ignored (R-1) |

### Situation 2 — Busy class schedule
| Case | How | Engine → result |
|---|---|---|
| **2A** protect gym, offer alternatives | gym is **pinned** (padlock); drops onto it snap back; **spyglass** finds meeting slots around it | `resolveDropConflicts` reject + `findFreeSlots` |
| **2B** burnout rest tasks survive | Add task with tag `rest`/`break`/`recovery` (or a blank "Free time" blocker) | protected → never auto-evicted; hammock badge |
| **2C** route homework into a study zone | Cabana → Zones → new zone, match tag `study`, add per-day windows | `addZone` → study-tagged tasks auto-place only there |
| **2D** assignment due Wed, zone is Sat | Add task, set **deadline Wed** (panel pennant field) | deadline > zone; places pre-deadline, info badge if outside zone |
| **2E** two deadlines, Monday packed | just add both with deadlines; Week ⋯ → Re-optimize | urgency sort → endangered Wed task places first |

### Situation 3 — Week gets disrupted
| Case | How | Engine → result |
|---|---|---|
| **3A** sick Tuesday, clear it | **Day header ⋯** → Clear this day → panel (flexibles-only / full; resolve each pinned; **block day** on) | `evacuateDay` forward-only |
| **3B** meeting ran long | drag the meeting's **sand border** longer → inline chooser **Ripple day →** | `rippleShift` (breaks absorb first) |
| **3C** event cancelled | delete the task → **removal toast**: Leave / Backfill / Protect | scoped `findFreeSlots` or rest blocker |
| **3D** finished early | card **check → Done** before end | truncates (crosshatch) + removal toast for remainder; rating prompt |
| **3E** end-of-week triage | Week ⋯ → Wrap up week (or past-week banner) | `carryOver` classifies carried / missed / recurring |

### Situation 4 — Recurrence vs real life
| Case | How | Engine → result |
|---|---|---|
| **4A** skip one class | occurrence context menu → **Skip this occurrence** | `skip` exception; slot frees (backfill toast) |
| **4B** gym → mornings permanently | panel → Recurrence → edit windows → **"from now on"** | period split; one identity, ML history kept |
| **4C** one-off lands on a recurring slot | drop appointment onto the occurrence → **mini-menu**: Move this / Skip this / Cancel | `move`/`skip` exception; pattern untouched |
| **4D** laundry every other Sunday | Recurrence → interval **every 2nd week** | parity vs `anchorDate` |
| **4E** standup +30m in summer only | Recurrence → **temporary: from Jun 1 until Sep 1** | period sandwich auto-built |

### Situation 5 — Planning ahead
| Case | How | Engine → result |
|---|---|---|
| **5A** task two weeks out | **›** twice (or date-jump) → Add task on that day | week-relative render |
| **5B** 10h project in chunks | **＋ Add → Project** (total 10h, min 1h / max 3h, range 2 wks) | `addProject` materializes chunks (buckets → castle) |
| **5C** block the whole weekend | Week ⋯ → **Block days…** (Sat–Sun) | `blockRange` per-day blockers; flexibles evacuate |
| **5D** compare this vs next week load | hover the **load meter ›** | `getWeekLoad` adjacent preview |

### Situation 6 — Reviewing (report/Cabana only — never grid nags)
| Case | How | Where |
|---|---|---|
| **6A/6E** low-rated patterns / prefer mornings | read **Wrap report** or Cabana **Insights** | learned weights, plain language |
| **6B** keep dragging 8am→10am | report **drift** suggestion → one-click "update pattern to 10am?" | `driftCheck` → 4B split |
| **6C** per-day load | column-header fill tint | `getWeekLoad().perDay` |
| **6D** task keeps getting displaced | report **starvation**: Pin next week / Let it go | `displaced+carried ≥3` |
| **6F** hours by tag | Cabana Insights / report | `getTagBreakdown` |
| **6H** breaks pinned at floor | **overpack notice** (the one grid notice) | post-autoSchedule |
| **6I** pinned 14 things | report observation >0.5 (no cap) | `pinnedRatio` |
| **6J** planned vs actual | report diff | `snapshot` |
| **6L** skipped gym 3 weeks | report **skip-streak**: Change pattern / Let it go | `effectiveUntil` |

### Situation 7 — Quick capture / messy input
| Case | How | Engine → result |
|---|---|---|
| **7A** title only | Add task, type "Call plumber", submit | defaults cascade (flexible/60m/pri 3), placed immediately |
| **7B** forgot to pin the dentist | it's `fixed` (has a time) → drops onto it snap back anyway | semantics table |
| **7C** duplicate a task | card context menu → **Duplicate** | new id, lived data reset |
| **7D** delete a recurring task | card menu → Delete → **This / This+future / Everything** | skip / `effectiveUntil` / true delete (confirms) |

---

## 5. Coverage notes & flagged decisions

- **OD-11 resolved by B+C:** the compass opens the right panel in **What-To-Do**
  mode (not a floating card, not an always-open rail). Same panel, contextual.
- **Every 1A–7D case has a gesture path above** — no missing top-level control.
  The header cluster (§2) + Week ⋯ + Day ⋯ + card + panel + Cabana + toasts cover
  the full method surface (§3).
- **Grid stays quiet (P-1):** only two grid-side notices exist — the overpack
  physics notice and scheduling-warning badges. Every insight/detector lives in
  the report or Cabana.
- **Right panel is single & modal-less:** **Task-edit** and **What-To-Do** are two
  modes of one slim docked panel, closed by default; opening a new mode replaces
  the current. Day view is a separate main-area mode (not the panel) with its own ✕.
- **Cabana is a full page**, not the panel — it replaces the schedule entirely and
  carries its own warm cabana-interior background (SPEC §10 `--cabana-*`,
  FRONTEND-SPEC §3 image 3). A back/close returns to the week.
- **Resolved forks:** ＋Add task and Add project are **two separate header buttons**;
  **Find times** is header-only (plus per-task in the panel); **Cabana = own page**.
