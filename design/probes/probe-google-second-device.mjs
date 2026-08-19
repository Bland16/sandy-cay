// probe-google-second-device.mjs — what a phone gets when it signs in.
//
// GS-2 says the Google calendar IS the store: an account without a database.
// Tasks live on their own events; everything that is not an appointment —
// buckets, activities, zones, config, the learned model, commitments,
// routineInstances — lives in the hidden library event (§4.3).
//
// So the question this answers is the one a second device asks: I have the
// calendar, do I get my life back?
//
//     node design/probes/probe-google-second-device.mjs
import { Schedule, defaultConfig, seedStarterBuckets } from '../../src/core/index.js';
import { pull, applyPlan, pushLibrary } from '../../src/ui/googleSync.js';
import { planSync, emptyState, advanceState, taskHash } from '../../src/core/syncPlan.js';
import {
  libraryFrom, LIBRARY_KEYS, diffLibrary, applyLibrary,
} from '../../src/core/googleLibrary.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

// An in-memory Google, same shape as the one in tests/google-sync.test.js.
function fakeGoogle() {
  const events = new Map();
  let seq = 0;
  let clock = 1_000_000;
  return {
    listAll: async () => [...events.values()].map((e) => ({ ...e })),
    insert: async (_cal, body) => {
      seq += 1; clock += 1;
      const id = `ev${seq}`;
      events.set(id, { ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    patch: async (_cal, id, body) => {
      clock += 1;
      events.set(id, { ...events.get(id), ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    remove: async (_cal, id) => { events.delete(id); return null; },
    _events: events,
    // ⚠️ The wall clock must stay AHEAD of Google's own `updated` stamps, or a
    // device reads its own just-made edit as older than the store and adopts
    // the copy it just replaced. Real life has that for free; a fixture with
    // toy timestamps does not, and this probe lost an hour to it.
    _now: () => clock + 1000,
  };
}

/** The library a brand-new install produces — `useGoogleSync#freshLibraryHash`. */
const freshHash = () => {
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  return taskHash(libraryFrom(s.toJSON()));
};

/** One sync pass, exactly as `useGoogleSync#runSync` performs it. */
async function runSync(api, sched, state) {
  const now = api._now();
  const remote = await pull(api, 'cal');

  // GS-8, the library gate — fresh adopts, agreement passes, difference FREEZES
  // the whole pass. It sits before anything that writes, and so does this.
  const localLibrary = libraryFrom(sched.toJSON());
  let adopted = false;
  if (remote.library) {
    const diff = diffLibrary(localLibrary, remote.library);
    if (!diff.same && taskHash(localLibrary) === freshHash()) {
      applyLibrary(sched, remote.library);
      adopted = true;
      state = { ...state, libHash: taskHash(libraryFrom(sched.toJSON())) };
    } else if (!diff.same) {
      return { frozen: true, diff, next: state, remote, plan: null, adopted: false };
    }
  }

  const local = sched.toJSON().tasks;
  const plan = planSync(local, remote.tasks, state, { unreadable: remote.unreadable });
  const applied = await applyPlan(api, 'cal', plan, {
    commitmentIds: new Set((sched.commitments || []).map((c) => c.id)),
    timeZone: 'America/New_York',
  });
  // The LOCAL half, as `applyLocal` does it.
  for (const t of plan.adopt) sched.upsertTaskFromJSON(t);
  for (const id of plan.deleteLocal) sched.removeTask(id);

  const json = sched.toJSON();
  const libNow = taskHash(libraryFrom(json));
  let wroteLibrary = false;
  if (libNow !== state.libHash) { await pushLibrary(api, 'cal', json); wroteLibrary = true; }

  const next = advanceState(state, applied, now);
  next.libHash = libNow;
  return {
    plan, remote, next, wroteLibrary, adopted, frozen: false,
  };
}

const at = (d, h, m = 0) => new Date(2026, 7, d, h, m, 0, 0);

console.log('=== 1. THE DESKTOP: a real setup, pushed ===\n');
const desktop = new Schedule({ config: defaultConfig });
seedStarterBuckets(desktop);
desktop.addBucket({ label: 'Thesis', tags: ['thesis', 'writing'], colour: '#88aacc' });
desktop.addZone({ label: 'Work', tags: ['work'], exclusive: true, windows: [{ day: 'mon', start: '09:00', end: '17:00' }] });
desktop.addFixed({ title: 'Orientation', startTime: at(31, 9), endTime: at(31, 10), tags: ['school'] });
desktop.addFlexible({ title: 'Read for seminar', durationMin: 90, tags: ['thesis'] });

const api = fakeGoogle();
let deskState = emptyState();
({ next: deskState } = await runSync(api, desktop, deskState));

const libOnWire = libraryFrom(desktop.toJSON());
console.log(`  buckets ${desktop.buckets.length} · zones ${desktop.zones.length} · tasks ${desktop.tasks.length}`);
console.log(`  library keys on the wire: ${LIBRARY_KEYS.filter((k) => libOnWire[k] !== undefined).length} of ${LIBRARY_KEYS.length}`);
console.log(`  events in the calendar:   ${api._events.size}\n`);
check('the library reached Google', [...api._events.values()].some((e) => e.extendedProperties?.private?.['sc.kind'] === 'library'));

console.log('\n=== 2. THE PHONE: same account, same calendar, empty storage ===\n');
const phone = new Schedule({ config: defaultConfig });
seedStarterBuckets(phone);           // useEngine.js:28 does this on a fresh store
let phoneState = emptyState();
const first = await runSync(api, phone, phoneState);
phoneState = first.next;

console.log(`  the pull DID find the library: ${first.remote.library ? 'yes' : 'no'}`);
if (first.remote.library) {
  console.log(`    it holds ${Object.keys(first.remote.library).length} collections, `
    + `including ${first.remote.library.buckets?.length ?? 0} buckets and ${first.remote.library.zones?.length ?? 0} zones`);
}
console.log(`  tasks adopted onto the phone: ${first.plan.adopt.length}\n`);

check('the phone gets the tasks back', phone.tasks.length === desktop.tasks.length,
  `${phone.tasks.length} of ${desktop.tasks.length}`);
check('the phone gets the BUCKETS back', phone.buckets.some((b) => b.label === 'Thesis'),
  `has: ${phone.buckets.map((b) => b.label).join(', ') || '(none)'}`);
check('the phone gets the ZONES back', phone.zones.length === desktop.zones.length,
  `${phone.zones.length} of ${desktop.zones.length}`);

console.log('\n=== 3. AND WHAT THE PHONE THEN WRITES BACK ===\n');
const libAfter = await (async () => {
  const evs = await api.listAll('cal');
  const lib = evs.filter((e) => e.extendedProperties?.private?.['sc.kind'] === 'library');
  return lib;
})();
console.log(`  the phone rewrote the library: ${first.wroteLibrary ? 'YES' : 'no'}`);
console.log(`  library events now in the calendar: ${libAfter.length}`);

// Read the store back the way a THIRD device would, and see whose library won.
const third = await pull(api, 'cal');
const survivors = third.library ? (third.library.buckets || []).map((b) => b.label) : [];
console.log(`  buckets now IN THE STORE: ${survivors.join(', ') || '(none)'}\n`);
check('the desktop\'s library SURVIVED the phone signing in', survivors.includes('Thesis'),
  survivors.includes('Thesis') ? '' : 'the phone overwrote it with its own starter set');

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);

console.log('\n=== 4. THE STALE LAPTOP: real content of its own, a week out of date ===\n');
// The case that decided the scope of the freeze. This device is NOT fresh, so
// it cannot simply adopt; and it must not write, because its `dirtyAt` is
// stamped when it NOTICES a difference — which is now — and would therefore
// beat every genuine edit made elsewhere while it slept.
const laptop = new Schedule({ config: defaultConfig });
seedStarterBuckets(laptop);
laptop.addBucket({ label: 'Old project', tags: ['old'] });
// It once synced these tasks, so it carries a sync record for them.
for (const t of desktop.tasks) laptop.upsertTaskFromJSON(t.toJSON());
let laptopState = { lastSyncAt: 1, entries: {} };
for (const t of laptop.tasks) laptopState.entries[t.id] = { hash: taskHash(t.toJSON()), eventId: null, dirtyAt: 0 };

// Meanwhile the desktop renames a task and pushes it.
desktop.updateTask(desktop.tasks[0].id, { title: 'Orientation — moved to the hall' });
({ next: deskState } = await runSync(api, desktop, deskState));
const titleInStore = () => {
  const t = [...api._events.values()].find((e) => e.extendedProperties?.private?.['sc.id'] === desktop.tasks[0].id);
  return t && t.summary;
};
console.log(`  the desktop's edit is in the store: ${JSON.stringify(titleInStore())}`);

// The laptop's own copy still says the old thing, and it has just woken up.
laptop.updateTask(laptop.tasks[0].id, { title: 'Orientation' });
const eventsBefore = api._events.size;
const woke = await runSync(api, laptop, laptopState);

console.log(`  the laptop's pass was frozen: ${woke.frozen ? 'YES' : 'no'}`);
if (woke.diff) console.log(`  it differs on: ${woke.diff.differing.map((r) => r.key).join(', ')}`);
console.log('');
check('the frozen pass wrote NOTHING', api._events.size === eventsBefore,
  `${api._events.size} events, was ${eventsBefore}`);
check("the desktop's newer edit SURVIVED the stale device", titleInStore() === 'Orientation — moved to the hall',
  `store says ${JSON.stringify(titleInStore())}`);
check('the stale library did not reach the store', (await pull(api, 'cal')).library.buckets
  .every((b) => b.label !== 'Old project'));

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
