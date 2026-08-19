// probe-sync-plan.mjs — what a sync would actually DO, printed.
// design/GOOGLE-AS-STORAGE.md P3.
//
// Every decision here can destroy data, and the two that matter most are
// AMBIGUOUS from a snapshot alone:
//
//   here but not there  =  new locally  OR  deleted remotely
//   there but not here  =  new remotely OR  deleted locally
//
// Guess wrong and a sync either resurrects everything you delete or deletes
// everything you add. This prints which way each case is decided and why.
//
//     node design/probes/probe-sync-plan.mjs
import {
  planSync, markDirty, advanceState, emptyState, taskHash, describePlan,
} from '../../src/core/syncPlan.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'OK  ' : '**FAIL**'} ${label}${extra ? `  ${extra}` : ''}`);
};

const task = (id, title = id, extra = {}) => ({ id, title, ...extra });
const remote = (t, updated, eventId = `ev-${t.id}`) => ({ task: t, googleEventId: eventId, updated });

// A state that says "these were synced, at this hash, at lastSyncAt".
const synced = (tasks, lastSyncAt) => ({
  lastSyncAt,
  entries: Object.fromEntries(tasks.map((t) => [t.id, { hash: taskHash(t), eventId: `ev-${t.id}`, dirtyAt: 0 }])),
});

const T0 = 1_000_000;   // "last sync"
const T1 = 1_000_500;   // after it

console.log('=== 1. THE FOUR ONE-SIDED CASES ===\n');
{
  const a = task('a');
  const b = task('b');

  // here, not there, NEVER synced -> it is new
  let p = planSync([a], [], emptyState());
  check('local only + never synced  -> CREATE', p.create.length === 1 && p.deleteLocal.length === 0);

  // here, not there, WAS synced -> deleted on the other device
  p = planSync([a], [], synced([a], T0));
  check('local only + was synced    -> DELETE LOCAL', p.deleteLocal.length === 1 && p.create.length === 0);

  // there, not here, never synced -> made on the other device
  p = planSync([], [remote(b, T1)], emptyState());
  check('remote only + never synced -> ADOPT', p.adopt.length === 1 && p.deleteRemote.length === 0);

  // there, not here, WAS synced -> deleted here
  p = planSync([], [remote(b, T1)], synced([b], T0));
  check('remote only + was synced   -> DELETE REMOTE', p.deleteRemote.length === 1 && p.adopt.length === 0);

  console.log('\n  ⚠️ The pairs above are IDENTICAL snapshots. Only the record of');
  console.log('     what was last synced tells them apart — without it, one of');
  console.log('     each pair is always wrong.');
}

console.log('\n=== 2. BOTH SIDES PRESENT ===\n');
{
  const a = task('a', 'Orientation');
  const edited = task('a', 'Orientation, moved');

  let p = planSync([a], [remote(a, T0 - 10)], synced([a], T0));
  check('nothing changed          -> no writes at all',
    p.update.length === 0 && p.adopt.length === 0 && p.unchanged.length === 1);

  p = planSync([edited], [remote(a, T0 - 10)], synced([a], T0));
  check('local edited only        -> UPDATE (push)', p.update.length === 1 && p.adopt.length === 0);

  p = planSync([a], [remote(edited, T1)], synced([a], T0));
  check('remote edited only       -> ADOPT (pull)', p.adopt.length === 1 && p.update.length === 0);
}

console.log('\n=== 3. BOTH EDITED — the conflict, and who wins (GS-7) ===\n');
{
  const a = task('a', 'Seminar');
  const mine = task('a', 'Seminar (my edit)');
  const theirs = task('a', 'Seminar (their edit)');

  // Local went dirty at T1+100; remote was updated at T1. Local is newer.
  let st = synced([a], T0);
  st = markDirty(st, [mine], T1 + 100);
  let p = planSync([mine], [remote(theirs, T1)], st);
  check('local edit is newer  -> local wins', p.conflicts[0]?.winner === 'local' && p.update.length === 1);
  console.log(`     ${JSON.stringify(p.conflicts[0])}`);

  // Now the other way: local dirty at T1, remote updated later.
  st = synced([a], T0);
  st = markDirty(st, [mine], T1);
  p = planSync([mine], [remote(theirs, T1 + 100)], st);
  check('remote edit is newer -> remote wins', p.conflicts[0]?.winner === 'remote' && p.adopt.length === 1);
  console.log(`     ${JSON.stringify(p.conflicts[0])}`);

  check('a conflict is always REPORTED, never silent', p.conflicts.length === 1
    && p.conflicts[0].title === 'Seminar (my edit)');
}

console.log('\n=== 4. dirtyAt STAMPS ONCE — a slow typist must not beat a real edit ===\n');
{
  const a = task('a', 'Essay');
  let st = synced([a], T0);
  st = markDirty(st, [task('a', 'Essay v2')], T1);
  const first = st.entries.a.dirtyAt;
  st = markDirty(st, [task('a', 'Essay v3')], T1 + 5000);
  check('later keystrokes do not re-stamp', st.entries.a.dirtyAt === first, `${first}`);
  console.log('     (otherwise typing for a minute would beat a remote edit that');
  console.log('      genuinely happened first)');

  // Edit, then undo back to what was pushed.
  st = markDirty(st, [a], T1 + 9000);
  check('editing back to the synced value clears dirty', st.entries.a.dirtyAt === 0);
}

console.log('\n=== 5. IDEMPOTENCE — a second sync must do nothing ===\n');
{
  const a = task('a');
  const b = task('b');
  const p1 = planSync([a, b], [], emptyState());
  check('first run creates both', p1.create.length === 2);

  // Apply it: both now exist remotely, and state records them.
  const st = advanceState(emptyState(), {
    synced: p1.create.map((t) => ({ task: t, eventId: `ev-${t.id}` })),
  }, T1);
  const rem = [remote(a, T1), remote(b, T1)];
  const p2 = planSync([a, b], rem, st);
  check('second run does NOTHING',
    p2.create.length === 0 && p2.update.length === 0 && p2.adopt.length === 0
    && p2.deleteLocal.length === 0 && p2.deleteRemote.length === 0,
    describePlan(p2));
  console.log('     (a sync that rewrites everything each run burns quota and');
  console.log('      churns `updated`, which then looks like a remote edit)');
}

console.log('\n=== 6. A HALF-FINISHED SYNC MUST NOT CLAIM SUCCESS ===\n');
{
  const a = task('a');
  const b = task('b');
  const p = planSync([a, b], [], emptyState());
  // Only `a` actually got written — the request for `b` failed.
  const st = advanceState(emptyState(), { synced: [{ task: a, eventId: 'ev-a' }] }, T1);
  check('only the confirmed one is recorded', !!st.entries.a && !st.entries.b);
  const next = planSync([a, b], [remote(a, T1)], st);
  check('the failed one is retried next run', next.create.length === 1 && next.create[0].id === 'b');
  console.log('     (recording the whole PLAN would mark b as pushed and never');
  console.log('      send it again — silent, permanent divergence)');
  void p;
}

console.log('\n=== 7. WHAT THE USER IS TOLD ===\n');
{
  const p = planSync([task('a'), task('b')], [remote(task('c'), T1)], emptyState());
  console.log(`  describePlan -> "${describePlan(p)}"`);
  check('it names what happened rather than just "synced"',
    /added/.test(describePlan(p)) && /pulled in/.test(describePlan(p)));
  check('and says so when there is nothing to do',
    describePlan(planSync([], [], emptyState())) === 'nothing to do');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
