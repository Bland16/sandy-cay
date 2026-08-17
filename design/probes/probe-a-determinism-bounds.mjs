// probe-a-determinism-bounds.mjs — PROBE-A / generation path.
//
// Five questions, each RUN:
//   1  planWeek (throwaway copy) vs layOutWeek (real schedule) — do they agree?
//   2  is generateAll deterministic across two identical fresh schedules?
//   3  ρ with Ω = 0: Infinity, NaN, and what that does to the sort
//   4  R* (runwayEnd) drops the last fifth of the runway — which DAYS does a
//      normal Mon–Sun week actually get offered?
//   5  DST weeks, single-day terms, huge and tiny amounts
//
//   node design/probes/probe-a-determinism-bounds.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll, runwayEnd, openMinutesFor } from '../../src/core/generate.js';
import { previewWeek, planWeek, layOutWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, addDays, dateKey, dayStart } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { Task } from '../../src/core/Task.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)} ${t.getDuration()}m`;
const sig = (results) => results.map((r) => `${r.commitment.title}|${r.shortfall}|${r.sittings.map(show).join(',')}`).join(' ;; ');

function termWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const cls = (o, h, e, t) => s.addFixed({ title: t, tags: ['classes'], startTime: at(o, h), endTime: at(o, e) });
  cls(0, 9, 10, 'CHEM'); cls(2, 9, 10, 'CHEM'); cls(4, 9, 10, 'CHEM');
  cls(1, 11, 12, 'THEO'); cls(3, 11, 12, 'THEO');
  cls(0, 13, 14, 'disc'); cls(1, 14, 15, 'ENGR'); cls(3, 14, 15, 'ENGR');
  s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(0, 17), endTime: at(0, 19) });
  return s;
}
const commit = (over = {}) => new Commitment({
  title: 'ENGR', tags: ['study'], amountMinPerWeek: 240,
  from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1, ...over,
});

console.log('PROBE-A · determinism, preview-vs-apply, ρ, and the R* horizon');
console.log(`week under test ${D(0)} … ${D(6)}\n`);

// ===========================================================================
// 1 — planWeek vs layOutWeek
// ===========================================================================
{
  console.log('1.  planWeek (throwaway copy) vs layOutWeek (real schedule)');
  const build = () => {
    const s = termWeek();
    s.addCommitment(commit({ title: 'ENGR' }));
    s.addCommitment(commit({ title: 'CHEM', amountMinPerWeek: 180, dueDay: 'fri' }));
    s.addCommitment(commit({ title: 'Reading', amountMinPerWeek: 120, minSitting: 45, maxSitting: 90 }));
    s.blockDay(addDays(MON, 3));
    return s;
  };
  const clock = at(0, 6);
  const a = build();
  const planned = planWeek(a, MON, clock);
  const applied = layOutWeek(a, MON, clock);
  console.log(`    planned  ${sig(planned)}`);
  console.log(`    applied  ${sig(applied)}`);
  console.log(sig(planned) === sig(applied) ? '    ✓ preview matches what you get' : '    ✗ PREVIEW DISAGREES WITH THE APPLY');
  console.log(`    (planWeek left the real schedule alone? tasks ${a.tasks.length - applied.flatMap((r) => r.sittings).length} before → ${a.tasks.length} after)`);
}

// ===========================================================================
// 2 — determinism across two identical fresh schedules
// ===========================================================================
{
  console.log('\n2.  two identical fresh schedules, same injected now');
  const clock = at(0, 6);
  const mk = () => {
    const s = termWeek();
    for (let i = 0; i < 4; i += 1) s.addCommitment(commit({ title: `C${i}`, amountMinPerWeek: 120 + i * 60 }));
    return s;
  };
  const s1 = mk(); const s2 = mk();
  const r1 = layOutWeek(s1, MON, clock);
  const r2 = layOutWeek(s2, MON, clock);
  console.log(`    run A  ${sig(r1)}`);
  console.log(`    run B  ${sig(r2)}`);
  console.log(sig(r1) === sig(r2) ? '    ✓ deterministic' : '    ✗ NON-DETERMINISTIC');
}

// ===========================================================================
// 3 — ρ when Ω is zero
// ===========================================================================
{
  console.log('\n3.  ρ = A/Ω with Ω = 0 (every day blocked)');
  const clock = at(0, 6);
  const s = termWeek();
  for (let d = 0; d < 7; d += 1) s.blockDay(addDays(MON, d));
  s.addCommitment(commit({ title: 'Alpha', amountMinPerWeek: 60, priority: 1 }));
  s.addCommitment(commit({ title: 'Beta', amountMinPerWeek: 600, priority: 5 }));
  const res = layOutWeek(s, MON, clock);
  for (const r of res) console.log(`    ${r.commitment.title.padEnd(8)} ρ = ${r.rho}  placed ${r.sittings.length}  short ${r.shortfall}`);
  console.log(`    sort key b.rho - a.rho for two Infinities = ${Infinity - Infinity} (falsy → falls through to priority)`);
  const probe = new Task({ title: 'x', tags: ['study'], type: 'flexible', startTime: MON, endTime: at(0, 1) });
  console.log(`    openMinutesFor over a fully blocked week = ${openMinutesFor(s, probe, MON, addDays(MON, 6), [], clock)}m`);
}

// ===========================================================================
// 4 — which days does R* actually offer?
// ===========================================================================
{
  console.log('\n4.  R* = runwayEnd(from, until) — the last fifth of the runway is dropped');
  const rows = [];
  for (let d = 0; d < 7; d += 1) {
    const c = commit();
    const clock = at(d, 6);
    const input = c.engineInputForWeek(MON, clock);
    if (!input) { rows.push(`    asked ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}  (nothing owed)`); continue; }
    const from = new Date(Math.max(dayStart(input.from).getTime(), dayStart(clock).getTime()));
    const rEnd = runwayEnd(from, input.until);
    const days = [];
    for (let x = dayStart(from); x.getTime() <= dayStart(rEnd).getTime(); x = addDays(x, 1)) days.push(dateKey(x).slice(5));
    rows.push(`    asked ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}  window ${dateKey(input.from).slice(5)}→${dateKey(input.until).slice(5)}(excl)  R*=${dateKey(rEnd).slice(5)} ${hhmm(rEnd)}  days offered: ${days.join(' ')}`);
  }
  for (const r of rows) console.log(r);
  console.log('    ⇒ a Mon-planned Mon–Sun week NEVER offers Sunday.');

  // What it costs: a week whose only real space is the weekend.
  console.log('\n    cost: Mon–Fri booked 08:00–22:00, Sat AND Sun completely free, 360m owed, 180m cap');
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let d = 0; d < 5; d += 1) s.addFixed({ title: `Work ${d}`, tags: ['work'], startTime: at(d, 8), endTime: at(d, 22) });
  const clock = at(0, 6);
  const c = commit({ amountMinPerWeek: 360 });
  const res = generateAll(s, [c.engineInputForWeek(MON, clock)], { now: clock });
  console.log(`    laid ${res[0].sittings.map(show).join('  ') || '(nothing)'}  short ${res[0].shortfall}m  (Sunday ${D(6)} sat empty)`);
}

// ===========================================================================
// 5 — DST, single-day terms, extreme amounts
// ===========================================================================
{
  console.log(`\n5.  boundaries  (host timezone offset Jan/Jul = ${new Date(2026, 0, 1).getTimezoneOffset()}/${new Date(2026, 6, 1).getTimezoneOffset()})`);
  const cases = [
    ['DST spring-forward week (8 Mar 2026 is a Sunday)', weekStart(new Date(2026, 2, 2)), 0],
    ['DST fall-back week (1 Nov 2026 is a Sunday)', weekStart(new Date(2026, 9, 26)), 0],
    ['EU DST week (29 Mar 2026 is a Sunday)', weekStart(new Date(2026, 2, 23)), 0],
  ];
  for (const [label, ws, dayOff] of cases) {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const clock = new Date(ws.getTime()); clock.setHours(6, 0, 0, 0);
    const c = new Commitment({
      title: 'DST', tags: ['study'], amountMinPerWeek: 600,
      from: dateKey(ws), until: dateKey(addDays(ws, 6 + dayOff)),
      minSitting: 60, maxSitting: 180, maxPerDay: 1,
    });
    const input = c.engineInputForWeek(ws, clock);
    const res = generateAll(s, [input], { now: clock });
    const placed = res[0].sittings.reduce((n, t) => n + t.getDuration(), 0);
    const cons = placed + res[0].shortfall === input.amountMin ? 'ok' : 'BROKEN';
    console.log(`    ${label}`);
    console.log(`      ${res[0].sittings.map(show).join('  ')}`);
    console.log(`      placed ${placed} + short ${res[0].shortfall} = ${placed + res[0].shortfall} vs ${input.amountMin} → conservation ${cons}`);
  }

  // Single-day term on a Sunday — the ONE way Sunday is reachable.
  {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const clock = at(6, 6);
    const c = commit({ from: D(6), until: D(6), amountMinPerWeek: 120 });
    const input = c.engineInputForWeek(MON, clock);
    const res = generateAll(s, [input], { now: clock });
    console.log(`\n    single-day Sunday term: ${res[0].sittings.map(show).join('  ') || '(nothing)'} short ${res[0].shortfall}m`);
  }

  // Extremes.
  for (const amount of [1, 15, 100000]) {
    resetIds();
    const s = termWeek();
    const clock = at(0, 6);
    const c = commit({ amountMinPerWeek: amount, minSitting: 30 });
    const input = c.engineInputForWeek(MON, clock);
    const t0 = Date.now();
    const res = generateAll(s, [input], { now: clock });
    const placed = res[0].sittings.reduce((n, t) => n + t.getDuration(), 0);
    console.log(`    amount ${String(amount).padStart(6)}m → minSitting ${input.minSitting} · ${res[0].sittings.length} sitting(s), placed ${placed}, short ${res[0].shortfall}, sum ${placed + res[0].shortfall} ${placed + res[0].shortfall === input.amountMin ? '(conserved)' : '✗ NOT CONSERVED'} · ${Date.now() - t0}ms`);
  }
}

// ===========================================================================
// 6 — previewWeek states
// ===========================================================================
{
  console.log('\n6.  previewWeek states');
  const s = termWeek();
  s.addCommitment(commit({ title: 'running' }));
  s.addCommitment(commit({ title: 'not-yet', from: D(7), until: D(40) }));
  s.addCommitment(commit({ title: 'finished', from: D(-14), until: D(-1) }));
  s.addCommitment(commit({ title: 'due-thu-passed', dueDay: 'thu' }));
  for (const p of previewWeek(s, MON, at(4, 12))) {
    console.log(`    ${p.state.padEnd(8)} ${p.commitment.title.padEnd(16)} owed ${p.owedMin}m placed ${p.placedMin}m`);
  }
}
