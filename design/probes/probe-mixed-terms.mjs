// probe-mixed-terms.mjs — "the weeks of different tasks are different".
//
// The question, asked by the user 2026-08-16: a single "Lay out this week"
// button, but every commitment has its OWN term. What actually happens to a
// commitment that has not started, one that has ended, one that starts
// mid-week, and one whose due day has already gone?
//
// Printed, not reasoned about.
//
//   node design/probes/probe-mixed-terms.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };

function termWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const cls = (o, h, e, t) => s.addFixed({ title: t, tags: ['classes'], startTime: at(o, h), endTime: at(o, e) });
  cls(0, 9, 10, 'CHEM'); cls(2, 9, 10, 'CHEM'); cls(4, 9, 10, 'CHEM');
  cls(1, 11, 12, 'THEO'); cls(3, 11, 12, 'THEO');
  s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(0, 17), endTime: at(0, 19) });
  return s;
}

/** Five commitments, deliberately all differently-termed. */
const CASES = [
  ['covers the whole week', { from: '2026-08-31', until: '2026-12-12' }],
  ['starts WEDNESDAY of this week', { from: '2026-09-09', until: '2026-12-12' }],
  ['term ENDED last week', { from: '2026-08-03', until: '2026-09-06' }],
  ['term STARTS next week', { from: '2026-09-14', until: '2026-12-12' }],
  ['due THURSDAY, whole term', { from: '2026-08-31', until: '2026-12-12', dueDay: 'thu' }],
];

const commitments = CASES.map(([label, over], i) => new Commitment({
  title: `C${i} ${label}`,
  tags: ['study'],
  amountMinPerWeek: 180,
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
  ...over,
}));

function run(nowLabel, now) {
  console.log(`\n${'='.repeat(72)}\nNOW = ${nowLabel}   ·   week of ${dateKey(MON)}\n${'='.repeat(72)}`);
  const s = termWeek();

  // What the BUTTON would see before it writes anything — this is the preview.
  const active = [];
  for (const c of commitments) {
    const input = c.engineInputForWeek(MON, now);
    if (!input) {
      // Two different reasons, and saying which is the whole point: one is the
      // term not reaching here, the other is the defect this probe found.
      const why = c.coversWeek(MON) ? 'its last usable day has PASSED' : 'the term does not reach this week';
      console.log(`  SKIP  ${c.title}\n          nothing owed — ${why}  (term ${c.from} → ${c.until})`);
      continue;
    }
    active.push({ c, input });
    console.log(`  OWES  ${c.title}`);
    console.log(`          ${input.amountMin}m · window ${dateKey(input.from)} → ${dateKey(input.until)} (excl)`);
  }

  if (!active.length) { console.log('\n  nothing owed this week.'); return; }

  const results = generateAll(s, active.map((a) => a.input), { now });
  console.log(`\n  --- laid out ---`);
  for (const r of results) {
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    const days = r.sittings.map((t) => `${dateKey(t.startTime)} ${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} ${t.getDuration()}m`);
    console.log(`  ${r.commitment.title}`);
    console.log(`     rho ${r.rho.toFixed(3)} · placed ${placed}/${r.commitment.amountMin}m · shortfall ${r.shortfall}m`);
    for (const d of days) console.log(`       ${d}`);
    if (!days.length) console.log('       (nothing)');
  }
  // §4.1.2: no two commitments may claim the same day.
  const byDay = {};
  for (const r of results) for (const t of r.sittings) (byDay[dateKey(t.startTime)] ||= []).push(r.commitment.title);
  const clashes = Object.entries(byDay).filter(([, v]) => v.length > 1);
  console.log(`\n  days used twice: ${clashes.length ? JSON.stringify(clashes) : 'none'}`);
}

run('Mon 7 Sep 06:00 — the week has not started', new Date(2026, 8, 7, 6, 0));
run('Wed 9 Sep 12:00 — midweek, half the week gone', new Date(2026, 8, 9, 12, 0));
run('Fri 11 Sep 12:00 — after a Thursday due day', new Date(2026, 8, 11, 12, 0));
