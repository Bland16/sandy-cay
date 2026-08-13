// A REAL week, anonymised. Course codes, club names, locations and people's
// names are stripped — this repo is public. Shape and times only.
//
// The week the user sent: dense term week. Red = classes (immovable). Purple =
// clubs. Light purple = relaxation/social (mostly DID happen). Salmon = "Free
// Time" self-assigned study — "Anything salmon like review notes etc, I didn't
// do. Consider that a failure."
//
// The question: would our placement rule put a commitment in the SAME slots the
// user already demonstrably ignores?
import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { energyTrajectory, loadForTask } from '../../src/core/energy.js';
import { placeTask } from '../../src/core/placement.js';

const Y = 2026, M = 3;
const D = (day, h, mi = 0) => new Date(Y, M - 1, day, h, mi, 0, 0);
const base = D(8, 0);                        // Sun 8 Mar
const DAY = 86400000;
const dayOf = (n) => new Date(base.getTime() + n * DAY);
const NAMES = ['Sun 8', 'Mon 9', 'Tue 10', 'Wed 11', 'Thu 12', 'Fri 13', 'Sat 14'];

const s = new Schedule({ config: { windows: {
  monFri: { start: '08:00', end: '23:00' },
  sat: { start: '08:00', end: '23:00' },
  sun: { start: '08:00', end: '23:00' },
} } });

// Buckets, with loads a student might plausibly author.
s.addBucket({ label: 'Classes', tags: ['class'], color: '#E2685F', load: { mental: 3, physical: 0, social: 1, creative: 0 } });
s.addBucket({ label: 'Clubs', tags: ['club'], color: '#8A5FA8', load: { mental: 1, physical: 0, social: 3, creative: 1 } });
s.addBucket({ label: 'Rest', tags: ['rest'], color: '#A9B8D8', load: { mental: -2, physical: 1, social: 1, creative: 0 } });
s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 4, physical: 0, social: 0, creative: 0 } });

// --- what actually happened (anonymised) ---
const REAL = [
  // day, start, end, title, tags
  [0, 9, 0, 10, 30, 'Gym with a friend', ['rest']],
  [0, 11, 45, 15, 0, 'Focus block', ['club']],
  [1, 10, 0, 11, 15, 'Class A', ['class']],
  [1, 12, 0, 14, 30, 'Office hours', ['class']],
  [1, 14, 0, 14, 50, 'Class B', ['class']],
  [1, 19, 0, 20, 30, 'Club board', ['club']],
  [2, 9, 0, 10, 15, 'Class C', ['class']],
  [2, 10, 30, 11, 50, 'Class D lab', ['class']],
  [2, 13, 30, 14, 45, 'Class E', ['class']],
  [2, 17, 30, 19, 30, 'Club programme', ['club']],
  [2, 19, 30, 21, 0, 'Gym with a friend', ['rest']],
  [2, 21, 0, 22, 0, 'Tea with friends', ['rest']],
  [3, 10, 0, 11, 15, 'Class A', ['class']],
  [3, 12, 15, 14, 0, 'Project meeting', ['club']],
  [3, 14, 0, 14, 50, 'Class B', ['class']],
  [3, 16, 30, 18, 50, 'Class F', ['class']],
  [3, 19, 30, 20, 30, 'Club build', ['club']],
  [3, 20, 0, 22, 30, 'Movie night', ['rest']],
  [4, 9, 0, 10, 15, 'Class C', ['class']],
  [4, 10, 30, 12, 20, 'Class D lab', ['class']],
  [4, 13, 30, 14, 45, 'Class E', ['class']],
  [4, 15, 30, 16, 30, 'Club meeting', ['club']],
  [4, 19, 30, 21, 0, 'Gym with a friend', ['rest']],
  [4, 21, 0, 22, 0, 'Tea with friends', ['rest']],
  [4, 22, 0, 23, 0, 'Evening walk', ['rest']],
  [5, 10, 0, 11, 50, 'Class A', ['class']],
  [5, 12, 0, 12, 50, 'Class G', ['class']],
  [5, 14, 0, 14, 50, 'Class B', ['class']],
  [5, 17, 0, 21, 0, 'Standing social evening', ['rest']],
];
for (const [d, sh, sm, eh, em, title, tags] of REAL) {
  s.addFixed({ title, tags, startTime: D(8 + d, sh, sm), endTime: D(8 + d, eh, em) });
}

// --- what the user SCHEDULED FOR THEMSELVES and did not do (the graveyard) ---
const GRAVEYARD = [
  [0, 17, 0, 18, 45], [1, 11, 15, 12, 45], [1, 15, 30, 17, 0],
  [2, 11, 20, 12, 45], [2, 15, 30, 17, 0],
  [3, 11, 20, 12, 45], [3, 15, 0, 16, 30],
  [5, 15, 0, 16, 15],
];
const graveMin = GRAVEYARD.reduce((n, [, sh, sm, eh, em]) => n + ((eh * 60 + em) - (sh * 60 + sm)), 0);

console.log('=== A real term week, anonymised ===');
console.log(`  self-assigned study blocks the user wrote and did NOT do: ${GRAVEYARD.length}`);
console.log(`  total: ${(graveMin / 60).toFixed(1)} hours in the week\n`);

console.log('  day       committed   deepest mental dip   longest free run');
for (let d = 0; d < 7; d++) {
  const tasks = s.getTasksForDay(dayOf(d)).filter((t) => !t.chunking);
  const mins = tasks.reduce((n, t) => n + t.getDuration(), 0);
  const dip = energyTrajectory(s, dayOf(d)).low.mental;
  const slots = s.findFreeSlots({ from: dayOf(d), to: dayOf(d), durationMin: 15 });
  let best = 0, rs = null, re = null;
  for (const sl of slots) {
    if (re && sl.start.getTime() <= re.getTime()) re = new Date(Math.max(re, sl.end));
    else { if (rs) best = Math.max(best, (re - rs) / 60000); rs = sl.start; re = sl.end; }
  }
  if (rs) best = Math.max(best, (re - rs) / 60000);
  console.log(`  ${NAMES[d].padEnd(9)} ${String(mins).padStart(5)}m      ${dip.toFixed(1).padStart(8)}          ${String(Math.round(best)).padStart(4)}m`);
}

// --- now place a 6h/week study commitment with H5 and see where it lands ---
const proto = { title: 'Maths commitment', tags: ['study'], type: 'flexible' };
const L = loadForTask(s, new Task({ ...proto, startTime: base, endTime: D(8, 1) }));
const axis = 'mental';
const reserveAt = (d, hour) => {
  const pts = energyTrajectory(s, dayOf(d)).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
};

console.log(`\n  commitment load: ${JSON.stringify(L)}`);
console.log('\n=== Where H5 puts 6h (3 x 2h, max 1/day) ===');
const chosen = [];
for (let k = 0; k < 3; k++) {
  const avail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !chosen.includes(d));
  const worst = Math.max(...avail.map((d) => Math.abs(reserveAt(d, 13))), 1);
  let best = null;
  for (const d of avail) {
    const energy = 1 - Math.abs(reserveAt(d, 13)) / worst;
    const gaps = chosen.map((c) => Math.abs(c - d));
    const space = (gaps.length ? Math.min(...gaps) : 7) / 7;
    const sc = energy + space;
    if (!best || sc > best.sc + 1e-9) best = { d, sc };
  }
  chosen.push(best.d);
  const t = new Task({ ...proto, startTime: dayOf(best.d), endTime: new Date(dayOf(best.d).getTime() + 120 * 60000) });
  placeTask(s, t, { from: dayOf(best.d), to: dayOf(best.d) });
  s.tasks.push(t);
  console.log(`    -> ${NAMES[best.d]}  ${t.startTime.toTimeString().slice(0, 5)}–${t.endTime.toTimeString().slice(0, 5)}`);
}

// --- did we land in the graveyard? ---
console.log('\n=== Overlap with the slots the user already ignores ===');
const placed = s.tasks.filter((t) => t.title === 'Maths commitment');
let hits = 0;
for (const t of placed) {
  const d = Math.round((new Date(t.startTime.getFullYear(), t.startTime.getMonth(), t.startTime.getDate()) - base) / DAY);
  const st = t.startTime.getHours() * 60 + t.startTime.getMinutes();
  const en = t.endTime.getHours() * 60 + t.endTime.getMinutes();
  for (const [gd, sh, sm, eh, em] of GRAVEYARD) {
    if (gd !== d) continue;
    const gs = sh * 60 + sm, ge = eh * 60 + em;
    if (st < ge && en > gs) {
      hits++;
      console.log(`    ${NAMES[d]} ${t.startTime.toTimeString().slice(0, 5)} overlaps a block the user wrote and skipped (${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')})`);
    }
  }
}
console.log(`\n  ${hits} of ${placed.length} sittings land in the graveyard.`);
