// Blending bucket colours without mud (design/EDITOR-REDESIGN.md, card tint).
import { describe, it, expect } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import {
  blendColors, averageRgbHex, chromaOf, hexToOklch, oklchToHex, parseHex, toHex,
  HUE_AGREEMENT_MIN,
} from '../src/core/color.js';

const CORAL = '#e2685f';
const GOLD = '#e8b94d';
const TEAL = '#2e8c99';

describe('OKLCH round trip', () => {
  it('survives hex → OKLCH → hex within a rounding step', () => {
    for (const hex of [CORAL, GOLD, TEAL, '#ffffff', '#000000', '#A8DADC']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex.toLowerCase());
    }
  });

  it('parses shorthand and rejects nonsense', () => {
    expect(toHex(parseHex('#fff'))).toBe('#ffffff');
    expect(parseHex('nope')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('blending keeps its colour instead of going muddy', () => {
  it('two warm hues blend to something at least as vivid as the duller input', () => {
    // The whole point. A channel-wise sRGB mean pulls toward grey; the OKLCH
    // blend keeps chroma because chroma is averaged separately from hue.
    const { hex, blended } = blendColors([CORAL, GOLD]);
    expect(blended).toBe(true);
    const naive = averageRgbHex([CORAL, GOLD]);
    expect(chromaOf(hex)).toBeGreaterThan(chromaOf(naive));
    expect(chromaOf(hex)).toBeGreaterThanOrEqual(Math.min(chromaOf(CORAL), chromaOf(GOLD)) - 1e-3);
  });

  it('the naive sRGB mean really is duller — the thing being avoided', () => {
    // Guards the premise: if this ever stops being true the blend is pointless.
    const naive = averageRgbHex([CORAL, TEAL]);
    expect(chromaOf(naive)).toBeLessThan(Math.min(chromaOf(CORAL), chromaOf(TEAL)));
  });

  it('averages hue circularly, so reds either side of 0° do not invert', () => {
    // A plain numeric mean of hues near 350° and near 10° lands on 180° — the
    // opposite colour. Both inputs are reds; the blend must be red, not cyan.
    const a = oklchToHex({ ...hexToOklch(CORAL), H: (-10 * Math.PI) / 180 });
    const b = oklchToHex({ ...hexToOklch(CORAL), H: (10 * Math.PI) / 180 });
    const { hex } = blendColors([a, b]);
    const H = (hexToOklch(hex).H * 180) / Math.PI;
    expect(Math.abs(H)).toBeLessThan(5); // ~0°, not ~180°
  });

  it('a single colour blends to itself', () => {
    expect(blendColors([GOLD]).hex).toBe(GOLD);
    expect(blendColors([GOLD]).agreement).toBe(1);
  });

  it('is order-independent, so a card cannot flicker between renders', () => {
    expect(blendColors([CORAL, GOLD, TEAL]).hex).toBe(blendColors([TEAL, GOLD, CORAL]).hex);
  });

  it('no colours in, nothing out', () => {
    expect(blendColors([]).hex).toBeNull();
    expect(blendColors(['garbage']).hex).toBeNull();
  });
});

describe('opposing hues are refused rather than faked', () => {
  it('flags a low-agreement blend so the caller can fall back', () => {
    // Red and cyan have no meaningful average: the hue vectors cancel and the
    // resulting angle is noise. Reporting that is the honest move.
    const red = oklchToHex({ L: 0.6, C: 0.15, H: 0 });
    const cyan = oklchToHex({ L: 0.6, C: 0.15, H: Math.PI });
    const res = blendColors([red, cyan]);
    expect(res.agreement).toBeLessThan(HUE_AGREEMENT_MIN);
    expect(res.blended).toBe(false);
  });

  it('near-identical hues agree completely', () => {
    expect(blendColors([CORAL, CORAL]).agreement).toBeCloseTo(1, 5);
  });

  it('a near-grey bucket does not steer the hue', () => {
    // Chroma-weighted, so a colourless bucket contributes no direction.
    const grey = oklchToHex({ L: 0.6, C: 0.001, H: Math.PI }); // opposite hue, no chroma
    const withGrey = blendColors([CORAL, grey]);
    // Despite pointing the opposite way, the grey barely moves the hue...
    const drift = Math.abs(hexToOklch(withGrey.hex).H - hexToOklch(CORAL).H);
    expect(drift).toBeLessThan(0.05); // radians
    // ...and does not drag the result below the blendable threshold.
    expect(withGrey.agreement).toBeGreaterThan(HUE_AGREEMENT_MIN);
  });

  it('all-grey inputs blend without dividing by zero', () => {
    const g1 = oklchToHex({ L: 0.4, C: 0, H: 0 });
    const g2 = oklchToHex({ L: 0.8, C: 0, H: 0 });
    const res = blendColors([g1, g2]);
    expect(res.hex).toBeTruthy();
    expect(res.blended).toBe(true);
  });
});

describe('a task takes the tint of every bucket its tags touch', () => {
  const build = () => {
    resetIds();
    const s = new Schedule({});
    s.addBucket({ label: 'Creative', tags: ['art'], color: GOLD });
    s.addBucket({ label: 'Maintenance', tags: ['chores'], color: TEAL });
    s.addBucket({ label: 'Rest', tags: ['rest'], color: CORAL });
    return s;
  };
  const D = (h) => new Date(2026, 6, 20, h, 0, 0, 0);

  it('one matching bucket gives that bucket\'s colour exactly', () => {
    const s = build();
    const t = s.addFixed({ title: 'Sketch', tags: ['art'], startTime: D(9), endTime: D(10) });
    const tint = s.tintForTask(t);
    expect(tint.hex).toBe(GOLD);
    expect(tint.buckets.map((b) => b.label)).toEqual(['Creative']);
  });

  it('no matching bucket gives no tint at all — the card stays paper', () => {
    const s = build();
    const t = s.addFixed({ title: 'Dentist', tags: ['health'], startTime: D(9), endTime: D(10) });
    expect(s.tintForTask(t)).toBeNull();
  });

  it('uses EVERY matching bucket, the same rule loadForTask uses', () => {
    // Colour and energy must derive from the same set. bucketForTask took only
    // the first match, so the two used to disagree.
    const s = build();
    const t = s.addFixed({ title: 'Cook', tags: ['art', 'chores'], startTime: D(9), endTime: D(10) });
    expect(s.bucketsForTask(t).map((b) => b.label)).toEqual(['Creative', 'Maintenance']);
    const tint = s.tintForTask(t);
    expect(tint.buckets).toHaveLength(2);
    expect(tint.hex).not.toBe(GOLD);
    expect(tint.hex).not.toBe(TEAL);
  });

  it('falls back to the dominant bucket when the hues cannot be blended', () => {
    resetIds();
    const s = new Schedule({});
    s.addBucket({ label: 'Red', tags: ['r', 'r2'], color: oklchToHex({ L: 0.6, C: 0.15, H: 0 }) });
    s.addBucket({ label: 'Cyan', tags: ['c'], color: oklchToHex({ L: 0.6, C: 0.15, H: Math.PI }) });
    const t = s.addFixed({ title: 'Both', tags: ['r', 'r2', 'c'], startTime: D(9), endTime: D(10) });

    const tint = s.tintForTask(t);
    expect(tint.blended).toBe(false);
    expect(tint.hex).toBe(s.buckets[0].color); // Red matched two tags — it wins
    expect(tint.buckets).toHaveLength(2); // ...but both are still reported
  });

  it('dominance is most-tags-matched, and ties are stable', () => {
    const s = build();
    const t = s.addFixed({ title: 'Tie', tags: ['art', 'chores'], startTime: D(9), endTime: D(10) });
    expect(s.dominantBucketForTask(t).label).toBe('Creative'); // tie → bucket order
    expect(s.dominantBucketForTask(t).label).toBe('Creative'); // and it does not drift
  });
});
