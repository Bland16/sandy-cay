// Q6 probe — does normalising `proximity` by the ACTUAL search span (instead of a
// fixed maxPlacementLookahead=3d) spread long-runway work, WITHOUT changing how an
// ordinary task is placed? Run once on shipped code, once with placement.js:189
// changed. Same script both times.
import { Schedule } from './src/core/Schedule.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const from = D(9, 7);           // Mon 7 Sep 2026
const until = D(9, 21, 18, 0);  // 14 days later

// Day offset from `from`, computed on the Date itself — never by reparsing a
// formatted string (that silently dropped the year and made every offset -9131).
const offsetOf = (dt) => Math.round(
  (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - from) / 86400000,
);

function report(label, sched, parentId) {
  const kids = sched.tasks.filter((t) => t.parentId === parentId)
    .sort((a, b) => a.startTime - b.startTime);
  const perDay = new Map();
  for (const k of kids) {
    const o = offsetOf(k.startTime);
    perDay.set(o, (perDay.get(o) || 0) + k.getDuration());
  }
  const idx = [...perDay.keys()].sort((a, b) => a - b);
  let streak = idx.length ? 1 : 0, run = 1;
  for (let i = 1; i < idx.length; i++) {
    run = idx[i] === idx[i - 1] + 1 ? run + 1 : 1;
    if (run > streak) streak = run;
  }
  const heaviest = Math.max(...perDay.values(), 0);
  console.log(`  ${label}`);
  console.log(`    sittings=${kids.length}  daysUsed=${perDay.size}/14  heaviestDay=${heaviest}m  longestStreak=${streak}`);
  console.log(`    spanUsed = day ${idx[0]} .. day ${idx[idx.length - 1]} of 14`);
  console.log(`    ${idx.map((o) => `d+${o}:${perDay.get(o)}m`).join('  ')}`);
}

function project(sched) {
  const { parent } = sched.addProject({
    title: 'Thesis', tags: ['study'],
    chunking: { totalMinutes: 1200, minChunk: 60, maxChunk: 240, range: { from, until } },
  });
  return parent.id;
}

console.log('=== 1. EMPTY week, 20h due in 14 days ===');
const empty = new Schedule({});
report('empty week', empty, project(empty));

console.log('\n=== 2. EMPTY week, windows widened to 06:00-23:00 (what HANDOFF tells the user to do) ===');
const wide = new Schedule({ config: { windows: { monFri: { start: '06:00', end: '23:00' } } } });
report('wide week', wide, project(wide));

console.log('\n=== 3. BUSY week (work zone Mon-Fri 09:00-17:00 exclusive + recurring gym) ===');
const busy = new Schedule({});
busy.addZone({
  label: 'Work', matchTags: ['work'], exclusive: true,
  windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => ({ day: d, start: '09:00', end: '17:00' })),
});
busy.addFixed({
  title: 'Gym', tags: ['gym'],
  startTime: D(9, 8, 18, 0), endTime: D(9, 8, 19, 0),
  recurrence: {
    periods: [{ windows: [{ day: 'tue', start: '18:00', end: '19:00' }, { day: 'thu', start: '18:00', end: '19:00' }], interval: 1, effectiveFrom: from }],
    anchorDate: from, exceptions: [],
  },
});
report('busy week', busy, project(busy));

// Controls run off the real clock, because addFlexible places from `now` — the
// runways below must be genuinely 2 and 3 days, not 28.
console.log('\n=== 4. CONTROLS — these must NOT move ===');
const now = new Date();
const plusDays = (n, h = 17) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, h, 0, 0, 0);
  return d;
};
const c = new Schedule({});
const ordinary = c.addFlexible({ title: 'Call plumber', durationMin: 60 });
console.log('  ordinary flexible, NO deadline    ->', ordinary.startTime.toString().slice(0, 21));
const short = c.addFlexible({ title: 'Due in 2 days', durationMin: 60, deadline: plusDays(2) });
console.log('  deadlined, 2-day runway           ->', short.startTime.toString().slice(0, 21));
const threeDay = c.addFlexible({ title: 'Due in 3 days', durationMin: 60, deadline: plusDays(3) });
console.log('  deadlined, exactly 3-day runway   ->', threeDay.startTime.toString().slice(0, 21));
const week = c.addFlexible({ title: 'Due in 7 days', durationMin: 60, deadline: plusDays(7) });
console.log('  deadlined, 7-day runway           ->', week.startTime.toString().slice(0, 21));
