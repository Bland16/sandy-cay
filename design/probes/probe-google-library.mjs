// probe-google-library.mjs — the half of a schedule that is not an appointment,
// packed into hidden calendar events. P1 of design/GOOGLE-AS-STORAGE.md.
//
//     node design/probes/probe-google-library.mjs
import { Schedule, defaultConfig, seed } from '../../src/core/index.js';
import {
  encodeLibrary, decodeLibrary, libraryFrom, libraryFootprint, missingFromLibrary,
  LIBRARY_KEYS, MAX_BYTES_PER_EVENT, MAX_PROPS_PER_EVENT,
  GOOGLE_BYTES_PER_EVENT, GOOGLE_PROPS_PER_EVENT, LIBRARY_VERSION,
} from '../../src/core/googleLibrary.js';
import { byteLength } from '../../src/core/googleEncode.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'OK  ' : '**FAIL**'} ${label}${extra ? `  ${extra}` : ''}`);
};
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// A term-scale schedule, the shape HANDOFF describes: 11 buckets, 49
// activities, 37 tasks, 21 day notes. Built to MEASURE, never committed.
function termScale() {
  const s = new Schedule({ config: defaultConfig });
  for (let i = 0; i < 11; i += 1) {
    s.addBucket({ label: `Bucket ${i}`, tags: [`tag${i}`, `alt${i}`], load: { physical: 1, mental: -1, social: 0, emotional: 1 } });
  }
  for (let i = 0; i < 49; i += 1) {
    s.addActivity({ label: `Activity number ${i}`, tags: [`tag${i % 11}`], durationMin: 45, priority: 3 });
  }
  const base = new Date(2026, 7, 31, 9, 0, 0, 0);
  for (let i = 0; i < 37; i += 1) {
    const st = new Date(base.getTime() + i * 43200000);
    s.addFixed({ title: `Scheduled thing ${i}`, startTime: st, endTime: new Date(st.getTime() + 3600000), tags: [`tag${i % 11}`] });
  }
  for (let i = 0; i < 21; i += 1) {
    s.addDayNote({ date: `2026-09-${String(1 + i).padStart(2, '0')}`, label: `Day note ${i}` });
  }
  return s;
}

console.log('=== 1. NOTHING FALLS THROUGH THE GAP ===\n');
console.log('  Every key a Schedule serialises is either a library key or a task.');
console.log('  A new collection nobody wired here would vanish on every sync.\n');
const s = termScale();
const json = s.toJSON();
const missing = missingFromLibrary(json);
console.log(`  schedule keys : ${Object.keys(json).join(', ')}`);
console.log(`  library keys  : ${LIBRARY_KEYS.join(', ')}`);
check('no key is unaccounted for', missing.length === 0, missing.length ? `MISSING: ${missing.join(', ')}` : '');

console.log('\n=== 2. WHAT IT COSTS TODAY ===\n');
const foot = libraryFootprint(json);
console.log(`  ${foot.events} event(s), ${foot.props} properties, ${kb(foot.bytes)}`);
console.log(`  ceiling per event: ${kb(GOOGLE_BYTES_PER_EVENT)} / ${GOOGLE_PROPS_PER_EVENT} props (Google)`);
console.log(`  our own cut:       ${kb(MAX_BYTES_PER_EVENT)} / ${MAX_PROPS_PER_EVENT} props`);
check('a term-scale library fits in one event today', foot.events === 1);
// Reported, NOT asserted against an invented threshold. The number is the
// point: measured at 16.1 KB, half of one event is already gone, where the spec
// estimated 12.4 KB from raw key sizes and did not count property keys or the
// JSON wrapper. So the multi-event split below is a near-term certainty, not
// insurance.
console.log(`  headroom: ${(100 - foot.bytes / GOOGLE_BYTES_PER_EVENT * 100).toFixed(1)}% `
  + `of one event left (${kb(GOOGLE_BYTES_PER_EVENT - foot.bytes)})`);

console.log('\n=== 3. ROUND TRIP ===\n');
const events = encodeLibrary(json);
const back = decodeLibrary(events);
check('decodes', back.ok, back.error || '');
check('is byte-identical to what went in',
  JSON.stringify(back.library) === JSON.stringify(libraryFrom(json)));
for (const k of LIBRARY_KEYS) {
  const a = JSON.stringify(libraryFrom(json)[k]);
  const b = JSON.stringify(back.library[k]);
  if (a !== b) check(`  key ${k}`, false, 'DIFFERS');
}
console.log(`  all ${LIBRARY_KEYS.length} keys survive`);

console.log('\n  and the seed, which carries a trained-ish model and a recurrence:');
const seedBack = decodeLibrary(encodeLibrary(seed().toJSON()));
check('seed library round-trips', seedBack.ok
  && JSON.stringify(seedBack.library) === JSON.stringify(libraryFrom(seed().toJSON())));

console.log('\n=== 4. THE OVERFLOW, FORCED ===\n');
console.log('  A term-scale library is one event. That will not stay true — the');
console.log('  model trains and occurrenceData accumulates — so the split is');
console.log('  forced here rather than discovered in November.\n');
const fat = new Schedule({ config: defaultConfig });
for (let i = 0; i < 900; i += 1) {
  fat.addActivity({ label: `Activity with a deliberately long label number ${i}`, tags: [`tag${i % 30}`, `second-tag-${i % 7}`], durationMin: 45 });
}
const fatJson = fat.toJSON();
const fatFoot = libraryFootprint(fatJson);
console.log(`  ${fatFoot.events} events, ${fatFoot.props} properties, ${kb(fatFoot.bytes)} total`);
check('it split across several events', fatFoot.events > 1, `${fatFoot.events} events`);
const fatEvents = encodeLibrary(fatJson);
let worstBytes = 0; let worstProps = 0;
for (const ev of fatEvents) {
  let b = 0; let p = 0;
  for (const [k, v] of Object.entries(ev.extendedProperties.private)) { b += byteLength(k) + byteLength(v); p += 1; }
  worstBytes = Math.max(worstBytes, b); worstProps = Math.max(worstProps, p);
}
console.log(`  largest single event: ${kb(worstBytes)}, ${worstProps} properties`);
check('no event exceeds GOOGLE\'s byte ceiling', worstBytes <= GOOGLE_BYTES_PER_EVENT);
check('no event exceeds GOOGLE\'s property ceiling', worstProps <= GOOGLE_PROPS_PER_EVENT);
const fatBack = decodeLibrary(fatEvents);
check('a multi-event library round-trips', fatBack.ok
  && JSON.stringify(fatBack.library) === JSON.stringify(libraryFrom(fatJson)), fatBack.error || '');

console.log('\n  order-independence — Google may hand them back in any order:');
const shuffled = [...fatEvents].reverse();
const shuffledBack = decodeLibrary(shuffled);
check('reversed events still reassemble', shuffledBack.ok
  && JSON.stringify(shuffledBack.library) === JSON.stringify(libraryFrom(fatJson)));

console.log('\n=== 5. WHAT IT REFUSES ===\n');
const truncated = JSON.parse(JSON.stringify(events));
const k0 = Object.keys(truncated[0].extendedProperties.private).find((k) => k.startsWith('sc.json.'));
truncated[0].extendedProperties.private[k0] = truncated[0].extendedProperties.private[k0].slice(0, 50);
check('truncation is DETECTED', !decodeLibrary(truncated).ok, decodeLibrary(truncated).error || '');

const holed = JSON.parse(JSON.stringify(fatEvents));
holed.pop();
check('a MISSING event is detected', !decodeLibrary(holed).ok, decodeLibrary(holed).error || '');

const chunkGone = JSON.parse(JSON.stringify(events));
delete chunkGone[0].extendedProperties.private['sc.json.0'];
check('a missing chunk is detected', !decodeLibrary(chunkGone).ok, decodeLibrary(chunkGone).error || '');

const newer = JSON.parse(JSON.stringify(events));
newer[0].extendedProperties.private['sc.v'] = String(LIBRARY_VERSION + 1);
check('a NEWER library version is refused', !decodeLibrary(newer).ok, decodeLibrary(newer).error || '');

check('an ordinary calendar with no library says so, without erroring',
  (() => { const r = decodeLibrary([{ summary: 'Dentist' }]); return !r.ok && r.empty; })());
check('never throws on rubbish', (() => {
  try { decodeLibrary(null); decodeLibrary([null]); decodeLibrary([{}]); return true; } catch { return false; }
})());

console.log('\n=== 6. THE EVENT ITSELF IS WELL-BEHAVED ===\n');
const ev0 = events[0];
console.log(`  summary      ${JSON.stringify(ev0.summary)}`);
console.log(`  start/end    ${ev0.start.date} (all-day)`);
console.log(`  transparency ${ev0.transparency}`);
check('parked far in the past so no real week shows it', ev0.start.date === '1970-01-01');
check('marked transparent, so it never reads as busy', ev0.transparency === 'transparent');
check('says in plain words what it is and what deleting it costs',
  /do not delete/i.test(ev0.summary) && /Deleting it loses/i.test(ev0.description));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
