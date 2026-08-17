// probe-b-scenarios2.mjs — scenarios 3, 25, 40, 46 rebuilt so the premise
// actually holds (the first pass showed Lab writeup's Omega was NOT 0, and the
// two "devices" shared one id counter). Plus scenario 11's grid-anchor case.

import { Schedule } from '../../src/core/Schedule.js';
import { previewWeek, layOutWeek } from '../../src/core/commitmentWeek.js';
import { resetIds } from '../../src/core/ids.js';
import { generateAll } from '../../src/core/generate.js';
import { dateFromKey, dateKey, formatHHMM, dayStart, addDays } from '../../src/core/time.js';
import { computeWindows, dayCapacityMin } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const dow = (k) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateFromKey(k).getDay()];
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const base = (cfg) => new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 }, ...cfg } });
const sig = (rows, skip) => rows.filter((r) => r.commitment.title !== skip)
  .map((r) => `${r.commitment.title}:${r.sittings.map((t) => `${dateKey(t.startTime)}@${formatHHMM(t.startTime)}`).join(',') || '-'}`).join(' | ');

// ==================================================================== 3 (redone)
line('=== 3 (redone). Omega REALLY 0: every day up to the due day blocked ===');
{
  const WS = '2026-11-23';
  const mk = (withLab, extraInert) => {
    const s = base();
    // due Thursday, and Mon-Thu all blocked -> no legal day at all for Lab.
    for (const k of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) s.blockDay(dateFromKey(k));
    if (withLab) s.addCommitment({ title: 'Lab writeup', tags: ['lab'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 180, dueDay: 'thu', minSitting: 60, maxSitting: 180 });
    if (extraInert) s.addCommitment({ title: 'Aardvark essay', tags: ['aa'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 90, dueDay: 'thu', minSitting: 60, maxSitting: 90 });
    s.addCommitment({ title: 'Reading', tags: ['read'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 300, minSitting: 60, maxSitting: 180 });
    s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 120, minSitting: 60, maxSitting: 180 });
    return s;
  };
  const now = at('2026-11-23', '08:00');
  const show = (label, s) => {
    const inputs = previewWeek(s, dateFromKey(WS), now).filter((p) => p.state === 'owes').map((p) => p.input);
    const res = generateAll(s, inputs, { now });
    line(`  ${label}`);
    for (const r of res) line(`      ${r.commitment.title.padEnd(16)} rho=${r.rho === Infinity ? 'Infinity' : r.rho.toFixed(4)}  ${r.sittings.map((t) => `${dow(dateKey(t.startTime))} ${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(' ') || '(none)'}${r.shortfall ? `  short=${r.shortfall}m` : ''}`);
    return res;
  };
  const a = show('WITH Lab writeup (rho must be Infinity):', mk(true, false));
  const b = show('WITHOUT Lab writeup:', mk(false, false));
  line(`  Reading/Maths identical either way? ${sig(a, 'Lab writeup') === sig(b, 'Lab writeup') ? 'YES — not poisoned' : 'NO'}`);
  line(`    with   : ${sig(a, 'Lab writeup')}`);
  line(`    without: ${sig(b, 'Lab writeup')}`);
  line('');
  const c = show('TWO commitments both at rho=Infinity (comparator gets NaN):', mk(true, true));
  line(`  sort order: ${c.map((r) => r.commitment.title).join(' > ')}`);
  const c2 = show('  ...same input again:', mk(true, true));
  line(`  order stable across runs? ${c.map((r) => r.commitment.title).join() === c2.map((r) => r.commitment.title).join() ? 'yes' : 'NO — non-transitive comparator'}`);
  line(`  Infinity - Infinity = ${Infinity - Infinity} ; (NaN || 2) = ${NaN || 2}  <- the || chain rescues it`);
}

// ==================================================================== 25 (forced)
line('');
line('=== 25 (forced). can a sitting actually LAND on 29 Feb 2028? ===');
{
  const s = base();
  for (const k of ['2028-02-28', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04', '2028-03-05']) s.blockDay(dateFromKey(k));
  const c = s.addCommitment({ title: 'Revision', tags: ['rev'], from: '2028-02-01', until: '2028-04-01', amountMinPerWeek: 120, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
  const res = layOutWeek(s, dateFromKey('2028-02-28'), at('2028-02-28', '08:00'));
  line(`  laid: ${res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${dateKey(t.startTime)} ${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(', ') || '(none)'} short=${res[0].shortfall}m`);
  line(`  sittingsFor(week of 28 Feb) = ${s.sittingsFor(c.id, dateFromKey('2028-02-28')).map((t) => dateKey(t.startTime)).join(', ')}`);
  const rt = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  line(`  round-trips: ${rt.tasks.map((t) => `${dateKey(t.startTime)} ${formatHHMM(t.startTime)}`).join(', ')}  blocked=${rt.blockedDays.length}`);
}

// ==================================================================== 40 (forced)
line('');
line('=== 40 (forced). legacy whole-day blocker TASK vs the widened window ===');
{
  const s = base({ windows: { monFri: { start: '06:00', end: '23:00' } } });
  const blocker = s.addFixed({ title: 'Blocked', tags: ['rest'], pinned: true, startTime: at('2026-09-09', '08:00'), durationMin: 10 * 60 });
  // Fill every other day of the week so Wednesday is the only candidate.
  for (const k of ['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']) {
    s.addFixed({ title: `full ${k}`, startTime: at(k, '06:00'), durationMin: 17 * 60 });
  }
  const c = s.addCommitment({ title: 'Work', tags: ['work'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 120, minSitting: 60, maxSitting: 120, maxPerDay: 2 });
  const res = layOutWeek(s, dateFromKey('2026-09-07'), at('2026-09-07', '05:00'));
  line(`  legacy blocker card: Wed 2026-09-09 08:00-18:00, protected tag 'rest', pinned`);
  line(`  schedule.isDayBlocked(9 Sep) = ${s.isDayBlocked(dateFromKey('2026-09-09'))}   <- what the day-header tint and computeWindows both read`);
  line(`  laid: ${res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${dateKey(t.startTime)} ${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(', ') || '(none)'} short=${res[0].shortfall}m`);
  const onWed = res[0].sittings.filter((t) => dateKey(t.startTime) === '2026-09-09');
  line(`  landed inside the "blocked" day: ${onWed.map((t) => formatHHMM(t.startTime)).join(', ') || '(none)'}`);
  line(`  overlaps the blocker card itself? ${onWed.some((t) => t.overlaps(blocker)) ? 'YES' : 'no'}`);
  line(`  preview for that week said: ${previewWeek(s, dateFromKey('2026-09-07'), at('2026-09-07', '05:00')).map((p) => p.state).join()}`);
}

// ==================================================================== 46 (redone)
line('');
line('=== 46 (redone). two devices, each with a FRESH id counter ===');
{
  const WS = dateFromKey('2026-09-07');
  const now = at('2026-09-07', '08:00');
  const seedJson = (() => {
    resetIds();
    const s = base();
    s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 240, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
    return JSON.parse(JSON.stringify(s.toJSON()));
  })();
  resetIds(); // device A: fresh page load
  const A = Schedule.fromJSON(JSON.parse(JSON.stringify(seedJson)));
  layOutWeek(A, WS, now);
  resetIds(); // device B: its own fresh page load
  const B = Schedule.fromJSON(JSON.parse(JSON.stringify(seedJson)));
  B.addFixed({ title: 'Dentist', pinned: true, startTime: at('2026-09-09', '10:00'), durationMin: 60 });
  layOutWeek(B, WS, now);
  const idsA = A.tasks.map((t) => t.id); const idsB = B.tasks.map((t) => t.id);
  line(`  A: ${idsA.join(', ')}`);
  line(`  B: ${idsB.join(', ')}`);
  const collide = idsA.filter((i) => idsB.includes(i));
  line(`  SAME id used for DIFFERENT sittings on the two devices: ${collide.join(', ') || '(none)'}`);
  for (const id of collide) {
    const ta = A.tasks.find((t) => t.id === id); const tb = B.tasks.find((t) => t.id === id);
    line(`     ${id}: A=${dateKey(ta.startTime)} ${formatHHMM(ta.startTime)}  B=${dateKey(tb.startTime)} ${formatHHMM(tb.startTime)}  same slot? ${ta.startTime.getTime() === tb.startTime.getTime()}`);
  }
  const merged = Schedule.fromJSON(JSON.parse(JSON.stringify(B.toJSON())));
  line(`  footlocker import B over A REPLACES: A's sittings survive? ${idsA.every((i) => merged.tasks.some((t) => t.id === i && t.startTime.getTime() === A.tasks.find((x) => x.id === i).startTime.getTime())) ? 'yes' : 'NO — silently discarded, no conflict signal'}`);
  const concat = Schedule.fromJSON({ schemaVersion: 1, tasks: [...A.toJSON().tasks, ...B.toJSON().tasks], commitments: A.toJSON().commitments });
  line(`  a naive id-keyed merge would hit ${collide.length} id collisions; _dedupeTaskIds silently reissues, giving ${concat.tasks.length} tasks and ${concat.sittingsFor(concat.commitments[0].id, WS).length} sittings for a 240m commitment`);
}

// ==================================================================== 11
line('');
line('=== 11. a sitting crossing the 5am grid anchor; maxPerDay counts CALENDAR days ===');
{
  line('  (a) a config window that crosses midnight cannot be expressed:');
  const s0 = base({ windows: { monFri: { start: '06:00', end: '02:00' } } });
  line(`      windows.monFri 06:00->02:00  dayCapacityMin(Mon) = ${dayCapacityMin(s0.config, dateFromKey('2026-09-07'))} min`);
  line(`      computeWindows = ${computeWindows(s0, { tags: [], deadline: null }, dateFromKey('2026-09-07')).length} window(s) -> the whole day is silently unusable`);

  line('  (b) a ZONE can open before 05:00 (SPEC §2.1: zones are not clipped):');
  const s = base();
  s.addZone({
    label: 'Night', matchTags: ['night'], exclusive: true,
    windows: [{ day: 'sun', start: '20:00', end: '23:00' }, { day: 'mon', start: '00:00', end: '04:00' }],
  });
  const c = s.addCommitment({ title: 'Night work', tags: ['night'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 300, minSitting: 120, maxSitting: 180, maxPerDay: 1 });
  const res = layOutWeek(s, dateFromKey('2026-09-07'), at('2026-09-06', '19:00'));
  const gridCol = (d) => {
    // 5am-anchored: 00:00-04:59 belongs to the PREVIOUS day's column (sharp #5).
    const anchored = d.getHours() < 5 ? addDays(dayStart(d), -1) : dayStart(d);
    return dateKey(anchored);
  };
  for (const t of res[0].sittings) {
    line(`      sitting ${dow(dateKey(t.startTime))} ${dateKey(t.startTime)} ${formatHHMM(t.startTime)}/${t.getDuration()}m`
      + `  -> calendar day ${dateKey(t.startTime)}, GRID column ${gridCol(t.startTime)} (${dow(gridCol(t.startTime))})`);
  }
  const byCal = new Map(); const byGrid = new Map();
  for (const t of res[0].sittings) {
    byCal.set(dateKey(t.startTime), (byCal.get(dateKey(t.startTime)) || 0) + 1);
    byGrid.set(gridCol(t.startTime), (byGrid.get(gridCol(t.startTime)) || 0) + 1);
  }
  line(`      maxPerDay=1. per CALENDAR day: ${[...byCal].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  line(`                   per GRID column : ${[...byGrid].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  line(`      two blocks in one visual column despite maxPerDay 1? ${[...byGrid.values()].some((v) => v > 1) ? 'YES' : 'no'}`);
  line(`      sittingsFor(week of Mon 7 Sep) = ${s.sittingsFor(c.id, dateFromKey('2026-09-07')).length} of ${res[0].sittings.length} placed`);
  line(`      sittingsFor(week of Mon 31 Aug) = ${s.sittingsFor(c.id, dateFromKey('2026-08-31')).length}`);
}
