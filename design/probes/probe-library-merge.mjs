// probe-library-merge.mjs — the two import doors, side by side on the same file.
//
// The question a footlocker file cannot answer is which of these you meant:
//
//   RESTORE  — my old setup, exactly. Tasks survive, everything else is theirs.
//   ADD      — the activities I am missing. Everything I have survives.
//
// So both exist, and this prints what each does to the SAME schedule from the
// SAME file, because the difference is the whole point and a sentence about it
// is not evidence.
//
//     node design/probes/probe-library-merge.mjs
import {
  Schedule, defaultConfig, planLibraryMerge, applyLibraryMerge, applyLibrary,
} from '../../src/core/index.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

// ── The old save: a well-built activity library ─────────────────────────────
const old = new Schedule({ config: defaultConfig });
const oldStudy = old.addBucket({ label: 'Study', tags: ['study'], colour: '#88aacc' });
const oldBody = old.addBucket({ label: 'Body', tags: ['gym'], colour: '#cc8888' });
old.addActivity({ label: 'Read a paper', bucketId: oldStudy.id, durationMin: 45 });
old.addActivity({ label: 'Problem set', bucketId: oldStudy.id, durationMin: 90 });
old.addActivity({ label: 'Swim', bucketId: oldBody.id, durationMin: 60 });
old.addZone({ label: 'Old work', tags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '17:00' }] });
const file = old.toJSON();

// ── This term: some overlap, some of my own, and a week I care about ────────
const makeNow = () => {
  const s = new Schedule({ config: defaultConfig });
  const study = s.addBucket({ label: 'study', tags: ['study'] });   // same name, different case
  s.addBucket({ label: 'Thesis', tags: ['thesis'] });
  s.addActivity({ label: 'read a paper', bucketId: study.id, durationMin: 45 }); // already have it
  s.addFixed({
    title: 'Orientation',
    startTime: new Date(2026, 8, 7, 9),
    endTime: new Date(2026, 8, 7, 10),
  });
  s.addZone({ label: 'This term work', tags: ['work'], windows: [{ day: 'tue', start: '09:00', end: '17:00' }] });
  return s;
};

console.log('=== WHAT I HAVE NOW ===\n');
const before = makeNow();
console.log(`  buckets     ${before.buckets.map((b) => b.label).join(', ')}`);
console.log(`  activities  ${before.activities.map((a) => a.label).join(', ')}`);
console.log(`  zones       ${before.zones.map((z) => z.label).join(', ')}`);
console.log(`  tasks       ${before.tasks.map((t) => t.title).join(', ')}\n`);

console.log('=== DOOR 1 — ADD WHAT IS MISSING ===\n');
const addTo = makeNow();
const plan = planLibraryMerge(addTo, file);
console.log(`  it would add ${plan.activityCount} activities and ${plan.bucketCount} buckets,`);
console.log(`  and skip ${plan.skippedCount} it already has: ${plan.skipped.map((s) => s.label).join(', ') || '(none)'}\n`);

const r = applyLibraryMerge(addTo, file);
console.log(`  buckets     ${addTo.buckets.map((b) => b.label).join(', ')}`);
console.log(`  activities  ${addTo.activities.map((a) => a.label).join(', ')}`);
console.log(`  zones       ${addTo.zones.map((z) => z.label).join(', ')}`);
console.log(`  tasks       ${addTo.tasks.map((t) => t.title).join(', ')}\n`);

check('the plan and the result agree', r.activitiesAdded === plan.activityCount,
  `${r.activitiesAdded} vs ${plan.activityCount}`);
check('"read a paper" was NOT duplicated — case-insensitive, within its bucket',
  addTo.activities.filter((a) => a.label.toLowerCase() === 'read a paper').length === 1);
check('the missing activities arrived', ['Problem set', 'Swim'].every((l) => addTo.activities.some((a) => a.label === l)));
check('the bucket "Swim" needed came with it', addTo.buckets.some((b) => b.label === 'Body'));
check('my "study" bucket was REUSED, not duplicated',
  addTo.buckets.filter((b) => b.label.toLowerCase() === 'study').length === 1,
  addTo.buckets.map((b) => b.label).join(', '));
check('"Problem set" landed IN my existing study bucket',
  (addTo.activities.find((a) => a.label === 'Problem set') || {}).bucketId
    === (addTo.buckets.find((b) => b.label.toLowerCase() === 'study') || {}).id);
check('my own bucket survived', addTo.buckets.some((b) => b.label === 'Thesis'));
check('MY TASKS ARE UNTOUCHED', addTo.tasks.length === 1 && addTo.tasks[0].title === 'Orientation');
check('my zone is untouched, and theirs did NOT come', addTo.zones.length === 1 && addTo.zones[0].label === 'This term work',
  addTo.zones.map((z) => z.label).join(', '));

console.log('=== DOOR 2 — RESTORE THE WHOLE SETUP ===\n');
const restoreTo = makeNow();
applyLibrary(restoreTo, file);
console.log(`  buckets     ${restoreTo.buckets.map((b) => b.label).join(', ')}`);
console.log(`  activities  ${restoreTo.activities.map((a) => a.label).join(', ')}`);
console.log(`  zones       ${restoreTo.zones.map((z) => z.label).join(', ')}`);
console.log(`  tasks       ${restoreTo.tasks.map((t) => t.title).join(', ')}\n`);

check('the old setup is exactly restored', restoreTo.activities.length === 3);
check('their zone replaced mine', restoreTo.zones.length === 1 && restoreTo.zones[0].label === 'Old work');
check('⚠️ my "Thesis" bucket is GONE — which is what restore MEANS',
  !restoreTo.buckets.some((b) => b.label === 'Thesis'));
check('MY TASKS ARE STILL UNTOUCHED', restoreTo.tasks.length === 1 && restoreTo.tasks[0].title === 'Orientation');

console.log('=== RUNNING IT TWICE MUST BE A NO-OP ===\n');
const twice = makeNow();
applyLibraryMerge(twice, file);
const afterOne = twice.activities.length;
const second = applyLibraryMerge(twice, file);
console.log(`  first pass: ${afterOne} activities · second pass added ${second.activitiesAdded}\n`);
check('a second import adds nothing', second.activitiesAdded === 0 && twice.activities.length === afterOne,
  `${twice.activities.length} after, was ${afterOne}`);

console.log('=== AND A FILE THAT IS NOT ONE ===\n');
check('refuses junk', planLibraryMerge(makeNow(), { nope: true }).valid === false);
check('refuses a wrong schemaVersion', planLibraryMerge(makeNow(), { schemaVersion: 9 }).valid === false);
check('says why', typeof planLibraryMerge(makeNow(), {}).reason === 'string');

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
