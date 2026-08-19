// probe-google-bounded-repeat.mjs — why every class failed to reach Google with
// `date.getTime is not a function`.
//
// Reported from a real sync: 18 of 26 tasks written, 8 refused, every one of
// them a course. The courses have one thing the seed's recurring tasks do not:
// a TERM END, i.e. `period.effectiveUntil`.
//
//     node design/probes/probe-google-bounded-repeat.mjs
import { Schedule, defaultConfig } from '../../src/core/index.js';
import { encodeTask, encodeTaskParts, safeRRULE } from '../../src/core/googleEncode.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};
const attempt = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };

const s = new Schedule({ config: defaultConfig });
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m, 0, 0);

// A course: Mon/Wed/Fri 10:00, running until the term ends.
const bounded = s.addFixed({
  title: 'CHEM — General Chemistry I',
  startTime: at(7, 10), endTime: at(7, 10, 50),
  tags: ['class'],
  recurrence: {
    periods: [{
      windows: [
        { day: 'mon', start: '10:00', end: '10:50' },
        { day: 'wed', start: '10:00', end: '10:50' },
        { day: 'fri', start: '10:00', end: '10:50' },
      ],
      interval: 1,
      effectiveFrom: at(7, 0).getTime(),
      effectiveUntil: new Date(2026, 11, 12).getTime(),
    }],
    anchorDate: at(7, 0).getTime(),
    exceptions: [],
  },
});

// The same shape with NO end date — this is what every seed fixture looks like.
const unbounded = s.addFixed({
  title: 'Gym',
  startTime: at(7, 16), endTime: at(7, 17),
  tags: ['body'],
  recurrence: {
    periods: [{
      windows: [{ day: 'mon', start: '16:00', end: '17:00' }],
      interval: 1,
      effectiveFrom: at(7, 0).getTime(),
      effectiveUntil: null,
    }],
    anchorDate: at(7, 0).getTime(),
    exceptions: [],
  },
});

console.log('=== 1. THE SHAPE THAT FAILS ===\n');
console.log(`  effectiveUntil, as stored on the live Task : ${bounded.recurrence.periods[0].effectiveUntil}`);
console.log(`  effectiveUntil, as toJSON() emits it       : ${bounded.toJSON().recurrence.periods[0].effectiveUntil}`);
console.log('  ↑ a Date on the model, an epoch NUMBER in the JSON. `safeRRULE` is\n'
  + '    handed the JSON, and `toRRULE` calls `lastRunDay(effectiveUntil)`\n'
  + '    → `dayStart(number)` → `new Date(date.getTime())`.\n');

const a = attempt(() => safeRRULE(bounded.toJSON()));
console.log(`  safeRRULE(bounded JSON)   ${a.ok ? JSON.stringify(a.value) : `THREW: ${a.error}`}`);
const b = attempt(() => safeRRULE(unbounded.toJSON()));
console.log(`  safeRRULE(unbounded JSON) ${b.ok ? JSON.stringify(b.value) : `THREW: ${b.error}`}\n`);

check('a BOUNDED repeat encodes at all', attempt(() => encodeTask(bounded, { timeZone: 'America/New_York' })).ok,
  attempt(() => encodeTask(bounded, {})).error || '');
check('an UNBOUNDED repeat encodes', attempt(() => encodeTask(unbounded, {})).ok);

console.log('\n=== 2. WHAT THE RULE SHOULD SAY ===\n');
const enc = attempt(() => encodeTask(bounded, { timeZone: 'America/New_York' }));
if (enc.ok) {
  const rule = (enc.value.recurrence || [])[0] || '(none)';
  console.log(`  ${rule}`);
  check('carries UNTIL, so the class stops when the term does', /UNTIL=/.test(rule),
    'RFC 5545 UNTIL is inclusive; effectiveUntil is exclusive, so 12 Dec → 11 Dec');
  check('UNTIL is UTC, which RFC 5545 §3.3.10 REQUIRES beside a zoned DTSTART', /UNTIL=[0-9]{8}T[0-9]{6}Z/.test(rule),
    'a rule Google refuses is a 400, and the event never appears at all');
  // The last class is Fri 11 Dec at 10:00. UNTIL must not fall before it, or the
  // final session of term silently vanishes from the calendar.
  const untilStr = (/UNTIL=([0-9]{8}T[0-9]{6})Z/.exec(rule) || [])[1];
  const untilAt = untilStr ? Date.UTC(+untilStr.slice(0, 4), +untilStr.slice(4, 6) - 1, +untilStr.slice(6, 8),
    +untilStr.slice(9, 11), +untilStr.slice(11, 13), +untilStr.slice(13, 15)) : 0;
  const lastClass = new Date(2026, 11, 11, 10, 0, 0, 0).getTime();
  check('the last class of term still falls inside the rule', untilAt >= lastClass,
    `UNTIL ${new Date(untilAt).toISOString()} vs last class ${new Date(lastClass).toISOString()}`);
} else {
  console.log(`  cannot say — encodeTask threw: ${enc.error}`);
  failures += 1;
}

console.log('\n=== 3. THE SPLIT PATH, WHICH TAKES A DIFFERENT DOOR ===\n');
// Different times on different days → one event per time, built by hand in
// `encodeTaskParts` rather than by `toRRULE`.
const split = s.addFixed({
  title: 'ENGR — Foundations + Studio',
  startTime: at(7, 9), endTime: at(7, 10),
  tags: ['class'],
  recurrence: {
    periods: [{
      windows: [
        { day: 'tue', start: '09:00', end: '10:00' },
        { day: 'thu', start: '13:00', end: '15:00' },
      ],
      interval: 1,
      effectiveFrom: at(7, 0).getTime(),
      effectiveUntil: new Date(2026, 11, 12).getTime(),
    }],
    anchorDate: at(7, 0).getTime(),
    exceptions: [],
  },
});
const parts = attempt(() => encodeTaskParts(split, { timeZone: 'America/New_York' }));
if (parts.ok) {
  console.log(`  parts: ${parts.value.length}`);
  for (const p of parts.value) console.log(`    ${(p.recurrence || ['(none)'])[0]}`);
  const allBounded = parts.value.every((p) => /UNTIL=/.test((p.recurrence || [])[0] || ''));
  check('each part stops at the end of term', allBounded,
    allBounded ? '' : 'a split class repeats FOREVER in Google');
} else {
  console.log(`  THREW: ${parts.error}`);
  failures += 1;
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
