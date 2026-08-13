// Two defects found by the blind use-case pass, fixed and proven.
//
//  FIX 1 (M6) — restorative sign flip. "Least depleted" is backwards for a task
//      that RESTORES. The sign of the task's own dominant-axis load must flip
//      the preference: spending work seeks shallow days, restoring work seeks
//      deep ones.
//  FIX 2 (A7) — cross-period spacing. Spacing is measured within one period, so
//      a Sunday sitting in week 1 and a Monday sitting in week 2 are each
//      "perfectly spaced" and 18 hours apart. Seed the spacing memory with the
//      commitment's recent sittings from the PREVIOUS period.
import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { energyTrajectory, loadForTask } from '../../src/core/energy.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const AXES = ['mental', 'physical', 'social', 'creative'];
const DAY = 86400000;
const dominantSigned = (L) => AXES.reduce((b, a) => (Math.abs(L[a]) > Math.abs(L[b]) ? a : b), AXES[0]);

/**
 * The energy term, with FIX 1.
 * @param sign +1 when the task spends that axis, -1 when it restores it.
 */
function energyScore(res, worst, sign) {
  const depth = Math.abs(res) / (worst || 1);
  return sign > 0 ? 1 - depth : depth;   // spend -> prefer shallow; restore -> prefer deep
}

function reserveAt(s, base, d, hour, axis) {
  const day = new Date(base.getTime() + d * DAY);
  const pts = energyTrajectory(s, day).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
}

/**
 * Choose days. `seed` carries sittings already placed in an EARLIER period
 * (FIX 2) as day-offsets relative to this period's base — may be negative.
 */
function chooseDays(s, base, nDays, tags, n, { signFlip, seed = [], hour = 13 }) {
  const proto = { title: 'C', tags, type: 'flexible' };
  const L = loadForTask(s, new Task({ ...proto, startTime: base, endTime: new Date(base.getTime() + 3600000) }));
  const axis = dominantSigned(L);
  const sign = signFlip ? Math.sign(L[axis]) || 1 : 1;
  const chosen = [];
  for (let k = 0; k < n; k++) {
    const avail = [];
    for (let d = 0; d < nDays; d++) if (!chosen.includes(d)) avail.push(d);
    const worst = Math.max(...avail.map((d) => Math.abs(reserveAt(s, base, d, hour, axis))), 1);
    let best = null;
    for (const d of avail) {
      const energy = energyScore(reserveAt(s, base, d, hour, axis), worst, sign);
      const refs = [...chosen, ...seed];                       // FIX 2
      const gaps = refs.map((c) => Math.abs(c - d));
      const space = (gaps.length ? Math.min(...gaps) : nDays) / nDays;
      const sc = energy + space;
      if (!best || sc > best.sc + 1e-9) best = { d, sc };
    }
    chosen.push(best.d);
  }
  return { days: chosen.sort((a, b) => a - b), axis, sign, load: L };
}

// ================= FIX 1 =================
console.log('=== FIX 1 — restorative commitments must seek the depleted days ===');
{
  const base = D(9, 7);
  const s = new Schedule({});
  s.addBucket({ label: 'Crunch', tags: ['work'], color: '#2E8C99', load: { mental: 6, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'Recovery', tags: ['rest'], color: '#7FBE8B', load: { mental: -6, physical: -2, social: 0, creative: 0 } });
  for (const d of [0, 1]) s.addFixed({ title: `Crunch ${d}`, tags: ['work'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 16, 0) });

  const before = chooseDays(s, base, 5, ['rest'], 2, { signFlip: false, hour: 17 });
  const after = chooseDays(s, base, 5, ['rest'], 2, { signFlip: true, hour: 17 });
  console.log(`  meditation load ${JSON.stringify(after.load)}  dominant ${after.axis}  sign ${after.sign}`);
  console.log(`  reserves @17:00: ${[0, 1, 2, 3, 4].map((d) => reserveAt(s, base, d, 17, 'mental').toFixed(1)).join('  ')}`);
  console.log(`    BEFORE (no flip): days [${before.days.join(',')}]  <- fresh days, nothing to restore`);
  console.log(`    AFTER  (flip):    days [${after.days.join(',')}]  <- the two crunch days`);
  const ok = after.days.every((d) => d < 2);
  console.log(`    ${ok ? 'FIXED' : 'STILL BROKEN'}`);

  // and the spending case must be unchanged
  const spendBefore = chooseDays(s, base, 5, ['work'], 2, { signFlip: false, hour: 17 });
  const spendAfter = chooseDays(s, base, 5, ['work'], 2, { signFlip: true, hour: 17 });
  console.log(`\n  regression — a SPENDING commitment must not move:`);
  console.log(`    before [${spendBefore.days.join(',')}]   after [${spendAfter.days.join(',')}]   ${
    spendBefore.days.join() === spendAfter.days.join() ? 'unchanged' : 'CHANGED — bug'}`);
}

// ================= FIX 2 =================
console.log('\n=== FIX 2 — spacing must reach across the period boundary ===');
{
  // Two consecutive 7-day periods, identical timetable, midweek free.
  const mk = (base) => {
    const s = new Schedule({});
    s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 3, physical: 0, social: 0, creative: 0 } });
    for (const d of [1, 3]) { // Tue and Thu lectures both weeks
      const day = new Date(base.getTime() + d * DAY);
      s.addFixed({ title: 'Lecture', tags: ['study'],
        startTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0),
        endTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 13, 0) });
    }
    return s;
  };
  const w1 = D(9, 7), w2 = D(9, 14);

  const p1 = chooseDays(mk(w1), w1, 7, ['study'], 1, { signFlip: true });
  // period 2, WITHOUT the fix
  const p2none = chooseDays(mk(w2), w2, 7, ['study'], 1, { signFlip: true });
  // period 2, WITH the fix: last period's sitting seeded as a negative offset
  const seed = p1.days.map((d) => d - 7);
  const p2fix = chooseDays(mk(w2), w2, 7, ['study'], 1, { signFlip: true, seed });

  const gap = (a, b) => (b + 7) - a; // days between a (period 1) and b (period 2)
  console.log(`  period 1 sitting: day ${p1.days[0]}`);
  console.log(`    BEFORE: period 2 sitting day ${p2none.days[0]}  -> gap of ${gap(p1.days[0], p2none.days[0])} days`);
  console.log(`    AFTER:  period 2 sitting day ${p2fix.days[0]}  -> gap of ${gap(p1.days[0], p2fix.days[0])} days`);
  const better = gap(p1.days[0], p2fix.days[0]) >= gap(p1.days[0], p2none.days[0]);
  console.log(`    ${better ? 'FIXED (or already fine)' : 'STILL BROKEN'}`);

  // the pathological case A7 named: force period 1 onto the last day
  const forcedSeed = [6 - 7]; // period 1 sat on its Sunday (day 6)
  const p2forced = chooseDays(mk(w2), w2, 7, ['study'], 1, { signFlip: true, seed: forcedSeed });
  const p2forcedNo = chooseDays(mk(w2), w2, 7, ['study'], 1, { signFlip: true });
  console.log(`\n  A7's case — period 1 sat on its LAST day (Sunday):`);
  console.log(`    BEFORE: period 2 picks day ${p2forcedNo.days[0]}  -> gap ${gap(6, p2forcedNo.days[0])} day(s)`);
  console.log(`    AFTER:  period 2 picks day ${p2forced.days[0]}  -> gap ${gap(6, p2forced.days[0])} day(s)`);
}
