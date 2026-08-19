// Wiring the sync to the app — design/GOOGLE-AS-STORAGE.md P3, last step.
//
// The two things that would be worst to get wrong, and neither is visible from
// a green round trip:
//   1. a GUEST must never sync. The entry screen promises "nothing leaves this
//      device" in so many words.
//   2. ADOPTING a task must not lose fields. `updateTask` would silently strip
//      load, routineId, parentId, chunking and history, because none of them
//      are in UPDATE_WHITELIST.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig, Task } from '../src/core/index.js';
import { applyLocal } from '../src/ui/useGoogleSync.js';
import { planSync, emptyState, taskHash } from '../src/core/syncPlan.js';

const at = (h) => new Date(2026, 8, 7, h, 0, 0, 0);

describe('⚠️ adopting a task must not lose fields to the whitelist', () => {
  it('keeps everything UPDATE_WHITELIST would have dropped', () => {
    // The fields below are ALL absent from UPDATE_WHITELIST, so adopting via
    // updateTask would quietly strip them on every single sync. That is why
    // `upsertTaskFromJSON` exists and why this test is the important one here.
    const rich = Task.fromJSON({
      id: 'gym-0001',
      title: 'Gym',
      startTime: at(16).getTime(),
      endTime: at(17).getTime(),
      load: { physical: 3, mental: -1, social: 0, creative: 1 },
      activityId: 'act-0007',
      routineId: 'laundry-0001',
      stepIndex: 2,
      parentId: 'essay-0002',
      chunking: { totalMinutes: 600, minChunk: 30, maxChunk: 120 },
      history: { moveCount: 4, displacedCount: 1, rippleCount: 2, carriedCount: 3 },
      energyAt: { physical: -2, mental: -3, social: 1, emotional: 0 },
      placedBy: 'user',
      dayFillAtCompletion: 0.6,
    }).toJSON();

    const s = new Schedule({ config: defaultConfig });
    applyLocal(s, { adopt: [rich], deleteLocal: [] });

    const got = s.tasks.find((t) => t.id === 'gym-0001').toJSON();
    expect(got).toEqual(rich);
    // Spelled out, so a failure names the field rather than dumping two blobs.
    for (const k of ['load', 'activityId', 'routineId', 'stepIndex', 'parentId',
      'chunking', 'history', 'energyAt', 'placedBy', 'dayFillAtCompletion']) {
      expect(got[k]).toEqual(rich[k]);
    }
  });

  it('proves updateTask WOULD have dropped them — the reason this exists', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Gym', startTime: at(16), endTime: at(17) });
    s.updateTask(t.id, { load: { physical: 3, mental: 0, social: 0, emotional: 0 }, routineId: 'r1' });
    const got = s.tasks.find((x) => x.id === t.id).toJSON();
    expect(got.load).toBe(null);        // silently dropped
    expect(got.routineId).toBe(null);   // silently dropped
  });

  it('replaces in place rather than duplicating', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Gym', startTime: at(16), endTime: at(17) });
    const edited = { ...t.toJSON(), title: 'Gym, moved' };
    applyLocal(s, { adopt: [edited], deleteLocal: [] });
    expect(s.tasks.filter((x) => x.id === t.id)).toHaveLength(1);
    expect(s.tasks.find((x) => x.id === t.id).title).toBe('Gym, moved');
  });

  it('removes what was deleted elsewhere', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Gone', startTime: at(9), endTime: at(10) });
    const r = applyLocal(s, { adopt: [], deleteLocal: [t.id] });
    expect(r.removed).toBe(1);
    expect(s.tasks).toHaveLength(0);
  });
});

describe('a full local round trip through the planner', () => {
  it('a remote edit lands on the schedule with every field intact', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Seminar', startTime: at(9), endTime: at(10), tags: ['school'] });
    const local = s.toJSON().tasks;

    // It was synced, then edited on another device with a per-task load set.
    const state = {
      lastSyncAt: 1000,
      entries: { [t.id]: { hash: taskHash(local[0]), eventId: 'ev1', dirtyAt: 0 } },
    };
    const remoteTask = { ...local[0], title: 'Seminar, moved', load: { physical: 1, mental: 2, social: 0, creative: 0 } };
    const plan = planSync(local, [{ task: remoteTask, googleEventId: 'ev1', updated: 2000 }], state);
    expect(plan.adopt).toHaveLength(1);

    applyLocal(s, plan);
    const got = s.tasks.find((x) => x.id === t.id).toJSON();
    expect(got.title).toBe('Seminar, moved');
    expect(got.load).toEqual({ mental: 2, physical: 1, social: 0, creative: 0 });
  });
});

// THE GUEST GUARANTEE is deliberately NOT tested here. It is proven where it
// actually matters, in tests/session.test.jsx, by spying on `fetch` while
// driving the real <App/> through the guest door and asserting nothing is
// called and no Google script is injected. A test in this file could only
// re-state that `enabled` is a boolean, which proves nothing — and a test that
// proves nothing is worse than no test, because it reads as coverage.
