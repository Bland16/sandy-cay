# Editor redesign — one drill-in idiom, a real form vocabulary & the wave energy control

**Status:** DRAFT spec (session 5, 2026-07-18). Extends `RECONCILIATION.md`
(Principles 1, 2, 3, 5) and `ACTIVITY-LIBRARY.md`. Written after the user's call:
*the Tag Manager and Activity Library "look and feel poor" — remake them, spec
well first.* **Build is gated on sign-off** (working agreement). This spec covers
**all three** collection editors (Zones, Buckets, Activities) plus the reused
energy control, then a phased build plan to ship them in one chunked effort.

---

## 1. Why they feel poor (the diagnosis this remake answers)

Grounded in the current code on `worktree-activity-library`:

1. **Inline-style soup over borrowed classes.** `TagManager.jsx` /
   `ActivitiesEditor.jsx` set a hand-tuned `style={{…}}` on nearly every element
   (`minWidth:44`, `width:46/58/40`, `padding:'5px 9px'`, ad-hoc `gap`), while a
   real design system sits unused in `styles.css`. Buckets and activities reuse
   **zone-named** classes (`.zonewin`, `.zonerow`, `.zmeta`). There is **no
   form-field vocabulary** (label · control · help), so nothing aligns into a
   column and spacing drifts field to field.
2. **The Activity Library is a "wall."** It never got the drill-in treatment: every
   activity renders fully expanded (name, min, max, priority, ✕, a full-width
   `TagEditor`, *and* a full-width energy row). Five activities = a dense stack of
   ~7 controls each, wrapping raggedly at the 250px card width. (RECONCILIATION
   debt #2.)
3. **Energy is bare −2..+2 number inputs** with cryptic glyph summaries
   (`🐦+2 🦀+1`). Numbers don't convey *spend vs restore*; there's no felt lean.
   It's the weakest control and is about to appear in a **third** place
   (energy-on-task), so it must be designed once and reused.
4. **Three idioms for "edit a collection":** Zones (inline in the Cabana, its own
   `ZoneTags`), Buckets (drill-in + `TagEditor`), Activities (flat wall). Even the
   add buttons disagree (`＋ bucket` / `＋ activity` / `＋ Add zone`).

## 2. Principles this remake must honor

- **One editor idiom** (RECONCILIATION P-5): every collection is a compact
  drill-in list → focused editor with a back header. No walls, no bespoke inline.
- **Task is the atom; Activity is a thin template** (P-1): an activity carries only
  what a task can (`label→title`, `tags`, elastic `durationMin/Max`, `priority`,
  `load`). No activity-only capability. Energy is authored **on the task** on the
  schedule; an activity/bucket only holds a *default the task inherits*.
- **Energy is honest** (P-2): load defaults to **neutral 0, user-authored** — never
  a fabricated role number. `role` is **gone** from the model and UI (P-3).
- **P-1 (never a scold):** every surface is physics, never moral bookkeeping.
- **§10 (never meaning by colour alone):** the energy control encodes value by
  **position**, not hue; it reads correctly in greyscale and print, and exposes a
  real slider semantics for keyboard + screen readers.

---

## 3. The shared drill-in idiom (`<DrillEditor>`)

A single component pair replaces all three bespoke list/editor blocks.

```
<DrillList
  title            // "Tags & buckets" | "Activities" | "Zones"
  blurb            // one-line help under the sign
  items            // rows to render
  renderRow        // (item) => row content (swatch, name, meta)
  onOpen           // (id) => drill in
  onAdd / addLabel // "＋ bucket" etc. — consistent affordance
  empty            // empty-state node
  footer           // e.g. retired-tags recover strip
/>
<DrillEditor
  backLabel        // "All buckets" | "All activities" | "All zones"
  onBack
  onRemove / removeLabel
>{fields}</DrillEditor>
```

- **List row** = the existing `.zonerow` shape, renamed **`.editrow`** (a neutral
  name, not zone-specific): `[swatch?] [name] [·meta·] [open ›]`, full-width button,
  hover lifts the border to `--cab-accent`.
- **Editor** = a back button, a stack of **fields** (see §4), then a destructive
  `remove` at the bottom (ghost, never adjacent to Save-like actions).
- **Selection state lives in the host** (`editingId`), exactly as today; opening an
  editor is `setEditingId(id)`, back is `setEditingId(null)`.
- Activities need **grouping** (activities live under a bucket). `DrillList` takes
  an optional `groupBy` so the Activities list renders bucket headers with rows
  beneath and a per-group `＋ activity`; ungrouped ("No bucket") collects orphans.

## 4. A real form-field vocabulary (CSS, replaces the inline soup)

New primitives in `styles.css` (Cabana scope), so editors stop hand-styling:

- **`.field`** — one row of the editor: a fixed **label column** (consistent width,
  `--font-type`, muted) + a **control area** (flex, wraps predictably) + optional
  **`.field-help`** beneath. This alone fixes the "nothing lines up" feel.
- **`.field.stack`** — label above control (for tags / the energy control, which
  are full-width).
- **`.control`** — the shared input/select/time skin (one definition; today's
  `.zonewin input` + `.cabinput` are inconsistent — unify).
- **`.rangefield`** — the elastic duration control (§7): two coupled steppers
  reading "**15 – 60 min**", not two naked number boxes with tiny "min"/"max".
- Rename zone-borrowed classes used generally: `.zonerow → .editrow`,
  `.zonewin` (as a generic row) → `.field`. Keep `.zone*` only for anything truly
  zone-specific (there is little).

**No component sets per-element `style={{…}}` for layout** after this — spacing,
widths, and alignment come from the vocabulary. (Colour swatches and the like stay
inline where they're data-driven.)

---

## 5. The energy control — `<EnergyControl>` (the centerpiece)

**The metaphor:** a **tube float bobbing on a wave**. Four stacked wave-rows, one
per axis. You place *how much a thing spends or restores* by moving the float — you
never see a number.

### 5.1 Anatomy (per axis row) — rendered in real sprite art

```
[seagull]  mental     restore ‹ ~~~~~(life-ring)~~~~~~~~~ › spend
[surfboard] physical  restore ‹ ~~~~~~~~~(life-ring)~~~~~ › spend
[beach-ball] social   restore ‹ ~~~~~(life-ring)~~~~~~~~~ › spend
[crab]     creative   restore ‹ ~~~~~(life-ring)~~~~~~~~~ › spend
```

- **Left = restore** (−, the tide gives energy back), **right = spend** (+, it
  costs). **Dead-centre = neutral (0):** calm, flat water — the resting default.
- The **wave track** is the **`wave.png`** sprite tiled `repeat-x` into a low
  ribbon (tuned height/opacity so four stacked rows read calm, not busy) — its
  **two ends are the visible floor and ceiling** (max restore ↔ max deplete),
  answering the user's ask for a visual min/max so a qualitative feeling has bounds.
- The **float is the `life-ring.png` sprite** (a real inner tube) sitting on the
  wave at the current value. Drag it; or tap the **‹ / ›** nudgers to step one stop.
- The **axis label is its critter sprite** (not an emoji): `seagull` (mental),
  `surfboard` (physical), `beach-ball` (social), `crab` (creative) — replacing the
  `energyMeta.js` emoji glyphs. *(No dolphin/fish sprite exists; surfboard/beach-
  ball are the substitutes — swappable, see D-4.)*
- Every sprite is decorative with an **SVG/CSS fallback** behind it (FRONTEND-SPEC
  §10 hard rule): a missing PNG degrades to a plain wavy line + a ring, never
  breaks. The slider still works entirely from the fallback.
- **No numerals shown.** The reading is the float's horizontal position plus how
  far the wave crests under it (amplitude grows toward the extremes — a bigger
  wave = a bigger effect). Faint end-labels "restore"/"spend" (words, greyscale-
  safe) anchor direction; the centre carries a subtle notch.

### 5.2 Value model (honest with the backend)

- The engine keeps **integer load −2..+2 per axis** (`energy.js#clampAxis`,
  unchanged). The float **snaps to 5 anchored stops** (−2, −1, 0, +1, +2). Drag
  glides continuously and **settles to the nearest stop** on release; ‹ / › step
  exactly one stop. So the front end feels analog; the model stays the 5-value
  vector everything else already consumes.
- *(If we ever want finer feeling, widening the scale is a one-line clamp change +
  a learning `MODEL_LAYOUT_VERSION` bump — noted, not proposed now.)*

### 5.3 Inherit state (activities & tasks)

Load resolves `own → bucket → neutral`. So the control has two modes:

- **Inheriting** (default for a new activity/task): the float renders as a **ghost
  tube** at the *inherited* position (the bucket's value), with a `.field-help`
  "inheriting from **{bucket}**". Touching/dragging it **commits** an explicit
  value (writes `load`).
- **Explicit:** a solid tube. A small **"↺ inherit"** link clears it back to `null`
  (returns to the ghost). Replaces today's clumsy "customise / inherit" text wall.
- **Buckets** have no inherit — their default is **neutral 0** (P-2; the old
  role-derived defaults are removed with the rip-out).

### 5.4 Accessibility & robustness (non-negotiable)

- Each axis is a real **`role="slider"`**, `aria-valmin=-2 aria-valuemax=2
  aria-valuenow=<int>`, `aria-valuetext="restores a lot"…"spends a lot"`,
  focusable, **←/→ = one stop**, Home/End = extremes. Meaning by **position**, not
  colour (§10) — works greyscale and in the printed report.
- Pointer + touch: drag uses pointer events; the row is `touch-action: none` **only
  while dragging the float** (mirror the card long-press discipline, sharp edge
  #16 — don't let it swallow page scroll otherwise).
- Reduced motion: the wave is static (no idle bobbing) under
  `prefers-reduced-motion`.

### 5.5 Reuse

One component, three homes: **bucket editor** (sets the default), **activity
editor** (template default, inheritable), **task popover/panel on the schedule**
(the real per-task authoring — RECONCILIATION P-1/P-2, the thing currently
missing). Same props: `{ value, onChange, inheritedFrom?, onInherit? }`.

---

## 6. Tag Manager (Buckets) — remade

Drill-in list of buckets → bucket editor. **`role` removed** (rip-out).

- **Row:** `[colour swatch] [name] [· N tags ·] [open ›]`. Drop the cryptic
  `loadSummary` glyph string from the row; a bucket's character shows *inside* via
  the energy control, not as `🐦+2 🦀+1` shorthand. (If a one-glance lean is
  wanted, a tiny static 4-dot sparkline of the load is the fallback — decision D-2.)
- **Editor fields** (all via `.field`): **Colour** + **Name** (one row) · **Tags**
  (`.field.stack` + `TagEditor`) · **Energy** (`.field.stack` + `<EnergyControl>`,
  neutral default) · **Protected** (a clearer toggle: *"Protected — tasks with
  these tags survive auto-eviction"*, with a one-line help, not the cramped inline
  label).
- **Add:** `＋ bucket`; starter-buckets seed when empty (kept).
- **Footer:** the **retired-tags recover strip** stays, and gains its missing half
  (§8).

## 7. Activity Library — remade (kill the wall)

Drill-in list **grouped by bucket** → activity editor. Removes the per-activity
energy *override* framing (P-1: an activity just carries a `load` like a task).

- **Row (collapsed):** `[name] [· 15–60 min ·] [P3?] [open ›]`. That's the whole
  row — no inline inputs. Duration shows as a compact **range badge**.
- **Editor fields:** **Name** · **Bucket** (a select, so you can re-file it —
  currently only settable at add) · **Tags** (`TagEditor`, seeded from the bucket)
  · **Duration** (the `.rangefield` elastic min–max, reading "15 – 60 min", with
  the fill-the-opening note) · **Priority** (P1–P5 or "—") · **Energy**
  (`<EnergyControl>` in **inherit** mode by default — see §5.3).
- **Add:** per-group `＋ activity`; empty-state points at making a bucket first.

## 8. Retire — completed (decision: complete it)

Today `unretireTag` has UI (the recover strip) but `retireTag` has **none**
(orphaned). Complete the pair:

- In the **bucket editor's Tags** area, each chip gains a **retire** affordance
  (e.g. a small "retire" on the chip's menu, distinct from ✕ which *removes from
  bucket*). Retire = archive: leaves history and zones untouched, drops the tag
  from **new-work** pickers/chips/library (`ACTIVITY-LIBRARY.md` retire
  semantics). Recover from the strip (existing). Un-retire stays; retire is
  un-destructive and reversible.
- Copy makes the two verbs unambiguous: **remove from bucket** ≠ **retire tag**.

## 9. What this removes / renames (so nothing lingers half-done)

- **`role` UI** — the `<select>` and the row-summary role text (with the model
  rip-out per RECONCILIATION §"The role rip-out").
- **Per-activity "customise / inherit" energy wall** — folded into
  `<EnergyControl>`'s inherit mode.
- **Zone-borrowed classes for non-zones** — `.zonerow→.editrow`, generic
  `.zonewin→.field`.
- **Ad-hoc inline layout styles** across both editors — replaced by §4 vocabulary.

---

## 10. Sprites across the redesign (decision: use the sprites)

The user's call — **use the sprites**. This **supersedes the old "only 3 wired"
default for the redesign's large surfaces**, while keeping its real rationale: art
earns its place where it's **big enough to read and carries identity**; tiny (~11px)
badges stay SVG (they turned to mud — that finding stands). Every sprite is
`aria-hidden` decorative with a CSS/SVG fallback (FRONTEND-SPEC §10), so a missing
file degrades, never breaks. `Icon.jsx` already routes name→sprite with fallback;
this **extends the `SPRITES` manifest** — call sites stay name-based.

| Surface | Sprite | Fallback |
|---|---|---|
| Energy wave track | `icons/wave.png` (repeat-x) | tinted SVG wave path |
| Energy float | `icons/life-ring.png` | SVG ring |
| Axis labels | `seagull` / `surfboard` / `beach-ball` / `crab` | emoji → then SVG |
| Section header (`.cabsign`) | `chrome/sign-hanging.png` (bg, text overlaid) | current CSS plaque |
| Card / editor / list row frame | `chrome/frame-scalloped.png` via `border-image` | current CSS border |
| Protected toggle | `chrome/toggle-pill.png` | native checkbox |
| Inputs (`.control`) | `chrome/input-rounded.png` (optional) | current CSS input |
| Buckets empty state | `icons/bucket-spade.png` | — |
| Footlocker | `icons/treasure-chest.png` | current `chest` SVG |

**Legibility guards (intentional, not decorative-for-its-own-sake):** frames must
overlay text with enough inner padding that scallops never crowd content; a
scalloped `border-image` must be tested for distortion (`repeat: round` or fall
back to CSS border — D-5); the wave ribbon's opacity is tuned so text/floats stay
first-read. If any sprite hurts legibility at its real size, the fallback is the
ship state — art never wins over readability (§10).

## 11. Phased build plan (all three, one chunked effort — gated on sign-off)

Each phase ends **green** (`npm run build && npm run test:run && npx eslint src`)
and is driven in the **real app** before it's called done (HANDOFF lesson). Commit
by explicit path. Base branch decided by the *re-examine activity-library* call —
this plan assumes a redesign branch atop activity-library's model.

- **P0 — Foundations (no visible change yet).**
  `.field` / `.field.stack` / `.control` / `.rangefield` / `.editrow` vocabulary in
  `styles.css`; extract `<DrillList>` + `<DrillEditor>`; **extend the `Icon.jsx`
  `SPRITES` manifest** (§10) with the new entries (life-ring, wave, seagull,
  surfboard, beach-ball, sign-hanging, frame-scalloped, toggle-pill…), each with a
  fallback. Migrate the **Buckets** editor onto them first (it's closest) as the
  reference implementation. *Tests:* Cabana smoke still green; bucket CRUD
  unchanged; a fallback-renders-when-sprite-missing test.
- **P1 — `<EnergyControl>` (the centerpiece), standalone.**
  Build + unit/interaction-test the wave/float control in isolation (snap to 5
  stops, drag+keyboard+nudgers, inherit/ghost mode, a11y slider semantics,
  greyscale). Wire it into the **bucket** editor, replacing the number inputs.
  *Prove:* drive it in the app; also ship an interactive prototype for sign-off
  (see below).
- **P2 — Activities editor → drill-in.**
  Grouped `<DrillList>` + activity `<DrillEditor>`; range badge + `.rangefield`;
  bucket re-file select; `<EnergyControl>` in inherit mode; **remove** the override
  wall. *Tests:* activity CRUD, inherit resolution, no wall.
- **P3 — Zones editor → the shared idiom.**
  Move the inline Zones block onto `<DrillList>/<DrillEditor>`; replace bespoke
  `ZoneTags` with the shared row vocabulary (keep the weekday preset + inclusive
  end-date edge, sharp edge #11). *Tests:* zone CRUD, weekday preset, date edges.
- **P4 — Task energy on the schedule.**
  Add `<EnergyControl>` to the task popover/panel (`TaskPanel`) — the P-1/P-2
  "author load on the task" that's currently missing. *Tests:* task load
  round-trips; budget reads it.
- **P5 — Retire completion + cleanup.**
  `retireTag` control + copy (§8); delete `role` UI and dead inline styles; final
  greyscale/print pass on the energy control.

**Sequencing note:** P0–P1 are the risk/craft core; P2–P4 reuse them; P5 is
tidy-up. The energy-model *role rip-out* (RECONCILIATION) can land in the same
branch **before P1** so `<EnergyControl>` is built against the neutral-0 model, not
the role-defaulted one.

## 12. Open decisions (flag before/at sign-off)

- **D-1 — wave granularity:** ship the 5-stop snap (recommended, honest with the
  model) vs widen the load scale for finer feel (adds a learning migration). *Lean:
  5-stop now.*
- **D-2 — bucket-row lean glyph:** show a tiny static load sparkline on the list
  row, or nothing until you drill in. *Lean: nothing on the row (calmer); the
  control is one tap away.*
- **D-3 — interactive prototype first?** Build a self-contained clickable prototype
  of `<EnergyControl>` (Artifact) for you to *feel* the drag before it goes into
  the app, since it's the centerpiece and hardest to judge from a spec. *Lean:
  yes — it's cheap insurance on the one piece a written spec can't convey.*
- **D-4 — physical/social critters:** no dolphin/fish sprite exists. Proposed
  `surfboard` (physical) + `beach-ball` (social); alternatives are `life-vest` /
  `flip-flops` (physical) and `message-bottle` (social). *Lean: surfboard +
  beach-ball (most legible, most energetic).*
- **D-5 — scalloped frame as `border-image`:** verify the scallops don't distort
  when the frame stretches to card/row size; if they do, use `frame-square` or the
  current CSS border. *Lean: try scalloped, fall back on any distortion.*
