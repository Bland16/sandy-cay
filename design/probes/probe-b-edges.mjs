// probe-b-edges.mjs — inclusive/exclusive edges (#11), zone/blocked/sleep
// interactions, and subtractIntervals. Fixed dates throughout (#8).

import { Schedule } from '../../src/core/Schedule.js';
import { dateFromKey, dateKey, formatHHMM, untilAfterLastRun } from '../../src/core/time.js';
import { computeWindows, subtractIntervals, sleepCutoff, isDayBlocked } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const fmt = (d) => `${dateKey(d)} ${formatHHMM(d)}`;
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const wins = (ws) => ws.map((w) => `${formatHHMM(w.start)}-${formatHHMM(w.end)}`).join(' | ') || '(none)';

// ==================================================== 1. task deadline edge
line('=== 1. a task deadline typed as a bare date ===');
{
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  // TaskPanel/AddTaskPanel store `dateFromKey(e.target.value)` -> 00:00 local.
  const deadline = dateFromKey('2026-08-20'); // user picked "20 Aug" in a date input
  const t = s.addFlexible({
    title: 'Essay', durationMin: 120, deadline,
    from: at('2026-08-17', '08:00'),
  });
  line(`  user picked 20 Aug -> stored deadline = ${fmt(deadline)}`);
  line(`  UI redisplays it as dateKey(deadline) = ${dateKey(deadline)}  ("20 Aug")`);
  // Force the task to be placed as late as possible: fill 17th-19th solid.
  const s2 = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  for (const k of ['2026-08-17', '2026-08-18', '2026-08-19']) {
    s2.addFixed({ title: `busy ${k}`, startTime: at(k, '08:00'), durationMin: 15 * 60 });
  }
  const t2 = s2.addFlexible({ title: 'Essay', durationMin: 120, deadline, from: at('2026-08-17', '08:00'), to: at('2026-08-21', '23:00') });
  line(`  every hour of 17-19 Aug booked; task due "20 Aug" lands ${fmt(t2.startTime)} (warning=${t2.schedulingWarning})`);
  const w20 = computeWindows(s2, { tags: [], deadline }, dateFromKey('2026-08-20'));
  line(`  computeWindows on 20 Aug itself = ${wins(w20)}`);
  line(`  -> the day the user typed is UNUSABLE. The half-open converter exists`);
  line(`     for exactly this (untilAfterLastRun -> ${fmt(untilAfterLastRun(dateFromKey('2026-08-20')))}) and the`);
  line(`     task deadline path does not use it, unlike the zone editor and Commitment.`);
  line(`  (unused first schedule kept the same shape: ${t.title} ${fmt(t.startTime)})`);
}

// ==================================================== 2. zone before 05:00
line('');
line('=== 2. Schedule#sittingsFor assumes no window opens before 05:00 ===');
{
  // Schedule.js#sittingsFor: "It cannot bite here, because a GENERATED sitting
  // can never start before 05:00: generateSittings places only inside
  // computeWindows, and the earliest window config allows is 08:00."
  // But SPEC §2.1's amendment says a zone is NOT clipped to config.windows.
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Dawn study', matchTags: ['study'], exclusive: true, windows: [{ day: 'mon', start: '04:00', end: '07:00' }] });
  const w = computeWindows(s, { tags: ['study'], deadline: null }, dateFromKey('2026-08-17'));
  line(`  computeWindows for a 'study' task on Mon 17 Aug = ${wins(w)}`);
  line(`  earliest legal automatic start = ${w.length ? formatHHMM(w[0].start) : 'n/a'}  (premise says >= 08:00)`);
  const t = s.addFlexible({ title: 'Sitting', tags: ['study'], durationMin: 60, from: at('2026-08-17', '00:00'), to: at('2026-08-17', '23:00') });
  line(`  addFlexible placed it at ${fmt(t.startTime)}`);
  // Now the grid-day / calendar-day split the comment says cannot occur:
  const c = s.addCommitment({ title: 'Study', tags: ['study'], from: '2026-08-01', until: '2026-12-01' });
  t.parentId = c.id;
  line(`  sittingsFor(week of Mon 17 Aug)  = ${s.sittingsFor(c.id, dateFromKey('2026-08-17')).map((x) => `${dateKey(x.startTime)} ${formatHHMM(x.startTime)}`).join(', ') || '(none)'}`);
  line(`  the 5am-anchored grid (#5) draws a 04:xx Monday task in SUNDAY's column.`);
}

// ==================================================== 3. blocked-day parking
line('');
line('=== 3. does the last-resort park respect a blocked day? ===');
{
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.blockDay(dateFromKey('2026-08-17'));
  line(`  isDayBlocked(17 Aug): Schedule=${s.isDayBlocked(dateFromKey('2026-08-17'))} placement=${isDayBlocked(s, dateFromKey('2026-08-17'))}`);
  line(`  computeWindows on the blocked day = ${wins(computeWindows(s, { tags: [], deadline: null }, dateFromKey('2026-08-17')))}`);
  // A task whose deadline has already passed -> placeTask step 4 (park).
  const t = s.addFlexible({
    title: 'Overdue', durationMin: 60, deadline: at('2026-08-16', '12:00'),
    from: at('2026-08-17', '09:00'),
  });
  line(`  overdue task parked at ${fmt(t.startTime)} (warning=${t.schedulingWarning})`);
  line(`  parked ON the blocked day? ${dateKey(t.startTime) === '2026-08-17' ? 'YES' : 'no'}`);
}

// ==================================================== 4. sleep guard vs zone
line('');
line('=== 4. sleep guard vs a zone window (and vs the task being placed) ===');
{
  const s = new Schedule({}); // default sleep: 8h
  // Tomorrow (Tue) has a 07:00 start.
  s.addFixed({ title: 'Early train', startTime: at('2026-08-18', '07:00'), durationMin: 60 });
  const cut = sleepCutoff(s, dateFromKey('2026-08-17'));
  line(`  sleepCutoff for Mon 17 Aug = ${cut ? fmt(cut) : 'null'} (tomorrow starts 07:00, guard 8h)`);
  line(`  Mon windows for an untagged task = ${wins(computeWindows(s, { tags: [], deadline: null }, dateFromKey('2026-08-17')))}`);
  s.addZone({ label: 'Night study', matchTags: ['study'], exclusive: true, windows: [{ day: 'mon', start: '20:00', end: '02:00' }] });
  line(`  a 20:00->02:00 zone window (crosses midnight) for a study task:`);
  line(`    ${wins(computeWindows(s, { tags: ['study'], deadline: null }, dateFromKey('2026-08-17')))}`);

  // Does the guard see the task it is currently re-placing?
  const s2 = new Schedule({});
  const early = s2.addFixed({ title: 'Gym', startTime: at('2026-08-18', '06:00'), durationMin: 60 });
  line(`  cutoff with only the task itself tomorrow (${early.title} 06:00) = ${fmt(sleepCutoff(s2, dateFromKey('2026-08-17')))}`);
}

// ==================================================== 5. subtractIntervals
line('');
line('=== 5. subtractIntervals edge cases ===');
{
  const iv = (a, b) => ({ start: at('2026-08-17', a), end: at('2026-08-17', b) });
  const p = (r) => r.map((x) => `${formatHHMM(x.start)}-${formatHHMM(x.end)}`).join(' | ') || '(empty)';
  line(`  base 08-18 minus 08-18       = ${p(subtractIntervals([iv('08:00', '18:00')], [iv('08:00', '18:00')]))}`);
  line(`  base 08-18 minus 12-12 (zero)= ${p(subtractIntervals([iv('08:00', '18:00')], [iv('12:00', '12:00')]))}`);
  line(`  base 08-18 minus 18-20 (abut)= ${p(subtractIntervals([iv('08:00', '18:00')], [iv('18:00', '20:00')]))}`);
  line(`  base 08-18 minus 07-09,17-19 = ${p(subtractIntervals([iv('08:00', '18:00')], [iv('07:00', '09:00'), iv('17:00', '19:00')]))}`);
  line(`  base 08-18 minus 14-12 (rev) = ${p(subtractIntervals([iv('08:00', '18:00')], [iv('14:00', '12:00')]))}`);
  line(`  base 08-18 minus overlapping holes 10-13,11-15 = ${p(subtractIntervals([iv('08:00', '18:00')], [iv('10:00', '13:00'), iv('11:00', '15:00')]))}`);
}
