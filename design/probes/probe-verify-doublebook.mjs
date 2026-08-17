// probe-verify-doublebook.mjs — verify the three silent double-booking fixes.
//
// All three were found by a probe agent; two of them independently by a second
// agent from the other side. Each is silent: no warning, no coral, the task
// simply sits on top of another one.
//
//   node design/probes/probe-verify-doublebook.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { defaultConfig } from '../../src/core/config.js';
import { resolveDropConflicts } from '../../src/core/conflicts.js';
import { addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;
let bad = 0;

function report(label, subject, others) {
  const hit = others.find((o) => o !== subject && overlaps(subject, o));
  console.log(`   ${label}: ${dateKey(subject.startTime)} ${hhmm(subject.startTime)}-${hhmm(subject.endTime)}`
    + `  ${hit ? `*** ON TOP OF "${hit.title}" ***` : 'clear'}`);
  if (hit) bad += 1;
}

// ---------------------------------------------------------------------------
console.log('='.repeat(70));
console.log('1 — a ZONE hour outside config.windows. Stock config: Sunday opens 10:00.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  // A Sunday-morning running zone, 08:00-10:00 — before the day window opens.
  s.addZone({ label: 'Runs', matchTags: ['run'], windows: [{ day: 'sun', start: '08:00', end: '10:00' }], exclusive: false });
  const SUN = addDays(new Date(2026, 8, 7), 6); // Sun 13 Sep
  const st = new Date(SUN); st.setHours(8, 0, 0, 0);
  const en = new Date(SUN); en.setHours(9, 0, 0, 0);
  const run = s.addFixed({ title: 'Long run', tags: ['run'], startTime: st, endTime: en });
  const stretch = s.addFlexible({ title: 'Stretch', tags: ['run'], durationMin: 45, from: SUN, to: SUN });
  report('Stretch', stretch, [run]);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('2 — the 3-day lookahead crosses Sun -> Mon, past a recurring lecture.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const MON = new Date(2026, 8, 14); MON.setHours(0, 0, 0, 0);
  const anchor = new Date(MON); anchor.setHours(9, 0, 0, 0);
  const anchorEnd = new Date(MON); anchorEnd.setHours(11, 0, 0, 0);
  s.tasks.push(new Task({
    title: 'Lecture', tags: ['classes'], type: 'fixed', pinned: true,
    startTime: anchor, endTime: anchorEnd,
    recurrence: {
      periods: [{ windows: [{ day: 'mon', start: '09:00', end: '11:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
      anchorDate: MON, exceptions: [],
    },
  }));
  // Saturday 12 Sep: block the whole weekend so the search must reach Monday.
  const SAT = addDays(MON, -2);
  const satFrom = new Date(SAT); satFrom.setHours(8, 0, 0, 0);
  const sunTo = addDays(SAT, 1); sunTo.setHours(23, 0, 0, 0);
  s.addFixed({ title: 'Weekend away', startTime: satFrom, endTime: sunTo });
  const essay = s.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 120, from: satFrom });
  const occ = s.getTasksForWeek(MON).filter((t) => t.title === 'Lecture');
  report('Essay', essay, occ);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('3 — DISPLACEMENT crosses the same seam.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const MON = new Date(2026, 8, 14); MON.setHours(0, 0, 0, 0);
  const a = new Date(MON); a.setHours(9, 0, 0, 0);
  const b = new Date(MON); b.setHours(11, 0, 0, 0);
  s.tasks.push(new Task({
    title: 'Lecture', tags: ['classes'], type: 'fixed', pinned: true,
    startTime: a, endTime: b,
    recurrence: {
      periods: [{ windows: [{ day: 'mon', start: '09:00', end: '11:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
      anchorDate: MON, exceptions: [],
    },
  }));
  const SAT = addDays(MON, -2);
  const vFrom = new Date(SAT); vFrom.setHours(14, 0, 0, 0);
  const vTo = new Date(SAT); vTo.setHours(16, 0, 0, 0);
  const victim = s.addFlexible({ title: 'Victim', tags: ['study'], startTime: vFrom, endTime: vTo });
  // Fill Saturday and Sunday so the evictee must land on the Monday.
  const fillFrom = new Date(SAT); fillFrom.setHours(8, 0, 0, 0);
  const fillTo = addDays(SAT, 1); fillTo.setHours(23, 0, 0, 0);
  const dropped = new Task({ title: 'Big drop', type: 'fixed', startTime: fillFrom, endTime: fillTo });
  s.tasks.push(dropped);
  resolveDropConflicts(s, dropped, [victim], { now: fillFrom });
  const occ = s.getTasksForWeek(MON).filter((t) => t.title === 'Lecture');
  report('Victim', victim, occ);
}

console.log(`\n${bad === 0 ? 'ALL CLEAR — no double booking' : `${bad} DOUBLE BOOKING(S)`}`);
