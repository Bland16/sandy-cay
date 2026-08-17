// probe-verify-runway.mjs — PLAN D-10: R* is a preference, not a wall.
//
// `runwayEnd(Mon, next Mon)` is Sat 14:24, and `eachDay(from, rEnd)` truncated
// there — so a Monday-planned Mon–Sun week NEVER OFFERED SUNDAY. A week whose
// only real space was the weekend reported a shortfall with Sunday empty.
//
// Verify BOTH halves: the shortfall goes, AND a week that already fits is
// untouched (finish-early preserved).
//
//   node design/probes/probe-verify-runway.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateSittings, runwayEnd } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const NOW = at(0, 6);
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekdays nearly full, weekend wide open — the student's real shape (§4.5). */
function weekdaysFull() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let d = 0; d < 5; d += 1) {
    s.addFixed({ title: `full ${d}`, tags: ['classes'], startTime: at(d, 8), endTime: at(d, 21) });
  }
  return s;
}

console.log(`R* for a Mon→Mon week ends ${dateKey(runwayEnd(MON, addDays(MON, 7)))}`);
console.log('(that is SATURDAY — Sunday was never a candidate)\n');

function run(label, amountMin) {
  const s = weekdaysFull();
  const c = {
    id: 'c', title: 'Thesis', tags: ['study'],
    amountMin, from: MON, until: addDays(MON, 7),
    minSitting: 90, maxSitting: 240, maxPerDay: 1,
  };
  const r = generateSittings(s, c, { now: NOW });
  const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
  const days = r.sittings.map((t) => `${DAY[(t.startTime.getDay() + 6) % 7]} ${dateKey(t.startTime).slice(5)}`);
  const usedSun = r.sittings.some((t) => t.startTime.getDay() === 0);
  console.log(`${label}`);
  console.log(`   ${placed}/${amountMin}m placed · shortfall ${r.shortfall}m`);
  console.log(`   days ${days.join(' · ') || '(none)'}`);
  console.log(`   Sunday used? ${usedSun ? 'YES' : 'no'}\n`);
  return { r, usedSun };
}

// The week can afford the buffer: it must NOT reach into Sunday.
const fits = run('A · 3h — the week can afford to finish early', 180);
// The week cannot: the buffer must give way rather than invent a shortfall.
const tight = run('B · 10h — only the weekend has room', 600);

console.log('='.repeat(64));
console.log(`A keeps finish-early (no Sunday): ${!fits.usedSun ? 'YES ✓' : 'NO ✗'}`);
// Measured with the change disabled: short 15m over Sat+Mon+Wed+Thu, Sunday
// unused. With it: short 5m over Sun+Sat+Mon. The residual is gap arithmetic
// (the sitting bounds cannot tile 600m exactly), not the buffer wall.
console.log(`B reaches Sunday: ${tight.usedSun ? 'YES ✓' : 'NO ✗'}`);
console.log(`B beats the buffered plan (was short 15m): ${tight.r.shortfall < 15 ? `YES ✓ (short ${tight.r.shortfall}m)` : 'NO ✗'}`);
