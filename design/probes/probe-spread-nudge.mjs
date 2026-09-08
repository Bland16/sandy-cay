// probe-spread-nudge.mjs — does bounding the energy nudge preserve spacing?
//
// `spreadDays` summed a distance in ARRAY INDICES with a rank in LOAD-HOURS:
// `distance - rank * 0.25`, rank unbounded and 10–14 on a heavy day, so energy
// could pull a sitting 3.5 days off its ideal position — in the function whose
// documented purpose is even spacing, against its own "never overrides" comment.
//
// The acceptance bar is the evaluation's own: the CONSECUTIVE STREAK, because
// the finding that produced this function is "burnout is clustering, not sitting
// length". Spacing must not get worse.
//
// Run: node design/probes/probe-spread-nudge.mjs
import { spreadDays, addDays, dateKey } from '../../src/core/index.js';

const line = (s = '') => console.log(s);
const MON = new Date(2026, 8, 7);
const days = (n) => Array.from({ length: n }, (_, i) => addDays(MON, i));

/** The old rule, verbatim, so the two are compared and not described. */
function spreadOld(candidates, n, rank) {
  const pool = candidates;
  if (n >= pool.length) return pool.slice(0, n);
  const chosen = [];
  const step = (pool.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i += 1) {
    const ideal = n === 1 ? (pool.length - 1) / 2 : i * step;
    let best = null; let bestScore = Infinity;
    pool.forEach((d, idx) => {
      if (chosen.includes(d)) return;
      const s = Math.abs(idx - ideal) - rank(d) * 0.25;
      if (s < bestScore) { bestScore = s; best = d; }
    });
    if (best) chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
}

const idxOf = (pool, d) => pool.findIndex((x) => dateKey(x) === dateKey(d));
const streak = (pool, chosen) => {
  const idx = chosen.map((d) => idxOf(pool, d)).sort((a, b) => a - b);
  let run = 1; let best = 1;
  for (let i = 1; i < idx.length; i += 1) {
    run = idx[i] === idx[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return idx.length ? best : 0;
};

// ⚠️ THE FIRST VERSION OF THIS PROBE PROVED NOTHING. It gave the whole second
// week the same rank, and a rank that is uniform across the candidates near an
// ideal position is a constant offset that cancels — old and new agreed on every
// row. The unbounded pull only bites when rank VARIES STEEPLY between candidates
// at different distances, which is exactly a real week: one restorative day
// sitting a few days off the even position.
const POOL = days(14);
const idealFive = [0, 3.25, 6.5, 9.75, 13];
const drift = (c) => Math.max(...c.map((v, i) => Math.abs(v - idealFive[i])));
const idxs = (c) => c.map((d) => idxOf(POOL, d));

line('=== one day much fresher than its neighbours, 3 days off the ideal ===');
line('  A single deep-reserve day at index 3 while everything else reads 0.');
line('  Higher rank is preferred, so it pulls sittings toward itself.');
line();
line('  dip at day 3   old chosen              drift   new chosen              drift');
for (const depth of [1, 4, 8, 14]) {
  const rank = (d) => (idxOf(POOL, d) === 3 ? depth : 0);
  const o = idxs(spreadOld(POOL, 5, rank));
  const nw = idxs(spreadDays(POOL, 5, { rank }));
  const f = (c) => c.map((v) => String(v).padStart(2)).join(',');
  line(`  ${String(depth).padStart(2)} load-hours   ${f(o)}   ${drift(o).toFixed(2)}    ${f(nw)}   ${drift(nw).toFixed(2)}`);
}

line();
line('  A dip of 14 is an ordinary heavy day. Under the old rule it is worth');
line('  3.5 days of spacing, which is more than the 3.25-day step between');
line('  sittings — so energy does not nudge, it overrules. The new rule is');
line('  bounded by ENERGY_NUDGE_DAYS and cannot exceed it however deep the dip.');

line();
line('=== spacing is still the load-bearing property ===');
line('  streak must not grow: clustering is the burnout, not sitting length.');
const heavy = (d) => (idxOf(POOL, d) >= 7 ? 12 : 1);
for (const [label, rank] of [['no signal', () => 0], ['second week wrecked', heavy], ['one fresh day', (d) => (idxOf(POOL, d) === 3 ? 14 : 0)]]) {
  const o = spreadOld(POOL, 5, rank);
  const nw = spreadDays(POOL, 5, { rank });
  line(`  ${label.padEnd(22)} old streak ${streak(POOL, o)}   new streak ${streak(POOL, nw)}`);
}
