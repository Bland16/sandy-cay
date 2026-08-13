// The two blind scenarios that attack the EQUATION rather than the plan.
//
//  M6  A restorative commitment (meditation, negative load) should be ATTRACTED
//      to depleted days, not pushed to fresh ones. "Least depleted" is exactly
//      backwards for anything that restores.
//  N10 Minimising the deepest dip is minimised by chopping work into the
//      smallest legal sittings: 4h in one block dips -12; eight 30m blocks dip
//      -1.5 each. Does the rule chase the statistic?
import { Schedule } from './src/core/Schedule.js';
import { Task } from './src/core/Task.js';
import { energyTrajectory, loadForTask } from './src/core/energy.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const AXES = ['mental', 'physical', 'social', 'creative'];
const base = D(9, 7);
const DAY = 86400000;
const dayOf = (n) => new Date(base.getTime() + n * DAY);
const dominant = (L) => AXES.reduce((b, a) => (Math.abs(L[a]) > Math.abs(L[b]) ? a : b), AXES[0]);
const reserveAt = (s, d, hour, axis) => {
  const pts = energyTrajectory(s, dayOf(d)).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
};

// ================= M6 =================
console.log('=== M6 — a RESTORATIVE commitment should seek out the bad days ===');
{
  const s = new Schedule({});
  s.addBucket({ label: 'Crunch', tags: ['work'], color: '#2E8C99', load: { mental: 6, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'Recovery', tags: ['rest'], color: '#7FBE8B', load: { mental: -6, physical: -2, social: 0, creative: 0 } });
  // Mon/Tue catastrophic; Wed-Fri clean.
  for (const d of [0, 1]) s.addFixed({ title: `Crunch ${d}`, tags: ['work'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 16, 0) });

  const proto = { title: 'Meditation', tags: ['rest'], type: 'flexible' };
  const L = loadForTask(s, new Task({ ...proto, startTime: base, endTime: D(9, 7, 1, 0) }));
  const axis = dominant(L);
  console.log(`  meditation load: ${JSON.stringify(L)}  dominant axis: ${axis} (rate ${L[axis]})`);
  console.log('  day     reserve@17:00   H5 score (1 - |res|/worst)   what a person wants');
  const res = [0, 1, 2, 3, 4].map((d) => reserveAt(s, d, 17, axis));
  const worst = Math.max(...res.map(Math.abs), 1);
  for (const d of [0, 1, 2, 3, 4]) {
    const r = res[d];
    const h5 = 1 - Math.abs(r) / worst;
    const want = r < 0 ? 'YES — restore here' : 'nothing to restore';
    console.log(`  d+${d}    ${r.toFixed(1).padStart(7)}         ${h5.toFixed(2)}                     ${want}`);
  }
  const picked = [0, 1, 2, 3, 4].sort((a, b) => (1 - Math.abs(res[b]) / worst) - (1 - Math.abs(res[a]) / worst))[0];
  console.log(`\n  H5 as specified picks d+${picked} (a day with nothing to restore).`);
  console.log('  => DEFECT CONFIRMED. "Least depleted" is backwards for a restorative task.');
  console.log('     Fix: the sign of the task\'s own load must flip the preference —');
  console.log('     spending work seeks shallow days, restoring work seeks deep ones.');
}

// ================= N10 =================
console.log('\n=== N10 — does minimising the dip reward chopping the work up? ===');
{
  const s = new Schedule({});
  s.addBucket({ label: 'Study', tags: ['maths'], color: '#C9A96E', load: { mental: 3, physical: 0, social: 0, creative: 0 } });
  const proto = { title: 'Maths', tags: ['maths'], type: 'flexible' };

  console.log('  4 hours of maths at mental +3/h, placed on one empty day:');
  for (const [n, mins] of [[1, 240], [2, 120], [4, 60], [8, 30]]) {
    const t = new Schedule({});
    t.addBucket({ label: 'Study', tags: ['maths'], color: '#C9A96E', load: { mental: 3, physical: 0, social: 0, creative: 0 } });
    let h = 8;
    for (let i = 0; i < n; i++) {
      t.tasks.push(new Task({ ...proto, startTime: D(9, 7, h, 0), endTime: D(9, 7, h + mins / 60, 0) }));
      h += mins / 60 + 1; // an hour's gap between sittings
    }
    const low = energyTrajectory(t, dayOf(0)).low.mental;
    console.log(`    ${String(n).padStart(2)} x ${String(mins).padStart(3)}m  ->  deepest dip ${low.toFixed(1).padStart(6)}`);
  }
  console.log('\n  The statistic is strictly minimised by maximum fragmentation, exactly as');
  console.log('  the scenario predicted. Whether the RULE chases it depends on where the');
  console.log('  energy term sits:');
  console.log('    - DEPTH (C1/H4) scores the dip, so coupling it to sizing WOULD chase it.');
  console.log('    - RESERVE-AT-SIT-DOWN (C3/H5) scores when you START, which 8 x 30m does');
  console.log('      not improve — the 8th sitting still starts deeply depleted.');
  console.log('    - And in the chosen design sizing runs BEFORE day choice and never reads');
  console.log('      energy at all, so nothing can chase the statistic. That immunity is');
  console.log('      accidental and must be written down, or someone will "improve" it.');
}
