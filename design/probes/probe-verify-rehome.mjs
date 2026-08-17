// probe-verify-rehome.mjs — verify PROBE-A's finding 2/5 independently.
//
// Sittings come out of step 4 DESCENDING by minutes; `spreadDays` returns days
// ASCENDING by date. They were paired POSITIONALLY, so the longest sitting was
// always handed the earliest candidate day whatever that day could hold — and
// `placeTask` then fell through to its last-resort park and dropped a 3h block
// on top of an all-day booking, while the app reported "short 0m".
//
//   node design/probes/probe-verify-rehome.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateSittings } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const NOW = at(0, 6);

/** A week that gets FREER as it goes on — the shape that exposes the pairing. */
function taperingWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  // Mon almost solid, Tue nearly so, Wed onwards wide open.
  s.addFixed({ title: 'Mon work', tags: ['work'], startTime: at(0, 8), endTime: at(0, 21) });
  s.addFixed({ title: 'Tue work', tags: ['work'], startTime: at(1, 8), endTime: at(1, 20) });
  return s;
}

function run(label, commitment) {
  const s = taperingWeek();
  const r = generateSittings(s, commitment, { now: NOW });
  const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
  console.log(`\n${label}`);
  console.log(`   ${placed}/${commitment.amountMin}m placed · shortfall ${r.shortfall}m · conserved: ${placed + r.shortfall === commitment.amountMin ? 'YES' : '*** NO ***'}`);

  const perDay = {};
  let bad = 0;
  for (const t of r.sittings) {
    const k = dateKey(t.startTime);
    perDay[k] = (perDay[k] || 0) + 1;
    // Does it sit on top of anything already there?
    const clash = s.tasks.find((o) => o !== t && !o.chunking && o.startTime && o.endTime
      && t.startTime < o.endTime && o.startTime < t.endTime);
    const flag = clash ? `  *** OVERLAPS "${clash.title}" ***` : (t.schedulingWarning ? '  (parked)' : '');
    if (clash) bad += 1;
    console.log(`      ${k} ${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} ${t.getDuration()}m${flag}`);
  }
  const over = Object.entries(perDay).filter(([, n]) => n > commitment.maxPerDay);
  if (over.length) { console.log(`   *** maxPerDay ${commitment.maxPerDay} EXCEEDED: ${JSON.stringify(over)} ***`); bad += 1; }
  if (!bad) console.log('   ✓ no overlaps, maxPerDay respected');
  return bad;
}

let bad = 0;
bad += run('A · 700m in 180m sittings, maxPerDay 1 (PROBE-A\'s H1c shape)', {
  id: 'c1', title: 'ENGR', tags: ['study'],
  amountMin: 700, from: MON, until: addDays(MON, 7),
  minSitting: 60, maxSitting: 180, maxPerDay: 1,
});

bad += run('B · maxPerDay 2, 4 sittings wanted, most of the week busy', {
  id: 'c2', title: 'ENGR', tags: ['study'],
  amountMin: 480, from: MON, until: addDays(MON, 3),
  minSitting: 60, maxSitting: 120, maxPerDay: 2,
});

bad += run('C · maxPerDay 3, small sittings', {
  id: 'c3', title: 'Drill', tags: ['study'],
  amountMin: 300, from: MON, until: addDays(MON, 4),
  minSitting: 30, maxSitting: 60, maxPerDay: 3,
});

console.log(`\n${bad === 0 ? 'ALL CLEAN' : `${bad} problem(s)`}`);
