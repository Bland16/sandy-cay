// zoom.js — the grid's vertical zoom (design/GRID-ZOOM.md).
//
// The ask was legibility: a 2-minute routine touchpoint is 1.1px at 34px/hour,
// so `layoutDay` floors it to 26px and it then looks nearly as tall as an hour.
// More pixels per hour is the honest fix.
//
// ⚠️ ZOOM IS A MULTIPLIER, NOT A PIXEL COUNT. The week grid is 34px/hour and the
// day view 42, and each keeps its own base. A shared absolute would silently
// redensify one of the two the moment the feature shipped; with a multiplier,
// `z === 1` is an exact no-op on both — which is what makes the change provable.

/** The rungs. Geometric, so every press is the same proportional jump. */
export const ZOOM_LEVELS = [1, 1.4, 2, 2.8, 4];
export const DEFAULT_ZOOM = 1;

/**
 * No rung below 1× (GRID-ZOOM D-3). The ask was legibility, and zooming out is
 * a different feature; adding one later is one entry in the array above.
 */
export const BASE_PXH_WEEK = 34;
export const BASE_PXH_DAY = 42;

const KEY = 'sandycay.gridZoom';

/** A stored value is only honoured if it is one of the rungs we actually have. */
function legal(z) {
  return ZOOM_LEVELS.includes(z) ? z : DEFAULT_ZOOM;
}

/**
 * Pixels per hour for a surface at a zoom level.
 *
 * ⚠️ Call this ONCE per render and pass the result everywhere, `data-pxh`
 * included. Recomputing it at a second site risks a 1px rounding difference
 * between what was drawn and what the drop geometry reads back, and that failure
 * is completely silent — see `useCardInteraction.js:64`.
 */
export function pxhFor(base, zoom) {
  return Math.round(base * legal(zoom));
}

/**
 * The minimum rendered height of a card, which SHRINKS as you zoom in.
 *
 * The floor exists so a 2-minute block is visible at all, and it buys that
 * visibility by lying about length. The lie is not measured in pixels but in
 * APPARENT MINUTES (`floor / pxh × 60`), so it has to fall as the hour grows:
 *
 *     z=1   floor 26px   a 2-minute block looks like 46 minutes
 *     z=2   floor 13px   ...11 minutes
 *     z=4   floor 12px   ...5 minutes
 *
 * ⚠️ Keyed on ZOOM, not on absolute pxh. Anchoring it to a pixel count would
 * make the day view (base 42) floor at 21px rather than 26 at rest — a change to
 * today's behaviour smuggled in under a feature that is meant to be a no-op at
 * 1×. Both surfaces floor at exactly 26px when z === 1.
 *
 * 12 is a HIT-TARGET minimum, not a derived quantity: below it a card stops
 * being comfortably clickable. It is the number to change if a 12px card turns
 * out to be awkward on a real screen, and nothing else moves with it.
 */
export function floorPxFor(zoom) {
  return Math.max(12, Math.round(26 / legal(zoom)));
}

/** The next rung in, saturating at the top. */
export function zoomIn(z) {
  const i = ZOOM_LEVELS.indexOf(legal(z));
  return ZOOM_LEVELS[Math.min(i + 1, ZOOM_LEVELS.length - 1)];
}

/** The next rung out, saturating at 1× — there is deliberately nothing below. */
export function zoomOut(z) {
  const i = ZOOM_LEVELS.indexOf(legal(z));
  return ZOOM_LEVELS[Math.max(i - 1, 0)];
}

/**
 * Zoom lives in localStorage, NOT in `config` (GRID-ZOOM D-2). `config` is
 * engine data: it round-trips through `Schedule#toJSON` and `exportState`
 * spreads it wholesale, so a zoom level kept there would ride the footlocker
 * export onto another machine and change a screen it knows nothing about. Zoom
 * is a property of THIS screen.
 *
 * Guarded both ways, the same shape `CalendarCard` uses. A zoom preference is
 * the least important thing in the app and must never be able to stop the grid
 * rendering, so anything unreadable or unrecognised falls back to 1×.
 */
export function loadZoom() {
  try {
    return legal(Number(globalThis.localStorage.getItem(KEY)));
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function saveZoom(z) {
  try {
    globalThis.localStorage.setItem(KEY, String(legal(z)));
  } catch { /* session only */ }
}
