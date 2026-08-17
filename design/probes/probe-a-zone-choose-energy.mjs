// probe-a-zone-choose-energy.mjs — PROBE-A / generation path, three smaller questions.
//
//  Z  A zone may open BEFORE the config day window (the 06:00 gym zone that
//     sharp-edge lore says must work). `gapsOnDay` filters the occupied set
//     against the ZONE's bounds, but `findBestSlot` filters it against
//     `dayWindowBounds(config, d)` — the general day. Anything occupying the
//     pre-window hours is therefore invisible to the placer. Does a generated
//     sitting land on top of it?
//
//  K  `chooseSittings`' "fold the remainder back into the previous sitting"
//     branch computes `room = min(prev.gap ? prev.gap.minutes : prev.minutes,
//     sMax) - prev.minutes`. `prev` is a raw GAP (no `.gap`), and gap minutes
//     were already capped at sMax, so `room` is identically 0 and the branch
//     can never fire. Is it dead?
//
//  E  `spreadDays` says "energy nudges, never overrides" (`s = distance -
//     rank(d) * 0.25`). `rank` is `energyBudget(...).low`, in LOAD-HOURS and
//     unbounded. How many load-hours does it take to overrule a day of distance?
//
//   node design/probes/probe-a-zone-choose-energy.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll, chooseSittings, spreadDays, gapsOnDay } from '../../src/core/generate.js';
import { seedStarterBuckets } from '../../src/core/index.js';
import { energyBudget, loadForTask } from '../../src/core/energy.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { Task } from '../../src/core/Task.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)}-${hhmm(t.endTime)} ${t.getDuration()}m`;

// ===========================================================================
// Z — a zone that opens before the config day window
// ===========================================================================
console.log('Z.  a 05:00–08:00 zone, with something already sitting inside it');
{
  resetIds();
  const s = new Schedule({ config: defaultConfig }); // config day window is 08:00–23:00
  s.addZone({
    label: 'Early', matchTags: ['gym'], exclusive: true,
    windows: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => ({ day: d, start: '05:00', end: '08:00' })),
  });
  // A real thing already in those hours — before the general day window opens.
  for (let d = 0; d < 7; d += 1) s.addFixed({ title: `Physio ${d}`, tags: ['gym'], startTime: at(d, 5), endTime: at(d, 6) });

  const clock = at(0, 4);
  const c = new Commitment({
    title: 'Training', tags: ['gym'], amountMinPerWeek: 180,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 90, maxPerDay: 1,
  });
  const input = c.engineInputForWeek(MON, clock);

  const probe = new Task({ title: 'Training', tags: ['gym'], type: 'flexible', startTime: input.from, endTime: at(0, 6), deadline: input.until });
  const occ = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const g = gapsOnDay(s, probe, MON, occ, clock);
  console.log(`    gapsOnDay(Mon) sees: ${g.map((x) => `${hhmm(x.start)}-${hhmm(x.end)} ${x.minutes}m`).join('  ') || '(none)'}   ← Physio IS subtracted here`);

  const res = generateAll(s, [input], { now: clock });
  console.log(`    laid: ${res[0].sittings.map(show).join('   ') || '(nothing)'}  short ${res[0].shortfall}m`);
  const bad = [];
  for (const t of res[0].sittings) {
    for (const o of s.tasks) {
      if (o === t || !o.startTime || !o.endTime || o.recurrence) continue;
      if (t.startTime < o.endTime && o.startTime < t.endTime) bad.push(`${show(t)} over "${o.title}" ${hhmm(o.startTime)}-${hhmm(o.endTime)}`);
    }
    if (t.schedulingWarning) bad.push(`schedulingWarning on ${show(t)}`);
  }
  if (bad.length) { console.log('    ✗ Z CONFIRMED:'); for (const b of bad) console.log(`        ${b}`); } else console.log('    ✓ no overlap');
  console.log('    cause: placement.js:273 filters the occupied set by dayWindowBounds(config, d),');
  console.log('           so anything wholly outside 08:00–23:00 is dropped before walkGaps.');
}

// ===========================================================================
// K — is the fold-back branch reachable?
// ===========================================================================
console.log('\nK.  chooseSittings, generate.js:155-163 — the fold-back branch');
{
  const day = (o) => addDays(MON, o);
  const gap = (o, mins) => ({ date: day(o), start: at(o, 8), end: at(o, 8 + mins / 60), minutes: mins });
  const cases = [
    ['gaps 180,100  amount 200  60/180', [gap(0, 180), gap(1, 100)], 200, { sMin: 60, sMax: 180, maxPerDay: 1 }],
    ['gaps 120,120  amount 130  60/120', [gap(0, 120), gap(1, 120)], 130, { sMin: 60, sMax: 120, maxPerDay: 1 }],
    ['gaps 90,90,90 amount 200  60/90', [gap(0, 90), gap(1, 90), gap(2, 90)], 200, { sMin: 60, sMax: 90, maxPerDay: 1 }],
    ['gaps 300,70  amount 320  60/300', [gap(0, 300), gap(1, 70)], 320, { sMin: 60, sMax: 300, maxPerDay: 1 }],
  ];
  for (const [label, gaps, amount, bounds] of cases) {
    const r = chooseSittings(gaps, amount, bounds);
    const placed = r.sittings.reduce((n, x) => n + x.minutes, 0);
    console.log(`    ${label.padEnd(34)} → ${r.sittings.map((x) => `${x.minutes}m@${dateKey(x.gap.date).slice(5)}`).join(' ')} short ${r.shortfall}  (${placed + r.shortfall === amount ? 'conserved' : '✗ NOT CONSERVED'})`);
  }
  // Direct proof that `room` is 0 for every possible head element.
  const probe = [{ minutes: 180 }, { minutes: 90 }, { minutes: 1 }];
  const rooms = probe.map((prev) => Math.min(prev.gap ? prev.gap.minutes : prev.minutes, 180) - prev.minutes);
  console.log(`    room for head elements ${JSON.stringify(probe.map((p) => p.minutes))} with sMax 180 = ${JSON.stringify(rooms)}`);
  console.log(`    the guard is \`room >= tail && tail > 0\` → ${JSON.stringify(rooms)} vs a positive tail: UNREACHABLE`);
}

// ===========================================================================
// E — how hard does energy push?
// ===========================================================================
console.log('\nE.  spreadDays: "energy nudges, never overrides" — measured');
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  // Thu/Fri/Sat loaded with heavy mental work; Mon–Wed clear.
  for (const d of [3, 4, 5]) {
    s.addFixed({ title: `Deep ${d}`, tags: ['study'], startTime: at(d, 9), endTime: at(d, 21) });
  }
  const probe = new Task({ title: 'ENGR', tags: ['study'], type: 'flexible', startTime: MON, endTime: at(0, 1) });
  const load = loadForTask(s, probe);
  console.log(`    load for a 'study' task: ${JSON.stringify(load)}`);
  const pool = [];
  for (let d = 0; d < 6; d += 1) pool.push(addDays(MON, d));
  const ranks = pool.map((d) => {
    const b = energyBudget(s, d);
    const axis = ['mental', 'physical', 'social', 'creative'].reduce((best, a) => (Math.abs(load[a]) > Math.abs(load[best]) ? a : best), 'mental');
    return { k: dateKey(d).slice(5), axis, low: b[axis].low, rank: load[axis] > 0 ? b[axis].low : -b[axis].low };
  });
  for (const r of ranks) console.log(`      ${r.k}  axis ${r.axis}  low ${r.low.toFixed(2)} load-hours  → rank ${r.rank.toFixed(2)}  → nudge ${(-r.rank * 0.25).toFixed(2)} days`);

  const flat = spreadDays(pool, 3, {});
  const withEnergy = spreadDays(pool, 3, {
    rank: (d) => {
      const b = energyBudget(s, d);
      const axis = ['mental', 'physical', 'social', 'creative'].reduce((best, a) => (Math.abs(load[a]) > Math.abs(load[best]) ? a : best), 'mental');
      if (!load[axis]) return 0;
      return load[axis] > 0 ? b[axis].low : -b[axis].low;
    },
  });
  const gapsOf = (ds) => ds.slice(1).map((d, i) => Math.round((d - ds[i]) / 86400000));
  console.log(`    n=3 over Mon–Sat, no energy   → ${flat.map((d) => dateKey(d).slice(5)).join(' ')}   day-gaps ${JSON.stringify(gapsOf(flat))}`);
  console.log(`    n=3 over Mon–Sat, with energy → ${withEnergy.map((d) => dateKey(d).slice(5)).join(' ')}   day-gaps ${JSON.stringify(gapsOf(withEnergy))}`);
  const adjacent = gapsOf(withEnergy).some((g) => g === 1);
  console.log(adjacent
    ? '    ⚠ energy produced ADJACENT days — the clustering the whole of step 5 exists to prevent'
    : '    ✓ still spread');
  console.log('    nudge = 0.25 × load-hours, so 4 load-hours cancels a whole day of distance;');
  console.log(`    with the SHIPPED starter buckets a 'study' hour is ${load.mental} mental, i.e. 2h of study = 1 day.`);
}

// E2 — the same thing through the real generator, at increasing day loads.
console.log('\nE2. the real generator: study already on Thu/Fri/Sat, at three sizes');
for (const [label, sh, eh] of [['2h evenings', 19, 21], ['4h afternoons', 13, 17], ['8h days (09:00–17:00)', 9, 17]]) {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  for (const d of [3, 4, 5]) s.addFixed({ title: `Reading ${d}`, tags: ['study'], startTime: at(d, sh), endTime: at(d, eh) });
  const clock = at(0, 6);
  console.log(`  · ${label}`);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 360,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 120, maxPerDay: 1,
  });
  const res = generateAll(s, [c.engineInputForWeek(MON, clock)], { now: clock });
  const ds = res[0].sittings.map((t) => t.startTime);
  const gaps = ds.slice(1).map((d, i) => Math.round((d - ds[i]) / 86400000));
  console.log(`    laid: ${res[0].sittings.map(show).join('   ')}`);
  console.log(`    day-gaps ${JSON.stringify(gaps)} — longest consecutive run of days = ${(() => { let best = 1; let run = 1; for (const g of gaps) { run = g === 1 ? run + 1 : 1; best = Math.max(best, run); } return best; })()}`);

  // Control: the identical week with NO buckets, so loadForTask returns zeros.
  resetIds();
  const s2 = new Schedule({ config: defaultConfig });
  for (const d of [3, 4, 5]) s2.addFixed({ title: `Reading ${d}`, tags: ['study'], startTime: at(d, sh), endTime: at(d, eh) });
  const c2 = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 360,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 120, maxPerDay: 1,
  });
  const res2 = generateAll(s2, [c2.engineInputForWeek(MON, clock)], { now: clock });
  console.log(`    control (no buckets → no energy opinion): ${res2[0].sittings.map(show).join('   ')}`);
}
