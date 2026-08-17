// probe-a-recurrence-blind.mjs — PROBE-A / generation path.
//
// Hypothesis: `generateAll` builds its occupied set with `baseOccupied(schedule,
// null)`, whose `to` bound is `addDays(new Date(), 90)` and whose `from` is
// `new Date(0)`. `recurrenceIntervals` walks weeks forward from `weekStart(from)`
// with `guard < 60`, so it expands 60 weeks starting at the UNIX EPOCH and
// returns nothing for the week actually being planned.
//
// If true: sharp edge #3 is reintroduced in the one path the button uses, and
// sittings are laid straight through a pinned recurring class.
//
//   node design/probes/probe-a-recurrence-blind.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll, generateSittings } from '../../src/core/generate.js';
import { recurrenceIntervals } from '../../src/core/placement.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const show = (t) => `${dateKey(t.startTime).slice(5)} ${hhmm(t.startTime)}-${hhmm(t.endTime)} ${t.getDuration()}m`;

/** Mon–Fri 09:00–17:00 lab, as a RECURRING pattern (the normal way a class lives). */
function recurringWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({
    title: 'Lab', tags: ['classes'], startTime: at(0, 9), endTime: at(0, 17),
    recurrence: {
      periods: [{
        windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => ({ day: d, start: '09:00', end: '17:00' })),
        interval: 1, effectiveFrom: at(0, 0), effectiveUntil: null,
      }],
      anchorDate: at(0, 0), exceptions: [],
    },
  });
  return s;
}

/** The exact same week, but the lab is five ordinary FIXED tasks. Control. */
function fixedWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let d = 0; d < 5; d += 1) {
    s.addFixed({ title: `Lab ${d}`, tags: ['classes'], startTime: at(d, 9), endTime: at(d, 17) });
  }
  return s;
}

const commit = (over = {}) => new Commitment({
  title: 'ENGR', tags: ['study'], amountMinPerWeek: 240,
  from: D(0), until: D(76), minSitting: 60, maxSitting: 180, maxPerDay: 1, ...over,
});

function anchors(s) {
  return recurrenceIntervals(s, MON, addDays(MON, 7));
}

function overlaps(sittings, blocks) {
  const out = [];
  for (const t of sittings) {
    for (const b of blocks) {
      if (t.startTime < b.end && b.start < t.endTime) {
        out.push(`${show(t)}  ⟂  "${b.task.title}" ${dateKey(b.start).slice(5)} ${hhmm(b.start)}-${hhmm(b.end)}`);
      }
    }
  }
  return out;
}

console.log('PROBE-A · does generateAll see RECURRING anchors?');
console.log(`week under test ${D(0)} … ${D(6)}\n`);

// --- 0. What the occupied-set builder actually returns ----------------------
{
  const s = recurringWeek();
  const real = anchors(s);
  console.log(`0.  recurrenceIntervals(sched, Mon, Mon+7d)          → ${real.length} occurrence(s)`);
  const epochish = recurrenceIntervals(s, new Date(0), addDays(new Date(), 90));
  console.log(`    recurrenceIntervals(sched, epoch, now+90d)       → ${epochish.length} occurrence(s)`);
  console.log('    (the second is exactly what generate.js#baseOccupied(schedule, null) computes,');
  console.log('     which is the occupied set generateAll hands to every commitment)\n');
}

// --- 1. generateAll on the recurring week ------------------------------------
{
  const s = recurringWeek();
  const c = commit();
  const input = c.engineInputForWeek(MON, at(0, 6));
  const res = generateAll(s, [input], { now: at(0, 6) });
  const sittings = res[0].sittings;
  console.log('1.  generateAll — lab is RECURRING');
  console.log(`    laid: ${sittings.map(show).join('   ')}`);
  const bad = overlaps(sittings, anchors(s));
  if (bad.length) { console.log('    ✗ OVERLAPS a pinned recurring occurrence:'); for (const b of bad) console.log(`        ${b}`); } else console.log('    ✓ no overlap');
}

// --- 2. the identical week with FIXED tasks (control) ------------------------
{
  const s = fixedWeek();
  const c = commit();
  const input = c.engineInputForWeek(MON, at(0, 6));
  const res = generateAll(s, [input], { now: at(0, 6) });
  const sittings = res[0].sittings;
  console.log('\n2.  generateAll — the same hours as FIXED tasks (control)');
  console.log(`    laid: ${sittings.map(show).join('   ')}`);
  const blocks = s.tasks.filter((t) => t.title.startsWith('Lab')).map((t) => ({ start: t.startTime, end: t.endTime, task: t }));
  const bad = overlaps(sittings, blocks);
  if (bad.length) { console.log('    ✗ OVERLAPS:'); for (const b of bad) console.log(`        ${b}`); } else console.log('    ✓ no overlap');
}

// --- 3. generateSittings alone builds its OWN (correct) occupied set ---------
{
  const s = recurringWeek();
  const c = commit();
  const input = c.engineInputForWeek(MON, at(0, 6));
  const r = generateSittings(s, input, { now: at(0, 6) }); // no opts.occupied
  console.log('\n3.  generateSittings called DIRECTLY on the recurring week (builds its own set)');
  console.log(`    laid: ${r.sittings.map(show).join('   ')}`);
  const bad = overlaps(r.sittings, anchors(s));
  if (bad.length) { console.log('    ✗ OVERLAPS:'); for (const b of bad) console.log(`        ${b}`); } else console.log('    ✓ no overlap — so the defect is generateAll\'s occupied set, not the placer');
}

// --- 4. does the wall clock change the answer? (sharp edge #8) ---------------
{
  // A recurrence far in the future: `to = addDays(new Date(), 90)` is a WALL
  // CLOCK read, so a term more than 90 days out is outside the window the
  // occupied set is built for, whatever `now` the caller injected.
  console.log('\n4.  baseOccupied(schedule, null) reads the WALL CLOCK for its `to` bound');
  console.log(`    generate.js:342  const to = commitment ? commitment.until : addDays(new Date(), 90);`);
  console.log(`    real clock right now = ${dateKey(new Date())}; injected now = ${dateKey(at(0, 6))}`);
}
