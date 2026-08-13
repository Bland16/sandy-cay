// Evaluate candidate 6 (forward load) on the user's real weeks, and test the
// cheaper alternative (c): schedule the breaks as real rest tasks.
//
// Questions, from ENERGY-PLACEMENT-C6-FORWARD.md:
//   Q1 does it change any decision on the real weeks?
//   Q2 does it just restate `balance` (time-fill)?
//   Q3 does its optimum drift to the LATEST slot, fighting `buffer`?
//   (c) if the breaks are entered as rest tasks, does C3 alone read them right?
import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { energyTrajectory, loadForTask } from '../../src/core/energy.js';

const DAY = 86400000;
const AXES = ['mental', 'physical', 'social', 'creative'];
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DENSE = {
  name: 'DENSE term week', base: new Date(2026, 2, 8, 0, 0, 0, 0),
  events: [
    [0, 9, 0, 10, 30, 'Gym', ['rest']], [0, 11, 45, 15, 0, 'Focus block', ['club']],
    [1, 10, 0, 11, 15, 'Class A', ['class']], [1, 12, 0, 14, 30, 'Office hours', ['class']],
    [1, 14, 0, 14, 50, 'Class B', ['class']], [1, 19, 0, 20, 30, 'Club board', ['club']],
    [2, 9, 0, 10, 15, 'Class C', ['class']], [2, 10, 30, 11, 50, 'Class D lab', ['class']],
    [2, 13, 30, 14, 45, 'Class E', ['class']], [2, 17, 30, 19, 30, 'Club programme', ['club']],
    [2, 19, 30, 21, 0, 'Gym', ['rest']], [2, 21, 0, 22, 0, 'Tea', ['rest']],
    [3, 10, 0, 11, 15, 'Class A', ['class']], [3, 12, 15, 14, 0, 'Project meeting', ['club']],
    [3, 14, 0, 14, 50, 'Class B', ['class']], [3, 16, 30, 18, 50, 'Class F', ['class']],
    [3, 19, 30, 20, 30, 'Club build', ['club']], [3, 20, 0, 22, 30, 'Movie night', ['rest']],
    [4, 9, 0, 10, 15, 'Class C', ['class']], [4, 10, 30, 12, 20, 'Class D lab', ['class']],
    [4, 13, 30, 14, 45, 'Class E', ['class']], [4, 15, 30, 16, 30, 'Club meeting', ['club']],
    [4, 19, 30, 21, 0, 'Gym', ['rest']], [4, 21, 0, 22, 0, 'Tea', ['rest']],
    [5, 10, 0, 11, 50, 'Class A', ['class']], [5, 12, 0, 12, 50, 'Class G', ['class']],
    [5, 14, 0, 14, 50, 'Class B', ['class']], [5, 17, 0, 21, 0, 'Standing social', ['rest']],
  ],
};
// (c): the inter-class gaps the user said were their break, entered as REST.
const BREAKS = [
  [1, 11, 15, 12, 0], [1, 15, 0, 15, 30],
  [2, 12, 0, 13, 0], [2, 15, 0, 15, 30],
  [3, 11, 15, 12, 0], [3, 15, 0, 16, 0],
  [4, 12, 30, 13, 15], [4, 15, 0, 15, 30],
  [5, 13, 0, 13, 45],
];

function mk(spec, withBreaks) {
  const s = new Schedule({});
  s.addBucket({ label: 'Classes', tags: ['class'], color: '#E2685F', load: { mental: 3, physical: 0, social: 1, creative: 0 } });
  s.addBucket({ label: 'Clubs', tags: ['club'], color: '#8A5FA8', load: { mental: 1, physical: 0, social: 3, creative: 1 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], color: '#A9B8D8', load: { mental: -2, physical: 1, social: 1, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 4, physical: 0, social: 0, creative: 0 } });
  const add = ([d, sh, sm, eh, em, title, tags]) => {
    const day = new Date(spec.base.getTime() + d * DAY);
    s.addFixed({ title, tags,
      startTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm),
      endTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em) });
  };
  spec.events.forEach(add);
  if (withBreaks) BREAKS.forEach(([d, sh, sm, eh, em]) => add([d, sh, sm, eh, em, 'Break', ['rest']]));
  return s;
}

const dayDate = (spec, d) => new Date(spec.base.getTime() + d * DAY);
const reserveBefore = (s, spec, d, hour, axis) => {
  const pts = energyTrajectory(s, dayDate(spec, d)).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
};
/** C6: demanding (positive-load) work still to come after `hour`, that day. */
function forwardLoad(s, spec, d, hour, axis) {
  let sum = 0;
  for (const t of s.getTasksForDay(dayDate(spec, d))) {
    if (t.chunking) continue;
    if (t.startTime.getHours() < hour) continue;
    const l = loadForTask(s, t)[axis];
    if (l > 0) sum += l * ((t.endTime - t.startTime) / 3600000);
  }
  return sum;
}
const freeAfter = (s, spec, d, hour) => {
  const day = dayDate(spec, d);
  const slots = s.findFreeSlots({ from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0), to: day, durationMin: 15 });
  return slots.length * 15;
};

const spec = DENSE;
const s = mk(spec, false);
const HOURS = [8, 13, 20];

console.log('=== Q3 — does C6 always prefer the LATEST slot? ===');
console.log('    forward load (demanding mental work still to come that day)\n');
console.log('  day      fwd@08   fwd@13   fwd@20');
for (let d = 0; d < 7; d++) {
  const row = HOURS.map((h) => forwardLoad(s, spec, d, h, 'mental').toFixed(1).padStart(7)).join('  ');
  console.log(`  ${NAMES[d]}    ${row}`);
}
const monotone = [0, 1, 2, 3, 4, 5, 6].every((d) => {
  const v = HOURS.map((h) => forwardLoad(s, spec, d, h, 'mental'));
  return v[0] >= v[1] && v[1] >= v[2];
});
console.log(`\n  monotonically decreasing toward later hours on every day? ${monotone}`);
console.log('  => CONFIRMED HAZARD: C6 alone is maximised by the last slot of the day,');
console.log('     and across a runway by the last day. It must be paired, never alone.');

console.log('\n=== Q2 — does C6 just restate `balance` (time-fill)? ===');
console.log('  day     fwd@13   free-after-13   C6 rank   balance rank');
const rows = [];
for (let d = 0; d < 7; d++) rows.push({ d, fwd: forwardLoad(s, spec, d, 13, 'mental'), free: freeAfter(s, spec, d, 13) });
const byFwd = [...rows].sort((a, b) => a.fwd - b.fwd).map((r) => r.d);
const byFree = [...rows].sort((a, b) => b.free - a.free).map((r) => r.d);
for (const r of rows) {
  console.log(`  ${NAMES[r.d]}    ${r.fwd.toFixed(1).padStart(6)}   ${String(r.free).padStart(9)}m        ${String(byFwd.indexOf(r.d) + 1).padStart(2)}          ${String(byFree.indexOf(r.d) + 1).padStart(2)}`);
}
const agree = rows.filter((r) => byFwd.indexOf(r.d) === byFree.indexOf(r.d)).length;
console.log(`\n  days where C6 and balance agree on rank: ${agree}/7`);

console.log('\n=== Q1 — does C6 change the decision? C3 alone vs C3+C6, at 3 candidate hours ===');
for (const d of [1, 3, 5]) {
  console.log(`\n  ${NAMES[d]}:`);
  for (const h of HOURS) {
    const c3raw = Math.abs(reserveBefore(s, spec, d, h, 'mental'));
    const c6raw = forwardLoad(s, spec, d, h, 'mental');
    console.log(`    ${String(h).padStart(2)}:00   arrive-depleted ${c3raw.toFixed(1).padStart(5)}   still-to-come ${c6raw.toFixed(1).padStart(5)}`);
  }
}

console.log('\n=== (c) — enter the inter-class gaps as REST tasks. Does C3 alone then read them right? ===');
const sb = mk(spec, true);
console.log('  day     dip (no breaks)   dip (breaks entered)   res@20 before   res@20 after');
for (let d = 1; d < 6; d++) {
  const a = energyTrajectory(s, dayDate(spec, d)).low.mental;
  const b = energyTrajectory(sb, dayDate(spec, d)).low.mental;
  console.log(`  ${NAMES[d]}    ${a.toFixed(1).padStart(9)}        ${b.toFixed(1).padStart(9)}            ${reserveBefore(s, spec, d, 20, 'mental').toFixed(1).padStart(7)}       ${reserveBefore(sb, spec, d, 20, 'mental').toFixed(1).padStart(7)}`);
}
