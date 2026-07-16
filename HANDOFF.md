# Sandy Cay — handoff

**Updated:** 2026-07-16, third session. **The active line of work is the
`wrap-report` branch, NOT `main`** (https://github.com/Bland16/sandy-cay):
wrap-report is ~5 commits ahead of main (wrap report, recurrence/zones,
responsive) and was never merged. Session 3's precedence + de-flake work stacks
on top of it. Don't assume `main` has any of this.

```bash
npm install
npm run dev      # http://localhost:5173/sandy-cay/
npm run test:run # 308 tests, all green any day of the week (flaky tests fixed)
npm run build
npx eslint src
```

---

## ⚠️ READ THIS FIRST

**Wrap report (§7.1 / R-7) and Responsive (§11) are DONE. The date-flaky tests
are FIXED and ripple now honours zones (session 3).** Next job: **verify touch
drag on a real phone** (still unrun), and drive a ripple near the work zone.

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

## NEXT JOB: verify touch drag on a real phone (Responsive is otherwise done)

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
