// probe-term-spread.mjs — "isn't Lay out this week supposed to lay out the
// next term … otherwise it is uneven no?"
//
// Two questions in one, and they have different answers:
//   Q1 does the CURRENT week already fill "from today until the due day"?
//   Q2 what does week-by-week actually look like across a whole term — is it
//      uneven, and would laying the whole term out at once be more even?
//
//   node design/probes/probe-term-spread.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { previewWeek, layOutWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayName = (d) => DAY[(d.getDay() + 6) % 7];

/** A term week with real classes, repeated every week of the term. */
function termSchedule(weeks, anchorMon) {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let w = 0; w < weeks; w += 1) {
    const mon = addDays(anchorMon, w * 7);
    const cls = (o, h, e, t) => {
      const st = addDays(mon, o); st.setHours(h, 0, 0, 0);
      const en = addDays(mon, o); en.setHours(e, 0, 0, 0);
      s.addFixed({ title: t, tags: ['classes'], startTime: st, endTime: en });
    };
    cls(0, 9, 10, 'CHEM'); cls(2, 9, 10, 'CHEM'); cls(4, 9, 10, 'CHEM');
    cls(1, 11, 12, 'THEO'); cls(3, 11, 12, 'THEO');
    cls(0, 17, 19, 'Gym');
  }
  return s;
}

function line(t) {
  return `${dayName(t.startTime)} ${dateKey(t.startTime).slice(5)} `
    + `${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} `
    + `${t.getDuration()}m`;
}

// ---------------------------------------------------------------------------
console.log('='.repeat(74));
console.log('Q1 — does the CURRENT week already run "from today until the due day"?');
console.log('    commitment due TUESDAY. Asked on the Wednesday BEFORE it.');
console.log('='.repeat(74));
{
  const MON = weekStart(new Date(2026, 8, 7));
  const s = termSchedule(3, MON);
  s.addCommitment({
    title: 'Math', tags: ['study'], from: dateKey(MON), until: dateKey(addDays(MON, 60)),
    amountMinPerWeek: 240, dueDay: 'tue', minSitting: 30, maxSitting: 180, maxPerDay: 1,
  });
  // "Today" is the Wednesday of week 1 — so its Tuesday has gone; week 2's
  // Tuesday is the live one.
  const NOW = addDays(MON, 2); NOW.setHours(12, 0, 0, 0);
  for (const wOff of [0, 7]) {
    const ws = addDays(MON, wOff);
    const p = previewWeek(s, ws, NOW)[0];
    console.log(`\n  week of ${dateKey(ws)}  →  ${p.state.toUpperCase()}`);
    if (p.input) {
      console.log(`     window ${dayName(p.input.from)} ${dateKey(p.input.from)}  →  ${dateKey(p.input.until)} (exclusive)`);
      console.log('     ↑ generateSittings then floors this at NOW, so the real');
      console.log(`       start is ${dateKey(NOW)} 12:00, not the window start.`);
    }
    for (const r of layOutWeek(s, ws, NOW)) {
      for (const t of r.sittings) console.log(`     placed  ${line(t)}`);
      if (r.shortfall) console.log(`     short   ${r.shortfall}m`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n\n${'='.repeat(74)}`);
console.log('Q2 — week-by-week across a 4-week term. Is it uneven?');
console.log('    4h/week, no due day, laid out one week at a time from Monday.');
console.log('='.repeat(74));
{
  const MON = weekStart(new Date(2026, 8, 7));
  const s = termSchedule(4, MON);
  s.addCommitment({
    title: 'Math', tags: ['study'], from: dateKey(MON), until: dateKey(addDays(MON, 27)),
    amountMinPerWeek: 240, minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const NOW = new Date(MON.getTime()); NOW.setHours(6, 0, 0, 0);
  for (let w = 0; w < 4; w += 1) {
    const ws = addDays(MON, w * 7);
    const rs = layOutWeek(s, ws, NOW);
    const placed = rs.reduce((n, r) => n + r.sittings.reduce((m, t) => m + t.getDuration(), 0), 0);
    const short = rs.reduce((n, r) => n + r.shortfall, 0);
    const days = rs.flatMap((r) => r.sittings.map(line));
    console.log(`\n  week ${w + 1} (${dateKey(ws)})  ${placed}m placed, ${short}m short`);
    for (const d of days) console.log(`     ${d}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n\n${'='.repeat(74)}`);
console.log('Q2b — the UNEVEN case: you only start laying out on the WEDNESDAY.');
console.log('     Week 1 has 5 days for its 4h; every later week has 7.');
console.log('='.repeat(74));
{
  const MON = weekStart(new Date(2026, 8, 7));
  const s = termSchedule(4, MON);
  s.addCommitment({
    title: 'Math', tags: ['study'], from: dateKey(MON), until: dateKey(addDays(MON, 27)),
    amountMinPerWeek: 240, minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const NOW = addDays(MON, 2); NOW.setHours(12, 0, 0, 0);
  for (let w = 0; w < 3; w += 1) {
    const ws = addDays(MON, w * 7);
    const rs = layOutWeek(s, ws, NOW);
    const placed = rs.reduce((n, r) => n + r.sittings.reduce((m, t) => m + t.getDuration(), 0), 0);
    const short = rs.reduce((n, r) => n + r.shortfall, 0);
    console.log(`\n  week ${w + 1} (${dateKey(ws)})  ${placed}m placed, ${short}m short`);
    for (const r of rs) for (const t of r.sittings) console.log(`     ${line(t)}`);
  }
}
