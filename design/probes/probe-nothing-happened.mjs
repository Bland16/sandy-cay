// probe-nothing-happened.mjs — reported 2026-08-16.
//
// "I started the commitment in July and ended it in September, but nothing
// generated in the current week or at all, and there was no label or
// notification. Just nothing."
//
// The week of 10–16 Aug IS inside 1 Jul – 30 Sep, so the button should have
// been enabled and SOMETHING should have been said. Reproduce exactly.
//
//   node design/probes/probe-nothing-happened.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { previewWeek, planWeek, layOutWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, dateKey, addDays } from '../../src/core/time.js';

const WS = weekStart(new Date(2026, 7, 16)); // Mon 10 Aug 2026

function scheduleWith() {
  const s = new Schedule({ config: defaultConfig });
  // A few ordinary anchors, so this is not an empty calendar.
  for (const d of [0, 2, 4]) {
    const st = addDays(WS, d); st.setHours(9, 0, 0, 0);
    const en = addDays(WS, d); en.setHours(10, 0, 0, 0);
    s.addFixed({ title: `class ${d}`, tags: ['classes'], startTime: st, endTime: en });
  }
  s.addCommitment({
    title: 'Math homework',
    tags: ['study'],
    from: '2026-07-01',
    until: '2026-09-30',
    amountMinPerWeek: 120,
    minSitting: 30,
    maxSitting: 180,
    maxPerDay: 1,
  });
  return s;
}

function run(label, now) {
  console.log(`\n${'='.repeat(72)}\n${label}\n  now = ${dateKey(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} · week of ${dateKey(WS)}\n${'='.repeat(72)}`);
  const s = scheduleWith();

  let pre;
  try {
    pre = previewWeek(s, WS, now);
  } catch (e) { console.log(`  ✗ previewWeek THREW: ${e.message}`); return; }
  for (const p of pre) console.log(`  preview   ${p.state.toUpperCase()}  ${p.commitment.title}`);
  const owes = pre.filter((p) => p.state === 'owes');
  console.log(`  button    ${owes.length ? 'ENABLED' : 'DISABLED'}`);

  let plan;
  try {
    plan = planWeek(s, WS, now);
  } catch (e) { console.log(`  ✗ planWeek THREW: ${e.message}\n${e.stack}`); return; }
  console.log(`  plan      ${plan.length} result(s)`);
  for (const r of plan) {
    console.log(`     ${r.commitment.title}: ${r.sittings.length} sitting(s), shortfall ${r.shortfall}m`);
    for (const t of r.sittings) console.log(`        ${dateKey(t.startTime)} ${String(t.startTime.getHours()).padStart(2, '0')}:${String(t.startTime.getMinutes()).padStart(2, '0')} ${t.getDuration()}m`);
  }

  // What the handler would then DO.
  if (!plan.length) { console.log('  → toast "Nothing owed this week"; nothing else happens'); return; }
  console.log('  → confirm dialog would read:');
  for (const r of plan) {
    console.log(`        ${r.commitment.title} — ${r.commitment.amountMin}m`);
    if (r.shortfall) console.log(`            ${r.shortfall}m could not be fitted`);
  }
  const done = layOutWeek(s, WS, now);
  const placed = done.reduce((n, r) => n + r.sittings.length, 0);
  console.log(`  → accepted: placed ${placed} sitting(s)`);
}

run('A · Sunday night, the LAST day of the week, 22:40', new Date(2026, 7, 16, 22, 40));
run('B · Sunday morning, still the last day', new Date(2026, 7, 16, 9, 0));
run('C · Monday morning, a full week ahead', new Date(2026, 7, 10, 8, 0));
run('D · Wednesday midday', new Date(2026, 7, 12, 12, 0));
