// probe-commitment-cases.mjs — "make sure it is airtight no matter what".
//
// Asked by the user 2026-08-16, BEFORE the "Lay out this week" button is built:
// week one is the worrying case, and they wanted the realistic usage settled
// first. So this defines the button's intended logic (`layOutWeek` below) and
// runs it against every lifecycle case that can actually happen.
//
// House method (design/USE-CASE-RUN-2026-08.md): nothing here is called a pass
// or a fail on anyone's opinion. Each case is RUN, its invariants are checked
// mechanically, and the failures are printed as failures.
//
//   node design/probes/probe-commitment-cases.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { defaultConfig } from '../../src/core/config.js';
import { generateAll } from '../../src/core/generate.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const MON = weekStart(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const D = (o) => dateKey(addDays(MON, o));
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const now = (o, h, m = 0) => at(o, h, m);

// ---------------------------------------------------------------------------
// THE BUTTON, as it is intended to be built. Written here first so the DESIGN
// gets tested rather than the implementation.
// ---------------------------------------------------------------------------

/** What the preview shows before anything is written. */
function previewWeek(sched, ws, clock) {
  return sched.commitments.map((c) => {
    const already = sched.sittingsFor(c.id, ws);
    const input = c.engineInputForWeek(ws, clock);
    let state = 'OWES';
    if (already.length) state = 'DONE';
    else if (!input) state = c.coversWeek(ws) ? 'PASSED' : 'OUTSIDE';
    return { c, already, input, state };
  });
}

/** Lay out one week. Idempotent: a commitment already laid out here is skipped. */
function layOutWeek(sched, ws, clock) {
  const inputs = previewWeek(sched, ws, clock)
    .filter((p) => p.state === 'OWES')
    .map((p) => p.input);
  return inputs.length ? generateAll(sched, inputs, { now: clock }) : [];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real term week: classes Mon/Wed/Fri 9-10, seminars Tue/Thu 11-12, gym Mon eve. */
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

/** A week with almost nothing free — 08:00-21:00 booked solid every day. */
function packedWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  for (let d = 0; d < 7; d += 1) s.addFixed({ title: `busy ${d}`, tags: ['work'], startTime: at(d, 8), endTime: at(d, 21) });
  return s;
}

const commit = (over) => new Commitment({
  title: over.title || 'Coursework',
  tags: ['study'],
  amountMinPerWeek: 240,
  from: D(0),
  until: D(76), // ~11 weeks
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
  ...over,
});

// ---------------------------------------------------------------------------
// Invariants — checked mechanically, never by eye
// ---------------------------------------------------------------------------

function checkInvariants(sched, results, ws, clock) {
  const fails = [];
  const shared = [];
  const dayOwner = {};

  for (const r of results) {
    const c = r.commitment;
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);

    if (placed + r.shortfall !== c.amountMin) {
      fails.push(`§4.3 conservation: ${c.title} placed ${placed} + short ${r.shortfall} ≠ ${c.amountMin}`);
    }
    const perDay = {};
    for (const t of r.sittings) {
      const k = dateKey(t.startTime);
      const dur = t.getDuration();
      if (dur < c.minSitting) fails.push(`sitting ${dur}m under minSitting ${c.minSitting} (${c.title})`);
      if (dur > c.maxSitting) fails.push(`sitting ${dur}m over maxSitting ${c.maxSitting} (${c.title})`);
      if (t.startTime.getTime() < clock.getTime()) fails.push(`placed in the PAST: ${c.title} ${k} ${t.startTime.getHours()}h`);
      if (sched.isDayBlocked(t.startTime)) fails.push(`placed on a BLOCKED day: ${c.title} ${k}`);
      if (k < dateKey(c.from)) fails.push(`before the window: ${c.title} ${k} < ${dateKey(c.from)}`);
      if (k >= dateKey(c.until)) fails.push(`after the due day: ${c.title} ${k} >= ${dateKey(c.until)}`);
      perDay[k] = (perDay[k] || 0) + 1;
      if (perDay[k] > c.maxPerDay) fails.push(`maxPerDay ${c.maxPerDay} exceeded on ${k} (${c.title})`);
      // §4.1.2 asks a commitment to count another's days as TAKEN — a strong
      // preference, not a prohibition. `spreadDays` falls back to the full
      // candidate pool when there are fewer free days than sittings, which is
      // right: nine commitments cannot have nine days in a seven-day week, and
      // refusing to place two of them would be worse than sharing a Wednesday.
      // So this is reported, not failed, unless days were going spare.
      if (dayOwner[k] && dayOwner[k] !== c.title) shared.push(`${k}: ${dayOwner[k]} + ${c.title}`);
      dayOwner[k] = c.title;
    }
    // Overlap with anything else on the grid.
    for (const t of r.sittings) {
      for (const o of sched.tasks) {
        if (o === t || o.chunking || !o.startTime || !o.endTime) continue;
        if (t.startTime < o.endTime && o.startTime < t.endTime) {
          fails.push(`OVERLAP: ${c.title} ${dateKey(t.startTime)} clashes with "${o.title}"`);
        }
      }
    }
  }
  void ws;
  return { fails, shared };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let total = 0; let bad = 0;

function run(id, title, build) {
  total += 1;
  const { sched, ws = MON, clock, note } = build();
  console.log(`\n${'─'.repeat(74)}\n${id}  ${title}`);
  if (note) console.log(`      ${note}`);

  const pre = previewWeek(sched, ws, clock);
  for (const p of pre) {
    const tail = p.state === 'OWES' ? `${p.input.amountMin}m · ${dateKey(p.input.from)} → ${dateKey(p.input.until)} (excl)`
      : p.state === 'DONE' ? `${p.already.length} sitting(s) already here`
        : p.state === 'PASSED' ? 'its last usable day has passed'
          : 'term does not reach this week';
    console.log(`   preview  ${p.state.padEnd(8)} ${p.c.title.padEnd(22)} ${tail}`);
  }

  const results = layOutWeek(sched, ws, clock);
  for (const r of results) {
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    const days = r.sittings.map((t) => `${dateKey(t.startTime).slice(5)} ${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} ${t.getDuration()}m`).join('  ');
    console.log(`   laid     ${r.commitment.title.padEnd(22)} ${placed}/${r.commitment.amountMin}m short ${r.shortfall}m  ${days || '(nothing)'}`);
  }
  if (!results.length) console.log('   laid     (nothing — nothing owed)');

  const { fails, shared } = checkInvariants(sched, results, ws, clock);
  for (const sd of shared) console.log(`   · day shared (allowed when days run out) — ${sd}`);
  if (fails.length) { bad += 1; for (const f of fails) console.log(`   ✗ ${f}`); } else console.log('   ✓ invariants hold');
  return { sched, ws, clock, results };
}

console.log('COMMITMENT LIFECYCLE — every case that can actually happen');
console.log(`week under test: ${D(0)} (Mon) … ${D(6)} (Sun)`);

// ===== A — WEEK ONE, the case the user asked about ==========================
console.log(`\n\n${'='.repeat(74)}\nA — WEEK ONE\n${'='.repeat(74)}`);

run('A1', 'term starts Monday, asked Monday before the week begins', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(0, 6) };
});

run('A2', 'term starts WEDNESDAY — week one is Wed–Sun, still owes a full week', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', from: D(2) }));
  return { sched: s, clock: now(0, 6), note: 'DECIDED: full amount, never pro-rated. §4.3 states any shortfall.' };
});

run('A3', 'term started Monday but you only ask on WEDNESDAY', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(2, 12), note: 'half the week gone; nothing may be placed in the past' };
});

run('A4', 'due THURSDAY, asked Wednesday — two days left', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', dueDay: 'thu' }));
  return { sched: s, clock: now(2, 12) };
});

run('A5', 'due THURSDAY, asked FRIDAY — the week is over for it', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', dueDay: 'thu' }));
  return { sched: s, clock: now(4, 12), note: 'must owe NOTHING — no shortfall manufactured by time passing' };
});

run('A6', 'due MONDAY — a one-day window', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', dueDay: 'mon', amountMinPerWeek: 120 }));
  return { sched: s, clock: now(0, 6) };
});

// ===== B — TERM END =========================================================
console.log(`\n\n${'='.repeat(74)}\nB — TERM END\n${'='.repeat(74)}`);

run('B1', 'term ends WEDNESDAY of this week', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', until: D(2) }));
  return { sched: s, clock: now(0, 6), note: 'a stub week still owes its full amount' };
});

run('B2', 'the week AFTER the term ends', () => {
  // ⚠️ `from: D(-14)` matters: the constructor SWAPS a backwards range, so
  // leaving `from` at D(0) with `until: D(-1)` silently produced a 1-day term
  // starting the 6th and this case tested nothing. My fixture, not the code.
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', from: D(-14), until: D(-1) }));
  return { sched: s, clock: now(0, 6) };
});

run('B3', 'a single-day term', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', from: D(1), until: D(1), amountMinPerWeek: 120 }));
  return { sched: s, clock: now(0, 6) };
});

// ===== C — WHEN IT DOES NOT FIT ============================================
console.log(`\n\n${'='.repeat(74)}\nC — WHEN IT DOES NOT FIT (§4.3)\n${'='.repeat(74)}`);

run('C1', '20h a week into a real term week', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR', amountMinPerWeek: 1200 }));
  return { sched: s, clock: now(0, 6) };
});

run('C2', 'a packed week — nothing free at all', () => {
  const s = packedWeek(); s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(0, 6), note: 'the whole amount should be stated as shortfall, not crammed' };
});

run('C3', 'the amount is SMALLER than one minimum sitting', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'Errand', amountMinPerWeek: 30, minSitting: 60 }));
  return { sched: s, clock: now(0, 6), note: 'must not book a 60m block for a 30m job, nor emit a fragment' };
});

run('C4', 'every day of the week is BLOCKED', () => {
  const s = termWeek();
  for (let d = 0; d < 7; d += 1) s.blockDay(addDays(MON, d));
  s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(0, 6), note: 'a holiday week owes its amount and can place none of it' };
});

run('C5', 'three days blocked, four free', () => {
  const s = termWeek();
  [1, 2, 3].forEach((d) => s.blockDay(addDays(MON, d)));
  s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(0, 6) };
});

run('C6', 'maxPerDay 1, needs 4 sittings, only 2 days free', () => {
  const s = termWeek();
  [2, 3, 4, 5, 6].forEach((d) => s.blockDay(addDays(MON, d)));
  s.addCommitment(commit({ title: 'ENGR', amountMinPerWeek: 480, maxSitting: 120 }));
  return { sched: s, clock: now(0, 6) };
});

// ===== D — SEVERAL COMMITMENTS (§4.1.2) ====================================
console.log(`\n\n${'='.repeat(74)}\nD — SEVERAL COMMITMENTS (§4.1.2)\n${'='.repeat(74)}`);

run('D1', 'three commitments competing for the same week', () => {
  const s = termWeek();
  s.addCommitment(commit({ title: 'ENGR', amountMinPerWeek: 240 }));
  s.addCommitment(commit({ title: 'CHEM', amountMinPerWeek: 180, dueDay: 'fri' }));
  s.addCommitment(commit({ title: 'Reading', amountMinPerWeek: 120, minSitting: 45, maxSitting: 90 }));
  return { sched: s, clock: now(0, 6), note: 'rho order, and no day claimed twice' };
});

run('D2', 'more commitments than there are days', () => {
  const s = termWeek();
  for (let i = 0; i < 9; i += 1) s.addCommitment(commit({ title: `C${i}`, amountMinPerWeek: 60, minSitting: 60, maxSitting: 60 }));
  return { sched: s, clock: now(0, 6), note: 'nine commitments, seven days, maxPerDay 1 each' };
});

run('D3', 'mixed terms in one week', () => {
  const s = termWeek();
  s.addCommitment(commit({ title: 'running', amountMinPerWeek: 120 }));
  s.addCommitment(commit({ title: 'not-yet', from: D(7) }));
  s.addCommitment(commit({ title: 'finished', until: D(-1) }));
  s.addCommitment(commit({ title: 'starts-Wed', from: D(2), amountMinPerWeek: 120 }));
  return { sched: s, clock: now(0, 6) };
});

// ===== E — PRESSING IT AGAIN ===============================================
console.log(`\n\n${'='.repeat(74)}\nE — PRESSING IT AGAIN (D-3: a shortfall must never grow)\n${'='.repeat(74)}`);

const e1 = run('E1', 'press once', () => {
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR' }));
  return { sched: s, clock: now(0, 6) };
});
{
  total += 1;
  console.log('\nE2  press it a SECOND time — must be a no-op');
  const before = e1.sched.tasks.length;
  const again = layOutWeek(e1.sched, MON, now(0, 6));
  const after = e1.sched.tasks.length;
  console.log(`   tasks ${before} → ${after}, second run returned ${again.length} result(s)`);
  if (after !== before || again.length !== 0) { bad += 1; console.log('   ✗ NOT idempotent — pressing twice changed the week'); } else console.log('   ✓ idempotent');
}
{
  total += 1;
  console.log('\nE3  delete one sitting by hand, then press again');
  const c = e1.sched.commitments[0];
  const mine = e1.sched.sittingsFor(c.id, MON);
  const keep = mine.length - 1;
  e1.sched.removeTask(mine[0].id);
  const again = layOutWeek(e1.sched, MON, now(0, 6));
  const nowCount = e1.sched.sittingsFor(c.id, MON).length;
  console.log(`   ${mine.length} → deleted 1 → ${keep} remain → pressed → ${nowCount} now, ${again.length} result(s)`);
  console.log(nowCount === keep
    ? '   ⚠ the week is NOT topped up — deliberate? (see the doc: "already laid out" is per week, not per amount)'
    : '   ⚠ the week WAS topped up — check this is what you want');
}
{
  total += 1;
  console.log('\nE4  move a sitting by hand, then press again — the hand must win (R-1)');
  const s = termWeek(); s.addCommitment(commit({ title: 'ENGR' }));
  layOutWeek(s, MON, now(0, 6));
  const c = s.commitments[0];
  const first = s.sittingsFor(c.id, MON)[0];
  const movedTo = at(6, 15);
  first.startTime = movedTo; first.endTime = addDays(movedTo, 0);
  first.endTime = new Date(movedTo.getTime() + 60 * 60000);
  first.placedBy = 'user';
  const before = s.sittingsFor(c.id, MON).length;
  layOutWeek(s, MON, now(0, 6));
  const after = s.sittingsFor(c.id, MON).length;
  console.log(`   moved one to ${dateKey(movedTo)} 15:00 · sittings ${before} → ${after}`);
  if (after !== before) { bad += 1; console.log('   ✗ pressing again disturbed a hand-placed sitting'); } else console.log('   ✓ the hand survives');
}

console.log(`\n${'='.repeat(74)}`);
console.log(`${total} cases · ${bad} with failing invariants`);
console.log('='.repeat(74));
