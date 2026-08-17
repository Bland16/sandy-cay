// probe-a-spread-rehome.mjs — PROBE-A / generation path, step 5.
//
// generate.js's header promises: "sittings are GAP-SHAPED. Each takes the length
// of the gap it was chosen for … the placer cannot undo the plan — step 6 bounds
// each sitting to a single day and THE DAY ALREADY HAS ROOM FOR IT BY
// CONSTRUCTION."
//
// But step 5 (`spreadDays`) RE-HOMES the sittings onto a different set of days,
// and the pairing is positional:
//
//    plan.sittings  is in DESCENDING-MINUTES order (picked order)
//    spread         is in ASCENDING-DATE order   (`chosen.sort((a,b)=>a-b)`)
//    day = spread[i] || sit.gap.date
//
// So the LONGEST sitting is always handed the EARLIEST candidate day, whatever
// that day's longest run actually is. Two hypotheses:
//
//  H1  a 180m sitting cut from Saturday's empty day is re-homed onto a Monday
//      whose only free run is 60m → placeTask falls through to its step-4 park
//      and lays it straight over the day's existing tasks.
//  H2  when there are fewer candidate DAYS than sittings, `spreadDays` returns a
//      short array and `|| sit.gap.date` fills in — stacking more than
//      `maxPerDay` sittings on one day.
//
//   node design/probes/probe-a-spread-rehome.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll, gapsOnDay, chooseSittings, spreadDays } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { Task } from '../../src/core/Task.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)}-${hhmm(t.endTime)} ${t.getDuration()}m`;

function check(sched, results, clock) {
  const fails = [];
  for (const r of results) {
    const c = r.commitment;
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    if (placed + r.shortfall !== c.amountMin) fails.push(`conservation: ${placed} + ${r.shortfall} ≠ ${c.amountMin}`);
    const perDay = {};
    for (const t of r.sittings) {
      const k = dateKey(t.startTime);
      const dur = t.getDuration();
      if (dur < c.minSitting) fails.push(`sitting ${dur}m < minSitting ${c.minSitting}`);
      if (dur > c.maxSitting) fails.push(`sitting ${dur}m > maxSitting ${c.maxSitting}`);
      if (t.startTime.getTime() < clock.getTime()) fails.push(`in the PAST: ${show(t)}`);
      if (sched.isDayBlocked(t.startTime)) fails.push(`on a BLOCKED day: ${show(t)}`);
      if (k >= dateKey(c.until)) fails.push(`on/after the exclusive end: ${k} >= ${dateKey(c.until)}`);
      perDay[k] = (perDay[k] || 0) + 1;
      if (perDay[k] > c.maxPerDay) fails.push(`maxPerDay ${c.maxPerDay} EXCEEDED on ${k} (${perDay[k]} sittings)`);
      if (t.schedulingWarning) fails.push(`schedulingWarning (parked, no legal slot): ${show(t)}`);
      for (const o of sched.tasks) {
        if (o === t || o.chunking || o.recurrence || !o.startTime || !o.endTime) continue;
        if (t.startTime < o.endTime && o.startTime < t.endTime) fails.push(`OVERLAP: ${show(t)} over "${o.title}" ${hhmm(o.startTime)}-${hhmm(o.endTime)}`);
      }
    }
  }
  return fails;
}

function report(label, sched, results, clock) {
  console.log(`    laid: ${results.flatMap((r) => r.sittings).map(show).join('   ') || '(nothing)'}`);
  for (const r of results) console.log(`    ${r.commitment.title}: ${r.sittings.reduce((n, t) => n + t.getDuration(), 0)}/${r.commitment.amountMin}m  short ${r.shortfall}m`);
  const fails = check(sched, results, clock);
  if (fails.length) { console.log(`    ✗ ${label}`); for (const f of fails) console.log(`        ${f}`); } else console.log('    ✓ invariants hold');
  return fails;
}

console.log('PROBE-A · step 5 re-homes sittings onto days that cannot hold them');
console.log(`week under test ${D(0)} … ${D(6)}\n`);

// ===========================================================================
// H1 — a long sitting handed a short day
// ===========================================================================
// Monday is booked 08:00–21:50 (one free run of 70m at 21:50–23:00, which is
// 65m once the 5m break padding for a 93%-full day is taken off — just over the
// 60m minimum, so Monday IS a candidate day).
// Saturday is entirely free (one run of 900m, capped to maxSitting 180).
// Tue–Fri and Sun are blocked, so the candidate days are exactly [Mon, Sat].
function shortMondayLongSaturday() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({ title: 'All-day thing', tags: ['work'], startTime: at(0, 8), endTime: at(0, 21, 50) });
  [1, 2, 3, 4, 6].forEach((d) => s.blockDay(addDays(MON, d)));
  return s;
}

{
  console.log('H1  Monday has one 60m run; Saturday is empty. 240m owed, 60/180 bounds.');
  const s = shortMondayLongSaturday();
  const clock = at(0, 6);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 240,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const input = c.engineInputForWeek(MON, clock);

  // Show the plan BEFORE step 5, so the re-home is visible rather than inferred.
  const probe = new Task({ title: c.title, tags: ['study'], type: 'flexible', startTime: input.from, endTime: at(0, 1), deadline: input.until });
  const days = [];
  for (let d = new Date(MON.getTime()); d.getTime() <= addDays(MON, 5).getTime(); d = addDays(d, 1)) days.push(d);
  const occ = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const gaps = days.flatMap((d) => gapsOnDay(s, probe, d, occ, clock));
  console.log(`    real free runs: ${gaps.map((g) => `${dateKey(g.date).slice(5)} ${hhmm(g.start)}-${hhmm(g.end)} ${g.minutes}m`).join('  ')}`);
  const plan = chooseSittings(gaps, 240, { sMin: 60, sMax: 180, maxPerDay: 1 });
  console.log(`    step 3-4 plan (descending): ${plan.sittings.map((x) => `${x.minutes}m from ${dateKey(x.gap.date).slice(5)}`).join('  ')}`);
  const cand = [...new Map(gaps.filter((g) => g.minutes >= 60).map((g) => [dateKey(g.date), g.date])).values()].sort((a, b) => a - b);
  const spread = spreadDays(cand, plan.sittings.length, {});
  console.log(`    step 5 spread (ascending):  ${spread.map((d) => dateKey(d).slice(5)).join('  ')}`);
  console.log(`    ⇒ pairing: ${plan.sittings.map((x, i) => `${x.minutes}m → ${dateKey(spread[i] || x.gap.date).slice(5)}`).join('   ')}`);

  const results = generateAll(s, [input], { now: clock });
  report('H1 CONFIRMED', s, results, clock);
}

// ===========================================================================
// H1b — the same shape with nothing blocked (is it only reachable artificially?)
// ===========================================================================
{
  console.log('\nH1b Nothing blocked: Mon–Fri booked 08:00–22:00, weekend free.');
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let d = 0; d < 5; d += 1) s.addFixed({ title: `Work ${d}`, tags: ['work'], startTime: at(d, 8), endTime: at(d, 22) });
  const clock = at(0, 6);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 420,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const results = generateAll(s, [c.engineInputForWeek(MON, clock)], { now: clock });
  report('H1b CONFIRMED', s, results, clock);
}

// ===========================================================================
// H1c — an ORDINARY week: nothing blocked, evenings free, Monday the busiest.
// ===========================================================================
{
  console.log('\nH1c Nothing blocked, no artificial shapes: a week that gets freer as it goes on.');
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const endHour = [21, 20, 19, 18, 17]; // Mon busiest → Fri freest
  endHour.forEach((h, d) => s.addFixed({ title: `Day ${d} work`, tags: ['work'], startTime: at(d, 8), endTime: at(d, h) }));
  const clock = at(0, 6);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 700,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const results = generateAll(s, [c.engineInputForWeek(MON, clock)], { now: clock });
  report('H1c CONFIRMED — reachable with no blocked days and no contrived gaps', s, results, clock);
}

// ===========================================================================
// H2 — maxPerDay > 1 with fewer candidate days than sittings
// ===========================================================================
{
  console.log('\nH2  maxPerDay 2, 4 sittings wanted, only Mon+Tue available.');
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  // A midday task splits each day into two runs, so each day offers 2 gaps.
  s.addFixed({ title: 'Lunch thing Mon', tags: ['work'], startTime: at(0, 12), endTime: at(0, 13) });
  s.addFixed({ title: 'Lunch thing Tue', tags: ['work'], startTime: at(1, 12), endTime: at(1, 13) });
  [2, 3, 4, 5, 6].forEach((d) => s.blockDay(addDays(MON, d)));
  const clock = at(0, 6);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 480,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 120, maxPerDay: 2,
  });
  const results = generateAll(s, [c.engineInputForWeek(MON, clock)], { now: clock });
  const perDay = {};
  for (const t of results[0].sittings) perDay[dateKey(t.startTime)] = (perDay[dateKey(t.startTime)] || 0) + 1;
  console.log(`    per-day counts: ${JSON.stringify(perDay)}   (maxPerDay = 2)`);
  report('H2 CONFIRMED', s, results, clock);
}
