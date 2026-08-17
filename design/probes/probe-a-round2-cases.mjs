// probe-a-round2-cases.mjs — PROBE-A round 2, CASE-GEN's generation/arithmetic cases.
//
// Every setup built faithfully from the brief; every `now` injected; nothing
// asserted that is not printed. Run against the working tree as it stands.
//
//   node design/probes/probe-a-round2-cases.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { makeConfig, defaultConfig } from '../../src/core/config.js';
import { generateAll, runwayEnd, gapsOnDay } from '../../src/core/generate.js';
import { layOutWeek, previewWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, addDays, dateKey, dayStart } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { Task } from '../../src/core/Task.js';

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)}-${hhmm(t.endTime)} ${t.getDuration()}m`;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dow = (d) => DOW[(d.getDay() + 6) % 7];
const atDate = (d, h, m = 0) => { const x = new Date(d.getTime()); x.setHours(h, m, 0, 0); return x; };

let failures = 0;
function verdict(ok, msg) { if (ok) console.log(`    ✓ ${msg}`); else { failures += 1; console.log(`    ✗ ${msg}`); } }

/** Run one week and print the FULL picture: days used, times, conservation. */
function runWeek(label, sched, ws, clock, extra) {
  console.log(`\n${'─'.repeat(78)}\n${label}`);
  console.log(`    clock ${dow(clock)} ${dateKey(clock)} ${hhmm(clock)}   week ${dateKey(weekStart(ws))}`);
  for (const p of previewWeek(sched, ws, clock)) {
    console.log(`    preview  ${p.state.padEnd(8)} ${p.commitment.title.padEnd(10)} owed ${p.owedMin}m  min/max ${p.commitment.minSitting}/${p.commitment.maxSitting}  maxPerDay ${p.commitment.maxPerDay}`);
  }
  const res = layOutWeek(sched, ws, clock);
  if (!res.length) console.log('    laid     (nothing — nothing owed)');
  for (const r of res) {
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    const days = [...new Set(r.sittings.map((t) => `${dow(t.startTime)} ${dateKey(t.startTime).slice(5)}`))];
    console.log(`    laid     ${r.commitment.title.padEnd(10)} ${placed}/${r.commitment.amountMin}m short ${r.shortfall}m  ρ=${Number.isFinite(r.rho) ? r.rho.toFixed(4) : String(r.rho)}`);
    console.log(`    DAYS USED  [${days.join(' · ') || 'none'}]   (${r.sittings.length} sitting(s))`);
    for (const t of r.sittings) console.log(`        ${show(t)}${t.schedulingWarning ? '  ⚠ PARKED' : ''}`);
    verdict(placed + r.shortfall === r.commitment.amountMin,
      `conservation ${placed} + ${r.shortfall} = ${placed + r.shortfall} vs ${r.commitment.amountMin}`);
    for (const t of r.sittings) {
      const d = t.getDuration();
      if (d < r.commitment.minSitting || d > r.commitment.maxSitting) verdict(false, `sitting ${d}m outside [${r.commitment.minSitting}, ${r.commitment.maxSitting}]`);
      if (d <= 0) verdict(false, `sitting of ${d}m — zero or negative`);
    }
    const per = {};
    for (const t of r.sittings) { const k = dateKey(t.startTime); per[k] = (per[k] || 0) + 1; if (per[k] > r.commitment.maxPerDay) verdict(false, `maxPerDay ${r.commitment.maxPerDay} exceeded on ${k}`); }
  }
  if (extra) extra(res, sched);
  return res;
}

/** Which days in [from, until) actually offer a run ≥ sMin, and which does R* reach? */
function horizonReport(sched, input, clock) {
  const probe = new Task({
    title: input.title, tags: [...input.tags], type: 'flexible',
    startTime: input.from, endTime: new Date(input.from.getTime() + 3600000), deadline: input.until,
  });
  const from = new Date(Math.max(dayStart(input.from).getTime(), dayStart(clock).getTime()));
  const rEnd = runwayEnd(from, input.until);
  const rows = [];
  for (let d = dayStart(from); d.getTime() < input.until.getTime(); d = addDays(d, 1)) {
    const g = gapsOnDay(sched, probe, d, sched.tasks.filter((t) => !t.parentId).map((t) => ({ start: t.startTime, end: t.endTime, task: t })), clock);
    const longest = g.reduce((n, x) => Math.max(n, x.minutes), 0);
    rows.push({ d, longest, inR: d.getTime() <= dayStart(rEnd).getTime() });
  }
  console.log(`    R* ends ${dateKey(rEnd)} ${hhmm(rEnd)}`);
  for (const r of rows) {
    console.log(`      ${dow(r.d)} ${dateKey(r.d).slice(5)}  longest run ${String(r.longest).padStart(4)}m  ${r.inR ? 'inside R*' : '⟵ OUTSIDE R* (never offered)'}`);
  }
  return rows;
}

console.log('PROBE-A ROUND 2 — CASE-GEN generation/arithmetic cases');
console.log('(run against the working tree, i.e. WITH the round-1 step-5 fix applied)');

// ===========================================================================
// 1 — R* EATS THE WEEKEND  (priority)
// ===========================================================================
{
  const WS = weekStart(new Date(2026, 9, 5)); // Mon 5 Oct 2026
  resetIds();
  const cfg = makeConfig({
    windows: {
      monFri: { start: '08:00', end: '18:00' },
      sat: { start: '08:00', end: '22:00' },
      sun: { start: '08:00', end: '22:00' },
    },
  });
  const s = new Schedule({ config: cfg });
  // Weekdays ~40% full: two 90-minute classes each (180m of a 600m window).
  for (let d = 0; d < 5; d += 1) {
    const day = addDays(WS, d);
    s.addFixed({ title: `Class A${d}`, tags: ['classes'], startTime: atDate(day, 9), endTime: atDate(day, 10, 30) });
    s.addFixed({ title: `Class B${d}`, tags: ['classes'], startTime: atDate(day, 14), endTime: atDate(day, 15, 30) });
  }
  // Sat/Sun deliberately EMPTY.
  const c = new Commitment({
    title: 'Thesis', tags: ['study'], amountMinPerWeek: 360,
    from: '2026-08-31', until: '2026-12-18',
    minSitting: 90, maxSitting: 240, maxPerDay: 1,
  });
  s.addCommitment(c);
  const clock = atDate(WS, 8, 0);
  const input = c.engineInputForWeek(WS, clock);
  console.log(`\n${'═'.repeat(78)}\nCASE 1 — R* eats the weekend  (6h/wk, 90m–4h sittings, maxPerDay 1)`);
  horizonReport(s, input, clock);
  const res = runWeek('CASE 1 — lay out Mon 5 Oct 08:00', s, WS, clock);
  const used = new Set(res[0].sittings.map((t) => dow(t.startTime)));
  console.log(`    weekend used? Sat=${used.has('Sat')} Sun=${used.has('Sun')}`);
  verdict(res[0].shortfall === 0, `no shortfall in a week holding two empty 14-hour days (short ${res[0].shortfall}m)`);
  verdict(used.has('Sun'), 'Sunday — the largest free run in the week — is reachable');

  // 1b — the SAME fixture with a bigger amount, so the missing Sunday actually
  // costs minutes rather than merely going unused.
  resetIds();
  const s2 = new Schedule({ config: cfg });
  for (let d = 0; d < 5; d += 1) {
    const day = addDays(WS, d);
    s2.addFixed({ title: `Class A${d}`, tags: ['classes'], startTime: atDate(day, 9), endTime: atDate(day, 10, 30) });
    s2.addFixed({ title: `Class B${d}`, tags: ['classes'], startTime: atDate(day, 14), endTime: atDate(day, 15, 30) });
  }
  const c2 = new Commitment({
    title: 'Thesis', tags: ['study'], amountMinPerWeek: 600,
    from: '2026-08-31', until: '2026-12-18', minSitting: 90, maxSitting: 240, maxPerDay: 1,
  });
  s2.addCommitment(c2);
  const r2 = runWeek('CASE 1b — the same week, 10h owed instead of 6h', s2, WS, clock);
  const used2 = new Set(r2[0].sittings.map((t) => dow(t.startTime)));
  console.log(`    weekend used? Sat=${used2.has('Sat')} Sun=${used2.has('Sun')}`);
  verdict(r2[0].shortfall === 0, `shortfall ${r2[0].shortfall}m, while Sun 10-11 sat empty with a 840m free run`);
}

// ===========================================================================
// A shared fixture for the arithmetic cases: one empty week, default windows.
// ===========================================================================
const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => atDate(addDays(MON, o), h, m);

function emptyWeek(cfgOverride) {
  resetIds();
  return new Schedule({ config: cfgOverride ? makeConfig(cfgOverride) : defaultConfig });
}
function withCommit(s, over) {
  const c = new Commitment({
    title: 'C', tags: ['study'], from: D(0), until: D(76), ...over,
  });
  s.addCommitment(c);
  return c;
}

// ---- 2 — min == max, amount not a multiple ---------------------------------
{
  const s = emptyWeek();
  const c = withCommit(s, { amountMinPerWeek: 240, minSitting: 90, maxSitting: 90, maxPerDay: 2 });
  console.log(`\n${'═'.repeat(78)}\nCASE 2 — min == max == 90m, amount 240 (= 90+90+60, and 60 < 90)`);
  console.log(`    stored after Commitment clamps: min ${c.minSitting} max ${c.maxSitting} amount ${c.amountMinPerWeek}`);
  const res = runWeek('CASE 2', s, MON, at(0, 6));
  const durs = res[0].sittings.map((t) => t.getDuration());
  verdict(durs.every((d) => d === 90), `every sitting is exactly 90m — got ${JSON.stringify(durs)}`);
  verdict(res[0].shortfall === 60, `the un-tileable 60m is reported as shortfall (got ${res[0].shortfall}m)`);
}

// ---- 13 — min > max --------------------------------------------------------
{
  const s = emptyWeek();
  const c = withCommit(s, { amountMinPerWeek: 240, minSitting: 240, maxSitting: 60, maxPerDay: 1 });
  console.log(`\n${'═'.repeat(78)}\nCASE 13 — min 4h > max 1h`);
  console.log(`    asked min 240 max 60 → stored min ${c.minSitting} max ${c.maxSitting}  (Commitment.js:105 raises max to min)`);
  runWeek('CASE 13', s, MON, at(0, 6));
}

// ---- 14 — zero hours a week ------------------------------------------------
{
  const s = emptyWeek();
  const c = withCommit(s, { amountMinPerWeek: 0, minSitting: 30, maxSitting: 120, maxPerDay: 1 });
  console.log(`\n${'═'.repeat(78)}\nCASE 14 — zero hours a week`);
  console.log(`    asked amountMinPerWeek 0 → stored ${c.amountMinPerWeek}m  (posInt's fallback, Commitment.js:64)`);
  const res = runWeek('CASE 14', s, MON, at(0, 6));
  verdict(c.amountMinPerWeek === 0, 'a commitment worth 0 minutes stays 0 and places nothing');
  console.log(`    (it placed ${res[0] ? res[0].sittings.reduce((n, t) => n + t.getDuration(), 0) : 0}m of work the user asked for none of)`);
}

// ---- 15 — 20h/week, maxPerDay 1, 1h–2h sittings ---------------------------
{
  const s = emptyWeek({ windows: { monFri: { start: '06:00', end: '23:00' }, sat: { start: '06:00', end: '23:00' }, sun: { start: '06:00', end: '23:00' } } });
  withCommit(s, { amountMinPerWeek: 1200, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
  console.log(`\n${'═'.repeat(78)}\nCASE 15 — 20h/wk, maxPerDay 1, 1h–2h sittings, windows 06:00–23:00`);
  console.log('    ceiling is 7 days × 2h = 14h; does step 3\'s "drop a sitting and re-derive" terminate?');
  const t0 = Date.now();
  const res = runWeek('CASE 15', s, MON, at(0, 6));
  console.log(`    completed in ${Date.now() - t0}ms`);
  verdict(res[0].sittings.length <= 7, `at most one sitting per day (${res[0].sittings.length})`);
}

// ---- 16 — 100h/week --------------------------------------------------------
{
  const s = emptyWeek({ windows: { monFri: { start: '06:00', end: '23:00' }, sat: { start: '06:00', end: '23:00' }, sun: { start: '06:00', end: '23:00' } } });
  withCommit(s, { amountMinPerWeek: 6000, minSitting: 60, maxSitting: 480, maxPerDay: 3 });
  console.log(`\n${'═'.repeat(78)}\nCASE 16 — 100h/wk, 1h–8h sittings, maxPerDay 3, windows 06:00–23:00`);
  const t0 = Date.now();
  const res = runWeek('CASE 16', s, MON, at(0, 6));
  console.log(`    completed in ${Date.now() - t0}ms`);
  const per = {};
  for (const t of res[0].sittings) per[dateKey(t.startTime)] = (per[dateKey(t.startTime)] || 0) + 1;
  console.log(`    per-day counts ${JSON.stringify(per)}  (maxPerDay 3 — an EMPTY day is one free RUN, so it can only ever host one sitting)`);
}

// ---- 21 — due weekday == TODAY --------------------------------------------
{
  const WS = weekStart(new Date(2026, 9, 5)); // Mon 5 Oct
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const thu = addDays(WS, 3); // Thu 8 Oct
  s.addFixed({ title: 'Class', tags: ['classes'], startTime: atDate(thu, 9), endTime: atDate(thu, 10, 30) });
  s.addFixed({ title: 'Lab', tags: ['classes'], startTime: atDate(thu, 14), endTime: atDate(thu, 15, 30) });
  const c = new Commitment({
    title: 'DueToday', tags: ['study'], amountMinPerWeek: 240,
    from: '2026-08-31', until: '2026-12-18', dueDay: 'thu', minSitting: 30, maxSitting: 180, maxPerDay: 1,
  });
  s.addCommitment(c);
  const clock = atDate(thu, 15, 0);
  console.log(`\n${'═'.repeat(78)}\nCASE 21 — due Thursday, asked ON Thursday 15:00 (A4 tested before, A5 after)`);
  const input = c.engineInputForWeek(WS, clock);
  console.log(`    engineInputForWeek → ${input ? `${dateKey(input.from)} → ${dateKey(input.until)} (excl)` : 'null (owes nothing)'}`);
  const res = runWeek('CASE 21', s, WS, clock);
  if (res.length) {
    verdict(res[0].sittings.every((t) => t.startTime.getTime() >= clock.getTime()), 'nothing before 15:00');
    verdict(res[0].sittings.every((t) => dateKey(t.startTime) === dateKey(thu)), 'nothing after the due day');
  }
}

// ---- 29 — amount exactly 15 minutes ---------------------------------------
{
  const s = emptyWeek();
  const c = withCommit(s, { amountMinPerWeek: 15, minSitting: 30, maxSitting: 60, maxPerDay: 1 });
  console.log(`\n${'═'.repeat(78)}\nCASE 29 — amount 15m, sittings 30m–60m`);
  console.log(`    stored: amount ${c.amountMinPerWeek} min ${c.minSitting} max ${c.maxSitting}  (Commitment.js:103 clamps min DOWN to the amount)`);
  const res = runWeek('CASE 29', s, MON, at(0, 6));
  verdict(res[0].sittings.every((t) => t.getDuration() === 15), 'books 15m, not 30m');
}

// ---- 30 — 2.5h/week, 40m–70m sittings -------------------------------------
{
  const s = emptyWeek();
  withCommit(s, { amountMinPerWeek: 150, minSitting: 40, maxSitting: 70, maxPerDay: 1 });
  console.log(`\n${'═'.repeat(78)}\nCASE 30 — 150m owed, sittings 40m–70m (150 = 70+70+10, 10 < 40)`);
  const res = runWeek('CASE 30', s, MON, at(0, 6));
  const durs = res[0].sittings.map((t) => t.getDuration());
  verdict(durs.every((d) => d >= 40 && d <= 70), `every sitting inside [40,70] — got ${JSON.stringify(durs)}`);
}

// ---- 34 — Sunday 23:50, window already closed -----------------------------
{
  const WS = weekStart(new Date(2026, 10, 15)); // Mon 9 Nov 2026
  resetIds();
  const s = new Schedule({
    config: makeConfig({ windows: { sun: { start: '08:00', end: '22:00' } } }),
  });
  const c = new Commitment({
    title: 'Late', tags: ['study'], amountMinPerWeek: 300,
    from: '2026-08-31', until: '2026-12-18', minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  s.addCommitment(c);
  const sun = addDays(WS, 6); // Sun 15 Nov
  const clock = atDate(sun, 23, 50);
  console.log(`\n${'═'.repeat(78)}\nCASE 34 — ${dow(sun)} ${dateKey(sun)} 23:50, Sunday window 08:00–22:00 already closed`);
  const input = c.engineInputForWeek(WS, clock);
  if (input) {
    const from = new Date(Math.max(dayStart(input.from).getTime(), dayStart(clock).getTime()));
    const rEnd = runwayEnd(from, input.until);
    console.log(`    runway ${hhmm(from)} ${dateKey(from)} → ${dateKey(input.until)} 00:00 = ${(input.until - from) / 60000}m; R* = ${dateKey(rEnd)} ${hhmm(rEnd)}`);
  }
  const res = runWeek('CASE 34', s, WS, clock);
  for (const r of res) for (const t of r.sittings) verdict(t.getDuration() > 0, `sitting duration ${t.getDuration()}m > 0`);
  if (res.length) verdict(res[0].sittings.length === 0, 'nothing placed into a window that has already closed');
}

// ---- 35 — maxPerDay 7, tiny sittings --------------------------------------
{
  const s = emptyWeek();
  withCommit(s, { amountMinPerWeek: 60, minSitting: 10, maxSitting: 15, maxPerDay: 7 });
  console.log(`\n${'═'.repeat(78)}\nCASE 35 — maxPerDay 7, 1h/wk, sittings 10m–15m: does step 5 still spread?`);
  const res = runWeek('CASE 35', s, MON, at(0, 6));
  const days = [...new Set(res[0].sittings.map((t) => dateKey(t.startTime)))];
  verdict(days.length === res[0].sittings.length, `${res[0].sittings.length} sittings across ${days.length} distinct day(s) — not stacked`);
}

// ---- 36 — a term of exactly 8 days ----------------------------------------
{
  const W1 = weekStart(new Date(2026, 7, 31)); // Mon 31 Aug 2026
  const W2 = addDays(W1, 7); // Mon 7 Sep
  console.log(`\n${'═'.repeat(78)}\nCASE 36 — term exactly 8 days (Mon 31 Aug → Mon 7 Sep), 6h/wk, 7 Sep BLOCKED`);
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.blockDay(W2);
  const c = new Commitment({
    title: 'EightDay', tags: ['study'], amountMinPerWeek: 360,
    from: '2026-08-31', until: '2026-09-07', minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  s.addCommitment(c);
  runWeek('CASE 36 · week 1 (31 Aug)', s, W1, atDate(W1, 6));
  runWeek('CASE 36 · week 2 (7 Sep — one day, and it is blocked)', s, W2, atDate(W2, 6));
}

// ---- 37 — a term of exactly one year, ρ scale -----------------------------
{
  const WS = weekStart(new Date(2027, 4, 3)); // Mon 3 May 2027
  console.log(`\n${'═'.repeat(78)}\nCASE 37 — term of exactly one year; lay out the week of ${dateKey(WS)}`);
  resetIds();
  const sYear = new Schedule({ config: defaultConfig });
  // ⚠️ MY FIXTURE, corrected: `until: '2027-05-03'` put the term's LAST DAY on
  // the Monday under test, so the week legitimately got a one-day window and a
  // 60m shortfall. That is case B1, not a ρ-scale bug. The term must STRADDLE
  // the week for this case to test what it claims to.
  const cYear = new Commitment({
    title: 'YearLong', tags: ['study'], amountMinPerWeek: 240,
    from: '2026-09-01', until: '2027-08-31', minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  sYear.addCommitment(cYear);
  const clock = atDate(WS, 6);
  const rYear = runWeek('CASE 37 · one-year term', sYear, WS, clock);

  resetIds();
  const sWeek = new Schedule({ config: defaultConfig });
  const cWeek = new Commitment({
    title: 'YearLong', tags: ['study'], amountMinPerWeek: 240,
    from: dateKey(WS), until: dateKey(addDays(WS, 6)), minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  sWeek.addCommitment(cWeek);
  const rWeek = runWeek('CASE 37 · the same numbers with a ONE-WEEK term (control)', sWeek, WS, clock);
  verdict(Math.abs(rYear[0].rho - rWeek[0].rho) < 1e-9,
    `ρ is the WEEK's, not the term's: year ${rYear[0].rho.toFixed(6)} vs week ${rWeek[0].rho.toFixed(6)}`);
}

// ---- 38 — spends vs restores with learnedCapacity() null -------------------
{
  console.log(`\n${'═'.repeat(78)}\nCASE 38 — a spending and a restoring commitment, learnedCapacity() still null`);
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  // Buckets carry the load; `energy from tags` is the locked decision.
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2, physical: 0, social: 0, creative: 0.5 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -1.5, physical: -0.5, social: 0, creative: 0 } });
  for (const d of [1, 2, 3]) s.addFixed({ title: `Seminar ${d}`, tags: ['study'], startTime: at(d, 9), endTime: at(d, 17) });
  s.addCommitment(new Commitment({ title: 'Spends', tags: ['study'], amountMinPerWeek: 240, from: D(0), until: D(76), minSitting: 60, maxSitting: 120, maxPerDay: 1 }));
  s.addCommitment(new Commitment({ title: 'Restores', tags: ['rest'], amountMinPerWeek: 180, from: D(0), until: D(76), minSitting: 60, maxSitting: 90, maxPerDay: 1 }));
  const res = runWeek('CASE 38', s, MON, at(0, 6));
  let anyNaN = false;
  for (const r of res) {
    if (Number.isNaN(r.rho)) { anyNaN = true; console.log(`    ✗ ρ is NaN for ${r.commitment.title}`); }
    for (const t of r.sittings) if (Number.isNaN(t.startTime.getTime()) || Number.isNaN(t.getDuration())) { anyNaN = true; console.log(`    ✗ NaN in a placed sitting for ${r.commitment.title}`); }
  }
  verdict(!anyNaN, 'no NaN reached ρ or any placement with learnedCapacity() null');
}

console.log(`\n${'═'.repeat(78)}\n${failures} failed check(s)\n${'═'.repeat(78)}`);
