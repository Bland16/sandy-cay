// probe-b-scenarios.mjs — the blind-generated cases assigned to PROBE-B:
// 3, 4, 10, 12, 17, 25, 27, 28, 31, 40, 43, 46. Fixed `now` everywhere (#8).

import { Schedule } from '../../src/core/Schedule.js';
import { previewWeek, layOutWeek, planWeek } from '../../src/core/commitmentWeek.js';
import { dateFromKey, dateKey, formatHHMM, weekStart, isoWeekKey, DAY_KEYS } from '../../src/core/time.js';

const line = (s = '') => console.log(s);
const dow = (k) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateFromKey(k).getDay()];
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const fmt = (d) => `${dow(dateKey(d))} ${dateKey(d)} ${formatHHMM(d)}`;
const plan = (rows) => rows.map((r) => `${r.commitment.title}[rho=${r.rho === Infinity ? 'Inf' : r.rho.toFixed(3)}] `
  + `${r.sittings.map((t) => `${dow(dateKey(t.startTime))} ${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(' ') || '(none)'}`
  + (r.shortfall ? ` short=${r.shortfall}m` : '')).join('\n      ');

const base = (cfg) => new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 }, ...cfg } });

// ==================================================================== 3
line('=== 3. rho divide-by-zero: does an unplaceable commitment poison the others? ===');
{
  const WS = '2026-11-23';
  line(`  week of ${WS} is a ${dow(WS)}; blocking ${dow('2026-11-26')} 26th and ${dow('2026-11-27')} 27th`);
  const mk = (withLab) => {
    const s = base();
    s.blockDay(dateFromKey('2026-11-26'));
    s.blockDay(dateFromKey('2026-11-27'));
    if (withLab) s.addCommitment({ title: 'Lab writeup', tags: ['lab'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 180, dueDay: 'thu', minSitting: 60, maxSitting: 180 });
    s.addCommitment({ title: 'Reading', tags: ['read'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 300, minSitting: 60, maxSitting: 180 });
    s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-11-01', until: '2026-12-20', amountMinPerWeek: 120, minSitting: 60, maxSitting: 180 });
    return s;
  };
  const now = at('2026-11-23', '08:00');
  const withLab = mk(true); const r1 = layOutWeek(withLab, dateFromKey(WS), now);
  const noLab = mk(false); const r2 = layOutWeek(noLab, dateFromKey(WS), now);
  line(`  WITH Lab writeup:\n      ${plan(r1)}`);
  line(`  WITHOUT Lab writeup:\n      ${plan(r2)}`);
  const sig = (rows) => rows.filter((r) => r.commitment.title !== 'Lab writeup')
    .map((r) => `${r.commitment.title}:${r.sittings.map((t) => `${dateKey(t.startTime)}@${formatHHMM(t.startTime)}`).join(',')}`).join(' | ');
  line(`  Reading/Maths identical either way? ${sig(r1) === sig(r2) ? 'yes' : 'NO — the unplaceable one moved them'}`);
  line(`    with   : ${sig(r1)}`);
  line(`    without: ${sig(r2)}`);
  // two consecutive presses
  const twice = mk(true);
  const a = layOutWeek(twice, dateFromKey(WS), now);
  const b = layOutWeek(twice, dateFromKey(WS), now);
  line(`  press #1 order: ${a.map((r) => r.commitment.title).join(' > ')}`);
  line(`  press #2       : ${b.length ? b.map((r) => r.commitment.title).join(' > ') : '(no-op — nothing owes)'}`);
  const fresh = mk(true);
  const c = layOutWeek(fresh, dateFromKey(WS), now);
  line(`  fresh press order matches #1? ${a.map((r) => r.commitment.title).join()===c.map((r) => r.commitment.title).join() ? 'yes (deterministic)' : 'NO'}`);
}

// ==================================================================== 4
line('');
line('=== 4. lay out a week entirely in the PAST ===');
{
  const s = base();
  s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 180, minSitting: 60, maxSitting: 180 });
  const now = at('2026-11-16', '09:00');
  const pastWs = dateFromKey('2026-09-07');
  line(`  clock ${dow('2026-11-16')} 2026-11-16; viewing week of ${dow('2026-09-07')} 2026-09-07`);
  const pv = previewWeek(s, pastWs, now);
  line(`  preview: ${pv.map((p) => `${p.commitment.title}=${p.state} owed=${p.owedMin}m`).join(', ')}`);
  const before = s.tasks.length;
  const res = layOutWeek(s, pastWs, now);
  line(`  layOutWeek -> ${res.length} result(s), tasks ${before} -> ${s.tasks.length}`);
  line(`  wrote into September? ${s.tasks.some((t) => dateKey(t.startTime).startsWith('2026-09')) ? 'YES' : 'no'}`);
  line(`  manufactured a shortfall? ${res.reduce((n, r) => n + r.shortfall, 0)}m`);
}

// ==================================================================== 10
line('');
line('=== 10. ISO week 53 across the 2026/2027 boundary ===');
{
  line(`  2026-12-28 is a ${dow('2026-12-28')}; weekStart -> ${dateKey(weekStart(dateFromKey('2026-12-30')))}`);
  line(`  isoWeekKey 2026-12-28=${isoWeekKey(dateFromKey('2026-12-28'))}  2027-01-01=${isoWeekKey(dateFromKey('2027-01-01'))}  2027-01-04=${isoWeekKey(dateFromKey('2027-01-04'))}`);
  const s = base();
  const c = s.addCommitment({ title: 'Thesis', tags: ['thesis'], from: '2026-12-28', until: '2027-01-15', amountMinPerWeek: 300, minSitting: 60, maxSitting: 180 });
  const now = at('2026-12-28', '08:00');
  const pv = previewWeek(s, dateFromKey('2026-12-28'), now);
  line(`  preview week of 28 Dec: ${pv.map((p) => `${p.state} owed=${p.owedMin}m`).join()}`);
  const res = layOutWeek(s, dateFromKey('2026-12-28'), now);
  line(`  laid: ${res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${dateKey(t.startTime)}`).join(', ')} short=${res[0].shortfall}m`);
  line(`  total placed = ${res[0].sittings.reduce((n, t) => n + t.getDuration(), 0)}m of ${c.amountMinPerWeek}m (must be ONE week's worth)`);
  const got = s.sittingsFor(c.id, dateFromKey('2026-12-28'));
  line(`  sittingsFor(week of 28 Dec) sees ${got.length} of ${res[0].sittings.length} placed: ${got.map((t) => dateKey(t.startTime)).join(', ')}`);
  const next = previewWeek(s, dateFromKey('2027-01-04'), now);
  line(`  week of 4 Jan preview: ${next.map((p) => `${p.state} owed=${p.owedMin}m`).join()}  (must owe a FRESH 300m, not a second copy of the same week)`);
}

// ==================================================================== 12
line('');
line('=== 12. term `until` mid-week vs a due weekday later that week ===');
{
  const rows = [
    ['term ends Tue 15 Dec, due Friday', { from: '2026-09-01', until: '2026-12-15', dueDay: 'fri' }],
    ['term ends Fri 18 Dec, due Tuesday', { from: '2026-09-01', until: '2026-12-18', dueDay: 'tue' }],
  ];
  line(`  2026-12-14 is a ${dow('2026-12-14')}, 12-15 ${dow('2026-12-15')}, 12-18 ${dow('2026-12-18')}`);
  for (const [name, data] of rows) {
    const s = base();
    const c = s.addCommitment({ title: 'Course', tags: ['course'], amountMinPerWeek: 240, minSitting: 60, maxSitting: 120, maxPerDay: 1, ...data });
    const inp = c.engineInputForWeek(dateFromKey('2026-12-14'), at('2026-12-14', '08:00'));
    const lastUsable = inp ? dateKey(new Date(inp.until.getTime() - 1)) : 'n/a';
    const res = layOutWeek(s, dateFromKey('2026-12-14'), at('2026-12-14', '08:00'));
    line(`  ${name}`);
    line(`     lastUsableDay=${lastUsable} (${dow(lastUsable)})   placed: ${res[0] ? res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${dateKey(t.startTime)}`).join(', ') : '(none)'} short=${res[0] ? res[0].shortfall : '-'}m`);
    const past = res[0] && res[0].sittings.some((t) => dateKey(t.startTime) > lastUsable);
    line(`     any sitting past the last usable day? ${past ? 'YES — BUG' : 'no'}`);
  }
}

// ==================================================================== 17
line('');
line('=== 17. delete sittings by hand, then press Lay out again ===');
{
  const WS = dateFromKey('2026-09-07');
  const now = at('2026-09-07', '08:00');
  const mk = () => {
    const s = base();
    s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 240, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
    layOutWeek(s, WS, now);
    return s;
  };
  // (a) delete ALL
  const a = mk();
  const cA = a.commitments[0];
  const madeA = a.sittingsFor(cA.id, WS);
  line(`  laid out ${madeA.length} sittings (${madeA.reduce((n, t) => n + t.getDuration(), 0)}m)`);
  for (const t of [...madeA]) a.removeTask(t.id);
  line(`  after deleting ALL: preview = ${previewWeek(a, WS, now).map((p) => `${p.state} placed=${p.placedMin}m`).join()}`);
  const again = layOutWeek(a, WS, now);
  line(`  press again -> re-added ${again[0] ? again[0].sittings.length : 0} sittings  => work the user deleted comes BACK`);
  // (b) delete ONE
  const b = mk();
  const cB = b.commitments[0];
  const madeB = b.sittingsFor(cB.id, WS);
  b.removeTask(madeB[0].id);
  const pvB = previewWeek(b, WS, now)[0];
  line(`  after deleting ONE: state=${pvB.state} placed=${pvB.placedMin}m of owed=${pvB.owedMin}m`);
  const againB = layOutWeek(b, WS, now);
  line(`  press again -> ${againB.length ? 'topped up' : 'NO-OP — the missing hour is never offered again'}`);
}

// ==================================================================== 25
line('');
line('=== 25. leap day, week of Mon 28 Feb 2028 ===');
{
  line(`  2028-02-28 is a ${dow('2028-02-28')}; 2028-02-29 is a ${dow('2028-02-29')}; 2028-03-05 is a ${dow('2028-03-05')}`);
  const s = base();
  const c = s.addCommitment({ title: 'Revision', tags: ['rev'], from: '2028-02-01', until: '2028-04-01', amountMinPerWeek: 300, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
  const now = at('2028-02-28', '08:00');
  const res = layOutWeek(s, dateFromKey('2028-02-28'), now);
  line(`  laid: ${res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${dateKey(t.startTime)}`).join(', ')} short=${res[0].shortfall}m`);
  line(`  29 Feb used? ${res[0].sittings.some((t) => dateKey(t.startTime) === '2028-02-29') ? 'yes' : 'no'}`);
  line(`  sittingsFor(week) = ${s.sittingsFor(c.id, dateFromKey('2028-02-28')).length} of ${res[0].sittings.length}`);
  s.addDayNote({ label: 'Leap day', from: '2028-02-29', to: '2028-02-29', kind: 'holiday' });
  line(`  notesForDate(29 Feb) = ${s.notesForDate(dateFromKey('2028-02-29')).map((n) => n.label).join() || '(none)'}`);
  line(`  blockDay/isDayBlocked(29 Feb) = ${s.blockDay(dateFromKey('2028-02-29'))} / ${s.isDayBlocked(dateFromKey('2028-02-29'))}`);
}

// ==================================================================== 27
line('');
line('=== 27. a multi-day day note straddling Sunday ===');
{
  line(`  2026-11-21 is a ${dow('2026-11-21')}, 11-22 ${dow('2026-11-22')}, 11-25 ${dow('2026-11-25')}`);
  const s = base();
  const n = s.addDayNote({ label: 'Reading week', from: '2026-11-21', to: '2026-11-25', kind: 'note' });
  line(`  dayCount=${n.dayCount}`);
  for (const k of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-25', '2026-11-26']) {
    line(`    ${k} ${dow(k)}: ${s.notesForDate(dateFromKey(k)).map((x) => x.label).join() || '—'}`);
  }
  const w1 = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
  const w2 = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
  line(`  week of 16 Nov covers: ${w1.filter((k) => s.notesForDate(dateFromKey(k)).length).join(', ')}`);
  line(`  week of 23 Nov covers: ${w2.filter((k) => s.notesForDate(dateFromKey(k)).length).join(', ')}`);
  const rt = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON()))).dayNotes[0];
  line(`  round-trip: ${rt.label} ${rt.from}..${rt.to} dayCount=${rt.dayCount}`);
}

// ==================================================================== 28
line('');
line('=== 28. two commitments with the SAME title ===');
{
  const WS = dateFromKey('2026-09-07');
  const now = at('2026-09-07', '08:00');
  const s = base();
  const a = s.addCommitment({ title: 'Seminar prep', tags: ['sem'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 180, minSitting: 60, maxSitting: 180, maxPerDay: 1 });
  const b = s.addCommitment({ title: 'Seminar prep', tags: ['sem'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 180, minSitting: 60, maxSitting: 180, maxPerDay: 1 });
  line(`  ids: ${a.id} / ${b.id}  (distinct? ${a.id !== b.id})`);
  const r1 = layOutWeek(s, WS, now);
  line(`  press #1: ${r1.map((r) => `${r.commitment.id}->${r.sittings.map((t) => dow(dateKey(t.startTime))).join('')}`).join('  ')}`);
  line(`  sittingsFor A=${s.sittingsFor(a.id, WS).length} B=${s.sittingsFor(b.id, WS).length}`);
  const r2 = layOutWeek(s, WS, now);
  line(`  press #2: ${r2.length ? r2.map((r) => r.commitment.id).join() : '(no-op)'}  total tasks=${s.tasks.length}`);
  const pv = previewWeek(s, WS, now);
  line(`  preview: ${pv.map((p) => `${p.commitment.id}=${p.state}`).join('  ')}`);
}

// ==================================================================== 31
line('');
line('=== 31. TA session runs past the day window (Wed 16:30-18:50, window ends 18:00) ===');
{
  const s = base({ windows: { monFri: { start: '08:00', end: '18:00' } } });
  const ta = s.addFixed({ title: 'TA session', tags: ['ta'], pinned: true, startTime: at('2026-09-09', '16:30'), durationMin: 140 });
  const c = s.addCommitment({ title: 'TA prep', tags: ['ta'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 540, minSitting: 60, maxSitting: 180, maxPerDay: 1 });
  const now = at('2026-09-07', '08:00');
  const res = layOutWeek(s, dateFromKey('2026-09-07'), now);
  line(`  TA session ${fmt(ta.startTime)} -> ${formatHHMM(ta.endTime)} (140m, 50m of it past the 18:00 window)`);
  line(`  laid: ${res[0].sittings.map((t) => `${dow(dateKey(t.startTime))} ${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(', ')} short=${res[0].shortfall}m`);
  const clash = res[0].sittings.filter((t) => t.overlaps(ta));
  line(`  any sitting overlapping the TA session? ${clash.length ? `YES — ${clash.map((t) => fmt(t.startTime)).join()}` : 'no'}`);
  line(`  conservation: placed ${res[0].sittings.reduce((n, t) => n + t.getDuration(), 0)}m + short ${res[0].shortfall}m = ${res[0].sittings.reduce((n, t) => n + t.getDuration(), 0) + res[0].shortfall}m (owed ${c.amountMinPerWeek}m)`);
}

// ==================================================================== 40
line('');
line('=== 40. a legacy 08:00-18:00 whole-day blocker TASK after widening to 06:00-23:00 ===');
{
  const s = base({ windows: { monFri: { start: '06:00', end: '23:00' } } });
  const blocker = s.addFixed({ title: 'Blocked', tags: ['rest'], pinned: true, startTime: at('2026-09-09', '08:00'), durationMin: 10 * 60 });
  line(`  legacy blocker task: ${fmt(blocker.startTime)} -> ${formatHHMM(blocker.endTime)}  protected-tag=${blocker.hasProtectedTag(s.config.protectedTags)}`);
  line(`  schedule.isDayBlocked(9 Sep) = ${s.isDayBlocked(dateFromKey('2026-09-09'))}   <- the day-header tint reads THIS`);
  const c = s.addCommitment({ title: 'Work', tags: ['work'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 240, minSitting: 60, maxSitting: 120, maxPerDay: 2 });
  const res = layOutWeek(s, dateFromKey('2026-09-07'), at('2026-09-07', '07:00'));
  const onWed = res[0].sittings.filter((t) => dateKey(t.startTime) === '2026-09-09');
  line(`  laid on Wed 9 Sep: ${onWed.map((t) => `${formatHHMM(t.startTime)}/${t.getDuration()}m`).join(', ') || '(none)'}`);
  line(`  -> the day LOOKS blocked (a 10h card) but is NOT blocked; 06:00-08:00 and 18:00-23:00 are schedulable.`);
  line(`     overlaps the blocker card? ${onWed.some((t) => t.overlaps(blocker)) ? 'YES' : 'no'}`);
}

// ==================================================================== 43
line('');
line('=== 43. from == until == a blocked day ===');
{
  line(`  2026-11-27 is a ${dow('2026-11-27')}`);
  const s = base();
  s.blockDay(dateFromKey('2026-11-27'));
  const c = s.addCommitment({ title: 'One-off', tags: ['x'], from: '2026-11-27', until: '2026-11-27', amountMinPerWeek: 180, minSitting: 60, maxSitting: 180 });
  const now = at('2026-11-23', '08:00');
  const pv = previewWeek(s, dateFromKey('2026-11-23'), now);
  line(`  preview: state=${pv[0].state} owed=${pv[0].owedMin}m`);
  const p = planWeek(s, dateFromKey('2026-11-23'), now);
  line(`  planWeek: ${p.map((r) => `rho=${r.rho === Infinity ? 'Inf' : r.rho.toFixed(2)} sittings=${r.sittings.length} short=${r.shortfall}m`).join()}`);
  const res = layOutWeek(s, dateFromKey('2026-11-23'), now);
  line(`  layOutWeek: sittings=${res[0].sittings.length} short=${res[0].shortfall}m  tasks written=${s.tasks.length}`);
  const again = layOutWeek(s, dateFromKey('2026-11-23'), now);
  line(`  press again: ${again.length ? `still owes, short=${again[0].shortfall}m — the same 3h is restated every press` : '(no-op)'}`);
}

// ==================================================================== 46
line('');
line('=== 46. two devices lay out the same week, then sync ===');
{
  const WS = dateFromKey('2026-09-07');
  const now = at('2026-09-07', '08:00');
  const seed = () => {
    const s = base();
    s.addCommitment({ title: 'Maths', tags: ['maths'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 240, minSitting: 60, maxSitting: 120, maxPerDay: 1 });
    return s;
  };
  const A = seed(); const B = Schedule.fromJSON(JSON.parse(JSON.stringify(A.toJSON())));
  layOutWeek(A, WS, now);
  // Device B is offline and adds something of its own first, then lays out.
  B.addFixed({ title: 'Dentist', pinned: true, startTime: at('2026-09-09', '10:00'), durationMin: 60 });
  layOutWeek(B, WS, now);
  const idsA = A.tasks.map((t) => t.id);
  const idsB = B.tasks.map((t) => t.id);
  line(`  A tasks: ${idsA.join(', ')}`);
  line(`  B tasks: ${idsB.join(', ')}`);
  line(`  ids generated on BOTH devices for DIFFERENT sittings: ${idsA.filter((i) => idsB.includes(i)).join(', ') || '(none)'}`);
  // The app's only sync is footlocker import, which REPLACES.
  const merged = Schedule.fromJSON(JSON.parse(JSON.stringify(B.toJSON())));
  line(`  import B over A (useEngine#replace semantics): A's ${A.tasks.length} tasks -> ${merged.tasks.length}; A's Dentist survives? ${merged.tasks.some((t) => t.title === 'Dentist')}`);
  line(`  A's own sittings survive the import? ${idsA.every((i) => merged.tasks.some((t) => t.id === i)) ? 'yes' : 'NO — silently discarded, with no conflict signal'}`);
  // What a naive id-keyed merge would do:
  const naive = Schedule.fromJSON({ schemaVersion: 1, tasks: [...A.toJSON().tasks, ...B.toJSON().tasks], commitments: A.toJSON().commitments });
  line(`  naive concat merge -> ${naive.tasks.length} tasks; duplicate-id repair reissued ${naive.tasks.filter((t, i) => naive.tasks.findIndex((x) => x.title === t.title && x.startTime.getTime() === t.startTime.getTime()) !== i).length} same-slot duplicates`);
  line(`  sittingsFor(Maths) after concat = ${naive.sittingsFor(naive.commitments[0].id, WS).length} (was ${A.sittingsFor(A.commitments[0].id, WS).length})`);
}
