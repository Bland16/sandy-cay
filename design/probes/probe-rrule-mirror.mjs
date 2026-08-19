// probe-rrule-mirror.mjs — when a repeating task can be shown as a repeating
// GOOGLE event, and when it cannot. design/GOOGLE-AS-STORAGE.md GS-10.
//
// Both failure modes below came from a real calendar, not from imagination:
// a repeating gym showed only its first instance, and another showed nothing
// at all.
//
//     node design/probes/probe-rrule-mirror.mjs
import { Task } from '../../src/core/index.js';
import { encodeTask, safeRRULE } from '../../src/core/googleEncode.js';

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let failures = 0;
const check = (label, cond) => { if (!cond) failures += 1; console.log(`   ${cond ? 'OK  ' : '**FAIL**'} ${label}`); };

const mk = (windows, startTime) => Task.fromJSON({
  id: 'gym-0001',
  title: 'Gym',
  startTime: startTime.getTime(),
  endTime: new Date(startTime.getTime() + 3600000).getTime(),
  recurrence: {
    anchorDate: null,
    exceptions: [],
    periods: [{ windows, interval: 1, effectiveFrom: null, effectiveUntil: null }],
  },
});

const show = (t) => {
  const ev = encodeTask(t, {});
  const why = ev.extendedProperties.private['sc.norrule'];
  console.log(`   start      ${ev.start.dateTime}  (${DAY[new Date(t.startTime).getDay()]})`);
  console.log(`   recurrence ${ev.recurrence ? ev.recurrence[0] : '(none)'}`);
  if (why) console.log(`   downgraded because: ${why}`);
  return ev;
};

console.log('=== 1. SAME TIME on several days — one event does it ===\n');
{
  const t = mk([
    { day: 'mon', start: '16:15', end: '17:15' },
    { day: 'wed', start: '16:15', end: '17:15' },
    { day: 'sat', start: '16:15', end: '17:15' },
  ], new Date(2026, 8, 7, 16, 15)); // Monday
  const ev = show(t);
  check('emits BYDAY=MO,WE,SA', /BYDAY=MO,WE,SA/.test(ev.recurrence?.[0] || ''));
  console.log('   Google expands three instances, all at 16:15. Faithful.\n');
}

console.log('=== 2. DIFFERENT times per day — one event CANNOT do it ===\n');
console.log('   An RRULE carries exactly one time: the event\'s own start.\n');
{
  const t = mk([
    { day: 'mon', start: '16:15', end: '17:15' },
    { day: 'wed', start: '19:00', end: '20:00' },
    { day: 'sat', start: '14:00', end: '15:00' },
  ], new Date(2026, 8, 7, 16, 15));
  const ev = show(t);
  check('no rule is emitted', !ev.recurrence);
  check('and it says why', ev.extendedProperties.private['sc.norrule'] === 'windows-differ');
  console.log('   Without this guard Google would show Wed and Sat at 16:15 —');
  console.log('   the wrong time on two days out of three, while the app\'s own');
  console.log('   grid is right. A mirror that lies is worse than no mirror.\n');
}

console.log('=== 3. ANCHOR NOT AMONG THE REPEAT DAYS — Google refuses outright ===\n');
{
  const t = mk([
    { day: 'tue', start: '18:00', end: '19:00' },
    { day: 'thu', start: '18:00', end: '19:00' },
  ], new Date(2026, 8, 7, 18, 0)); // a MONDAY anchor
  const ev = show(t);
  check('no rule is emitted', !ev.recurrence);
  check('and it says why', ev.extendedProperties.private['sc.norrule'] === 'anchor-not-in-rule');
  console.log('   Google rejects an RRULE whose BYDAY excludes DTSTART with 400,');
  console.log('   so the INSERT FAILS and the event never appears at all. This is');
  console.log('   how a repeating task went completely missing from the calendar.\n');
}

console.log('=== 4. The payload is unaffected in every case ===\n');
{
  const t = mk([
    { day: 'mon', start: '16:15', end: '17:15' },
    { day: 'wed', start: '19:00', end: '20:00' },
  ], new Date(2026, 8, 7, 16, 15));
  const r = safeRRULE(t.toJSON());
  check('rule withheld', r.rule === null);
  console.log('   The app still knows the real pattern — it lives in sc.json, not');
  console.log('   in the RRULE. Only GOOGLE\'S VIEW is reduced to one event.');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
