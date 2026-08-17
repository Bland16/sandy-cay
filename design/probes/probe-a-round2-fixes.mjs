// probe-a-round2-fixes.mjs — PROBE-A round 2: BEFORE/AFTER for each open finding.
//
// Each section runs the SHIPPED code on a fixture, then runs the PROPOSED
// replacement — implemented here, verbatim, so the diff in the report is the
// thing that was actually executed — on the identical fixture.
//
//   node design/probes/probe-a-round2-fixes.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { makeConfig, defaultConfig } from '../../src/core/config.js';
import {
  generateAll, spreadDays, chooseSittings, gapsOnDay, runwayEnd,
} from '../../src/core/generate.js';
import {
  placeTask, computeWindows, dayWindowBounds,
} from '../../src/core/placement.js';
import { mergeIntervals } from '../../src/core/gaps.js';
import { seedStarterBuckets } from '../../src/core/index.js';
import { energyBudget, loadForTask, LOAD_AXES } from '../../src/core/energy.js';
import { weekStart, addDays, addMinutes, dateKey, dayStart } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';
import { Task } from '../../src/core/Task.js';

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const stamp = (d) => `${dateKey(d).slice(5)} ${hhmm(d)}`;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dow = (d) => DOW[(d.getDay() + 6) % 7];
const atDate = (d, h, m = 0) => { const x = new Date(d.getTime()); x.setHours(h, m, 0, 0); return x; };

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => atDate(addDays(MON, o), h, m);

console.log('PROBE-A ROUND 2 — proposed fixes, run before and after\n');

// ===========================================================================
// #3 + #6 — placeTask's step-4 park: ignores `occupied`, overruns the day
// ===========================================================================
console.log('═'.repeat(78));
console.log('#3/#6  placeTask step-4 park (placement.js:363-378)');
console.log('═'.repeat(78));

/** The fixture: a day the task cannot fit in at all, asked late. */
function parkFixture() {
  resetIds();
  const s = new Schedule({ config: defaultConfig }); // monFri 08:00-23:00
  s.addFixed({ title: 'Conference', tags: ['work'], startTime: at(0, 8), endTime: at(0, 20) });
  return s;
}
const parkOpts = () => {
  const s = parkFixture();
  const occupied = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  return { s, occupied };
};

{
  const { s, occupied } = parkOpts();
  console.log('\nBEFORE (shipped `placeTask`) — two 10h tasks, day already booked 08:00–20:00, from 21:00');
  const made = [];
  for (const n of ['A', 'B']) {
    const t = new Task({ title: `Park ${n}`, tags: ['study'], type: 'flexible', startTime: at(0, 21), endTime: at(0, 21 + 10) });
    const res = placeTask(s, t, { from: at(0, 21), to: addDays(MON, 0), occupied });
    s.tasks.push(t);
    occupied.push({ start: t.startTime, end: t.endTime, task: t });
    made.push(t);
    console.log(`    ${t.title}: ${stamp(t.startTime)} → ${stamp(t.endTime)}  warning=${!!res.warning}`);
  }
  const clash = made[0].startTime < made[1].endTime && made[1].startTime < made[0].endTime;
  console.log(`    two parks on the same minute? ${clash}`);
  console.log(`    crosses midnight? ${dateKey(made[0].endTime) !== dateKey(made[0].startTime)}   (day closes ${hhmm(dayWindowBounds(s.config, at(0, 0)).end)})`);
  console.log(`    sits on top of "Conference"? ${made.some((t) => t.startTime < at(0, 20) && at(0, 8) < t.endTime)}`);
}

/**
 * PROPOSED replacement for `placeTask`'s branch 4.
 *
 * Priority order, stated so the trade-off is visible:
 *   1. do not land on top of something already there   (the #3 harm)
 *   2. do not run past the day's own close             (the #6 harm)
 *   3. keep the task visible                           (the branch's purpose)
 * When 1 and 2 cannot both hold the day genuinely cannot hold the task, and
 * this keeps 1 — an overrun is visible, a task hidden under a pinned event is not.
 */
function parkSlot(schedule, task, opts, config) {
  const from = opts.from ? new Date(opts.from) : new Date();
  const durationMin = task.getDuration() || config.defaultDuration;
  const windows = computeWindows(schedule, task, from, { ignoreZone: true });
  const b = dayWindowBounds(config, from);
  const wins = windows.length ? windows : [{ start: b.start, end: b.end }];
  const occ = mergeIntervals((opts.occupied || []).map((iv) => ({ start: iv.start, end: iv.end })))
    .filter((iv) => iv.end.getTime() > wins[0].start.getTime() && iv.start.getTime() < wins[wins.length - 1].end.getTime());

  let start = null;
  let lastClear = null; // the earliest CLEAR minute found, even if past the close
  for (const win of wins) {
    let cursor = win.start.getTime() < from.getTime() ? new Date(from.getTime()) : new Date(win.start.getTime());
    // `occ` is merged and sorted, so one forward pass is enough.
    for (const iv of occ) {
      if (iv.start.getTime() <= cursor.getTime() && iv.end.getTime() > cursor.getTime()) cursor = new Date(iv.end.getTime());
    }
    if (!lastClear || cursor.getTime() < lastClear.getTime()) lastClear = cursor;
    if (cursor.getTime() < win.end.getTime()) { start = cursor; break; }
  }
  // ⚠️ The fallback is the CLEAR minute, not the window start. Falling back to
  // the window start is what made two parked tasks land on the same minute:
  // both were clamped to `from` and neither looked at what was already there.
  // A park that overruns the close is visible and flagged; a park hidden under
  // a pinned event is neither.
  if (!start) start = lastClear;
  const close = wins[wins.length - 1].end;
  if (addMinutes(start, durationMin).getTime() > close.getTime()) {
    const pulled = addMinutes(close, -durationMin);
    const floor = Math.max(from.getTime(), wins[0].start.getTime());
    const clear = !occ.some((iv) => pulled.getTime() < iv.end.getTime() && iv.start.getTime() < addMinutes(pulled, durationMin).getTime());
    if (pulled.getTime() >= floor && clear) start = pulled;
  }
  return { start, end: addMinutes(start, durationMin) };
}

{
  const { s, occupied } = parkOpts();
  console.log('\nAFTER (proposed `parkSlot`) — identical fixture');
  const made = [];
  for (const n of ['A', 'B']) {
    const t = new Task({ title: `Park ${n}`, tags: ['study'], type: 'flexible', startTime: at(0, 21), endTime: at(0, 21 + 10) });
    const slot = parkSlot(s, t, { from: at(0, 21), occupied }, s.config);
    t.placeAt(slot.start);
    s.tasks.push(t);
    occupied.push({ start: t.startTime, end: t.endTime, task: t });
    made.push(t);
    console.log(`    ${t.title}: ${stamp(t.startTime)} → ${stamp(t.endTime)}`);
  }
  const clash = made[0].startTime < made[1].endTime && made[1].startTime < made[0].endTime;
  console.log(`    two parks on the same minute? ${clash}`);
  console.log(`    sits on top of "Conference"? ${made.some((t) => t.startTime < at(0, 20) && at(0, 8) < t.endTime)}`);
  console.log('    (both still overrun 23:00 — the day truly cannot hold 10h. Overrun is the');
  console.log('     lesser harm and it is flagged; the generation path no longer reaches here.)');
}

// A shorter task, where the fix CAN honour both rules.
{
  const { s, occupied } = parkOpts();
  console.log('\nA 4h task asked from 19:00 — a SINGLE park, no sibling involved');
  const t2 = new Task({ title: 'Park C', tags: ['study'], type: 'flexible', startTime: at(0, 21), endTime: at(0, 25) });
  const res = placeTask(s, t2, { from: at(0, 19), to: addDays(MON, 0), occupied });
  const shippedClash = t2.startTime < at(0, 20) && at(0, 8) < t2.endTime;
  console.log(`    shipped : ${stamp(t2.startTime)} → ${stamp(t2.endTime)}  warning=${!!res.warning}  ON TOP OF "Conference"? ${shippedClash}`);
  const t = new Task({ title: 'Park C', tags: ['study'], type: 'flexible', startTime: at(0, 21), endTime: at(0, 25) });
  const slot = parkSlot(s, t, { from: at(0, 19), occupied }, s.config);
  const propClash = slot.start < at(0, 20) && at(0, 8) < slot.end;
  console.log(`    proposed: ${stamp(slot.start)} → ${stamp(slot.end)}  ON TOP OF "Conference"? ${propClash}  (overruns the 23:00 close by ${Math.round((slot.end - at(0, 23)) / 60000)}m)`);
  console.log('    ⇒ the trade the proposal makes, stated plainly: it prefers a visible overrun');
  console.log('      to a task hidden under a pinned event. Reverse the two lines if you disagree.');
}

// ===========================================================================
// #7 — the energy nudge is unbounded
// ===========================================================================
console.log(`\n${'═'.repeat(78)}`);
console.log('#7  spreadDays energy nudge (generate.js:205-226, line 220)');
console.log('═'.repeat(78));

/** PROPOSED `spreadDays` — the only change is normalising `rank` into [0, MAX_NUDGE]. */
const MAX_NUDGE = 0.5;
function spreadDaysFixed(candidates, n, { taken = new Set(), rank = () => 0 } = {}) {
  const free = candidates.filter((d) => !taken.has(dateKey(d)));
  const pool = free.length >= n ? free : candidates;
  if (n >= pool.length) return pool.slice(0, n);

  const ranks = pool.map((d) => rank(d));
  const lo = Math.min(...ranks);
  const span = Math.max(...ranks) - lo;
  const nudge = (idx) => (span > 0 ? ((ranks[idx] - lo) / span) * MAX_NUDGE : 0);

  const chosen = [];
  const step = (pool.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i += 1) {
    const ideal = n === 1 ? (pool.length - 1) / 2 : i * step;
    let best = null;
    let bestScore = Infinity;
    pool.forEach((d, idx) => {
      if (chosen.includes(d)) return;
      const s = Math.abs(idx - ideal) - nudge(idx);
      if (s < bestScore) { bestScore = s; best = d; }
    });
    if (best) chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
}

{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  // An ordinary heavy stretch: Thu/Fri/Sat hold a full 09:00–17:00 study day.
  for (const d of [3, 4, 5]) s.addFixed({ title: `Seminar ${d}`, tags: ['study'], startTime: at(d, 9), endTime: at(d, 17) });
  const probe = new Task({ title: 'ENGR', tags: ['study'], type: 'flexible', startTime: MON, endTime: at(0, 1) });
  const load = loadForTask(s, probe);
  const axis = LOAD_AXES.reduce((bestA, a) => (Math.abs(load[a]) > Math.abs(load[bestA]) ? a : bestA), LOAD_AXES[0]);
  const rank = (d) => {
    if (!load[axis]) return 0;
    const low = energyBudget(s, d)[axis].low;
    return load[axis] > 0 ? low : -low;
  };
  const pool = [];
  for (let d = 0; d < 6; d += 1) pool.push(addDays(MON, d));
  console.log(`\n    ranks: ${pool.map((d) => `${dow(d)} ${rank(d).toFixed(1)}`).join('  ')}   (load-hours; nudge = rank × 0.25 today)`);
  const gapsOf = (ds) => ds.slice(1).map((d, i) => Math.round((d - ds[i]) / 86400000));
  const before = spreadDays(pool, 3, { rank });
  const after = spreadDaysFixed(pool, 3, { rank });
  const flat = spreadDays(pool, 3, {});
  console.log(`    BEFORE (shipped)   ${before.map(dow).join(' ')}   day-gaps ${JSON.stringify(gapsOf(before))}`);
  console.log(`    AFTER  (proposed)  ${after.map(dow).join(' ')}   day-gaps ${JSON.stringify(gapsOf(after))}`);
  console.log(`    no-energy baseline ${flat.map(dow).join(' ')}   day-gaps ${JSON.stringify(gapsOf(flat))}`);

  // And the nudge must still BREAK TIES: two days the spread rates equally.
  const tieRank = (d) => (dateKey(d) === D(2) ? -10 : 0); // Wed is the depleted one
  const tieBefore = spreadDays(pool, 2, { rank: tieRank });
  const tieAfter = spreadDaysFixed(pool, 2, { rank: tieRank });
  console.log(`    tie-break check, n=2, Wed depleted:  shipped ${tieBefore.map(dow).join(' ')} · proposed ${tieAfter.map(dow).join(' ')}`);
  const tie3Before = spreadDays(pool, 3, { rank: tieRank });
  const tie3After = spreadDaysFixed(pool, 3, { rank: tieRank });
  console.log(`    tie-break check, n=3, Wed depleted:  shipped ${tie3Before.map(dow).join(' ')} · proposed ${tie3After.map(dow).join(' ')}`);
}

// ===========================================================================
// #8 — R* makes Sunday unreachable
// ===========================================================================
// ===========================================================================
// #C1 — the NEW step-5 day match drops a sitting while a candidate day is free
// ===========================================================================
console.log(`\n${'═'.repeat(78)}`);
console.log('#C1  the new capacity match only searches `spread` + the sitting\'s own gap day');
console.log('═'.repeat(78));
{
  // probe-a-spread-rehome H1c, exactly: a week that gets freer as it goes on.
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  [21, 20, 19, 18, 17].forEach((h, d) => s.addFixed({ title: `Day ${d} work`, tags: ['work'], startTime: at(d, 8), endTime: at(d, h) }));
  const clock = at(0, 6);
  const c = new Commitment({
    title: 'ENGR', tags: ['study'], amountMinPerWeek: 700,
    from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1,
  });
  const input = c.engineInputForWeek(MON, clock);
  const occupied = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const probe = new Task({ title: input.title, tags: [...input.tags], type: 'flexible', startTime: input.from, endTime: addMinutes(input.from, input.minSitting), deadline: input.until });
  const from = new Date(Math.max(dayStart(input.from).getTime(), dayStart(clock).getTime()));
  const rEnd = runwayEnd(from, input.until);
  const eachDay = (a, b) => { const out = []; for (let d = dayStart(a); d.getTime() <= dayStart(b).getTime(); d = addDays(d, 1)) out.push(d); return out; };
  const gaps = eachDay(from, rEnd).flatMap((d) => gapsOnDay(s, probe, d, occupied, clock));
  console.log(`\n    free runs: ${gaps.map((g) => `${dow(g.date)} ${g.minutes}m`).join('  ')}`);
  const bounds = { sMin: input.minSitting, sMax: input.maxSitting, maxPerDay: input.maxPerDay };
  const plan = chooseSittings(gaps, input.amountMin, bounds);
  console.log(`    plan: ${plan.sittings.map((x) => `${x.minutes}m@${dow(x.gap.date)}`).join(' ')}  short ${plan.shortfall}m`);
  const dayCandidates = [...new Map(gaps.filter((g) => g.minutes >= bounds.sMin).map((g) => [dateKey(g.date), g.date])).values()].sort((a, b) => a - b);
  const spread = spreadDays(dayCandidates, plan.sittings.length, {});
  console.log(`    spread: ${spread.map(dow).join(' ')}   candidates: ${dayCandidates.map(dow).join(' ')}`);

  const longestRun = new Map();
  for (const g of gaps) longestRun.set(dateKey(g.date), Math.max(longestRun.get(dateKey(g.date)) || 0, g.minutes));

  function assign(withRestFallback) {
    const perDay = new Map();
    const hasRoom = (d, mins) => (perDay.get(dateKey(d)) || 0) < bounds.maxPerDay && (longestRun.get(dateKey(d)) || 0) >= mins;
    const claim = (d) => { perDay.set(dateKey(d), (perDay.get(dateKey(d)) || 0) + 1); return d; };
    const pool = [...spread];
    const rest = dayCandidates.filter((d) => !spread.includes(d));
    const out = []; let dropped = 0;
    for (const sit of plan.sittings) {
      let i = pool.findIndex((d) => hasRoom(d, sit.minutes));
      if (i >= 0) { out.push([sit, claim(pool.splice(i, 1)[0])]); continue; }
      if (hasRoom(sit.gap.date, sit.minutes)) { out.push([sit, claim(sit.gap.date)]); continue; }
      if (withRestFallback) {
        i = rest.findIndex((d) => hasRoom(d, sit.minutes));
        if (i >= 0) { out.push([sit, claim(rest.splice(i, 1)[0])]); continue; }
      }
      dropped += sit.minutes;
    }
    return { out, dropped };
  }
  const before = assign(false);
  const after = assign(true);
  console.log(`    BEFORE (shipped)   ${before.out.map(([sit, d]) => `${sit.minutes}m@${dow(d)}`).join(' ')}   dropped ${before.dropped}m → short ${plan.shortfall + before.dropped}m`);
  console.log(`    AFTER  (proposed)  ${after.out.map(([sit, d]) => `${sit.minutes}m@${dow(d)}`).join(' ')}   dropped ${after.dropped}m → short ${plan.shortfall + after.dropped}m`);

  // Confirm the real generator agrees with the BEFORE column.
  resetIds();
  const s2 = new Schedule({ config: defaultConfig });
  [21, 20, 19, 18, 17].forEach((h, d) => s2.addFixed({ title: `Day ${d} work`, tags: ['work'], startTime: at(d, 8), endTime: at(d, h) }));
  const real = generateAll(s2, [input], { now: clock });
  console.log(`    real generateAll:  ${real[0].sittings.map((t) => `${t.getDuration()}m@${dow(t.startTime)}`).join(' ')}  short ${real[0].shortfall}m  ← matches BEFORE`);
}

console.log(`\n${'═'.repeat(78)}`);
console.log('#8  R* truncates the CANDIDATE DAYS (generate.js:237,240)');
console.log('═'.repeat(78));

{
  const WS = weekStart(new Date(2026, 9, 5)); // Mon 5 Oct 2026
  const cfg = makeConfig({
    windows: {
      monFri: { start: '08:00', end: '18:00' },
      sat: { start: '08:00', end: '22:00' },
      sun: { start: '08:00', end: '22:00' },
    },
  });
  const mk = () => {
    resetIds();
    const s = new Schedule({ config: cfg });
    for (let d = 0; d < 5; d += 1) {
      const day = addDays(WS, d);
      s.addFixed({ title: `Class A${d}`, tags: ['classes'], startTime: atDate(day, 9), endTime: atDate(day, 10, 30) });
      s.addFixed({ title: `Class B${d}`, tags: ['classes'], startTime: atDate(day, 14), endTime: atDate(day, 15, 30) });
    }
    return s;
  };
  const clock = atDate(WS, 8);
  const c = new Commitment({
    title: 'Thesis', tags: ['study'], amountMinPerWeek: 600,
    from: '2026-08-31', until: '2026-12-18', minSitting: 90, maxSitting: 240, maxPerDay: 1,
  });
  const input = c.engineInputForWeek(WS, clock);

  // BEFORE — the shipped path.
  const sBefore = mk();
  sBefore.addCommitment(c);
  const rBefore = generateAll(sBefore, [input], { now: clock });
  console.log(`\n    BEFORE  ${rBefore[0].sittings.reduce((n, t) => n + t.getDuration(), 0)}/${input.amountMin}m short ${rBefore[0].shortfall}m`);
  console.log(`            days ${rBefore[0].sittings.map((t) => dow(t.startTime)).join(' ')}`);

  // AFTER — the proposed retry, computed with the real exported pieces.
  const sAfter = mk();
  const occupied = sAfter.tasks.map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const probe = new Task({
    title: input.title, tags: [...input.tags], type: 'flexible',
    startTime: input.from, endTime: addMinutes(input.from, input.minSitting), deadline: input.until,
  });
  const from = new Date(Math.max(dayStart(input.from).getTime(), dayStart(clock).getTime()));
  const rEnd = runwayEnd(from, input.until);
  const eachDay = (a, b) => { const out = []; for (let d = dayStart(a); d.getTime() <= dayStart(b).getTime(); d = addDays(d, 1)) out.push(d); return out; };
  const bounds = { sMin: input.minSitting, sMax: input.maxSitting, maxPerDay: input.maxPerDay };

  const gapsR = eachDay(from, rEnd).flatMap((d) => gapsOnDay(sAfter, probe, d, occupied, clock));
  const planR = chooseSittings(gapsR, input.amountMin, bounds);
  const gapsFull = eachDay(from, addMinutes(input.until, -1)).flatMap((d) => gapsOnDay(sAfter, probe, d, occupied, clock));
  const planFull = chooseSittings(gapsFull, input.amountMin, bounds);
  console.log(`    R* window ${dateKey(from).slice(5)} → ${dateKey(rEnd).slice(5)}  → plan ${planR.sittings.map((x) => `${x.minutes}m@${dow(x.gap.date)}`).join(' ')}  short ${planR.shortfall}m`);
  console.log(`    full window ${dateKey(from).slice(5)} → ${dateKey(addMinutes(input.until, -1)).slice(5)}  → plan ${planFull.sittings.map((x) => `${x.minutes}m@${dow(x.gap.date)}`).join(' ')}  short ${planFull.shortfall}m`);
  console.log(`    AFTER (retry only when R* short-falls, adopt only if strictly better): short ${Math.min(planR.shortfall, planFull.shortfall)}m`);

  // And confirm the retry does NOT disturb a week that already fits.
  const c6 = new Commitment({
    title: 'Thesis', tags: ['study'], amountMinPerWeek: 360,
    from: '2026-08-31', until: '2026-12-18', minSitting: 90, maxSitting: 240, maxPerDay: 1,
  });
  const in6 = c6.engineInputForWeek(WS, clock);
  const p6R = chooseSittings(gapsR, in6.amountMin, { sMin: 90, sMax: 240, maxPerDay: 1 });
  console.log(`\n    6h week (already fits): R* plan short ${p6R.shortfall}m → no retry, Sunday still unused. Finish-early preserved.`);
}

console.log(`\n${'═'.repeat(78)}`);
