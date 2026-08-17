# Grid zoom — the hours get more pixels

**Session 9, 2026-08-17. STATUS: spec — every decision now ANSWERED (§8).**
Four questions were put to the user before writing this, and the four PROPOSED
decisions were answered on 2026-08-17. Nothing here is claimed to come from an
existing spec, because none of it does: this feature has never been specced.

The ask, in the user's words:

> *"Can we make it so that if I zoom in on like a key pad it extends the view so
> the hours have more pixels?"*

## 1. Why it matters, in numbers

A routine touchpoint can be 2 minutes. At today's `PXH = 34` that is **1.1px**,
so `layoutDay` floors it to **26px** (`src/ui/layout.js:110`) — visible, but a
2-minute step then looks nearly as tall as an hour. `styles.css:375` already
says this out loud in a comment, and the wait band was built partly to
compensate for it.

So the floor buys visibility by lying about length. Zoom is the honest fix:
give the hour more pixels and the short block can stop pretending.

## 2. Decided by the user, 2026-08-17

| # | Question | Answer |
|---|---|---|
| **A** | Which interaction? | **Both, split by device.** First answer was dealer's choice; then, on seeing §5: *"Phone should get pinch to zoom."* So: **keyboard where there is a keyboard, pinch on the phone.** §5. |
| **B** | Week and day view share a zoom level? | **Moot as asked** — *"There is no day view anymore, it was replaced by daynotes, no way to get to it."* See the correction below. Resolved in §3 as one multiplier over each surface's own base. |
| **C** | What happens to the 26px floor? | **Drop the floor as you zoom in.** Formula is **ZOOM D-1**, §4. |
| **D** | How far, in what steps? | **Discrete steps, up to ~4×.** Rungs in §3. |

### ⚠️ Correction to B, checked in the code rather than assumed

The user is right about the everyday path and I confirmed it: `App.jsx:121`
(`openDay`) sends a day-header click to the **day-notes panel** on desktop and
tablet, not to the day view. That route is gone.

But `DayView` is **not** dead code, on two paths:

1. **`App.jsx:580`** — the day **⋯ menu** still opens it on desktop. The comment
   at `App.jsx:118` says this is deliberate: *"The day view stays reachable
   everywhere from the day ⋯ menu, so nothing is lost."*
2. **Phone.** `App.jsx:122` — under 768px the day view **is** the layout (SPEC
   §11), not a mode you open.

So this spec cannot treat the day view as absent. It costs nothing to include:
one multiplier covers both surfaces (§3), and at 1× neither changes at all.

## 3. The model — one multiplier, not one pixel count

**Zoom is a multiplier `z`, and each surface keeps its own base.** The week grid
is 34px/hour (`WeekGrid.jsx:11`), the day view 42 (`DayView.jsx:10`). Rendering
uses `pxh = Math.round(base * z)`.

This is why it is a multiplier and not a shared pixel number: at `z = 1` every
pixel on both surfaces is exactly what it is today, so the feature ships with a
provable no-op at rest. A shared absolute would silently redensify the day view
on first run.

**Five rungs, `z ∈ {1, 1.4, 2, 2.8, 4}`** — geometric, so each press is the same
proportional jump.

| z | week px/hr | day px/hr | a 60m block | a 15m block | a 2m block (true) |
|---|---|---|---|---|---|
| 1 | 34 | 42 | 34px | 8.5px | 1.1px |
| 1.4 | 48 | 59 | 48px | 12px | 1.6px |
| 2 | 68 | 84 | 68px | 17px | 2.3px |
| 2.8 | 95 | 118 | 95px | 24px | 3.2px |
| 4 | 136 | 168 | 136px | 34px | 4.5px |

At 4× the whole 24-hour column is ~3260px. That is a lot of scrolling and it is
the cost of the thing being asked for.

**Rounding rule:** compute `pxh` **once**, at the top of the component, and pass
that one number to every consumer *including* `data-pxh`. Never recompute
`base * z` at a second site — a rounding difference of 1px between the render
and the drop geometry is precisely the silent failure §6 is about.

## 4. The floor — ZOOM D-1, **ANSWERED YES 2026-08-17**

The user said *drop the floor as you zoom in*. There is a subtlety worth stating
before picking a formula, because the naive reading makes things **worse**:

- At `z = 1` a 2-minute block renders at the floor, **26px**.
- At `z = 4` its true height is **4.5px**. If the floor is simply removed, the
  block gets **smaller on screen** than it was before you zoomed in — the
  opposite of the ask.

The floor's lie is not measured in pixels, it is measured in **apparent
minutes**: `floor / pxh × 60`. So the floor should shrink with zoom, but stop
at a size that can still be clicked.

**Decided:** `floorPx(pxh) = Math.max(12, Math.round(26 * 34 / pxh))`

| z | week px/hr | floor | a 2m block renders | it *looks* like |
|---|---|---|---|---|
| 1 | 34 | 26px | 26px | 46 min |
| 1.4 | 48 | 18px | 18px | 22 min |
| 2 | 68 | 13px | 13px | 11 min |
| 2.8 | 95 | 12px | 12px | 8 min |
| 4 | 136 | 12px | 12px | **5 min** |

The lie falls ninefold and nothing ever becomes unhittable. **12px was put to the
user as the number to argue with — it is a hit-target floor, not a derived
quantity — and it was accepted as it stands.** If a 12px card turns out to be
uncomfortable to hit on a real screen, this constant is the one to change and
nothing else moves with it.

**Anything ≥ 46 minutes is unaffected at every rung** — the floor is a `Math.max`
and a true height above it already wins today. This decision only ever touches
short blocks.

### ⚠️ CORRECTION, found while building: there is a SECOND floor, and it wins

**The table above is what `layoutDay` does. It is NOT what you see**, because a
2-minute block never reaches `layoutDay` as 2 minutes.

`columnItems` (`layout.js:34`) clamps every span to a quarter of an hour:

```
Math.max(s + 0.25, rawEnd > s ? rawEnd : s + task.getDuration() / 60)
```

Probed (`design/probes/probe-grid-zoom.mjs`): a real 2m, 5m or 10m task is all
laid out as **15 minutes** before any pixel arithmetic happens. So the honest
floor is applied in MINUTES, upstream, and no amount of zoom can go below it:

| z | week px/hr | 2m block renders | it *looks* like |
|---|---|---|---|
| 1 | 34 | 26px | 46 min |
| 2 | 68 | 17px | **15 min** |
| 4 | 136 | 34px | **15 min** |

**Zoom still buys the real improvement — 46 minutes down to 15** — and that is
worth having on its own. But the 5 minutes promised above is not reachable while
`columnItems` rounds up, and the routine touchpoint that motivated this whole
feature is exactly the block that hits it.

**A second consequence, also probed, and arguably worse than the height:** two
2-minute touchpoints five minutes apart are computed as **overlapping**, because
both spans were inflated to 15 minutes. They are laid out in half-width
side-by-side lanes for an overlap that does not exist. A routine is a chain of
short touchpoints, so this is its normal case, not an edge one.

**Deliberately NOT changed here.** It is not part of zoom, `s + 0.25` also
guards the post-midnight wrap case the comment describes, and shrinking it moves
lane assignment — a presentation change with its own consequences that wants an
eye on it. It is **ZOOM D-5** and both behaviours are locked by tests in
`tests/grid-zoom.test.jsx` so the limit is visible rather than folklore.

**Note, no change needed:** `layout.js:125` sets `compact: height < 44`, so
zooming in un-compacts cards. That is correct and wanted — a 30-minute block at
4× has room for its full label.

## 5. The controls — keyboard and pinch, built in that order

**Both are wanted. They are BUILT in two steps, and the order is not a
preference — it is what can be proven.**

### 5.1 Keyboard (step 1)

`+` / `=` zooms in, `-` zooms out, `0` returns to 1×. It is what was originally
asked for (*"if I zoom in on like a key pad"*) and it is the only control that
can be proven by execution in this repo.

⚠️ **The key handler must not fire while focus is in a text field.** Typing a `-`
in a task title, or `0` in a duration, must not zoom the grid. Guard on
`input` / `textarea` / `select` / `contenteditable`, and test it — this is the
kind of thing that goes unnoticed until it corrupts a title.

### 5.2 Pinch, on the phone (step 2)

**Decided 2026-08-17: the phone gets pinch to zoom.** On phone the surface is
`DayView` (SPEC §11), so pinch is a `DayView` gesture.

⚠️ **Pinch collides with a gesture that has already bitten this project.** Sharp
edge #16: cards are `touch-action: manipulation` and a drag arms on a 450ms
long-press, after an earlier version made scrolling the day impossible. The
rules that fall out of that:

- **A second finger CANCELS any armed or live drag.** Two fingers can only ever
  mean zoom. If a long-press has armed a drag and a second pointer arrives, the
  drag must abandon exactly as `pointercancel` already makes it (the path
  exists — reuse it, do not write a second one).
- **A pinch must never leave a task moved.** This is the one outcome that
  silently corrupts data rather than merely looking wrong.
- The gesture is two-pointer tracking on the scroll wrapper, not on a card.

**Why it is step 2, not step 1:** jsdom has no touch and no layout engine, so a
pinch implementation can only ever be handed over untested — it goes to the user
with a device checklist (§9). The zoom state and the `data-pxh` plumbing (§6)
are the whole risk of this feature and both controls share them, so pinch lands
on a base that has already been proven rather than being entangled with it.

### 5.3 Two questions pinch raises that are NOT yet answered

Neither blocks step 1. Both are asked before step 2 is written:

- **Does pinch snap to the five rungs, or move continuously?** D-4 chose discrete
  steps, which argues for snapping — likely tracking continuously *during* the
  gesture for feel and settling on the nearest rung at release. Not decided.
- **Does the tablet get pinch too?** The answer said "phone". Tablet (768–1279)
  is also a touch device, and it renders `WeekGrid`, not `DayView`. Not decided.

### 5.4 Discoverability, still open

A keyboard-only control is invisible on desktop. Pinch covers the phone. Raise
it once the mechanism works; a `−/+` pair in the topbar is the obvious answer if
wanted, and it is deliberately not built now.

## 6. ⚠️ The traps — three of them, all silent

**Trap 1 — the drop geometry (flagged in NEXT-AGENT.md).**
`useCardInteraction.js:64` reads `pxh: Number(el.dataset.pxh)` from the day
column **at pointer-down** and uses it for every drop calculation (`:85`,
`:103`, `:804`). If `PXH` becomes state and `data-pxh` still emits the module
constant, **every drag lands at the wrong time and nothing says so.**

**Trap 2 — the hour lines are drawn in CSS, not JS. NOT in NEXT-AGENT.md.**
Four rules hardcode the hour rule height and will desynchronise from the cards
the moment `pxh` moves:

| | |
|---|---|
| `styles.css:325` | `.day` — `…transparent 0 33px, var(--hair) 33px 34px` |
| `styles.css:354` | `.day.blocked` — same gradient, inside the blocked-day weave |
| `styles.css:711` | `.dvcol` — the 41px/42px day-view version |
| `styles.css:358` | `.dvcol.blocked` — same again |

At 4× the cards would sit at 136px/hour over gridlines still ruled every 34px.
**Fix:** emit `--pxh` as an inline custom property on the column and write the
gradients as `calc(var(--pxh) - 1px)` / `var(--pxh)`. One source of truth, same
argument as sharp edge #14.

**Trap 3 — the wake-hour scroll must not re-fire, and the view must not jump.**
`WeekGrid.jsx:129` sets `scrollTop = (WAKE_HOUR - start) * PXH` in an effect
keyed `[start]`, deliberately mount-only so it never fights the user's scroll.
Adding `pxh` to that dependency array would yank the grid back to 07:00 on every
key press. **Do not.** Instead, on a zoom change, preserve the hour under the
**vertical centre of the visible grid**: read `scrollTop` before, and set
`scrollTop' = (scrollTop + h/2) * (pxhNew / pxhOld) - h/2` after. Without this,
zooming at 20:00 dumps you somewhere near dawn.

**Every site that must take the live value, exhaustively:**

| File | Lines |
|---|---|
| `WeekGrid.jsx` | `20,21` off-window bands · `45,46` zone bands · `83,84` wait bands · `121` colHeight · `129` wake scroll · `186` hour cell · `197` layoutDay · **`213` data-pxh** · `236` layoutRemainders |
| `DayView.jsx` | `22` colHeight · `25` layoutDay · `35` zone bands · `57` hour cell · **`68` data-pxh** · `74` layoutRemainders |
| `layout.js` | `110` the floor (§4). `layoutDay`/`layoutRemainders` already take `pxh` as a parameter — no signature change |
| `styles.css` | `325`, `354`, `358`, `711` — trap 2 |

## 7. Persistence — ZOOM D-2, **ANSWERED `localStorage` 2026-08-17**

A `localStorage` key, **not** `config`. `config` is engine data: it round-trips
through `Schedule#toJSON` and `exportState` spreads it wholesale, so a zoom level
stored there would ride the footlocker export into another machine and change a
screen it knows nothing about. Zoom is a property of *this screen*.
`CalendarCard.jsx:25` is the existing precedent for a UI-only key.

⚠️ **Read it through the same guard `CalendarCard` uses** (`try`/`catch` around
both get and set). Storage can be unavailable, and a zoom preference is the
least important thing in the app — it must never be able to stop the grid
rendering. An unreadable or nonsense value falls back to 1×.

## 8. The decisions, all ANSWERED 2026-08-17

| # | Question | Answer |
|---|---|---|
| **ZOOM D-1** | The floor formula, and the 12px hit-target minimum | **YES**, `max(12, round(26 × 34 / pxh))` — §4 |
| **ZOOM D-2** | Persist in `localStorage` or in `config` | **`localStorage`** — §7 |
| **ZOOM D-3** | Is there a rung **below** 1× (zoom out, to see the whole day)? | **No zoom out.** Rungs start at 1×. Adding one later is one array entry |
| **ZOOM D-4** | Does the phone day view get zoom too? | **Yes** — and it gets **pinch** as its control (§5.2) |

**Opened by the build, and the one that matters most:**

| # | Question | Options |
|---|---|---|
| **ZOOM D-5** | `columnItems` rounds every span up to 15 minutes (§4's correction), so a 2-minute touchpoint can never read as shorter than 15 however far you zoom — and two touchpoints 5 minutes apart are laid side-by-side as if they overlapped | (a) leave it — zoom's 46→15 improvement is enough; (b) lower the minute-floor to ~2m and accept whatever it does to lane layout; (c) keep the span honest for OVERLAP purposes but keep a minimum for HEIGHT, which fixes the lanes and keeps small cards hittable |

**(c) is what I would propose** — the overlap test and the drawn height are two
different questions being answered by one number today — but it is a real change
to how the grid lays out and it is not mine to make. Nothing is built for it.

**Still open, and asked before step 2 only:** the two pinch questions in §5.3
(snap-to-rung vs continuous; tablet or phone only). Neither blocks step 1.

## 9. Done when — proven by execution, not by going green

1. **The honesty check.** Print computed `top`/`height` for a 2-minute and a
   60-minute block at all five rungs, and the apparent-minutes column from §4.
2. **The drop check (trap 1).** Print the minute a drop resolves to for a fixed
   pointer `y` at each rung. It must land on the minute you dropped at. A test
   that only asserts `data-pxh` exists proves nothing — assert its **value**
   equals the value the cards were laid out with.
3. **The gridline check (trap 2).** At 4×, a card starting on the hour must have
   its `top` coincide with a gridline. jsdom cannot see this — it is a computed
   `--pxh` assertion here, and **an eye on a real browser** there.
4. **The scroll check (trap 3).** Zoom in at 20:00 and stay near 20:00.
5. **Each regression test must bite.** Revert the fix, watch its own test fail.

**For the user, in a browser** (jsdom has no layout engine, so these cannot be
settled here): whether 4× is far enough for a 2-minute step; whether 5 rungs is
the right number of presses; whether a 12px card is comfortably clickable; and
whether the gridlines still line up at every rung.

**For the user, on a phone — step 2 only, and none of it is verifiable here:**
whether pinch feels right against the 450ms long-press; that a two-finger pinch
**never** leaves a task moved; that one-finger scrolling still works untouched;
and whether the zoom holds where you left it after a reload.

## 10. Explicitly not in this

- **No change to placement, scoring, or any engine file.** This is presentation
  only. `src/core` is not touched.
- **No wheel zoom, no slider, no topbar control** — §5.4.
- **No zoom OUT** — D-3. The rungs start at 1×.
- **No horizontal zoom.** Columns are unchanged; only the hour gets taller.
- **The wait band stays.** It carries the real duration of a wait visually and
  is still doing that job at every zoom level (`styles.css:375`).
