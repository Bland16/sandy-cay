# Grid zoom — the hours get more pixels

**Session 9, 2026-08-17. STATUS: spec. Nothing built.**
Four questions were put to the user before writing this and are answered below.
Everything marked **PROPOSED** is mine and has not been agreed — say no to any of
it. Nothing here is claimed to come from an existing spec, because none of it
does: this feature has never been specced.

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
| **A** | Which interaction? | **Dealer's choice between pinch and keyboard.** *"Pinch to touch does seem best but keyboard would probably be cheapest."* Resolved in §5 — **keyboard**, with pinch sequenced after. |
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

## 4. The floor — ZOOM D-1 (**PROPOSED**, needs a yes or a different number)

The user said *drop the floor as you zoom in*. There is a subtlety worth stating
before picking a formula, because the naive reading makes things **worse**:

- At `z = 1` a 2-minute block renders at the floor, **26px**.
- At `z = 4` its true height is **4.5px**. If the floor is simply removed, the
  block gets **smaller on screen** than it was before you zoomed in — the
  opposite of the ask.

The floor's lie is not measured in pixels, it is measured in **apparent
minutes**: `floor / pxh × 60`. So the floor should shrink with zoom, but stop
at a size that can still be clicked.

**Proposed:** `floorPx(pxh) = Math.max(12, Math.round(26 * 34 / pxh))`

| z | week px/hr | floor | a 2m block renders | it *looks* like |
|---|---|---|---|---|
| 1 | 34 | 26px | 26px | 46 min |
| 1.4 | 48 | 18px | 18px | 22 min |
| 2 | 68 | 13px | 13px | 11 min |
| 2.8 | 95 | 12px | 12px | 8 min |
| 4 | 136 | 12px | 12px | **5 min** |

The lie falls ninefold and nothing ever becomes unhittable. **12px is the number
to argue with** — it is a hit-target floor, not a derived quantity. If you would
rather never lose a block and accept the lie, say so and the constant stays 26
at every rung; zoom alone still drops the apparent length from 46 to 11 minutes,
because `pxh` is in the denominator.

**Anything ≥ 46 minutes is unaffected at every rung** — the floor is a `Math.max`
and a true height above it already wins today. This decision only ever touches
short blocks.

**Note, no change needed:** `layout.js:125` sets `compact: height < 44`, so
zooming in un-compacts cards. That is correct and wanted — a 30-minute block at
4× has room for its full label.

## 5. The control — keyboard first, pinch after (my call, per "dealer's choice")

**Keyboard.** `+` / `=` zooms in, `-` zooms out, `0` returns to 1×.

Three reasons, in the order that decided it:

1. **It is what was asked for** — *"if I zoom in on like a key pad"*.
2. **It can be proven by execution here; pinch cannot.** jsdom has no touch and
   no layout, so a pinch implementation could only be handed over untested, and
   this project's standing rule is to print what the thing actually does.
3. **Pinch collides with a gesture that has already bitten once.** Sharp edge
   #16: cards are `touch-action: manipulation` and a drag arms on a 450ms
   long-press, after an earlier version made scrolling the day impossible. A
   two-finger handler over the same surface is exactly that class of change.

**Pinch is not refused, it is sequenced.** The whole risk of this feature is the
zoom state and the `data-pxh` plumbing (§6), and both controls share it — so
pinch becomes a small addition on top of a proven base, verified on a real
device with a checklist, rather than a rewrite.

⚠️ **The key handler must not fire while focus is in a text field.** Typing a `-`
in a task title, or `0` in a duration, must not zoom the grid. Guard on
`input` / `textarea` / `select` / `contenteditable`, and test it — this is the
kind of thing that goes unnoticed until it corrupts a title.

**Discoverability is a real gap and is deliberately left open.** A keyboard-only
control is invisible, and on phone it does not exist at all. Raise it once the
mechanism works; a `−/+` pair in the topbar is the obvious answer if wanted.

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

## 7. Persistence — ZOOM D-2 (**PROPOSED**)

**Recommend a `localStorage` key, not `config`.** `config` is engine data: it
round-trips through `Schedule#toJSON` and `exportState` spreads it wholesale, so
a zoom level stored there would ride the footlocker export into another machine
and change a screen it knows nothing about. Zoom is a property of *this screen*.
`CalendarCard.jsx:25` is the existing precedent for a UI-only key.

The counter-argument, stated fairly: `config` is described as "all values
Cabana-tunable" and gives persistence for free with no new storage path. If you
want it there, it is one line either way.

## 8. Open decisions

| # | Question | My proposal |
|---|---|---|
| **ZOOM D-1** | The floor formula, and the 12px hit-target minimum | `max(12, round(26 × 34 / pxh))` — §4 |
| **ZOOM D-2** | Persist in `localStorage` or in `config` | `localStorage` — §7 |
| **ZOOM D-3** | Is there a rung **below** 1× (zoom out, to see the whole day)? | **No, not yet.** The ask was legibility. Adding it later is one array entry |
| **ZOOM D-4** | Does the phone day view get zoom too? | **Yes** — the mechanism is shared, so excluding it would cost more code than including it |

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

## 10. Explicitly not in this

- **No change to placement, scoring, or any engine file.** This is presentation
  only. `src/core` is not touched.
- **No pinch, no wheel, no slider, no topbar control** — §5.
- **No horizontal zoom.** Columns are unchanged; only the hour gets taller.
- **The wait band stays.** It carries the real duration of a wait visually and
  is still doing that job at every zoom level (`styles.css:375`).
