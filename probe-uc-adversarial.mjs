// Running blind-generated adversarial scenarios. Starting with the two that
// attack H5's core claims directly.
//
//  X11 "busy is not depleting" — Mon busy but UNTAGGED, Tue busy with a tag in
//      NO bucket, Wed busy with a real load. Mon/Tue carry no load, so they must
//      rank equal to an empty Thursday. Ranking them lower would be the energy
//      term repeating `balance`'s mistake of counting minutes.
//  X8  "every day identically depleted" — a clinic 09:00-12:00 every day, so at
//      13:00 every day is identically -6 but at 08:00 every day is 0. Tests
//      whether the rule can express "sit down BEFORE the clinic".
import { Schedule } from './src/core/Schedule.js';
import { Task } from './src/core/Task.js';
import { energyTrajectory, loadForTask } from './src/core/energy.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const AXES = ['mental', 'physical', 'social', 'creative'];
const base = D(9, 7); // Mon
const DAY = 86400000;
const dayOf = (n) => new Date(base.getTime() + n * DAY);

function reserveAtHour(s, d, hour, axis) {
  const pts = energyTrajectory(s, dayOf(d)).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
}

// ---------------- X11 ----------------
console.log('=== X11 — "busy" must not be read as "depleting" ===');
{
  const s = new Schedule({});
  s.addBucket({ label: 'Care', tags: ['clinic'], color: '#2E8C99', load: { mental: 2, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['maths'], color: '#C9A96E', load: { mental: 1.5, physical: 0, social: 0, creative: 0 } });
  // Mon: busy, NO tags. Tue: busy, tag in no bucket. Wed: busy, real load.
  s.addFixed({ title: 'Mon block', tags: [], startTime: D(9, 7, 9, 0), endTime: D(9, 7, 17, 0) });
  s.addFixed({ title: 'Tue block', tags: ['admin'], startTime: D(9, 8, 9, 0), endTime: D(9, 8, 17, 0) });
  s.addFixed({ title: 'Wed clinic', tags: ['clinic'], startTime: D(9, 9, 9, 0), endTime: D(9, 9, 17, 0) });

  console.log('  day        occupied?   load-bearing?   dip        reserve@17:00');
  for (const [n, label] of [[0, 'Mon'], [1, 'Tue'], [2, 'Wed'], [3, 'Thu']]) {
    const tasks = s.getTasksForDay(dayOf(n));
    const busy = tasks.reduce((m, t) => m + t.getDuration(), 0);
    const loaded = tasks.some((t) => Math.abs(loadForTask(s, t).mental) > 0);
    const dip = energyTrajectory(s, dayOf(n)).low.mental;
    console.log(`  ${label}        ${String(busy).padStart(3)}m       ${loaded ? 'YES' : 'no '}             ${dip.toFixed(1).padStart(6)}     ${reserveAtHour(s, n, 17, 'mental').toFixed(1).padStart(6)}`);
  }
  console.log('  EXPECTED: Mon, Tue and Thu identical (0.0); only Wed depleted.');
  const ok = [0, 1, 3].every((n) => energyTrajectory(s, dayOf(n)).low.mental === 0)
    && energyTrajectory(s, dayOf(2)).low.mental < 0;
  console.log(`  RESULT: ${ok ? 'PASS — busy-but-loadless days are not penalised' : 'FAIL'}`);
}

// ---------------- X8 ----------------
console.log('\n=== X8 — every day identically depleted; can the rule say "before the clinic"? ===');
{
  const s = new Schedule({});
  s.addBucket({ label: 'Care', tags: ['clinic'], color: '#2E8C99', load: { mental: 2, social: 2, physical: 0, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['maths'], color: '#C9A96E', load: { mental: 1.5, physical: 0, social: 0, creative: 0 } });
  for (let d = 0; d < 7; d++) {
    s.addFixed({ title: `Clinic ${d}`, tags: ['clinic'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 12, 0) });
  }
  console.log('  day      dip     reserve@08:00   reserve@13:00');
  for (let d = 0; d < 7; d++) {
    console.log(`  d+${d}    ${energyTrajectory(s, dayOf(d)).low.mental.toFixed(1).padStart(6)}` +
      `        ${reserveAtHour(s, d, 8, 'mental').toFixed(1).padStart(5)}          ${reserveAtHour(s, d, 13, 'mental').toFixed(1).padStart(5)}`);
  }
  const dips = [...Array(7).keys()].map((d) => energyTrajectory(s, dayOf(d)).low.mental);
  const allTie = dips.every((x) => x === dips[0]);
  const pre = reserveAtHour(s, 0, 8, 'mental');
  const post = reserveAtHour(s, 0, 13, 'mental');
  console.log(`\n  every day ties on the DAY score? ${allTie}  (dip = ${dips[0].toFixed(1)} everywhere)`);
  console.log(`  within a day, 08:00 (${pre.toFixed(1)}) vs 13:00 (${post.toFixed(1)}) — a real difference of ${(post - pre).toFixed(1)}`);
  console.log('  => A DAY-CHOOSER CANNOT EXPRESS THIS. Choosing the day is settled by spacing;');
  console.log('     the thing that actually matters here is WHICH SLOT within the day, and');
  console.log('     that decision lives in the scorer, not in the day chooser.');
}
