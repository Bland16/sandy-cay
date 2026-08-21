// probe-css-cascade.mjs — which media block actually WINS at a given width.
//
// ⚠️ WHY THIS EXISTS. `styles.css` had:
//
//     @media (max-width: 767px)  { .panel { width: 100%;  } }   ← the phone rule
//     @media (max-width: 1023px) { .panel { width: 280px; } }   ← "narrow desktops"
//
// On a 390px phone BOTH match. Equal specificity, so the LATER one wins and the
// panel rendered as a fixed 280px column stuck to the left instead of the
// full-width sheet it is meant to be. The comment on the second block said
// "narrow desktops and the tablet"; the query did not, and 1069 green tests saw
// nothing, because no behaviour changed. Reported from a real phone.
//
// The shape recurs: a phone rule is written FIRST and a wider rule LATER, and
// the wider one silently wins on the narrow screen. This prints every instance.
//
//     node design/probes/probe-css-cascade.mjs
//     node design/probes/probe-css-cascade.mjs 390 820 1440
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
const WIDTHS = process.argv.slice(2).map(Number).filter(Boolean);
const CHECK = WIDTHS.length ? WIDTHS : [390, 820, 1440];

/** Media blocks in source order: { cond, min, max, body, index }. */
function mediaBlocks(css) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m = re.exec(css);
  while (m) {
    // Walk braces to find this block's end, so nested rules do not fool us.
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    const cond = m[1].trim();
    const min = /min-width:\s*(\d+)px/.exec(cond);
    const max = /max-width:\s*(\d+)px/.exec(cond);
    out.push({
      cond,
      min: min ? Number(min[1]) : null,
      max: max ? Number(max[1]) : null,
      body: css.slice(m.index + m[0].length, i - 1),
      index: m.index,
      // Anything that is not a plain width query (print, hover, reduced-motion,
      // max-height) is reported as such rather than guessed at.
      widthOnly: /width/.test(cond) && !/print|height|hover|pointer|prefers/.test(cond),
    });
    re.lastIndex = i;
    m = re.exec(css);
  }
  return out;
}

/** `selector { prop: value }` pairs inside one block. */
function declarations(body) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m = re.exec(body);
  while (m) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (!prop || prop.startsWith('/*')) continue;
      for (const sel of selectors) out.push({ sel, prop, value });
    }
    m = re.exec(body);
  }
  return out;
}

const blocks = mediaBlocks(CSS).filter((b) => b.widthOnly);
const matches = (b, w) => (b.min === null || w >= b.min) && (b.max === null || w <= b.max);

let findings = 0;
for (const width of CHECK) {
  const live = blocks.filter((b) => matches(b, width));
  console.log(`\n=== ${width}px — ${live.length} width media blocks match ===\n`);

  // Last writer wins at equal specificity, so walk in source order and keep the
  // final setter of each selector+property.
  const seen = new Map();
  for (const b of live) {
    for (const d of declarations(b.body)) {
      const key = `${d.sel}|${d.prop}`;
      const prev = seen.get(key);
      if (prev) {
        // ⚠️ THE BUG SHAPE: the rule that LOST was written for a NARROWER
        // screen than the one that beat it. That is a rule aimed at this
        // device being overridden by one aimed at a bigger one.
        const loserNarrower = prev.block.max !== null && b.max !== null && prev.block.max < b.max;
        if (loserNarrower && prev.value !== d.value) {
          findings += 1;
          console.log(`  **OVERRIDDEN**  ${d.sel} { ${d.prop} }`);
          console.log(`      written for  @media ${prev.block.cond}  →  ${d.prop}: ${prev.value}`);
          console.log(`      beaten by    @media ${b.cond}  →  ${d.prop}: ${d.value}`);
          console.log('      (same specificity, and it comes later in the file)\n');
        }
      }
      seen.set(key, { value: d.value, block: b });
    }
  }
  if (!findings) console.log('  nothing aimed at this width is overridden by a wider rule');
}

console.log(`\n${findings ? `${findings} OVERRIDE(S) — each is a rule that does not apply where it was meant to` : 'all clear'}`);
