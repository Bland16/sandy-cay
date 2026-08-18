// probe-google-encode.mjs — does a task survive the trip to a Google event and
// back, and does the encoding NOTICE when Google eats part of it?
//
// The suite cannot see the thing that matters here. Google truncates an
// over-long property value silently, so the failure mode is a task that comes
// back looking fine with fields quietly gone. This prints the actual bytes.
//
//     node design/probes/probe-google-encode.mjs
import { Schedule, defaultConfig } from '../../src/core/index.js';
import {
  encodeTask, decodeEvent, kindOf, chunkString, packPayload, unpackPayload,
  checksum, byteLength, KIND, CHUNK_BYTES, ENCODING_VERSION,
} from '../../src/core/googleEncode.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

const s = new Schedule({ config: defaultConfig });
const day = (h, m = 0) => { const d = new Date(2026, 8, 7, h, m, 0, 0); return d; };

console.log('=== 1. A PLAIN TASK, there and back ===\n');
const plain = s.addFixed({
  title: 'Orientation', startTime: day(9), endTime: day(10, 30),
  tags: ['school', 'admin'], priority: 2, details: 'Bring the form',
});
const ev = encodeTask(plain, { timeZone: 'America/New_York' });
console.log(`  summary      ${JSON.stringify(ev.summary)}`);
console.log(`  description  ${JSON.stringify(ev.description)}`);
console.log(`  start        ${ev.start.dateTime}  tz=${ev.start.timeZone}`);
const props = ev.extendedProperties.private;
console.log(`  properties   ${Object.keys(props).length}  (${Object.keys(props).join(', ')})`);
console.log(`  payload      ${byteLength(props['sc.json.0'])} bytes in ${props['sc.json.n']} chunk(s)\n`);

const back = decodeEvent({ ...ev, id: 'abc12' });
check('decodes', back.ok, back.error || '');
check('id survives', back.task.id === plain.id, `${back.task.id}`);
check('title survives', back.task.title === plain.title);
check('tags survive', JSON.stringify(back.task.tags) === JSON.stringify(plain.tags));
check('details survive', back.task.details === plain.details);
check('priority survives', back.task.priority === plain.priority);
check('start time survives', back.task.startTime === plain.startTime.getTime(),
  `${new Date(back.task.startTime).toISOString()}`);
check('end time survives', back.task.endTime === plain.endTime.getTime());
check('kind is a plain task', back.kind === KIND.TASK, back.kind);
check('google event id captured', back.googleEventId === 'abc12');

console.log('\n=== 2. EVERY KIND classifies correctly ===\n');
console.log('  ⚠️ parentId is OVERLOADED: a project chunk points at a Task, a');
console.log('     commitment sitting points at a Commitment. Nothing on the task');
console.log('     says which — so it must be resolved at encode time.\n');
const commitmentIds = new Set(['stat-hw-0009']);
const cases = [
  ['plain task', { id: 'a-1', title: 'x' }, KIND.TASK],
  ['routine step', { id: 'a-2', title: 'x', routineId: 'laundry-1', stepIndex: 1 }, KIND.ROUTINE_STEP],
  ['project parent', { id: 'a-3', title: 'x', chunking: { totalMinutes: 600 } }, KIND.PROJECT_PARENT],
  ['project chunk', { id: 'a-4', title: 'x', parentId: 'essay-0002' }, KIND.PROJECT_CHUNK],
  ['commitment sitting', { id: 'a-5', title: 'x', parentId: 'stat-hw-0009' }, KIND.COMMITMENT_SITTING],
];
for (const [label, t, want] of cases) {
  const got = kindOf(t, { commitmentIds });
  check(label.padEnd(20), got === want, `-> ${got}`);
}
console.log('\n  and the pair that shares a field, told apart only by the resolver:');
const chunkT = { id: 'a-4', title: 'x', parentId: 'essay-0002' };
const sitT = { id: 'a-5', title: 'x', parentId: 'stat-hw-0009' };
console.log(`    same shape? parentId on both: ${!!chunkT.parentId && !!sitT.parentId}`);
check('without the resolver BOTH look like chunks',
  kindOf(sitT) === KIND.PROJECT_CHUNK, '(so callers must pass commitmentIds)');

console.log('\n=== 3. THE TRUNCATION TRAP — Google cuts at 1024 bytes, silently ===\n');
const big = 'y'.repeat(5000);
const packed = packPayload(big);
const nChunks = Number(packed['sc.json.n']);
console.log(`  ${big.length} chars -> ${nChunks} chunks, checksum ${packed['sc.json.sum']}`);
let maxBytes = 0;
for (let i = 0; i < nChunks; i += 1) maxBytes = Math.max(maxBytes, byteLength(packed[`sc.json.${i}`]));
check('every chunk is under Google\'s 1024-byte ceiling', maxBytes <= 1024, `largest ${maxBytes} bytes`);
check(`every chunk is under our own ${CHUNK_BYTES}-byte cut`, maxBytes <= CHUNK_BYTES, `largest ${maxBytes}`);
check('round-trips clean', unpackPayload(packed).value === big);

console.log('\n  now simulate what Google actually does to an over-long value:');
const truncated = { ...packed, 'sc.json.0': packed['sc.json.0'].slice(0, 400) };
const caught = unpackPayload(truncated);
check('TRUNCATION IS DETECTED, not silently accepted', !caught.ok, caught.error || '');

const dropped = { ...packed };
delete dropped[`sc.json.${nChunks - 1}`];
const caught2 = unpackPayload(dropped);
check('a MISSING chunk is detected too', !caught2.ok, caught2.error || '');

console.log('\n=== 4. BOUNDARY FUZZ around the cut and the ceiling ===\n');
console.log('  len   chunks  largest  round-trips');
let boundaryBad = 0;
for (const len of [1, 899, 900, 901, 1023, 1024, 1025, 1799, 1800, 1801, 4096]) {
  const str = 'z'.repeat(len);
  const p = packPayload(str);
  const n = Number(p['sc.json.n']);
  let mx = 0;
  for (let i = 0; i < n; i += 1) mx = Math.max(mx, byteLength(p[`sc.json.${i}`]));
  const rt = unpackPayload(p).value === str;
  if (!rt || mx > CHUNK_BYTES) boundaryBad += 1;
  console.log(`  ${String(len).padStart(5)} ${String(n).padStart(6)} ${String(mx).padStart(8)}   ${rt ? 'yes' : 'NO'}`);
}
check('no boundary length breaks', boundaryBad === 0);

console.log('\n=== 5. MULTI-BYTE characters must not be cut in half ===\n');
console.log('  A naive byte-slice splits a 4-byte emoji and the halves rejoin as');
console.log('  a DIFFERENT string — corruption on every save, not just rarely.\n');
const emoji = '🌊'.repeat(400);          // 4 bytes each = 1600 bytes
const ep = packPayload(emoji);
const eBack = unpackPayload(ep);
check('emoji payload round-trips exactly', eBack.ok && eBack.value === emoji);
check('byteLength counts bytes not chars', byteLength('🌊') === 4, `got ${byteLength('🌊')}`);
let emojiMax = 0;
for (let i = 0; i < Number(ep['sc.json.n']); i += 1) emojiMax = Math.max(emojiMax, byteLength(ep[`sc.json.${i}`]));
check('emoji chunks stay under the cut', emojiMax <= CHUNK_BYTES, `largest ${emojiMax} bytes`);
const accents = 'é'.repeat(700);
check('2-byte accents round-trip', unpackPayload(packPayload(accents)).value === accents);

console.log('\n=== 6. REFUSALS: what it will NOT quietly accept ===\n');
check('a foreign event is "not ours", not corrupt',
  (() => { const r = decodeEvent({ summary: 'Dentist', id: 'zz' }); return !r.ok && r.notOurs; })());
check('an event from a NEWER encoding is refused',
  (() => {
    const e = encodeTask(plain, {});
    e.extendedProperties.private['sc.v'] = String(ENCODING_VERSION + 1);
    const r = decodeEvent(e);
    return !r.ok && !r.notOurs;
  })(), '(refusing beats a partial read that then gets written back)');
check('a non-JSON payload is refused',
  (() => {
    const e = encodeTask(plain, {});
    e.extendedProperties.private['sc.json.0'] = 'not json{';
    delete e.extendedProperties.private['sc.json.sum'];
    return !decodeEvent(e).ok;
  })());

console.log('\n=== 7. A HAND EDIT IN GOOGLE WINS (GS-4 / R-1) ===\n');
const moved = encodeTask(plain, { timeZone: 'America/New_York' });
moved.start = { dateTime: new Date(2026, 8, 7, 15, 0, 0, 0).toISOString(), timeZone: 'America/New_York' };
moved.end = { dateTime: new Date(2026, 8, 7, 16, 30, 0, 0).toISOString(), timeZone: 'America/New_York' };
const movedBack = decodeEvent(moved);
check('the moved time is what comes back',
  movedBack.task.startTime === new Date(2026, 8, 7, 15, 0, 0, 0).getTime(),
  new Date(movedBack.task.startTime).toString().slice(16, 21));
console.log('  (times live ONLY on the event, never in the payload, so there is no');
console.log('   second copy to disagree with the hand edit)');

console.log('\n=== 8. REAL-SCALE budget check ===\n');
const t2 = s.addFlexible({ title: 'Read for seminar', durationMin: 90, tags: ['reading'] });
for (const task of [plain, t2]) {
  const e = encodeTask(task, {});
  const p = e.extendedProperties.private;
  const total = Object.entries(p).reduce((n, [k, v]) => n + byteLength(k) + byteLength(v), 0);
  console.log(`  ${task.title.padEnd(20)} ${String(Object.keys(p).length).padStart(2)} props, `
    + `${String(total).padStart(4)} bytes  (${(total / 32768 * 100).toFixed(1)}% of the 32kB event budget)`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
