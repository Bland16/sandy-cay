# Sandy Cay — Frontend Specification

**Status:** PRIMARY frontend spec. Supersedes SPEC.md §10 (design system) and §11 (UI inventory); everything else in SPEC.md (engine, data model, behaviors) stands.
**Working title:** **Sandy Cay** (from the art: "Sandy Cay Cabana No. 1"). Replaces "Tidepool."
**Assets on hand:** (1) UI chrome sheet — frames, buttons, toggle, badges; (2) beach icon sheet — 30+ objects; (3) cabana interior; (4) cleaned beach scene (`beach-scene-clean.png`). The layout drawing from the user may still amend §5.

---

## 1. Art direction — "hand-tinted film"

The world is a 1930s rubber-hose cartoon in monochrome film; **function is color**. Like hand-tinted silent film, color is applied only where the user acts: task cards, badges, interactive states, warnings. Everything ambient — backgrounds, chrome, frames, icons at rest — stays ink-and-paper.

The rule in one line: **if you can click it or it's telling you something, it may be tinted; if it's scenery, it's monochrome.**

Consequences:
- Color regains meaning through scarcity — a coral warning on a monochrome page is unmissable without being loud.
- The no-color-alone accessibility rule gets easier, not harder: every state now has an *icon* from the sheets (padlock, anchor, hammock…) doing primary duty, with tint as reinforcement.
- Backgrounds never compete with the schedule. The busiest pixels on screen are always the user's own week.

## 2. Design tokens

```css
/* world (from the art) */
--paper:        #F1E9D8;   /* aged sheet background — the app canvas */
--paper-shade:  #E4D9C3;   /* panel insets, alternating rows */
--ink:          #2A2620;   /* line art, text — never pure black */
--ink-soft:     #6E665A;   /* secondary text, hairlines */
--film:         #141210;   /* film-strip chrome, modal scrim */

/* function (hand-tint — original palette, softened onto paper) */
--tint-primary:  #2E8C99;  /* interactive, links, focus ring */
--tint-fixed:    #5Fb8B0;  /* fixed-task tint */
--tint-flexible: #A9CDD1;  /* flexible-task tint */
--tint-pinned:   #C9A96E;  /* pinned gold */
--tint-rest:     #7FBE8B;  /* protected / sea-glass */
--tint-warning:  #E2685F;  /* coral — scheduling physics only (P-1) */
--tint-cta:      #E8B94D;  /* golden sand — primary buttons */
--tint-info:     #8AA7C2;  /* info badges (outside-zone, due chips) */
```

Tint application: flat fills at 20–35% over `--paper` inside ink outlines (cel style), full strength only on small elements (badges, dots, focus ring). No gradients except film vignette.

**Typography:** Display — **Rye** (Google Fonts; matches the hand-lettered "SANDY CAY" sign; fallback Playfair Display) for the app title, day names, panel titles. Time axis & numerals — **Special Elite** (typewriter; silent-film title-card flavor). Body/UI — **Nunito** stays (legibility over theme; theme lives in display type and line art). Sizes unchanged from original spec.

**Line language:** components not covered by sprites are drawn to match: 2px `--ink` outlines, slightly irregular (SVG with subtle hand-wobble filter, `prefers-reduced-motion` gets clean lines), rounded rubber-hose corners.

## 3. Asset → component mapping

### Sheet 1 — UI chrome (image `…eqjipce…`)
| Cell (row,col) | Asset | Assignment |
|---|---|---|
| 1,1 ornate scroll frame | Wrap report PDF title frame |
| 1,2 wooden post sign | Week header (holds "July 13 – 19") |
| 1,3 scalloped frame | Detail modal header plate |
| 1,4 shield | Priority marker (1–5 rendered as small shield with numeral) |
| 1,5 hanging sign | Zone labels on the grid; Cabana section headers |
| 2,1–2,3 circle / rounded square / oval | Icon-button chassis (sizes S/M/L) |
| 2,4 inset square | Pressed/active button state |
| 2,5 **two-circle pill** | **The toggle switch** (pinned, exclusive, block-day…) — knob slides between the two wells |
| 2,6–2,7 pills | Secondary buttons / duration chips |
| 3,1 square frame | Day-cell focus outline (keyboard nav) |
| 3,2 arched frame | What To Do "Now" card frame |
| 3,3–3,6 rounded rects & long pill | Text inputs, search field (long pill = Find Times query bar) |
| 4,1 deep inset frame | Wells for stat numbers (Cabana insights, report) |
| 4,2 **padlocked frame** | **Pinned badge** — the padlock alone at small size; the framed version on the detail modal of pinned tasks |
| 4,3 plaque | Toast chassis |
| 4,4 small pennant | Deadline chip ("due Wed" rides the pennant) |
| 4,5 flag | schedulingWarning marker planted on parked tasks (tinted coral) |
| 4,6 calendar | Date-jump button |
| 4,7 cameo | (reserved — no current use; do not force) |
| 4,8 keypad grid | Mini-month in the date-jump popover |

### Sheet 2 — beach icons (image `…pm0fda…`)
| Asset | Assignment |
|---|---|
| Crab | Mascot: empty states, undo toast companion ("Brought it back.") |
| Palm | Decorative only (beach scene already has one) |
| **Cabana hut** | **Settings button** (replaces Palmtree/Lucide) — bottom-right corner, per the beach composition decision |
| Surfboard | Cabana section divider |
| Umbrella | "Protect" action icon (3C toast, blockers) |
| Sandcastle | **Add Project** icon & project parent glyph — a castle built bucket by bucket |
| Bucket & spade | Individual chunk glyph (children of the sandcastle) |
| Beach ball | Loading spinner (slow bounce) |
| Life ring | Help / onboarding hints |
| Trunks, visor, flip-flops, vest | Tag-chip decorations pool (user-assignable tag icons in Cabana tag roles) |
| Seagull | Rare delight: perches on the week sign after a fully-completed day. Never obstructs. |
| **Starfish** | 'Partial' completion glyph |
| **Seashell** | **Satisfaction rating unit** (filled = ink+tint, empty = outline) |
| Treasure chest | **Footlocker** (export/import) — was literally named for this before the art existed |
| Key | Import action (opens the chest) |
| **Anchor** | **Fixed-type badge** |
| Message in bottle | Empty states (empty day, no Find-Times results) |
| Ring (life preserver ring, plain) | Recurrence indicator (a loop) |
| Blank rounded rect | Spare chassis |
| Sun with face | Morning bucket glyph in report/insights time-of-day charts |
| Compass | **What To Do button** (guidance metaphor) — see §7 OD-11 |
| Lighthouse | Report-side warning section header (beacon = heads-up) |
| Radio | Cabana easter egg: toggles a subtle ambient beach-loop audio, off by default, P-1-silent |
| Spyglass | **Find Times** action |
| Hammock | **Protected/rest badge** |
| Whistle | Overpack notice icon (§7.3 of SPEC — the one grid-side "physics" notice) |
| Wave | **Ripple action** icon in the ripple/displace chooser |

### Image 3 — cabana interior
Cabana panel background. **Cleanup at segmentation:** remove Gemini sparkle from the treasure-chest side (same inpaint+grain-match as the beach). The window (center) stays visible at the panel's top; controls sit on a translucent paper sheet (`--paper` at 92%) pinned over the lower two-thirds of the wall — like a notice tacked to the cabana wall — so the busy woodwork never fights the sliders. The wall map ("Sandy Cay Archipelagos") crops out or stays as flavor depending on panel width; never functional.

### Image 4 — beach scene (cleaned)
App backdrop **behind** the grid at very low presence: blurred 2px + lightened to ~12% opacity so the paper grid floats over it, full-strength in the header strip and on the empty-week state. The cabana settings button anchors bottom-right *on* the scene, exactly where we cleared the sand.

## 4. Segmentation plan

Sheets are grid-regular with film borders; process per sheet: detect inner frame → crop cells on gridlines → trim margins → export PNG with alpha (paper keyed where the asset should float; kept where the paper *is* the chassis, e.g. buttons) → 2× display size into `/src/assets/{chrome,icons,scenes}/` with manifest JSON (`name, file, sourceSheet, cell, keyed`). Watermark inpaint on image 3 before cropping. Icons that will be tinted (badges) also export a stencil (ink-only alpha) so tint is applied in CSS, not baked in.

## 5. Layout (amendable by the user's drawing)

**Film-strip chrome:** sprocket-hole strips top and bottom of the viewport (from the sheets' borders, tiled) frame the whole app — thin (~28px), `--film`, decorative, `aria-hidden`. The app *is* the frame's current still.

**Header** (on the beach scene strip): wooden post sign = week range · ‹ Today › + calendar date-jump · load bar drawn as a sand-fill meter · week `⋯` menu · compass (What To Do) right of center · cabana hut bottom-right corner (fixed position, overlaps header/grid boundary like it's standing on the beach).

**Grid:** paper surface, 24h × 7 columns; time axis in Special Elite; hairline `--ink-soft` hour rules, heavier hand-drawn day separators; weekend columns get a light halftone-dot screen (film texture, not color); zones render as denser halftone regions with a hanging-sign label on hover; day headers in Rye with the `⋯` menu.

**Responsive (unchanged from SPEC):** ≥1280 full week · 768–1279 Mon–Fri + weekend drawer (drawer pull drawn as a beach-towel tab) · <768 single-day with day-picker strip; film sprockets collapse to top-only on mobile.

## 6. Components

**TaskCard:** paper card, ink outline, type tint fill (anchor badge + `--tint-fixed` / `--tint-flexible`); pinned = padlock badge + gold tint + **frosted sea-mist** (R-2 blur+wash survives — it reads even better over line art; badges stay on the crisp layer); protected = hammock badge + full `--tint-rest` wash; warning = coral flag planted top-right; deadline = pennant chip; recurrence = ring glyph; completion = check → dimmed + crosshatch remainder, starfish for 'partial'. **Resize borders:** top strip = the wave icon's crest line, tiled, ink-on-paper; bottom strip = sand grain line; 8px, ns-resize, 15-min snap, tinted `--tint-primary` on hover. Body drag = move (unchanged interaction contract).

**Popover (hover edit):** small paper slip, slight rotation (−1°), tape corner; title, exact times, duration chips (pill sprites), tags, padlock toggle (the two-circle toggle), deadline pennant field.

**Detail modal:** scalloped-frame header; opens with an **iris wipe** (the 1930s circular reveal, 220ms; `prefers-reduced-motion` → fade). Contents per SPEC §11: all fields, recurrence editor (shared window-row component), spyglass Find Times + copy-as-text, shell rating row + three facet toggles, occurrence actions.

**Add Task / Add Project panels:** slide from right on paper; project version headed by the sandcastle, chunk preview rendered as buckets filling toward the castle.

**Clear Day panel (OD-7):** unchanged logic; pinned/fixed rows show padlock/anchor and each carries its own Reschedule pill; commit button disabled until rows resolve.

**Cabana (settings):** interior scene per §3; sections (Zones / Tag roles / Tuning / Footlocker / Insights / Retrain) headed by hanging signs, divided by surfboards; toggles and sliders on the tacked paper sheet; treasure chest bottom-right *is* the Footlocker UI (open lid = import/export revealed); radio sits on the shelf (easter egg).

**Toasts & choosers:** plaque chassis; ripple/displace chooser shows wave icon vs. anchor-drop icon with the computed default pre-highlighted (OD-8); whistle icon on the overpack notice; crab appears on undo toasts.

**Wrap report (PDF):** silent-film title-card opening — ornate scroll frame, "YOUR WEEK AT SANDY CAY", Rye + Special Elite; monochrome art (lighthouse for the suggestions header, sun-face for time-of-day chart glyphs) with hand-tint used exactly where the app uses it (shells tinted, warnings coral); sand-bar day-load chart; `wrap-YYYY-'W'ww.pdf`. **Length: no hard budget (amended 2026-07-15, was ≤2 pages — see SPEC §7.1); the report never drops rows to fit paper.** Shells always print their numeral beside the glyphs: five shapes with only two tinted reads as five, and a greyscale printer flattens the tint away entirely (§9 — never meaning by colour alone).

## 7. OD-11 — What To Do placement (proposed resolution)

**Compass button in the header** → opens a single **"Now" card** in the arched frame, anchored below the compass: top pick with its reasons, two smaller alternates beneath, "another?" re-rolls to the next ranked. One surface, dismisses on outside click, never auto-opens (P-1). *Sign-off with the layout drawing.*

## 8. Motion & film grammar

Iris wipe = modal open/close · drag ghost = 0.85 opacity, 1.03 scale, raw follow, 150ms drop snap (unchanged) · displaced/relocated cards animate with a brief squash-and-stretch settle (rubber-hose physics, 180ms) · panel slides 250ms · a static film-grain overlay at 3% opacity sits above backgrounds only, never over text; **no flicker effects, ever** (photosensitivity) · `prefers-reduced-motion`: all transitions 0ms, wipes → fades, grain removed.

## 9. Accessibility carryover (unchanged, restated against the new art)

All SPEC keyboard/ARIA rules stand. Meaning = icon first, tint second, never tint alone. Ink on paper (#2A2620 / #F1E9D8) passes AA with room; tinted fills stay ≤35% so ink text always sits on effectively-paper. Sprites `aria-hidden` with text equivalents; decorative delight (seagull, crab) never carries information and never intercepts pointer events. Focus ring: 2px `--tint-primary` on the square-frame sprite for grid cells.

## 10. Build integration

Assets are repo files (`/src/assets`, no base64 budget); every sprite has a CSS/SVG fallback (app ships art-less if needed); manifest-driven imports so swapping a regenerated sheet is a re-segmentation, not a code change. Phase 2 order (SPEC §13) unchanged: grid → cards → drag/resize → popover/modal → panels → Cabana → report → sprites last (fallbacks first proves the skeleton).

**Open items:** OD-11 sign-off · the layout drawing may amend §5 · segmentation session when you're ready (I'll clean the chest sparkle then).
