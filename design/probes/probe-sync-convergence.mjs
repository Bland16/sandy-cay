// probe-sync-convergence.mjs — does the sync SETTLE, or does it argue with itself?
//
// ⚠️ EVERY SYNC TEST IN THIS REPO IS SINGLE-PASS, and a loop is invisible to a
// single pass. That is written down as one of the three habits that caught
// session 9's bugs: "test repetition — convergence is invisible to a single-pass
// test". This is that test.
//
// A pass that changes local state calls `mutate`, which bumps `version`, which
// schedules ANOTHER sync five seconds later. So any pass that keeps deciding to
// adopt, or keeps deciding to push, runs forever at 5-second intervals — burning
// Google's quota and never settling.
//
//     node design/probes/probe-sync-convergence.mjs
import { Schedule, defaultConfig, seedStarterBuckets } from '../../src/core/index.js';
import { pull, applyPlan, pushLibrary, encodeNoteParts } from '../../src/ui/googleSync.js';
import { planSync, emptyState, advanceState, taskHash } from '../../src/core/syncPlan.js';
import { libraryFrom, diffLibrary, applyLibrary } from '../../src/core/googleLibrary.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

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
    _now: () => clock + 1000,
  };
}

const freshHash = () => {
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  return taskHash(libraryFrom(s.toJSON()));
};

/**
 * One pass, mirroring `useGoogleSync#runSync`. Returns what it DID, so a caller
 * can watch for a pass that never stops doing something.
 *
 * `resolved` is the per-session flag under test: once the library question has
 * been answered for this session, it is not asked again.
 */
async function pass(api, sched, state, { resolved }) {
  const remote = await pull(api, 'cal');
  const did = { adoptedLibrary: false, frozen: false, mutated: 0 };

  const localLibrary = libraryFrom(sched.toJSON());
  if (remote.library && !resolved.done) {
    did.asked = true;
    const diff = diffLibrary(localLibrary, remote.library);
    if (diff.same) resolved.done = true;
    else if (taskHash(localLibrary) === freshHash()) {
      applyLibrary(sched, remote.library);
      did.adoptedLibrary = true;
      did.mutated += 1;
      state = { ...state, libHash: taskHash(libraryFrom(sched.toJSON())) };
      resolved.done = true;
    } else {
      did.frozen = true;
      return { did, state };
    }
  }

  const now = api._now();
  const local = sched.toJSON().tasks;
  state = { ...state, entries: state.entries || {} };
  const plan = planSync(local, remote.tasks, state);
  const applied = await applyPlan(api, 'cal', plan, { timeZone: 'America/New_York' });
  if (plan.adopt.length || plan.deleteLocal.length) did.mutated += 1;
  for (const t of plan.adopt) sched.upsertTaskFromJSON(t);
  for (const id of plan.deleteLocal) sched.removeTask(id);

  const noteState = { lastSyncAt: state.lastSyncAt || 0, entries: state.noteEntries || {} };
  const notePlan = planSync(sched.dayNotes.map((n) => n.toJSON()), remote.notes || [], noteState);
  const noteApplied = await applyPlan(api, 'cal', notePlan, { encode: encodeNoteParts });
  if (notePlan.adopt.length || notePlan.deleteLocal.length) did.mutated += 1;
  for (const n of notePlan.adopt) sched.upsertDayNoteFromJSON(n);

  const json = sched.toJSON();
  const libNow = taskHash(libraryFrom(json));
  if (libNow !== state.libHash) {
    await pushLibrary(api, 'cal', json);
    did.pushedLibrary = true;
  }

  const next = advanceState(state, applied, now);
  next.noteEntries = advanceState(noteState, noteApplied, now).entries;
  next.libHash = libNow;
  did.plan = { create: plan.create.length, update: plan.update.length, adopt: plan.adopt.length };
  did.notes = { create: notePlan.create.length, update: notePlan.update.length, adopt: notePlan.adopt.length };
  return { did, state: next };
}

async function run(label, { resolvedFlagWorks }) {
  console.log(`\n=== ${label} ===\n`);
  const api = fakeGoogle();

  // Device A: a real setup, pushed up.
  const deskState = { ...emptyState() };
  const desk = new Schedule({ config: defaultConfig });
  seedStarterBuckets(desk);
  desk.addBucket({ label: 'Thesis', tags: ['thesis'] });
  desk.addFixed({
    title: 'Orientation',
    startTime: new Date(2026, 8, 7, 9),
    endTime: new Date(2026, 8, 7, 10),
  });
  desk.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });
  let ds = deskState;
  ({ state: ds } = await pass(api, desk, ds, { resolved: { done: false } }));

  // Device B: fresh, signs in, and then keeps syncing.
  const phone = new Schedule({ config: defaultConfig });
  seedStarterBuckets(phone);
  let ps = { ...emptyState() };
  // ⚠️ When the flag does NOT persist between passes, the library question is
  // re-asked every single pass — which is the shape of the bug.
  const shared = { done: false };
  const history = [];
  for (let i = 0; i < 6; i += 1) {
    const flag = resolvedFlagWorks ? shared : { done: false };
    // eslint-disable-next-line no-await-in-loop
    const r = await pass(api, phone, ps, { resolved: flag });
    ps = r.state;
    history.push(r.did);
  }

  history.forEach((d, i) => {
    const bits = [];
    if (d.adoptedLibrary) bits.push('ADOPTED LIBRARY');
    if (d.frozen) bits.push('FROZE');
    if (d.pushedLibrary) bits.push('pushed library');
    if (d.plan) bits.push(`tasks ${d.plan.create}c/${d.plan.update}u/${d.plan.adopt}a`);
    if (d.notes) bits.push(`notes ${d.notes.create}c/${d.notes.update}u/${d.notes.adopt}a`);
    console.log(`  pass ${i + 1}: mutate×${d.mutated}  ${bits.join(' · ') || 'nothing'}`);
  });

  const tail = history.slice(2);
  const quiet = tail.every((d) => d.mutated === 0 && !d.pushedLibrary);
  const asks = history.filter((d) => d.asked).length;
  console.log('');
  console.log(`  the library question was asked on ${asks} of ${history.length} passes`);
  console.log('');

  // ⚠️ THE INVARIANT, and it is what the fix is really about. Whether a given
  // fixture LOOPS depends on something this harness cannot conjure reliably —
  // an `applyLibrary` round trip that does not come back byte-identical. What
  // can be stated flatly is that the question must be asked ONCE. Asked every
  // pass, it only takes one non-identical round trip to adopt forever or to
  // re-freeze immediately after being answered.
  check('the question is asked at most once per session',
    !resolvedFlagWorks || asks <= 1, `asked ${asks} times`);
  check('it settles — later passes do nothing at all', quiet,
    quiet ? '' : `still working on pass ${history.findIndex((d, i) => i >= 2 && (d.mutated || d.pushedLibrary)) + 1}`);
  return quiet;
}

await run('WITHOUT the per-session flag — the library question re-asked every pass', { resolvedFlagWorks: false });
await run('WITH the per-session flag — asked once, at the start', { resolvedFlagWorks: true });

console.log(`\n${failures ? `${failures} FAILURE(S) — see which run they came from` : 'all clear'}`);
