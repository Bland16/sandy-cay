// Project placement across four week shapes, plus the energy question.
// Q: is project placement good on an empty / somewhat-empty / busy week, and on
// a week already carrying heavy mental load at the front?
import { Schedule } from './src/core/Schedule.js';
import { seedStarterBuckets } from './src/core/index.js';
import { energyTrajectory } from './src/core/energy.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const from = D(9, 7);            // Mon 7 Sep 2026
const until = D(9, 21, 18, 0);   // 14 days
const DAY = 86400000;
const off = (dt) => Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - from) / DAY);

function place20h(sched, tags = ['study']) {
  const { parent } = sched.addProject({
    title: 'Thesis', tags,
    chunking: { totalMinutes: 1200, minChunk: 60, maxChunk: 240, range: { from, until } },
  });
  return parent.id;
}

function summarise(sched, parentId) {
  const kids = sched.tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.startTime - b.startTime);
  const perDay = new Map();
  for (const k of kids) perDay.set(off(k.startTime), (perDay.get(off(k.startTime)) || 0) + k.getDuration());
  const idx = [...perDay.keys()].sort((a, b) => a - b);
  let streak = idx.length ? 1 : 0, run = 1;
  for (let i = 1; i < idx.length; i++) { run = idx[i] === idx[i - 1] + 1 ? run + 1 : 1; if (run > streak) streak = run; }
  return { n: kids.length, days: perDay.size, heaviest: Math.max(...perDay.values(), 0), streak, idx, perDay };
}

function line(label, s) {
  console.log(`  ${label.padEnd(22)} n=${s.n}  days=${String(s.days).padStart(2)}/14  heaviest=${String(s.heaviest).padStart(3)}m  streak=${s.streak}`);
  console.log(`  ${' '.repeat(22)} ${s.idx.map((o) => `d+${o}:${s.perDay.get(o)}m`).join('  ')}`);
}

// ---- week shapes ----------------------------------------------------------
function emptyWeek() { return new Schedule({}); }

function somewhatEmpty() {
  // ~40% full: two 90-min commitments most weekdays, nothing at weekends.
  const s = new Schedule({});
  for (let d = 0; d < 14; d++) {
    const day = new Date(from.getTime() + d * DAY);
    const wd = (day.getDay() + 6) % 7;
    if (wd > 4) continue;
    s.addFixed({ title: `Class ${d}a`, tags: ['class'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 10, 30) });
    s.addFixed({ title: `Class ${d}b`, tags: ['class'], startTime: D(9, 7 + d, 14, 0), endTime: D(9, 7 + d, 15, 30) });
  }
  return s;
}

function busyWeek() {
  const s = new Schedule({});
  s.addZone({
    label: 'Work', matchTags: ['work'], exclusive: true,
    windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => ({ day: d, start: '09:00', end: '17:00' })),
  });
  s.addFixed({
    title: 'Gym', tags: ['gym'], startTime: D(9, 8, 18, 0), endTime: D(9, 8, 19, 0),
    recurrence: { periods: [{ windows: [{ day: 'tue', start: '18:00', end: '19:00' }, { day: 'thu', start: '18:00', end: '19:00' }], interval: 1, effectiveFrom: from }], anchorDate: from, exceptions: [] },
  });
  return s;
}

// Front-loaded MENTAL overload: days 0-3 packed with mentally demanding work,
// days 4-13 comparatively free. Same total free minutes as `somewhatEmpty` is
// not the point — the point is WHERE the mental load already is.
function mentalFrontLoaded() {
  const s = new Schedule({});
  seedStarterBuckets(s); // buckets ship load values, so tags carry energy
  for (let d = 0; d < 4; d++) {
    s.addFixed({ title: `Deep work ${d}`, tags: ['work', 'study'], startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 12, 0) });
    s.addFixed({ title: `Seminar ${d}`, tags: ['study'], startTime: D(9, 7 + d, 13, 0), endTime: D(9, 7 + d, 15, 0) });
  }
  return s;
}

console.log('=== 20h project, deadline 14 days out, SHIPPED placer ===\n');
for (const [label, mk] of [
  ['EMPTY week', emptyWeek],
  ['SOMEWHAT empty (~40%)', somewhatEmpty],
  ['BUSY (zone + gym)', busyWeek],
  ['MENTAL front-load', mentalFrontLoaded],
]) {
  const s = mk();
  line(label, summarise(s, place20h(s)));
}

// ---- the energy question --------------------------------------------------
console.log('\n=== Does the project land where the mental load already is? ===');
const s = mentalFrontLoaded();
const before = [];
for (let d = 0; d < 14; d++) {
  // energyTrajectory returns { points, low } — `low` is the deepest dip per
  // axis, <= 0, reserve starting full at 0. (An earlier version of this probe
  // treated the return value as an array and silently reported 0.0 everywhere.)
  const dip = energyTrajectory(s, new Date(from.getTime() + d * DAY)).low.mental;
  before.push(dip);
}
const pid = place20h(s, ['study']);
const after = [];
for (let d = 0; d < 14; d++) {
  // energyTrajectory returns { points, low } — `low` is the deepest dip per
  // axis, <= 0, reserve starting full at 0. (An earlier version of this probe
  // treated the return value as an array and silently reported 0.0 everywhere.)
  const dip = energyTrajectory(s, new Date(from.getTime() + d * DAY)).low.mental;
  after.push(dip);
}
const sm = summarise(s, pid);
console.log('  deepest MENTAL dip per day (lower = more depleted):');
console.log('  day      ', Array.from({ length: 14 }, (_, i) => `d+${i}`.padStart(6)).join(''));
console.log('  before   ', before.map((v) => v.toFixed(1).padStart(6)).join(''));
console.log('  after    ', after.map((v) => v.toFixed(1).padStart(6)).join(''));
console.log('  project  ', Array.from({ length: 14 }, (_, i) => (sm.perDay.get(i) ? `${sm.perDay.get(i)}m`.padStart(6) : '     .')).join(''));
