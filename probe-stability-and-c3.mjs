// Two tests still owed by design/ENERGY-PLACEMENT-EVAL.md:
//   1. STABILITY — re-plan on each of days 0..10 and count sittings that move
//      for reasons the user did not cause.
//   2. THE C3 FIXTURE — a week where load varies WITHIN a day, which is the only
//      thing that can distinguish "reserve when you sit down" from "the day's dip".
import { Schedule } from './src/core/Schedule.js';
import { Task } from './src/core/Task.js';
import { energyTrajectory, loadForTask } from './src/core/energy.js';
import { placeTask } from './src/core/placement.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const from = D(9, 7);
const DAY = 86400000;
const AXES = ['mental', 'physical', 'social', 'creative'];
const dayOf = (n) => new Date(from.getTime() + n * DAY);
const N_DAYS = 14, N_SIT = 5, SIT_MIN = 240, SIT_HOUR = 13;

const mag = (a) => Math.sqrt(AXES.reduce((n, k) => n + a[k] * a[k], 0));
const dominant = (L) => AXES.reduce((b, a) => (L[a] > L[b] ? a : b), AXES[0]);

function dipAfter(s, d, proto) {
  const t = new Task({ ...proto, startTime: D(9, 7 + d, SIT_HOUR, 0), endTime: D(9, 7 + d, SIT_HOUR + SIT_MIN / 60, 0) });
  s.tasks.push(t);
  const low = energyTrajectory(s, dayOf(d)).low;
  s.tasks.pop();
  return low;
}
/** Reserve immediately BEFORE the nominal sitting start — C3's quantity. */
function reserveBefore(s, d, axis) {
  const pts = energyTrajectory(s, dayOf(d)).points.filter((p) => p.at && p.at.getHours() < SIT_HOUR);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
}

/** H4: gated relative depth + sibling spacing. `lo` is the first available day. */
// opts.energy: 'depth' (C1) | 'reserve' (C3) | 'none'.  opts.spacing: bool.
// (An earlier version selected these by string-matching the rule NAME, and
// 'C3only' silently failed to match 'C3' — so it ran C1 and looked like proof
// that C3 was blind. Explicit flags instead.)
function chooseDays(s, tags, lo, opts) {
  const { energy: energyKind, spacing } = opts;
  const proto = { title: 'Thesis', tags, type: 'flexible' };
  const L = loadForTask(s, new Task({ ...proto, startTime: from, endTime: D(9, 7, 4, 0) }));
  const axis = dominant(L);
  const hasLoad = mag(L) > 0;
  const chosen = [];
  for (let k = 0; k < N_SIT; k++) {
    const avail = [];
    for (let d = lo; d < N_DAYS; d++) if (!chosen.includes(d)) avail.push(d);
    if (!avail.length) break;
    const worstAfter = Math.max(...avail.map((d) => Math.abs(dipAfter(s, d, proto)[axis])), 1);
    const worstRes = Math.max(...avail.map((d) => Math.abs(reserveBefore(s, d, axis))), 1);
    let best = null;
    for (const d of avail) {
      let energy = 0;
      if (hasLoad && energyKind === 'reserve') energy = 1 - Math.abs(reserveBefore(s, d, axis)) / worstRes;
      else if (hasLoad && energyKind === 'depth') energy = 1 - Math.abs(dipAfter(s, d, proto)[axis]) / worstAfter;
      const gaps = chosen.map((c) => Math.abs(c - d));
      const space = spacing ? (gaps.length ? Math.min(...gaps) : N_DAYS) / N_DAYS : 0;
      const sc = energy + space;
      if (!best || sc > best.sc + 1e-9) best = { d, sc };
    }
    chosen.push(best.d);
    const t = new Task({ ...proto, startTime: dayOf(best.d), endTime: new Date(dayOf(best.d).getTime() + SIT_MIN * 60000) });
    placeTask(s, t, { from: dayOf(best.d), to: dayOf(best.d) });
    s.tasks.push(t);
  }
  return chosen.sort((a, b) => a - b);
}

// ---- fixtures -------------------------------------------------------------
function mkBuckets(s) {
  s.addBucket({ label: 'Deep', tags: ['deep'], color: '#2E8C99', load: { mental: 2, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'Errands', tags: ['errand'], color: '#7FBE8B', load: { mental: 0, physical: 1, social: 0, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 2, physical: 0, social: 0, creative: 0 } });
}
function frontLoad() {
  const s = new Schedule({}); mkBuckets(s);
  for (let d = 0; d < N_DAYS; d++) {
    const heavy = d < 4;
    s.addFixed({ title: heavy ? `Deep ${d}` : `Errand ${d}`, tags: [heavy ? 'deep' : 'errand'],
      startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 11, 0) });
  }
  return s;
}
/** THE C3 FIXTURE. Every day carries an identical 2h mental block. Days 0-6 have
 *  it in the MORNING (so you sit down at 13:00 already spent); days 7-13 have it
 *  in the EVENING (so you sit down fresh). The day's TOTAL dip is identical
 *  either way, because the battery is additive — only the ORDER differs. */
function orderVaries() {
  const s = new Schedule({}); mkBuckets(s);
  for (let d = 0; d < N_DAYS; d++) {
    const morning = d < 7;
    s.addFixed({ title: `Deep ${d}`, tags: ['deep'],
      startTime: D(9, 7 + d, morning ? 8 : 19, 0), endTime: D(9, 7 + d, morning ? 10 : 21, 0) });
  }
  return s;
}

// ---- 1. STABILITY ---------------------------------------------------------
console.log('=== 1. STABILITY — replan each day, nothing else changes ===');
console.log('    churn = sittings on days >= r+1 that MOVED between consecutive replans\n');
const RULES = {
  'C1 only  (depth)': { energy: 'depth', spacing: false },
  'C3 only  (reserve)': { energy: 'reserve', spacing: false },
  'H4 = depth+spacing': { energy: 'depth', spacing: true },
  'H5 = reserve+spacing': { energy: 'reserve', spacing: true },
};

for (const [rule, opts] of Object.entries(RULES)) {
  let prev = null, totalChurn = 0;
  const rows = [];
  for (let r = 0; r <= 10; r++) {
    const days = chooseDays(frontLoad(), ['study'], r, opts);
    let churn = 0;
    if (prev) {
      const future = (arr) => arr.filter((d) => d >= r + 1);
      const a = future(prev), b = future(days);
      churn = a.filter((d) => !b.includes(d)).length;
      totalChurn += churn;
    }
    rows.push(`r=${String(r).padStart(2)} [${days.join(',')}]${churn ? ` moved:${churn}` : ''}`);
    prev = days;
  }
  console.log(`  ${rule}`);
  rows.forEach((x) => console.log(`    ${x}`));
  console.log(`    TOTAL unprovoked moves: ${totalChurn}\n`);
}

// ---- 2. THE C3 FIXTURE ----------------------------------------------------
console.log('=== 2. C3 FIXTURE — same daily total, different ORDER within the day ===');
console.log('    days 0-6: heavy block 08:00-10:00 (you sit down spent)');
console.log('    days 7-13: heavy block 19:00-21:00 (you sit down fresh)\n');
const f = orderVaries();
console.log('  day            ' + Array.from({ length: N_DAYS }, (_, i) => `d+${i}`.padStart(6)).join(''));
console.log('  day dip        ' + Array.from({ length: N_DAYS }, (_, d) => energyTrajectory(f, dayOf(d)).low.mental.toFixed(1).padStart(6)).join(''));
console.log('  reserve@13:00  ' + Array.from({ length: N_DAYS }, (_, d) => reserveBefore(f, d, 'mental').toFixed(1).padStart(6)).join(''));
console.log('');
for (const [rule, opts] of Object.entries(RULES)) {
  const days = chooseDays(orderVaries(), ['study'], 0, opts);
  const fresh = days.filter((d) => d >= 7).length;
  console.log(`  ${rule.padEnd(22)} days=[${days.join(',')}]  chose ${fresh}/5 SIT-DOWN-FRESH`);
}

console.log('\n=== 3. Re-run the ACCEPTANCE fixture with all four (does C3 still pass?) ===');
for (const [rule, opts] of Object.entries(RULES)) {
  const days = chooseDays(frontLoad(), ['study'], 0, opts);
  const front = days.filter((d) => d < 4).length * SIT_MIN;
  let st = days.length ? 1 : 0, run = 1;
  for (let i = 1; i < days.length; i++) { run = days[i] === days[i - 1] + 1 ? run + 1 : 1; if (run > st) st = run; }
  console.log(`  ${rule.padEnd(22)} days=[${days.join(',')}]  front=${String(front).padStart(4)}m  streak=${st}`);
}
