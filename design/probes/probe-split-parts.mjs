// probe-split-parts.mjs — a task with different times on different days becomes
// several Google events, and comes back as ONE task.
// design/GOOGLE-AS-STORAGE.md GS-10.
//
//     node design/probes/probe-split-parts.mjs
import { Task, seed } from '../../src/core/index.js';
import { encodeTaskParts, decodeEvent, timeGroups } from '../../src/core/googleEncode.js';

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`   ${cond ? 'OK  ' : '**FAIL**'} ${label}${extra ? `  ${extra}` : ''}`);
};

const gym = Task.fromJSON({
  id: 'gym-0001',
  title: 'Gym',
  tags: ['gym'],
  startTime: new Date(2026, 8, 7, 16, 15).getTime(), // Monday
  endTime: new Date(2026, 8, 7, 17, 15).getTime(),
  load: { physical: 3, mental: 0, social: 0, creative: 0 },
  recurrence: {
    anchorDate: null,
    exceptions: [],
    periods: [{
      windows: [
        { day: 'mon', start: '16:15', end: '17:15' },
        { day: 'wed', start: '19:00', end: '20:00' },
        { day: 'sat', start: '14:00', end: '15:00' },
      ],
      interval: 1,
      effectiveFrom: null,
      effectiveUntil: null,
    }],
  },
});

console.log('=== 1. THE GYM: three times, three events ===\n');
const parts = encodeTaskParts(gym, { timeZone: 'America/New_York' });
check('splits into three', parts.length === 3, `got ${parts.length}`);
for (const p of parts) {
  const s = new Date(p.start.dateTime);
  const priv = p.extendedProperties.private;
  console.log(`   part ${priv['sc.part']}/${priv['sc.parts']}  `
    + `${DAY[s.getDay()]} ${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}  `
    + `${p.recurrence[0]}`);
}

console.log('\n=== 2. EVERY PART IS LEGAL: DTSTART falls on one of its own days ===\n');
console.log('   Google rejects an RRULE whose BYDAY excludes DTSTART — that is');
console.log('   how the gym vanished entirely before this.\n');
for (const p of parts) {
  const s = new Date(p.start.dateTime);
  const code = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][s.getDay()];
  const byday = /BYDAY=([^;]+)/.exec(p.recurrence[0])[1].split(',');
  check(`part ${p.extendedProperties.private['sc.part']}: ${code} in ${byday.join(',')}`, byday.includes(code));
}

console.log('\n=== 3. AND THE TIMES ARE RIGHT, which is the whole point ===\n');
const times = parts.map((p) => {
  const s = new Date(p.start.dateTime);
  return `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
}).sort();
console.log(`   ${times.join(', ')}`);
check('all three real times are present', ['14:00', '16:15', '19:00'].every((t) => times.includes(t)));

console.log('\n=== 4. THEY COME BACK AS ONE TASK ===\n');
const decoded = parts.map((p) => decodeEvent({ ...p, id: `ev${p.extendedProperties.private['sc.part']}` }));
check('every part decodes', decoded.every((d) => d.ok));
const ids = new Set(decoded.map((d) => d.task.id));
check('all parts share one task id', ids.size === 1, [...ids].join(','));
check('and it is the original', ids.has('gym-0001'));
check('each part carries the FULL pattern, so any one can rebuild it',
  decoded.every((d) => JSON.stringify(d.task.recurrence) === JSON.stringify(gym.toJSON().recurrence)));
console.log('   (that redundancy is deliberate: if only part 0 held the payload,');
console.log('    a hand-deleted part 0 would strand the rest as fragments)');

console.log('\n=== 5. A MISSING PART IS DETECTABLE ===\n');
const seenParts = parts.slice(0, 2).map((p) => Number(p.extendedProperties.private['sc.part']));
const expected = Number(parts[0].extendedProperties.private['sc.parts']);
check('count says 3, only 2 present', expected === 3 && seenParts.length === 2);
console.log('   sc.parts is what makes "half a routine" visible instead of silent.');

console.log('\n=== 6. ORDINARY TASKS ARE UNTOUCHED ===\n');
const s = seed();
const plain = s.tasks.find((t) => !t.recurrence);
check('a one-off makes exactly one event', encodeTaskParts(plain, {}).length === 1);
const sameTime = s.tasks.find((t) => t.recurrence);
check('a same-time-every-day repeat is NOT split',
  timeGroups(sameTime.toJSON()).length === 0 && encodeTaskParts(sameTime, {}).length === 1);
console.log('   Splitting only happens when one event genuinely cannot say it.');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
