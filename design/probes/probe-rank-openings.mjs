// probe-rank-openings.mjs — Find a time, ranked (design/FIND-A-TIME.md P1).
//
// The spec says the deliverable here is not a unit test: it is "here are five
// openings and why each ranked where it did", against a real-shaped afternoon.
// An ordering is the kind of thing that can be individually correct at every
// step and still put the wrong slot first, and only printing it shows that.
//
//     node design/probes/probe-rank-openings.mjs
import {
  Schedule, defaultConfig, addDays, formatHHMM,
  rankOpenings, modelCanSpeak, dipIfPlaced, loadForTask, draftFor,
} from '../../src/core/index.js';

// ⚠️ THE DAY, NOT JUST THE TIME. The first run of this probe printed bare times
// and an 11:00 slot looked like a same-day anomaly — it was TUESDAY, and that
// one missing word hid the finding in §3 completely.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (d) => `${DAYS[(d.getDay() + 6) % 7]} ${formatHHMM(d)}`;

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

const MON = new Date(2026, 8, 7);                    // Monday 7 Sep 2026
const at = (h, m = 0) => new Date(2026, 8, 7, h, m, 0, 0);

/** A day with a heavy mental morning and an easy afternoon. */
function makeDay() {
  const s = new Schedule({ config: defaultConfig });
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, physical: 0, social: 0, creative: 1 } });
  s.addBucket({ label: 'Admin', tags: ['admin'], load: { mental: 1, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'People', tags: ['people'], load: { mental: 1, physical: 0, social: 3, creative: 0 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: 0, social: 0, creative: 0 } });

  // A punishing morning of study, then lunch, then a light afternoon.
  s.addFixed({ title: 'Thesis reading', startTime: at(8), endTime: at(11), tags: ['study'] });
  s.addFixed({ title: 'Lunch', startTime: at(12), endTime: at(13), tags: ['rest'] });
  s.addFixed({ title: 'Email', startTime: at(15), endTime: at(15, 30), tags: ['admin'] });
  return s;
}

const s = makeDay();
const openings = s.findFreeSlots({
  from: MON, to: addDays(MON, 1), durationMin: 60, window: { start: '11:00', end: '18:00' },
});

console.log('=== THE DAY ===\n');
for (const t of s.getTasksForDay(MON)) {
  console.log(`  ${formatHHMM(t.startTime)}–${formatHHMM(t.endTime)}  ${t.title}  [${t.tags.join(', ')}]`);
}
console.log(`\n  openings between 11:00 and 18:00, 60 min: ${openings.length}`);
for (const o of openings) console.log(`    ${formatHHMM(o.start)}–${formatHHMM(o.end)}`);

console.log('\n=== 1. NO TAG — unchanged, chronological (today\'s behaviour) ===\n');
const plain = rankOpenings(s, openings, {});
console.log(`  rule: ${plain.rule}`);
for (const r of plain.rows) console.log(`    ${when(r.slot.start)}`);
check('the order is untouched without a tag',
  plain.rows.every((r, i) => r.slot.start.getTime() === openings[i].start.getTime()));
check('it is called what it is', plain.rule === 'time');

console.log('\n=== 2. A MENTAL THING, with no ratings yet ===\n');
// `study` spends mental hard, and the morning already spent 9 mental-hours.
const study = rankOpenings(s, openings, { tag: 'study', durationMin: 60 });
console.log(`  rule: ${study.rule}   (the model cannot speak: ${!modelCanSpeak(s, 'study')})\n`);
console.log('   slot        deeper  ends at  headroom  because');
for (const r of study.rows) {
  console.log(`    ${when(r.slot.start).padEnd(10)} ${String(r.impact.toFixed(2)).padStart(5)}  ${String(r.resulting.toFixed(2)).padStart(6)}   ${String(r.headroom.toFixed(2)).padStart(6)}   ${r.reason}`);
}
console.log('');
console.log('  ⚠️ THE FINDING THAT DECIDED F-4 — kept because it is the evidence.');
console.log('  "Least impact" has TWO readings and they DISAGREE:');
console.log('    deeper  = how much further THIS day bottoms out  (marginal)');
console.log('    ends at = how deep the day is left ALTOGETHER     (absolute)');
console.log('');
const byDeeper = [...study.rows].sort((a, b) => a.impact - b.impact).map((r) => when(r.slot.start));
const byEndsAt = [...study.rows].sort((a, b) => a.resulting - b.resulting).map((r) => when(r.slot.start));
console.log(`    ranked by "deeper":  ${byDeeper.join('  >  ')}`);
console.log(`    ranked by "ends at": ${byEndsAt.join('  >  ')}`);
console.log('');
console.log('    A Monday already deep in the red barely gets deeper, so the MARGINAL');
console.log('    reading recommended piling more onto the worst day of the week and');
console.log('    ranked the EMPTY TUESDAY LAST. Built that way first; the probe is');
console.log('    what caught it.');
console.log('');
console.log('    RESOLVED 2026-08-20 (F-4): the order is by "ends at". Both numbers');
console.log('    are still carried, and this section stays so the reason survives.');
console.log('');
check('it says it is ranking on energy', study.rule === 'energy');
check('every opening is still present — ranking never hides one',
  study.rows.length === openings.length, `${study.rows.length} of ${openings.length}`);
check('the day that ends up least drained comes first (F-4)',
  study.rows.every((r, i) => i === 0 || r.resulting >= study.rows[i - 1].resulting - 1e-9),
  study.rows.map((r) => r.resulting.toFixed(2)).join(' → '));
check('⚠️ and it does NOT recommend the day that is already wrecked',
  study.rows[0].resulting <= study.rows[study.rows.length - 1].resulting,
  `first ${when(study.rows[0].slot.start)} ends at ${study.rows[0].resulting.toFixed(2)}`);

console.log('\n=== 3. A SOCIAL THING, same day, different answer ===\n');
// Nothing has spent `social` today, so its dips are shallower and the ordering
// should NOT simply mirror the mental one.
const people = rankOpenings(s, openings, { tag: 'people', durationMin: 60 });
console.log('   slot    impact  headroom  because');
for (const r of people.rows) {
  console.log(`    ${when(r.slot.start)}   ${String(r.impact.toFixed(2)).padStart(5)}   ${String(r.headroom.toFixed(2)).padStart(6)}   ${r.reason}`);
}
// ⚠️ COMPARE THE NUMBERS, NOT THE ORDER. The first version of this check
// asserted the two orderings differed, which is not the claim: one opening can
// legitimately be the best answer for every tag, and on this fixture the empty
// Tuesday is. A check that passes or fails on something the feature never
// promised will one day fail for no reason — or pass while the tag is being
// ignored entirely, which is the thing it was meant to catch.
const keyed = (rows) => new Map(rows.map((r) => [when(r.slot.start), r]));
const mRows = keyed(study.rows);
const pRows = keyed(people.rows);
console.log('');
console.log('   slot        study ends at   people ends at');
for (const k of mRows.keys()) {
  const a = mRows.get(k).resulting.toFixed(2).padStart(8);
  const b = pRows.get(k).resulting.toFixed(2).padStart(8);
  console.log(`    ${k.padEnd(10)}  ${a}       ${b}`);
}
check('the tag reaches the arithmetic — the same slot scores differently',
  [...mRows.keys()].some((k) => mRows.get(k).resulting !== pRows.get(k).resulting),
  'if these were all equal the tag would not be reaching the score at all');

console.log('\n=== 4. A RESTORATIVE THING COSTS THE DAY NOTHING ===\n');
const rest = rankOpenings(s, openings, { tag: 'rest', durationMin: 60 });
console.log(`  every impact zero: ${rest.rows.every((r) => r.impact === 0)}`);
console.log(`  reason given: ${rest.rows[0].reason}`);
check('a restoring thing never deepens the dip', rest.rows.every((r) => r.impact === 0));
check('and says so rather than inventing a preference', rest.rows[0].reason === 'costs your day nothing');

console.log('\n=== 5. THE ARITHMETIC UNDERNEATH, spelled out ===\n');
const draft = draftFor({ tag: 'study', durationMin: 60 });
console.log(`  a 'study' hour loads: ${JSON.stringify(loadForTask(s, draft))}`);
const first = dipIfPlaced(s, openings[0], draft);
console.log(`  placing it at ${when(openings[0].start)}:`);
console.log(`    deepest dip before: ${JSON.stringify(first.before)}`);
console.log(`    deepest dip after:  ${JSON.stringify(first.after)}`);
console.log(`    deeper by:          ${JSON.stringify(first.deeper)}  total ${first.total.toFixed(2)}`);
check('the dip can only get deeper, never shallower', first.total >= 0);

console.log('\n=== 6. AND ONCE THE MODEL HAS SOMETHING TO SAY ===\n');
console.log(`  before any ratings, modelCanSpeak('study') = ${modelCanSpeak(s, 'study')}`);
console.log('  ↑ gated by config.coldStartRatings AND the tag being in the model\'s');
console.log('    vocabulary, both read off the model rather than chosen here.\n');
check('an untrained model does NOT claim to know your preferences', !modelCanSpeak(s, 'study'));
check('and an unknown tag never would', !modelCanSpeak(s, 'nonsense-tag'));

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
