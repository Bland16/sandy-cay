// probe-routines.mjs — R-B, printed rather than argued.
//
// The spec's own cases: laundry (two waits), the gym (travel lead-in), waffles
// (a 5-minute wait that cannot host a 30-minute shower), and concurrency
// (dishwasher + oven, whose waits overlap for free).
//
//   node design/probes/probe-routines.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { Activity } from '../../src/core/Activity.js';
import { defaultConfig } from '../../src/core/config.js';
import { instantiateRoutine, reflowRoutine, suggestRoutineStart } from '../../src/core/routines.js';
import { addMinutes, dateKey } from '../../src/core/time.js';
import { resetIds } from '../../src/core/ids.js';

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const DAY = new Date(2026, 8, 7);
const at = (h, m = 0) => { const d = new Date(DAY); d.setHours(h, m, 0, 0); return d; };

const LAUNDRY = new Activity({
  label: 'Laundry',
  tags: ['chores'],
  steps: [
    { label: 'load', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'wash', kind: 'passive', durationMin: 45 },
    { label: 'switch', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'dry', kind: 'passive', durationMin: 60 },
    { label: 'fold', kind: 'active', durationMin: 10, durationMax: 15 },
  ],
});

function show(s, id, label) {
  console.log(`   ${label}`);
  for (const t of s.touchpointsFor(id)) {
    console.log(`      step ${t.stepIndex}  ${hhmm(t.startTime)}–${hhmm(t.endTime)}  ${t.title}`);
  }
}

console.log('='.repeat(70));
console.log('1 — LAUNDRY at 19:00. Three touchpoints, two waits, 14m of attention.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const { instance, touchpoints, clashes } = instantiateRoutine(s, LAUNDRY, at(19));
  show(s, instance.id, `elapsed ${instance.spanMin}m · attention ${instance.attentionMin}m · clashes ${clashes.length}`);
  console.log(`      waits: ${instance.waits().map((w) => `${w.fromMin}→${w.toMin}m`).join(', ')}`);
  console.log(`      tasks are fixed anchors? ${touchpoints.every((t) => t.type === 'fixed')}`);
}

console.log(`\n${'='.repeat(70)}`);
console.log('2 — THE WAIT IS FREE. Dinner drops inside the wash and nothing breaks.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const { instance } = instantiateRoutine(s, LAUNDRY, at(19));
  s.addFixed({ title: 'Dinner', tags: ['food'], startTime: at(19, 10), endTime: at(19, 40) });
  show(s, instance.id, 'after dropping dinner 19:10–19:40 (inside the 45m wash)');
  console.log('      ↑ untouched: a wait is not a task, so there was nothing to collide with');
}

console.log(`\n${'='.repeat(70)}`);
console.log('3 — RE-FLOW. Drag "switch" LATER; the rest follows. Drag it EARLIER;');
console.log('    it moves alone, because the machine is not finished (R-1).');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const { instance } = instantiateRoutine(s, LAUNDRY, at(19));
  const chain = s.touchpointsFor(instance.id);
  const sw = chain[1];

  sw.startTime = at(20, 30); sw.endTime = addMinutes(sw.startTime, 2);
  const later = reflowRoutine(s, instance.id, { movedStepIndex: sw.stepIndex });
  show(s, instance.id, `switch dragged to 20:30 → ${later.moved.length} following touchpoint(s) pushed`);

  const chain2 = s.touchpointsFor(instance.id);
  const foldWas = hhmm(chain2[2].startTime);
  chain2[1].startTime = at(19, 10); chain2[1].endTime = addMinutes(chain2[1].startTime, 2);
  const earlier = reflowRoutine(s, instance.id, { movedStepIndex: chain2[1].stepIndex });
  console.log(`   switch dragged BACK to 19:10 → ${earlier.moved.length} moved (fold stays at ${foldWas})`);
  show(s, instance.id, '');
}

console.log(`\n${'='.repeat(70)}`);
console.log('4 — WAFFLES. A 5-minute wait cannot host a 30-minute shower.');
console.log('    R-1: warn, never refuse. "as long as I have the ability to place it"');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const waffles = new Activity({
    label: 'Waffles',
    steps: [
      { label: 'in the air fryer', kind: 'active', durationMin: 2 },
      { label: 'cooking', kind: 'passive', durationMin: 5, maxWaitMin: 10 },
      { label: 'eat', kind: 'active', durationMin: 10 },
    ],
  });
  const { instance } = instantiateRoutine(s, waffles, at(8));
  show(s, instance.id, 'as programmed');
  const chain = s.touchpointsFor(instance.id);
  // The shower goes in anyway — that is the user's hand.
  chain[1].startTime = at(8, 37); chain[1].endTime = addMinutes(chain[1].startTime, 10);
  const r = reflowRoutine(s, instance.id, { movedStepIndex: chain[0].stepIndex });
  show(s, instance.id, 'after putting a 30m shower in the gap');
  for (const w of r.warnings) {
    console.log(`      ⚠ "${w.label}" waited ${w.waitedMin}m, past its ${w.maxWaitMin}m — cold waffles`);
  }
  console.log(`      refused? ${r.warnings.length ? 'NO — stated only' : 'n/a'}`);
}

console.log(`\n${'='.repeat(70)}`);
console.log('5 — CONCURRENCY. Dishwasher and oven waits overlap, for free.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const dish = new Activity({ label: 'Dishwasher', steps: [
    { label: 'load', kind: 'active', durationMin: 5 },
    { label: 'run', kind: 'passive', durationMin: 90 },
    { label: 'unload', kind: 'active', durationMin: 5 },
  ] });
  const oven = new Activity({ label: 'Oven', steps: [
    { label: 'preheat on', kind: 'active', durationMin: 2 },
    { label: 'heating', kind: 'passive', durationMin: 15 },
    { label: 'food in', kind: 'active', durationMin: 3 },
    { label: 'cooking', kind: 'passive', durationMin: 40 },
    { label: 'take out', kind: 'active', durationMin: 3 },
  ] });
  const a = instantiateRoutine(s, dish, at(18));
  const b = instantiateRoutine(s, oven, at(18, 10));
  show(s, a.instance.id, `dishwasher · clashes ${a.clashes.length}`);
  show(s, b.instance.id, `oven · clashes ${b.clashes.length}`);
  console.log('      ↑ both waits are running at once; only the touchpoints are anchors');
}

console.log(`\n${'='.repeat(70)}`);
console.log('6 — SUGGEST a start. The gym, with travel, into a busy evening.');
console.log('='.repeat(70));
{
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({ title: 'Class', tags: ['classes'], startTime: at(9), endTime: at(12) });
  s.addFixed({ title: 'Seminar', tags: ['classes'], startTime: at(13), endTime: at(17) });
  const gym = new Activity({ label: 'Gym', tags: ['gym'], travelMin: 15, durationMin: 45, durationMax: 60 });
  const when = suggestRoutineStart(s, gym, at(8));
  console.log(`   gym needs ${gym.span().min}m contiguous (travel 15 + workout 45)`);
  console.log(`   suggested start: ${when ? `${dateKey(when)} ${hhmm(when)}` : '(nothing fits)'}`);
  if (when) {
    const { instance, clashes } = instantiateRoutine(s, gym, when);
    show(s, instance.id, `placed · clashes ${clashes.length}`);
  }
}
