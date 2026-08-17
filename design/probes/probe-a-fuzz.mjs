// probe-a-fuzz.mjs — PROBE-A / generation path, brute force.
//
// 700 green tests missed real bugs, so this does not reason: it runs 2000
// seeded, reproducible weeks through the REAL button path (`layOutWeek`) and
// checks the §4.3 invariants mechanically on every one. No wall clock anywhere —
// `now` is injected from the seed.
//
// Deliberately EXCLUDES recurring tasks and zones, so anything it finds is a
// second, independent defect rather than a re-run of probe-a-recurrence-blind /
// probe-a-zone-choose-energy.
//
//   node design/probes/probe-a-fuzz.mjs [count]

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { layOutWeek, planWeek, previewWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, addDays, dateKey, dayStart } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { gapsOnDay, runwayEnd } from '../../src/core/generate.js';
import { dayWindowBounds, computeWindows, dayCapacityMin, occupiedMinutesOnDay } from '../../src/core/placement.js';
import { breakMinForFill } from '../../src/core/gaps.js';
import { Task } from '../../src/core/Task.js';

const N = Number(process.argv[2] || 2000);
const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dow = (d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7];
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)}-${hhmm(t.endTime)} ${t.getDuration()}m`;

/** Deterministic LCG — the whole run reproduces from the seed alone. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

function build(seed) {
  const r = rng(seed);
  resetIds();
  const s = new Schedule({ config: defaultConfig });

  // Existing commitments in the day: 0–14 fixed tasks, 30m–5h, anywhere 06:00–22:00.
  const nTasks = int(r, 0, 14);
  for (let i = 0; i < nTasks; i += 1) {
    const d = int(r, 0, 6);
    const h = int(r, 6, 21);
    const mins = pick(r, [30, 45, 60, 90, 120, 180, 300]);
    s.addFixed({
      title: `T${i}`, tags: [pick(r, ['work', 'classes', 'chores', 'social'])],
      startTime: at(d, h), endTime: at(d, h, mins),
    });
  }

  // 0–3 blocked days.
  const nBlocked = int(r, 0, 3);
  for (let i = 0; i < nBlocked; i += 1) s.blockDay(addDays(MON, int(r, 0, 6)));

  // 1–4 commitments with wildly varied bounds.
  const nCommit = int(r, 1, 4);
  for (let i = 0; i < nCommit; i += 1) {
    const minS = pick(r, [15, 30, 45, 60, 90, 120]);
    const maxS = pick(r, [30, 60, 90, 120, 180, 240, 480]);
    const termStart = int(r, -21, 6);
    const termLen = pick(r, [0, 1, 3, 6, 13, 30, 90]);
    s.addCommitment(new Commitment({
      title: `C${i}`, tags: [pick(r, ['study', 'work', 'admin'])],
      amountMinPerWeek: pick(r, [15, 30, 60, 120, 240, 360, 600, 900, 1500]),
      from: D(termStart), until: D(termStart + termLen),
      minSitting: minS, maxSitting: maxS,
      maxPerDay: pick(r, [1, 1, 1, 2, 3]),
      dueDay: pick(r, [null, null, null, 'mon', 'wed', 'thu', 'fri', 'sat', 'sun']),
      priority: int(r, 1, 5),
    }));
  }

  const clock = at(int(r, 0, 6), int(r, 5, 22), pick(r, [0, 15, 30, 45]));
  return { s, clock };
}

// `node probe-a-fuzz.mjs dissect:591` — reopen one seed and show why it parked.
if (String(process.argv[2] || '').startsWith('dissect:')) {
  const seed = Number(String(process.argv[2]).split(':')[1]);
  const { s, clock } = build(seed);
  console.log(`DISSECT seed ${seed} · clock ${dateKey(clock).slice(5)} ${hhmm(clock)}`);
  console.log(`  blocked: ${s.blockedDays.join(' ') || '(none)'}`);
  for (const t of s.tasks) console.log(`  existing  ${show(t)}  "${t.title}"`);
  for (const c of s.commitments) console.log(`  commit    ${c.title} ${c.amountMinPerWeek}m  ${c.minSitting}-${c.maxSitting}m  maxPerDay ${c.maxPerDay}  due ${c.dueDay || 'sun'}  term ${c.from}→${c.until}`);
  const before = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const res = layOutWeek(s, MON, clock);
  for (const r of res) {
    console.log(`  RESULT ${r.commitment.title} rho ${r.rho.toFixed(4)} short ${r.shortfall}m`);
    for (const t of r.sittings) {
      console.log(`    ${show(t)}${t.schedulingWarning ? '   ⚠ PARKED' : ''}`);
      const probe = new Task({ title: r.commitment.title, tags: [...r.commitment.tags], type: 'flexible', startTime: t.startTime, endTime: t.endTime, deadline: r.commitment.until });
      const runs = gapsOnDay(s, probe, t.startTime, before, clock);
      console.log(`      gapsOnDay says that day offers: ${runs.map((g) => `${hhmm(g.start)}-${hhmm(g.end)} ${g.minutes}m`).join('  ') || '(nothing)'}`);
      const wins = computeWindows(s, probe, t.startTime);
      console.log(`      computeWindows: ${wins.map((w) => `${hhmm(w.start)}-${hhmm(w.end)}`).join(' ')}`);
      const cap = dayCapacityMin(s.config, t.startTime) || 1;
      const dayOccA = before.filter((iv) => iv.end > wins[0].start && iv.start < wins[wins.length - 1].end);
      const occA = dayOccA.reduce((n, iv) => n + Math.round((iv.end - iv.start) / 60000), 0);
      const occB = occupiedMinutesOnDay(before, s.config, t.startTime);
      console.log(`      break input — gapsOnDay occMin ${occA} (fill ${(occA / cap).toFixed(3)} → break ${breakMinForFill(Math.min(1, occA / cap), s.config)}m)`);
      console.log(`                    findBestSlot occMin ${occB} (fill ${(occB / cap).toFixed(3)} → break ${breakMinForFill(occB / cap, s.config)}m)`);
    }
  }
  process.exit(0);
}

const CLASSES = [
  // CASE-GEN's two cross-cutting invariants.
  '(a1) placed NOTHING although a day INSIDE R* had a run >= minSitting',
  '(a2) placed nothing more although a day OUTSIDE R* had a run >= minSitting',
  '(a2b) SHORTFALL > 0 while a day OUTSIDE R* had a run >= minSitting',
  '(c1) SHORTFALL >= minSitting while an UNTOUCHED day INSIDE R* had a run >= minSitting',
  '(c2) SHORTFALL >= minSitting while an ALREADY-USED day still had a spare run (one-sitting-per-RUN limit)',
  '(b) two untouched runs of the same week differ',
  'sitting ENDS on/after the exclusive end (deadline)',
  'sitting ENDS outside the day window / after midnight',
  'parked onto a day that never had room (step-5 re-home)',
  'parked for some other reason',
  'second press ADDED tasks',
  'second press RE-STATED a shortfall (no tasks added)',
  'conservation placed+shortfall≠amount',
  'sitting under minSitting',
  'sitting over maxSitting',
  'placed in the PAST',
  'placed on a BLOCKED day',
  'placed before the window start',
  'placed on/after the exclusive end',
  'maxPerDay exceeded',
  'OVERLAP with an existing task',
  'OVERLAP with another generated sitting',
  'schedulingWarning (parked — no legal slot)',
  'preview ≠ apply',
  'NOT idempotent (second press changed the week)',
  'zero-length or negative sitting',
  'rho not finite-or-Infinity',
];
const hits = new Map(CLASSES.map((c) => [c, []]));
const note = (cls, seed, detail) => { const a = hits.get(cls); if (a.length < 3) a.push(`seed ${seed}: ${detail}`); else a.push(null); };

let ran = 0;
for (let seed = 1; seed <= N; seed += 1) {
  const { s, clock } = build(seed);
  const before = s.tasks.map((t) => ({ t, start: t.startTime, end: t.endTime }));
  const sig = (res) => res.map((r) => `${r.commitment.title}|${r.shortfall}|${r.sittings.map(show).join(',')}`).join(';;');

  let planned;
  try { planned = planWeek(s, MON, clock); } catch (e) { note('preview ≠ apply', seed, `planWeek threw ${e.message}`); continue; }
  const results = layOutWeek(s, MON, clock);
  ran += 1;
  if (sig(planned) !== sig(results)) note('preview ≠ apply', seed, `\n        plan  ${sig(planned)}\n        apply ${sig(results)}`);

  const madeAll = results.flatMap((r) => r.sittings);
  for (const r of results) {
    const c = r.commitment;
    if (!(Number.isFinite(r.rho) || r.rho === Infinity)) note('rho not finite-or-Infinity', seed, `${c.title} rho=${r.rho}`);
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    if (placed + r.shortfall !== c.amountMin) note('conservation placed+shortfall≠amount', seed, `${c.title} ${placed}+${r.shortfall}≠${c.amountMin}`);
    const perDay = {};
    for (const t of r.sittings) {
      const k = dateKey(t.startTime);
      const dur = t.getDuration();
      if (dur <= 0) note('zero-length or negative sitting', seed, `${c.title} ${show(t)}`);
      if (dur < c.minSitting) note('sitting under minSitting', seed, `${c.title} ${dur}m < ${c.minSitting}m  ${show(t)}`);
      if (dur > c.maxSitting) note('sitting over maxSitting', seed, `${c.title} ${dur}m > ${c.maxSitting}m  ${show(t)}`);
      if (t.startTime.getTime() < clock.getTime()) note('placed in the PAST', seed, `${c.title} ${show(t)} vs clock ${dateKey(clock).slice(5)} ${hhmm(clock)}`);
      if (s.isDayBlocked(t.startTime)) note('placed on a BLOCKED day', seed, `${c.title} ${show(t)}`);
      if (k < dateKey(c.from)) note('placed before the window start', seed, `${c.title} ${k} < ${dateKey(c.from)}`);
      if (k >= dateKey(c.until)) note('placed on/after the exclusive end', seed, `${c.title} ${k} >= ${dateKey(c.until)}`);
      perDay[k] = (perDay[k] || 0) + 1;
      if (perDay[k] > c.maxPerDay) note('maxPerDay exceeded', seed, `${c.title} maxPerDay ${c.maxPerDay}, ${perDay[k]} on ${k}`);
      if (dateKey(t.endTime) >= dateKey(c.until) && t.endTime.getTime() > c.until.getTime()) note('sitting ENDS on/after the exclusive end (deadline)', seed, `${c.title} ${show(t)} ends past ${dateKey(c.until)} 00:00`);
      const wb = dayWindowBounds(s.config, t.startTime);
      if (t.endTime.getTime() > wb.end.getTime()) note('sitting ENDS outside the day window / after midnight', seed, `${c.title} ${show(t)} (window closes ${hhmm(wb.end)})`);
      if (t.schedulingWarning) {
        note('schedulingWarning (parked — no legal slot)', seed, `${c.title} ${show(t)}`);
        // Did the day it was HOMED to ever have a run long enough? If not, step 5
        // re-homed it onto a day that could not hold it.
        const probe = new Task({ title: c.title, tags: [...c.tags], type: 'flexible', startTime: t.startTime, endTime: t.endTime, deadline: c.until });
        const runs = gapsOnDay(s, probe, t.startTime, before.map((o) => ({ start: o.start, end: o.end, task: o.t })), clock);
        const longest = runs.reduce((n, g) => Math.max(n, g.minutes), 0);
        if (longest < dur) note('parked onto a day that never had room (step-5 re-home)', seed, `${c.title} ${show(t)} — longest free run on that day was ${longest}m`);
        else note('parked for some other reason', seed, `${c.title} ${show(t)} — longest free run ${longest}m`);
      }
      for (const o of before) {
        if (t.startTime < o.end && o.start < t.endTime) note('OVERLAP with an existing task', seed, `${c.title} ${show(t)} over "${o.t.title}" ${hhmm(o.start)}-${hhmm(o.end)}`);
      }
      for (const u of madeAll) {
        if (u !== t && t.startTime < u.endTime && u.startTime < t.endTime) note('OVERLAP with another generated sitting', seed, `${show(t)} ⟂ ${show(u)}`);
      }
    }
  }

  // ---- (a) a week with room must not come back empty ----------------------
  // Split, because the two halves mean different things: a1 is an internal
  // contradiction (the generator's own horizon offered a run and it placed
  // nothing); a2 is the R* horizon costing real days.
  //
  // ⚠️ ONLY the first commitment in ρ order. `before` is the pre-layout grid,
  // and every LATER commitment plans against a week its siblings have already
  // eaten — seed 311 looked like a violation (510m free, placed 0) purely
  // because C2 had taken 14:30–22:30 of the one day C1's Friday deadline left
  // it. Checking siblings against `before` measures the fixture, not the code.
  for (const r of results.slice(0, 1)) {
    // (a2) as CASE-GEN states it only fires on "placed NOTHING", and the R*
    // horizon almost never produces that — it produces a PARTIAL week. So the
    // shortfall variant (a2b) below is the one that can see it.
    if (r.sittings.length && r.shortfall <= 0) continue;
    const zero = r.sittings.length === 0;
    const c = r.commitment;
    const probe = new Task({
      title: c.title, tags: [...c.tags], type: 'flexible',
      startTime: c.from, endTime: new Date(c.from.getTime() + c.minSitting * 60000), deadline: c.until,
    });
    const start = new Date(Math.max(dayStart(c.from).getTime(), dayStart(clock).getTime()));
    const rEnd = runwayEnd(start, c.until);
    const occ = before.map((o) => ({ start: o.start, end: o.end, task: o.t }));
    let bestIn = 0; let bestOut = 0; let outDay = null;
    for (let d = dayStart(start); d.getTime() < c.until.getTime(); d = addDays(d, 1)) {
      const longest = gapsOnDay(s, probe, d, occ, clock).reduce((n, g) => Math.max(n, g.minutes), 0);
      if (d.getTime() <= dayStart(rEnd).getTime()) bestIn = Math.max(bestIn, longest);
      else if (longest > bestOut) { bestOut = longest; outDay = d; }
    }
    if (zero && bestIn >= c.minSitting) note('(a1) placed NOTHING although a day INSIDE R* had a run >= minSitting', seed, `${c.title} minSitting ${c.minSitting}, best run inside R* ${bestIn}m, placed 0`);
    else if (zero && bestOut >= c.minSitting) note('(a2) placed nothing more although a day OUTSIDE R* had a run >= minSitting', seed, `${c.title} minSitting ${c.minSitting}, ${dateKey(outDay)} offers ${bestOut}m but is past R* (${dateKey(rEnd)})`);
    if (r.shortfall > 0 && bestOut >= c.minSitting) {
      note('(a2b) SHORTFALL > 0 while a day OUTSIDE R* had a run >= minSitting', seed,
        `${c.title} short ${r.shortfall}m; ${dateKey(outDay)} (${dow(outDay)}) offers a ${bestOut}m run but sits past R* (${dateKey(rEnd)} ${hhmm(rEnd)})`);
    }
  }

  // ---- (c) minutes left on the table INSIDE R* ----------------------------
  // Measured AFTER the layout, against the real current grid, so a day another
  // commitment has taken already counts as full. If a day inside this
  // commitment's own R* still has a run >= minSitting and is under maxPerDay
  // for it, the shortfall it just reported was avoidable.
  for (const r of results) {
    const c = r.commitment;
    if (r.shortfall < c.minSitting) continue;
    const probe = new Task({
      title: c.title, tags: [...c.tags], type: 'flexible',
      startTime: c.from, endTime: new Date(c.from.getTime() + c.minSitting * 60000), deadline: c.until,
    });
    const start = new Date(Math.max(dayStart(c.from).getTime(), dayStart(clock).getTime()));
    const rEnd = runwayEnd(start, c.until);
    const occNow = s.tasks.filter((t) => !t.chunking && !t.recurrence).map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
    const mineOn = {};
    for (const t of r.sittings) mineOn[dateKey(t.startTime)] = (mineOn[dateKey(t.startTime)] || 0) + 1;
    let c1 = null; let c2 = null;
    for (let d = dayStart(start); d.getTime() <= dayStart(rEnd).getTime(); d = addDays(d, 1)) {
      const used = mineOn[dateKey(d)] || 0;
      if (used >= c.maxPerDay) continue;
      const longest = gapsOnDay(s, probe, d, occNow, clock).reduce((n, g) => Math.max(n, g.minutes), 0);
      if (longest < c.minSitting) continue;
      const line = `${c.title} short ${r.shortfall}m (min ${c.minSitting}m); ${dateKey(d)} (${dow(d)}) has a ${longest}m run, ${used}/${c.maxPerDay} of its sittings`;
      if (used === 0 && !c1) c1 = line; else if (used > 0 && !c2) c2 = line;
    }
    // c1 = a day this commitment never touched at all — the day-matching in
    // step 5 only searches `spread` plus the sitting's own gap day, so a
    // candidate day the spread did not pick is never reconsidered.
    // c2 = the same day again: `chooseSittings` emits at most ONE sitting per
    // free RUN, so the leftover of a day it already used was never a candidate.
    if (c1) note('(c1) SHORTFALL >= minSitting while an UNTOUCHED day INSIDE R* had a run >= minSitting', seed, c1);
    if (c2) note('(c2) SHORTFALL >= minSitting while an ALREADY-USED day still had a spare run (one-sitting-per-RUN limit)', seed, c2);
  }

  // ---- (b) two untouched runs of the same week must be identical -----------
  {
    const fresh = build(seed);
    const rB = layOutWeek(fresh.s, MON, fresh.clock);
    if (sig(rB) !== sig(results)) note('(b) two untouched runs of the same week differ', seed, `\n        A ${sig(results)}\n        B ${sig(rB)}`);
  }

  // Idempotency: pressing again must be a no-op.
  const n0 = s.tasks.length;
  const again = layOutWeek(s, MON, clock);
  if (s.tasks.length !== n0) note('second press ADDED tasks', seed, `tasks ${n0}→${s.tasks.length}`);
  else if (again.length !== 0) {
    note('second press RE-STATED a shortfall (no tasks added)', seed,
      `${again.map((r) => `${r.commitment.title} short ${r.shortfall}m again`).join(', ')} — previewWeek still says "owes"`);
  }
  if (s.tasks.length !== n0 || again.length !== 0) note('NOT idempotent (second press changed the week)', seed, `tasks ${n0}→${s.tasks.length}, second press returned ${again.length}`);
}

console.log(`PROBE-A FUZZ · ${ran} seeded weeks through layOutWeek (no zones, no recurrence)\n`);
let clean = true;
for (const cls of CLASSES) {
  const a = hits.get(cls);
  const n = a.length;
  if (!n) { console.log(`  ✓ ${cls}`); continue; }
  clean = false;
  console.log(`  ✗ ${cls} — ${n} hit(s)`);
  for (const line of a.filter(Boolean)) console.log(`      ${line}`);
}
console.log(clean ? '\nno invariant broken in this sweep' : '\nsee above');
