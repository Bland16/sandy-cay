// probe-b-commitment.mjs — Commitment validation, updateCommitment partial
// patches, and the inclusive/exclusive edge conversion (sharp edges #4/#11).
// All dates fixed (sharp edge #8) except where the probe deliberately shows the
// engine reading the wall clock.

import { Schedule } from '../../src/core/Schedule.js';
import { Commitment } from '../../src/core/Commitment.js';
import { dateKey, dateFromKey, formatHHMM } from '../../src/core/time.js';

const line = (s = '') => console.log(s);
const fmt = (d) => (d instanceof Date ? `${dateKey(d)} ${formatHHMM(d)}` : String(d));
const show = (c) => `from=${c.from} until=${c.until} amt=${c.amountMinPerWeek} min=${c.minSitting} max=${c.maxSitting} perDay=${c.maxPerDay} due=${c.dueDay} pri=${c.priority}`;

// =========================================================== 1. validation
line('=== 1. Commitment constructor: what does it accept? ===');
const cases = [
  ['garbage from', { title: 'X', from: 'not-a-date', until: '2026-12-01' }],
  ['unpadded ISO', { title: 'X', from: '2026-8-1', until: '2026-12-31' }],
  ['empty-string from', { title: 'X', from: '', until: '2026-12-31' }],
  ['numeric from', { title: 'X', from: 20260901, until: '2026-12-31' }],
  ['Date objects', { title: 'X', from: dateFromKey('2026-09-01'), until: dateFromKey('2026-12-01') }],
  ['negative amount', { title: 'X', amountMinPerWeek: -60, from: '2026-09-01', until: '2026-12-01' }],
  ['zero amount', { title: 'X', amountMinPerWeek: 0, from: '2026-09-01', until: '2026-12-01' }],
  ['NaN amount', { title: 'X', amountMinPerWeek: NaN, from: '2026-09-01', until: '2026-12-01' }],
  ['absurd amount', { title: 'X', amountMinPerWeek: 1e9, from: '2026-09-01', until: '2026-12-01' }],
  ['absurd maxPerDay', { title: 'X', maxPerDay: 1e6, from: '2026-09-01', until: '2026-12-01' }],
  ['maxPerDay 0', { title: 'X', maxPerDay: 0, from: '2026-09-01', until: '2026-12-01' }],
  ['unicode title', { title: '数学 📐', from: '2026-09-01', until: '2026-12-01' }],
  ['empty title', { title: '', from: '2026-09-01', until: '2026-12-01' }],
  ['null title', { title: null, from: '2026-09-01', until: '2026-12-01' }],
  ['tags not array', { title: 'X', tags: 'study', from: '2026-09-01', until: '2026-12-01' }],
];
for (const [name, data] of cases) {
  try {
    const c = new Commitment(data);
    line(`  ${name.padEnd(20)} id=${JSON.stringify(c.id).padEnd(18)} title=${JSON.stringify(c.title).padEnd(12)} ${show(c)}`);
  } catch (e) { line(`  ${name.padEnd(20)} THREW ${e.message}`); }
}

line('');
line('--- consequences of the garbage that got stored ---');
{
  const bad = new Commitment({ title: 'X', from: 'not-a-date', until: '2026-12-01' });
  const ws = dateFromKey('2026-09-07');
  line(`  garbage-from coversWeek(2026-09-07) = ${bad.coversWeek(ws)}`);
  let out; try { out = bad.engineInputForWeek(ws); } catch (e) { out = `THREW ${e.message}`; }
  line(`  engineInputForWeek -> ${typeof out === 'string' ? out : `from=${fmt(out && out.from)} until=${fmt(out && out.until)}`}`);

  const unpad = new Commitment({ title: 'X', from: '2026-8-1', until: '2026-12-31' });
  line(`  unpadded  coversWeek(2026-09-07) = ${unpad.coversWeek(ws)}  (term 1 Aug - 31 Dec, so this MUST be true)`);
  line(`  unpadded  coversWeek(2026-08-31) = ${unpad.coversWeek(dateFromKey('2026-08-31'))}`);
}

line('');
line('--- wall clock (sharp edge #8): same data, different "today" ---');
{
  const a = new Commitment({ title: 'X', until: '2026-12-01' });
  line(`  new Commitment({until}) -> from=${a.from}  (today, read from the wall clock at Commitment.js:72)`);
  const b = new Commitment({ title: 'X', from: '', until: '2026-12-01' });
  line(`  from:'' falls back the same way -> from=${b.from}`);
}

// =========================================================== 2. update
line('');
line('=== 2. updateCommitment partial patches ===');
{
  const s = new Schedule({});
  const c = s.addCommitment({
    title: 'Maths', tags: ['study'], from: '2026-09-01', until: '2026-12-12',
    amountMinPerWeek: 120, minSitting: 45, maxSitting: 180, maxPerDay: 2, dueDay: 'thu', priority: 4,
  });
  line(`  stored              ${show(c)}`);

  // 2a. lower the weekly amount below minSitting, then put it back.
  s.updateCommitment(c.id, { amountMinPerWeek: 30 });
  line(`  after amt->30       ${show(c)}`);
  s.updateCommitment(c.id, { amountMinPerWeek: 120 });
  line(`  after amt->120      ${show(c)}   <-- minSitting was 45 before this pair`);

  // 2b. every single-field patch in turn: does anything else move?
  const base = { title: 'Maths', tags: ['study'], from: '2026-09-01', until: '2026-12-12', amountMinPerWeek: 120, minSitting: 45, maxSitting: 180, maxPerDay: 2, dueDay: 'thu', priority: 4 };
  const patches = [
    { title: 'Maths II' }, { tags: ['study', 'uni'] }, { amountMinPerWeek: 180 },
    { dueDay: 'fri' }, { dueDay: null }, { minSitting: 60 }, { maxSitting: 240 },
    { maxPerDay: 3 }, { priority: 1 }, { from: '2026-09-07' }, { until: '2026-12-20' },
    { from: '2026-12-31' }, { until: '2026-08-01' },
  ];
  for (const p of patches) {
    const s2 = new Schedule({});
    const cc = s2.addCommitment({ ...base });
    const before = show(cc);
    s2.updateCommitment(cc.id, p);
    const after = show(cc);
    const changed = before !== after;
    line(`  patch ${JSON.stringify(p).padEnd(32)} -> ${after}${changed ? '' : '   (no change)'}`);
  }

  // 2c. a form that submits BOTH ends at once — the guard only fires when
  //     exactly one is present.
  const s3 = new Schedule({});
  const c3 = s3.addCommitment({ ...base });
  s3.updateCommitment(c3.id, { from: '2026-12-31', until: '2026-12-12' });
  line(`  patch both ends backwards -> ${show(c3)}  (constructor swap still applies)`);
}

// =========================================================== 3. edges
line('');
line('=== 3. engineInputForWeek: inclusive/exclusive edges ===');
{
  const rows = [
    ['no dueDay, term covers whole week', { from: '2026-09-01', until: '2026-12-12' }, '2026-09-07', null],
    ['dueDay thu', { from: '2026-09-01', until: '2026-12-12', dueDay: 'thu' }, '2026-09-07', null],
    ['dueDay mon', { from: '2026-09-01', until: '2026-12-12', dueDay: 'mon' }, '2026-09-07', null],
    ['dueDay sun == no dueDay', { from: '2026-09-01', until: '2026-12-12', dueDay: 'sun' }, '2026-09-07', null],
    ['term ends Wed of this week', { from: '2026-09-01', until: '2026-09-09' }, '2026-09-07', null],
    ['term starts Wed of this week', { from: '2026-09-09', until: '2026-12-12' }, '2026-09-07', null],
    ['single-day term (Mon)', { from: '2026-09-07', until: '2026-09-07' }, '2026-09-07', null],
    ['asked ON the due day', { from: '2026-09-01', until: '2026-12-12', dueDay: 'thu' }, '2026-09-07', '2026-09-10'],
    ['asked the day AFTER due', { from: '2026-09-01', until: '2026-12-12', dueDay: 'thu' }, '2026-09-07', '2026-09-11'],
    ['asked on the term\'s last day', { from: '2026-09-01', until: '2026-09-09' }, '2026-09-07', '2026-09-09'],
    ['asked the day after term end', { from: '2026-09-01', until: '2026-09-09' }, '2026-09-07', '2026-09-10'],
  ];
  for (const [name, data, ws, now] of rows) {
    const c = new Commitment({ title: 'T', ...data });
    const inp = c.engineInputForWeek(dateFromKey(ws), now ? dateFromKey(now) : null);
    line(`  ${name.padEnd(34)} -> ${inp ? `from=${fmt(inp.from)}  until(exclusive)=${fmt(inp.until)}  lastUsableDay=${dateKey(new Date(inp.until.getTime() - 1))}` : 'null'}`);
  }
}

// =========================================================== 4. sittingsFor
line('');
line('=== 4. sittingsFor week selection ===');
{
  const s = new Schedule({});
  const c = s.addCommitment({ title: 'Maths', from: '2026-09-01', until: '2026-12-12' });
  const mk = (key, hhmm, dur) => {
    const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0);
    return s.addFixed({ title: 'Sitting', parentId: c.id, startTime: d, durationMin: dur });
  };
  mk('2026-09-06', '20:00', 60); // Sunday of the PREVIOUS week
  mk('2026-09-07', '20:00', 60); // Monday
  mk('2026-09-13', '20:00', 60); // Sunday of this week
  mk('2026-09-14', '20:00', 60); // Monday of the NEXT week
  const got = s.sittingsFor(c.id, dateFromKey('2026-09-07'));
  line(`  week 2026-09-07: ${got.map((t) => dateKey(t.startTime)).join(', ')}`);
  line(`  all:             ${s.sittingsFor(c.id).map((t) => dateKey(t.startTime)).join(', ')}`);

  // A 04:15 sitting: calendar day vs the 5am-anchored grid day (sharp edge #5).
  const early = dateFromKey('2026-09-14'); early.setHours(4, 15, 0, 0);
  s.addFixed({ title: 'Early sitting', parentId: c.id, startTime: early, durationMin: 60 });
  line(`  after adding Mon 2026-09-14 04:15 (grid draws it in SUNDAY 13th's column):`);
  line(`    sittingsFor(week of 09-07) = ${s.sittingsFor(c.id, dateFromKey('2026-09-07')).map((t) => `${dateKey(t.startTime)} ${formatHHMM(t.startTime)}`).join(', ')}`);
  line(`    sittingsFor(week of 09-14) = ${s.sittingsFor(c.id, dateFromKey('2026-09-14')).map((t) => `${dateKey(t.startTime)} ${formatHHMM(t.startTime)}`).join(', ')}`);
}
