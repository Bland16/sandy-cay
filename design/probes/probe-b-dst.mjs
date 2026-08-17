// probe-b-dst.mjs — scenarios 8 & 9. Does a DST week's open minutes differ from
// an identical non-DST week, and does that move which days commitments pick?
// Run under several zones:  TZ=America/New_York node design/probes/probe-b-dst.mjs
//                           TZ=Europe/London    node design/probes/probe-b-dst.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { previewWeek, layOutWeek } from '../../src/core/commitmentWeek.js';
import { generateAll } from '../../src/core/generate.js';
import { openMinutesFor, runwayEnd } from '../../src/core/generate.js';
import { dateFromKey, dateKey, formatHHMM, dayStart, addDays, weekStart } from '../../src/core/time.js';
import { dayCapacityMin, computeWindows } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const dow = (k) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateFromKey(k).getDay()];
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const base = (cfg) => new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 }, ...cfg } });

line(`TZ = ${process.env.TZ || '(unset)'} — resolved: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
line('');

/** True clock-length of a local day, in minutes. 1440 normally; 1380/1500 on a
 *  DST day. */
const dayMinutes = (d) => Math.round((addDays(dayStart(d), 1).getTime() - dayStart(d).getTime()) / 60000);

function weekTable(cfg, wsKey) {
  const s = base(cfg);
  const ws = dateFromKey(wsKey);
  const rows = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(ws, i);
    const wins = computeWindows(s, { tags: [], deadline: null }, d);
    const open = wins.reduce((n, w) => n + Math.round((w.end - w.start) / 60000), 0);
    rows.push({ key: dateKey(d), dow: dow(dateKey(d)), dayMin: dayMinutes(d), cap: dayCapacityMin(s.config, d), open });
  }
  return rows;
}

function report(label, cfg, wsKey, controlKey) {
  line(`--- ${label} ---`);
  const a = weekTable(cfg, wsKey);
  const b = weekTable(cfg, controlKey);
  line(`  week of ${wsKey} (test)      vs  week of ${controlKey} (control)`);
  for (let i = 0; i < 7; i += 1) {
    const flag = a[i].dayMin !== 1440 ? `  <-- ${a[i].dayMin}-minute day (DST)` : '';
    const delta = a[i].open - b[i].open;
    line(`    ${a[i].dow} ${a[i].key}  dayLen=${a[i].dayMin}  cap=${a[i].cap}  open=${a[i].open}`
      + `   | control ${b[i].dow} open=${b[i].open}  delta=${delta > 0 ? '+' : ''}${delta}${flag}`);
  }
  const ta = a.reduce((n, r) => n + r.open, 0);
  const tb = b.reduce((n, r) => n + r.open, 0);
  line(`  week open total: test=${ta}  control=${tb}  delta=${ta - tb} min`);
  return { a, b };
}

function planPair(label, cfg, wsKey, controlKey, commitments) {
  const mk = (ws) => {
    const s = base(cfg);
    for (const c of commitments) s.addCommitment({ ...c, from: '2026-01-01', until: '2028-01-01' });
    return { s, ws: dateFromKey(ws) };
  };
  const run = (ws) => {
    const { s, ws: W } = mk(ws);
    const now = at(ws, '07:00');
    const inputs = previewWeek(s, W, now).filter((p) => p.state === 'owes').map((p) => p.input);
    const res = generateAll(s, inputs, { now });
    return res.map((r) => ({
      title: r.commitment.title,
      rho: r.rho,
      days: r.sittings.map((t) => `${dow(dateKey(t.startTime))}${formatHHMM(t.startTime)}/${t.getDuration()}`),
      short: r.shortfall,
    }));
  };
  const A = run(wsKey); const B = run(controlKey);
  line(`  plan (${label}):`);
  for (let i = 0; i < A.length; i += 1) {
    line(`    ${A[i].title.padEnd(12)} test rho=${A[i].rho.toFixed(5)} ${A[i].days.join(' ')} short=${A[i].short}`);
    const m = B.find((x) => x.title === A[i].title);
    line(`    ${''.padEnd(12)} ctrl rho=${m.rho.toFixed(5)} ${m.days.join(' ')} short=${m.short}`);
  }
  const orderA = A.map((x) => x.title).join(' > ');
  const orderB = B.map((x) => x.title).join(' > ');
  line(`    pick order: test="${orderA}"  control="${orderB}"  ${orderA === orderB ? 'same' : 'DIFFERENT'}`);
  const shapeA = A.map((x) => `${x.title}:${x.days.map((d) => d.slice(0, 3)).join(',')}`).join('|');
  const shapeB = B.map((x) => `${x.title}:${x.days.map((d) => d.slice(0, 3)).join(',')}`).join('|');
  line(`    weekday shape identical? ${shapeA === shapeB ? 'yes' : `NO\n      test=${shapeA}\n      ctrl=${shapeB}`}`);
}

// ===================================================================== 8
line('=== 8. FALL BACK ===');
{
  const cfg = { windows: { monFri: { start: '08:00', end: '22:00' }, sat: { start: '08:00', end: '22:00' }, sun: { start: '08:00', end: '22:00' } } };
  // Both candidate transition weeks, so the probe is right in either zone.
  report('week of Mon 26 Oct 2026 (US fall-back Sun 1 Nov)', cfg, '2026-10-26', '2026-10-05');
  report('week of Mon 19 Oct 2026 (EU fall-back Sun 25 Oct)', cfg, '2026-10-19', '2026-10-05');
  const cs = [{ title: 'Alpha', tags: ['a'], amountMinPerWeek: 480, minSitting: 60, maxSitting: 300, maxPerDay: 1 },
    { title: 'Beta', tags: ['b'], amountMinPerWeek: 300, minSitting: 60, maxSitting: 300, maxPerDay: 1 }];
  planPair('26 Oct vs 5 Oct', cfg, '2026-10-26', '2026-10-05', cs);
  planPair('19 Oct vs 5 Oct', cfg, '2026-10-19', '2026-10-05', cs);
}

// ===================================================================== 9
line('');
line('=== 9. SPRING FORWARD ===');
{
  const cfg = { windows: { monFri: { start: '06:00', end: '23:00' }, sat: { start: '06:00', end: '23:00' }, sun: { start: '06:00', end: '23:00' } } };
  report('week of Mon 8 Mar 2027 (US spring-forward Sun 14 Mar)', cfg, '2027-03-08', '2027-02-15');
  report('week of Mon 22 Mar 2027 (EU spring-forward Sun 28 Mar)', cfg, '2027-03-22', '2027-02-15');
  const cs = [{ title: 'Alpha', tags: ['a'], amountMinPerWeek: 480, minSitting: 60, maxSitting: 300, maxPerDay: 1 },
    { title: 'Beta', tags: ['b'], amountMinPerWeek: 300, minSitting: 60, maxSitting: 300, maxPerDay: 1 }];
  planPair('8 Mar vs 15 Feb', cfg, '2027-03-08', '2027-02-15', cs);
  planPair('22 Mar vs 15 Feb', cfg, '2027-03-22', '2027-02-15', cs);
}

// ===================================================================== extra
line('');
line('=== extra: a window that SPANS the transition instant ===');
{
  // The transition is at 02:00 local. A window covering it is the only way the
  // hour can actually enter or leave a day's arithmetic.
  const cfg = { windows: { monFri: { start: '00:00', end: '06:00' }, sat: { start: '00:00', end: '06:00' }, sun: { start: '00:00', end: '06:00' } } };
  for (const [label, ws, ctrl] of [['fall back', '2026-10-26', '2026-10-05'], ['fall back EU', '2026-10-19', '2026-10-05'],
    ['spring fwd', '2027-03-08', '2027-02-15'], ['spring fwd EU', '2027-03-22', '2027-02-15']]) {
    const a = weekTable(cfg, ws); const b = weekTable(cfg, ctrl);
    const ta = a.reduce((n, r) => n + r.open, 0); const tb = b.reduce((n, r) => n + r.open, 0);
    const sun = a[6];
    line(`  ${label.padEnd(14)} 00:00-06:00 window: Sunday ${sun.key} open=${sun.open} (control ${b[6].open})  week delta=${ta - tb} min`);
  }
  line('  (a non-zero delta here means a DST week really does hold a different');
  line('   number of open minutes, which shifts Omega and therefore rho order.)');
}

// ===================================================================== sanity
line('');
line('=== sanity: day-length and week arithmetic across the transition ===');
{
  for (const k of ['2026-11-01', '2027-03-14', '2026-10-25', '2027-03-28']) {
    const d = dateFromKey(k);
    line(`  ${k} ${dow(k)}: dayLen=${dayMinutes(d)}min  weekStart=${dateKey(weekStart(d))}  +1day=${dateKey(addDays(d, 1))}  midnight=${formatHHMM(dayStart(d))}`);
  }
}
