// color.js — blending bucket colours without mud.
//
// A task's tags can match several buckets, and we want one tint from them.
// Averaging in sRGB is the obvious approach and it is wrong: channel-wise means
// drag everything toward grey. Coral #e2685f + teal #2e8c99 averages to a dead
// blue-grey that belongs to neither. Three things fix it:
//
//   1. Work in OKLCH — perceptually uniform, so a mean of two lightnesses looks
//      like the middle one rather than favouring whichever channel was brightest.
//   2. Average hue CIRCULARLY, as unit vectors. Hue is an angle: a plain mean of
//      350° and 10° gives 180°, the exact opposite colour.
//   3. Take chroma SEPARATELY (the mean of the inputs), not as the magnitude of
//      the summed hue vector. That magnitude collapses toward zero as hues
//      diverge — and that collapse IS the desaturation people call mud.
//
// One case no blend can rescue: opposing hues. Red and cyan have no meaningful
// average; the unit vectors cancel and whatever angle falls out is noise. We
// measure the agreement (the mean resultant length R) and refuse to invent a
// colour when it is low — the caller falls back to a single dominant colour.

/** Below this hue agreement, a blend would be fiction. R is 1 when every hue
 *  points the same way and 0 when they cancel exactly. */
export const HUE_AGREEMENT_MIN = 0.5;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function parseHex(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

const toHex2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

// sRGB transfer function, both directions.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * (clamp01(c) ** (1 / 2.4)) - 0.055);

/** sRGB (0..1) → OKLab. Ottosson's matrices. */
export function rgbToOklab([r, g, b]) {
  const R = toLinear(r); const G = toLinear(g); const B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** OKLab → sRGB (0..1), clamped into gamut. */
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ].map(clamp01);
}

export function hexToOklch(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [L, a, b] = rgbToOklab(rgb);
  return { L, C: Math.hypot(a, b), H: Math.atan2(b, a) };
}

export function oklchToHex({ L, C, H }) {
  return toHex(oklabToRgb([L, C * Math.cos(H), C * Math.sin(H)]));
}

/**
 * Blend hex colours perceptually.
 *
 * Hue is averaged as chroma-weighted unit vectors, so a near-grey bucket does
 * not steer the result, and chroma is the plain mean of the inputs so the blend
 * stays as vivid as what went in.
 *
 * @returns { hex, agreement, blended } — `blended` is false when the hues
 *   disagree too much to mean anything (see HUE_AGREEMENT_MIN); the caller
 *   should then pick a single colour rather than show `hex`.
 */
export function blendColors(hexes) {
  const parts = (hexes || []).map(hexToOklch).filter(Boolean);
  if (parts.length === 0) return { hex: null, agreement: 0, blended: false };
  if (parts.length === 1) return { hex: oklchToHex(parts[0]), agreement: 1, blended: true };

  const L = parts.reduce((n, p) => n + p.L, 0) / parts.length;
  const C = parts.reduce((n, p) => n + p.C, 0) / parts.length;

  // Chroma-weighted circular mean of hue.
  const wTotal = parts.reduce((n, p) => n + p.C, 0);
  if (wTotal < 1e-6) return { hex: oklchToHex({ L, C: 0, H: 0 }), agreement: 1, blended: true }; // all grey
  let x = 0; let y = 0;
  for (const p of parts) { x += p.C * Math.cos(p.H); y += p.C * Math.sin(p.H); }
  const agreement = Math.hypot(x, y) / wTotal; // 1 = aligned, 0 = cancelling
  const H = Math.atan2(y, x);

  return {
    hex: oklchToHex({ L, C, H }),
    agreement,
    blended: agreement >= HUE_AGREEMENT_MIN,
  };
}

/** The naive version, kept only so a test can demonstrate what we avoid. */
export function averageRgbHex(hexes) {
  const parts = (hexes || []).map(parseHex).filter(Boolean);
  if (!parts.length) return null;
  return toHex([0, 1, 2].map((i) => parts.reduce((n, p) => n + p[i], 0) / parts.length));
}

/** Chroma of a hex — how far from grey. Used to show that a blend kept its life. */
export const chromaOf = (hex) => { const o = hexToOklch(hex); return o ? o.C : 0; };
