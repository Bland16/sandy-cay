// probe-gs11-fallout.mjs — what else moved when day notes left the library.
//
// GS-11 removed `dayNotes` and `blockedDays` from `LIBRARY_KEYS`, correctly:
// they are all-day EVENTS now, and a second copy in the blob would resurrect a
// note deleted in Google.
//
// But `LIBRARY_KEYS` is not only the Google library's list. `applyLibrary`
// iterates it, and `applyLibrary` is ALSO the footlocker's "Restore setup only"
// door — where "they are events now" means nothing, because a footlocker file
// is a FILE, not a calendar. This asks what that removal cost the other caller.
//
//     node design/probes/probe-gs11-fallout.mjs
import { Schedule, defaultConfig, dateFromKey } from '../../src/core/index.js';
import { applyLibrary, RESTORABLE_KEYS } from '../../src/core/googleLibrary.js';
import { planSync, emptyState, markDirty, taskHash } from '../../src/core/syncPlan.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

console.log('=== 1. THE FOOTLOCKER: "Restore setup only" ===\n');
{
  // An old save with a term's worth of holidays in it.
  const old = new Schedule({ config: defaultConfig });
  old.addBucket({ label: 'Thesis', tags: ['thesis'] });
  old.addZone({ label: 'Work', tags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '17:00' }] });
  old.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });
  old.addDayNote({ label: 'Reading week', from: '2026-11-23', to: '2026-11-27' });
  old.blockDay(dateFromKey('2026-12-24'));
  const file = old.toJSON();

  console.log(`  the file holds: ${file.dayNotes.length} day notes, ${file.blockedDays.length} blocked day(s),`);
  console.log(`                  ${file.buckets.length} buckets, ${file.zones.length} zone(s)\n`);

  // This is exactly what the Cabana's "Restore setup only" button runs — the
  // WIDER list, because a footlocker file is a file and not a calendar.
  const now = new Schedule({ config: defaultConfig });
  const r = applyLibrary(now, file, { keys: RESTORABLE_KEYS });

  // And what the GOOGLE library gate runs, which must NOT bring them: a copy in
  // the blob alongside the events would resurrect a note deleted in Google.
  const viaGoogle = new Schedule({ config: defaultConfig });
  applyLibrary(viaGoogle, file);

  console.log(`  applied: ${r.applied.join(', ')}\n`);
  console.log(`  after restoring: ${now.dayNotes.length} day notes, ${now.blockedDays.length} blocked day(s),`);
  console.log(`                   ${now.buckets.length} buckets, ${now.zones.length} zone(s)\n`);

  check('buckets came across', now.buckets.some((b) => b.label === 'Thesis'));
  check('zones came across', now.zones.length === 1);
  check('⚠️ day notes came across', now.dayNotes.length === 2,
    `${now.dayNotes.length} of 2 — the file has them and the restore drops them`);
  check('⚠️ blocked days came across', now.blockedDays.length === 1,
    `${now.blockedDays.length} of 1`);
  check('and the GOOGLE path still leaves them alone', viaGoogle.dayNotes.length === 0,
    'they are events there, and a second copy would resurrect deleted ones');
  console.log('\n  ↑ A footlocker file is not a calendar. "They are events now" is true');
  console.log('    of Google and meaningless here, so the restore silently loses them.\n');
}

console.log('=== 2. A LOCAL EDIT TO A DAY NOTE CAN NEVER WIN ===\n');
{
  // GS-7: newest edit wins. `Task` has no modification time, so the sync stamps
  // its own `dirtyAt` — via `markDirty`, which `runSync` calls for TASKS ONLY.
  // Notes and blocked days therefore have no `dirtyAt` at all, and a conflict
  // resolves on `(known && known.dirtyAt) || 0` — always 0, always losing.
  const note = { id: 'thanksgiving-note', label: 'Thanksgiving (mine)', from: '2026-11-26', to: '2026-11-26' };
  const pushed = { ...note, label: 'Thanksgiving' };

  // Synced before, then edited on BOTH sides.
  const state = {
    lastSyncAt: 1000,
    entries: { [note.id]: { hash: taskHash(pushed), eventId: 'ev-1', dirtyAt: 0 } },
  };
  const remote = [{ task: { ...pushed, label: 'Thanksgiving (theirs)' }, googleEventIds: ['ev-1'], updated: 2000 }];

  // ⚠️ THE FIX IS IN THE CALLER, NOT THE PLANNER. `planSync` was always right:
  // it resolves on `(known && known.dirtyAt) || 0`. What was missing is that
  // nothing ever PUT a `dirtyAt` on a note's entry, because `runSync` ran
  // `markDirty` over tasks and nothing else. Both shapes are printed — the
  // planner is identical in each, and the caller's stamp is the only difference.
  const unstamped = planSync([note], remote, state).conflicts[0];
  console.log(`  WITHOUT the stamp (the bug): localAt=${unstamped.localAt} remoteAt=${unstamped.remoteAt} → ${unstamped.winner}`);
  check('unstamped, remote wins every time — the behaviour that was there',
    unstamped.winner === 'remote', 'kept as the record of what was wrong');

  // What `runSync` now does before planning notes.
  const stamped = planSync([note], remote, markDirty(state, [note], 5000)).conflicts[0];
  console.log(`  WITH the stamp (as runSync now does): localAt=${stamped.localAt} → ${stamped.winner}\n`);
  check('⚠️ stamped, a local note edit CAN win', stamped.winner === 'local',
    'which is what GS-7 says should happen and never did for notes');
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
