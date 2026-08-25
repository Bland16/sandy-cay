// The sync planner — design/GOOGLE-AS-STORAGE.md P3.
//
// Pure, no network. Every decision that can destroy data lives here, so this is
// where it gets pinned. `design/probes/probe-sync-plan.mjs` prints the same
// cases with their reasoning.
import { describe, it, expect } from 'vitest';
import {
  planSync, markDirty, advanceState, emptyState, taskHash, describePlan, isBulkDelete,
  outsideEdits,
} from '../src/core/syncPlan.js';

const task = (id, title = id) => ({ id, title });
const remote = (t, updated, eventId = `ev-${t.id}`) => ({ task: t, googleEventId: eventId, updated });
const synced = (tasks, lastSyncAt) => ({
  lastSyncAt,
  entries: Object.fromEntries(tasks.map((t) => [t.id, { hash: taskHash(t), eventId: `ev-${t.id}`, dirtyAt: 0 }])),
});

const T0 = 1_000_000;
const T1 = 1_000_500;

describe('the ambiguous cases — identical snapshots, opposite answers', () => {
  // ⚠️ THE HEART OF THIS FILE. "Here but not there" is either a new task or one
  // deleted elsewhere, and the two look the same. Only the record of what was
  // last synced separates them. Get it wrong and a sync either resurrects
  // everything you delete or deletes everything you add.
  const a = task('a');

  it('local-only and NEVER synced means it is new -> create', () => {
    const p = planSync([a], [], emptyState());
    expect(p.create).toHaveLength(1);
    expect(p.deleteLocal).toHaveLength(0);
  });

  it('local-only but PREVIOUSLY synced means it was deleted there -> delete here', () => {
    const p = planSync([a], [], synced([a], T0));
    expect(p.deleteLocal).toEqual(['a']);
    expect(p.create).toHaveLength(0);
  });

  it('remote-only and NEVER synced means another device made it -> adopt', () => {
    const p = planSync([], [remote(a, T1)], emptyState());
    expect(p.adopt).toHaveLength(1);
    expect(p.deleteRemote).toHaveLength(0);
  });

  it('remote-only but PREVIOUSLY synced means it was deleted here -> delete there', () => {
    const p = planSync([], [remote(a, T1)], synced([a], T0));
    expect(p.deleteRemote).toHaveLength(1);
    expect(p.deleteRemote[0].eventIds).toEqual(['ev-a']);
    expect(p.adopt).toHaveLength(0);
  });
});

describe('⚠️ a corrupt remote event must never delete the local task', () => {
  // THE WORST BUG IN THIS FILE'S HISTORY, and the shape of it is what to
  // remember: an event that cannot be READ is dropped from `remote`, which
  // makes the task look ABSENT, which reads as "deleted on the other device",
  // which deletes your copy. The checksum that exists to CATCH corruption
  // becomes the thing that completes it.
  const a = task('a', 'Orientation');

  it('leaves the task completely alone when its event is unreadable', () => {
    const plan = planSync([a], [], synced([a], T0), { unreadable: new Set(['a']) });
    expect(plan.deleteLocal).toHaveLength(0);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.adopt).toHaveLength(0);
    expect(plan.blocked).toEqual(['a']);
  });

  it('would delete it WITHOUT that signal — the bug, pinned', () => {
    // Kept deliberately: it documents why `unreadable` has to be threaded all
    // the way from decodeEvent through pull to here, and fails loudly if
    // someone decides the parameter is optional noise.
    const plan = planSync([a], [], synced([a], T0));
    expect(plan.deleteLocal).toEqual(['a']);
  });

  it('does not block a task that is genuinely gone', () => {
    const plan = planSync([a], [], synced([a], T0), { unreadable: new Set(['something-else']) });
    expect(plan.deleteLocal).toEqual(['a']);
  });

  it('accepts an array as well as a Set', () => {
    const plan = planSync([a], [], synced([a], T0), { unreadable: ['a'] });
    expect(plan.deleteLocal).toHaveLength(0);
  });
});

describe('⚠️ the bulk-delete guard — a restore was silently undone', () => {
  // WHAT HAPPENED: importing a footlocker while signed in brought back task ids
  // the sync remembered pushing. Google no longer had those events, so every
  // one read as "deleted on another device" and the sync deleted the lot. The
  // schedule emptied itself in front of the user.
  //
  // Two defences: a restore now clears the sync record (so the tasks are NEW),
  // and this guard stops any sync that is about to remove most of a schedule,
  // whatever the cause.
  const many = (n) => Array.from({ length: n }, (_, i) => task(`t${i}`, `Task ${i}`));

  it('a restore whose ids are all remembered would delete EVERYTHING', () => {
    const local = many(8);
    const plan = planSync(local, [], synced(local, T0));
    expect(plan.deleteLocal).toHaveLength(8);
    expect(isBulkDelete(plan, local.length)).toBe(true);
  });

  it('clearing the record instead pushes the restored tasks up', () => {
    const local = many(8);
    const plan = planSync(local, [], emptyState());
    expect(plan.deleteLocal).toHaveLength(0);
    expect(plan.create).toHaveLength(8);
  });

  it('does NOT cry wolf over ordinary deletions', () => {
    // Removing a task or two on your phone is exactly what this feature is for.
    const local = many(20);
    const gone = local.slice(0, 2);
    const plan = planSync(local, local.slice(2).map((t) => remote(t, T0 - 10)), synced(gone, T0));
    expect(plan.deleteLocal).toHaveLength(2);
    expect(isBulkDelete(plan, local.length)).toBe(false);
  });

  it('uses a floor AND a share — three of four is alarming, three of two hundred is a Tuesday', () => {
    const p = (n) => ({ deleteLocal: Array.from({ length: n }, (_, i) => `x${i}`) });
    expect(isBulkDelete(p(2), 4)).toBe(false);    // under the floor
    expect(isBulkDelete(p(3), 4)).toBe(true);     // over both
    expect(isBulkDelete(p(3), 200)).toBe(false);  // over the floor, tiny share
    expect(isBulkDelete(p(100), 200)).toBe(true);
  });
});

describe('both sides present', () => {
  const a = task('a', 'Orientation');
  const edited = task('a', 'Orientation, moved');

  it('writes NOTHING when neither side changed', () => {
    // A sync that rewrites everything every run burns quota and churns Google's
    // `updated`, which then reads as a remote edit on the next pass.
    const p = planSync([a], [remote(a, T0 - 10)], synced([a], T0));
    expect(p.update).toHaveLength(0);
    expect(p.adopt).toHaveLength(0);
    expect(p.unchanged).toEqual(['a']);
  });

  it('pushes a local-only edit', () => {
    const p = planSync([edited], [remote(a, T0 - 10)], synced([a], T0));
    expect(p.update).toHaveLength(1);
    expect(p.update[0].eventIds).toEqual(['ev-a']);
    expect(p.adopt).toHaveLength(0);
  });

  it('pulls a remote-only edit', () => {
    const p = planSync([a], [remote(edited, T1)], synced([a], T0));
    expect(p.adopt).toHaveLength(1);
    expect(p.update).toHaveLength(0);
  });
});

describe('conflict — GS-7, newest wins and it is SAID', () => {
  const a = task('a', 'Seminar');
  const mine = task('a', 'Seminar (mine)');
  const theirs = task('a', 'Seminar (theirs)');

  it('local wins when the local edit is newer', () => {
    let st = synced([a], T0);
    st = markDirty(st, [mine], T1 + 100);
    const p = planSync([mine], [remote(theirs, T1)], st);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].winner).toBe('local');
    expect(p.update).toHaveLength(1);
    expect(p.adopt).toHaveLength(0);
  });

  it('remote wins when the remote edit is newer', () => {
    let st = synced([a], T0);
    st = markDirty(st, [mine], T1);
    const p = planSync([mine], [remote(theirs, T1 + 100)], st);
    expect(p.conflicts[0].winner).toBe('remote');
    expect(p.adopt).toHaveLength(1);
    expect(p.update).toHaveLength(0);
  });

  it('always reports the conflict, with enough to find the loser again', () => {
    // The losing version is only recoverable if the user is told which task and
    // when. A silent overwrite is the surprise P-1 exists to prevent.
    let st = synced([a], T0);
    st = markDirty(st, [mine], T1);
    const p = planSync([mine], [remote(theirs, T1 + 100)], st);
    expect(p.conflicts[0]).toMatchObject({ id: 'a', title: 'Seminar (mine)' });
    expect(p.conflicts[0].localAt).toBe(T1);
    expect(p.conflicts[0].remoteAt).toBe(T1 + 100);
  });
});

describe('dirtyAt', () => {
  const a = task('a', 'Essay');

  it('stamps once, so a slow typist cannot beat an earlier remote edit', () => {
    let st = synced([a], T0);
    st = markDirty(st, [task('a', 'Essay v2')], T1);
    const first = st.entries.a.dirtyAt;
    st = markDirty(st, [task('a', 'Essay v3')], T1 + 5000);
    expect(st.entries.a.dirtyAt).toBe(first);
  });

  it('clears when an edit is undone back to the synced value', () => {
    let st = synced([a], T0);
    st = markDirty(st, [task('a', 'Essay v2')], T1);
    expect(st.entries.a.dirtyAt).toBe(T1);
    st = markDirty(st, [a], T1 + 9000);
    expect(st.entries.a.dirtyAt).toBe(0);
  });

  it('takes `now` as a parameter and never reads the clock', () => {
    // Sharp edge #8: nothing in core may read the wall clock, or fixtures go
    // flaky depending on the day they run.
    const src = markDirty.toString();
    expect(src).not.toMatch(/Date\.now|new Date/);
  });
});

describe('idempotence and partial failure', () => {
  const a = task('a');
  const b = task('b');

  it('a second sync does nothing', () => {
    const p1 = planSync([a, b], [], emptyState());
    const st = advanceState(emptyState(), {
      synced: p1.create.map((t) => ({ task: t, eventId: `ev-${t.id}` })),
    }, T1);
    const p2 = planSync([a, b], [remote(a, T1), remote(b, T1)], st);
    expect(p2.create).toHaveLength(0);
    expect(p2.update).toHaveLength(0);
    expect(p2.adopt).toHaveLength(0);
    expect(p2.deleteLocal).toHaveLength(0);
    expect(p2.deleteRemote).toHaveLength(0);
  });

  it('records only what SUCCEEDED, so a failed write is retried', () => {
    // ⚠️ Recording the whole plan would mark `b` as pushed when it never was,
    // and the next run would see it as unchanged and never send it — silent,
    // permanent divergence.
    const st = advanceState(emptyState(), { synced: [{ task: a, eventId: 'ev-a' }] }, T1);
    expect(st.entries.a).toBeTruthy();
    expect(st.entries.b).toBeUndefined();
    const next = planSync([a, b], [remote(a, T1)], st);
    expect(next.create.map((t) => t.id)).toEqual(['b']);
  });

  it('forgets entries for things that are gone', () => {
    const st = advanceState(synced([a, b], T0), { forgotten: ['b'] }, T1);
    expect(st.entries.a).toBeTruthy();
    expect(st.entries.b).toBeUndefined();
  });
});

describe('the per-task decisions (what the debug log prints)', () => {
  // Every sync bug in this file's history was diagnosed by working out which of
  // localChanged / remoteChanged / known was wrong, and that reasoning existed
  // only inside planSync. Recording it per task is what makes "why did THIS one
  // not sync" answerable instead of inferred from a summary count.
  const a = task('a', 'Orientation');

  it('records one row per task, with the reason', () => {
    const p = planSync([a, task('b', 'New')], [remote(a, T1)], synced([a], T0));
    expect(p.decisions).toHaveLength(2);
    const byId = Object.fromEntries(p.decisions.map((d) => [d.id, d]));
    expect(byId.b.decision).toBe('create');
    expect(byId.b.reason).toMatch(/never synced/);
    expect(byId.a.decision).toBe('adopt');
  });

  it('explains a deletion, which is the one worth being able to audit', () => {
    const p = planSync([a], [], synced([a], T0));
    expect(p.decisions[0]).toMatchObject({ id: 'a', decision: 'delete-local' });
    expect(p.decisions[0].reason).toMatch(/missing from the calendar/);
  });

  it('names a blocked task rather than staying silent about it', () => {
    const p = planSync([a], [], synced([a], T0), { unreadable: ['a'] });
    expect(p.decisions[0]).toMatchObject({ id: 'a', decision: 'blocked' });
  });

  it('covers every task exactly once, so nothing goes unexplained', () => {
    const local = [a, task('b'), task('c')];
    const p = planSync(local, [remote(a, T0 - 10)], synced([a], T0));
    expect(p.decisions.map((d) => d.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('what the user is told', () => {
  it('names what happened rather than just "synced"', () => {
    const p = planSync([task('a'), task('b')], [remote(task('c'), T1)], emptyState());
    const s = describePlan(p);
    expect(s).toMatch(/2 added/);
    expect(s).toMatch(/1 pulled in/);
  });

  it('says when there is nothing to do', () => {
    expect(describePlan(planSync([], [], emptyState()))).toBe('nothing to do');
  });
});

describe('outsideEdits — a hand edit vs our own echo', () => {
  // ⚠️ WHY THIS EXISTS. `remoteChanged` was `r.updated > lastSyncAt` — one
  // timestamp against every event. Google stamps `updated` on everything WE
  // write, so our own writes read as remote edits on the following pass. That
  // is what made a sync take five passes to settle, and it is why "the calendar
  // changed" and "we changed the calendar" were indistinguishable.
  const withEvents = (t, updated, ids) => ({ task: t, googleEventIds: ids, updated });

  it('flags an event whose updated moved past what we last knew', () => {
    const base = { 'ev-a': 1000 };
    const found = outsideEdits(base, [withEvents(task('a'), 2000, ['ev-a'])]);
    expect([...found]).toEqual(['a']);
  });

  it('⚠️ does NOT flag our own write, once the baseline has caught up', () => {
    // The executor folds what Google stamped on our writes back into the
    // baseline. Without that step this is the loop, not the fix.
    const base = { 'ev-a': 2000 };
    expect(outsideEdits(base, [withEvents(task('a'), 2000, ['ev-a'])]).size).toBe(0);
  });

  it('does not flag an event the baseline has never seen', () => {
    // A first pull would otherwise look like a calendar full of hand edits.
    // New events are the create/adopt branches' business, not this one's.
    expect(outsideEdits({}, [withEvents(task('a'), 9999, ['ev-a'])]).size).toBe(0);
  });

  it('flags a task if ANY of its parts moved', () => {
    // A split task is several events; editing any one of them is an edit to it.
    const base = { 'ev-1': 1000, 'ev-2': 1000 };
    const found = outsideEdits(base, [withEvents(task('a'), 3000, ['ev-1', 'ev-2'])]);
    expect([...found]).toEqual(['a']);
  });

  it('takes a Map as readily as an object', () => {
    const found = outsideEdits(new Map([['ev-a', 1000]]), [withEvents(task('a'), 2000, ['ev-a'])]);
    expect([...found]).toEqual(['a']);
  });
});

describe('planSync uses the baseline when given one', () => {
  it('a task WE wrote is unchanged, not adopted', () => {
    // The old rule would call this remoteChanged — `updated` is past
    // lastSyncAt — and adopt our own write straight back over the local copy.
    const t = task('a');
    const state = { lastSyncAt: 1000, entries: { a: { hash: taskHash(t), eventId: 'ev-a', dirtyAt: 0 } } };
    const r = [{ task: t, googleEventIds: ['ev-a'], updated: 5000 }];

    const without = planSync([t], r, state);
    expect(without.adopt).toHaveLength(1);              // the old behaviour

    const with_ = planSync([t], r, state, { changedOutside: new Set() });
    expect(with_.adopt).toHaveLength(0);
    expect(with_.unchanged).toEqual(['a']);
  });

  it('and still adopts a genuine hand edit', () => {
    const t = task('a');
    const state = { lastSyncAt: 9999, entries: { a: { hash: taskHash(t), eventId: 'ev-a', dirtyAt: 0 } } };
    const r = [{ task: { ...t, title: 'edited in Google' }, googleEventIds: ['ev-a'], updated: 1 }];
    // `updated` is BEFORE lastSyncAt, so the old rule would miss this entirely.
    const plan = planSync([t], r, state, { changedOutside: new Set(['a']) });
    expect(plan.adopt).toHaveLength(1);
    expect(plan.adopt[0].title).toBe('edited in Google');
  });
});
