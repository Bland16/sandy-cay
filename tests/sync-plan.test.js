// The sync planner — design/GOOGLE-AS-STORAGE.md P3.
//
// Pure, no network. Every decision that can destroy data lives here, so this is
// where it gets pinned. `design/probes/probe-sync-plan.mjs` prints the same
// cases with their reasoning.
import { describe, it, expect } from 'vitest';
import {
  planSync, markDirty, advanceState, emptyState, taskHash, describePlan,
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
    expect(p.deleteRemote[0].eventId).toBe('ev-a');
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
    expect(p.update[0].eventId).toBe('ev-a');
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
