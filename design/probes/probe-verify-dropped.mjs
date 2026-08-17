// probe-verify-dropped.mjs — verify PROBE-A's round-2 finding independently.
//
// The capacity-matching fix searched only `spread` plus the sitting's own gap
// day, so it DROPPED a sitting into the shortfall while a candidate day with
// room sat idle. A regression introduced by the fix itself.
//
// Fixture: free runs that grow across the week, so `spreadDays` picks a subset
// and Tuesday is left out despite having room.
//
//   node design/probes/probe-verify-dropped.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateSittings } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const NOW = at(0, 6);

/** Each day is booked from 08:00 until it tapers — later days are freer. */
function tapering() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const closes = [21, 20, 19, 18, 17]; // Mon..Fri; Sat/Sun free
  closes.forEach((h, i) => s.addFixed({
    title: `busy ${i}`, tags: ['work'], startTime: at(i, 8), endTime: at(i, h),
  }));
  return s;
}

const s = tapering();
const commitment = {
  id: 'c', title: 'ENGR', tags: ['study'],
  amountMin: 700, from: MON, until: addDays(MON, 7),
  minSitting: 60, maxSitting: 180, maxPerDay: 1,
};

const r = generateSittings(s, commitment, { now: NOW });
const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);

console.log('free run per day (minutes until the window closes at 23:00):');
for (let d = 0; d < 7; d += 1) {
  const close = [21, 20, 19, 18, 17][d];
  console.log(`   ${dateKey(addDays(MON, d))}  ${close ? (23 - close) * 60 : 900}m`);
}
console.log(`\n${placed}/${commitment.amountMin}m placed · shortfall ${r.shortfall}m`);
for (const t of r.sittings) {
  console.log(`   ${dateKey(t.startTime)} ${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} ${t.getDuration()}m`);
}

// The point: is any day left with room to spare while minutes were given up?
if (r.shortfall > 0) {
  const used = new Set(r.sittings.map((t) => dateKey(t.startTime)));
  const idle = [];
  for (let d = 0; d < 7; d += 1) {
    const k = dateKey(addDays(MON, d));
    const close = [21, 20, 19, 18, 17][d];
    const room = close ? (23 - close) * 60 : 900;
    if (!used.has(k) && room >= commitment.minSitting) idle.push(`${k} (${room}m free)`);
  }
  console.log(idle.length
    ? `\n*** ${r.shortfall}m given up while these days sat idle: ${idle.join(', ')} ***`
    : `\n✓ shortfall ${r.shortfall}m, but no idle day had room — honest`);
} else {
  console.log('\n✓ nothing given up');
}
