// The sync executor, driven by a fake Google — design/GOOGLE-AS-STORAGE.md P3.
//
// No account, no network: `fakeGoogle()` is an in-memory calendar that behaves
// like the real one where it matters (assigns its own event ids, stamps
// `updated`, can be made to fail a specific write). That is enough to prove the
// end-to-end round trip AND the failure handling, which is the part that
// silently corrupts a store if it is wrong.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig, seed, Task } from '../src/core/index.js';
import { planSync, advanceState, emptyState } from '../src/core/syncPlan.js';
import { inspectCalendar, pull, applyPlan, pushLibrary } from '../src/ui/googleSync.js';
import { libraryFrom } from '../src/core/googleLibrary.js';

/**
 * An in-memory Google. Deliberately imitates the behaviours that matter:
 *   - IT assigns event ids (ours are illegal as Google ids — base32hex only)
 *   - it stamps `updated` on every write
 *   - `failOn` makes one operation throw, so partial failure can be tested
 */
function fakeGoogle({ failOn = () => false } = {}) {
  const events = new Map();
  let seq = 0;
  let clock = 1_000_000;
  const api = {
    calls: [],
    listAll: async () => [...events.values()].map((e) => ({ ...e })),
    insert: async (_cal, body) => {
      api.calls.push(['insert', body]);
      if (failOn('insert', body)) throw new Error('Google said 500');
      seq += 1;
      clock += 1;
      const id = `ev${seq}`;
      events.set(id, { ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    patch: async (_cal, id, body) => {
      api.calls.push(['patch', id]);
      if (failOn('patch', body)) throw new Error('Google said 500');
      clock += 1;
      events.set(id, { ...events.get(id), ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    remove: async (_cal, id) => {
      api.calls.push(['remove', id]);
      if (failOn('remove', id)) throw new Error('Google said 500');
      events.delete(id);
      return null;
    },
    _events: events,
    _touch: (id) => { clock += 1000; events.set(id, { ...events.get(id), updated: new Date(clock).toISOString() }); },
    _now: () => clock,
  };
  return api;
}

const sched = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addFixed({
    title: 'Orientation',
    startTime: new Date(2026, 8, 7, 9), endTime: new Date(2026, 8, 7, 10),
    tags: ['school'],
  });
  s.addFlexible({ title: 'Read for seminar', durationMin: 90, tags: ['reading'] });
  return s;
};

describe('GS-5 — the calendar guard', () => {
  it('accepts an empty calendar', async () => {
    const api = fakeGoogle();
    const r = await inspectCalendar(api, 'cal');
    expect(r.safe).toBe(true);
    expect(r.foreign).toBe(0);
  });

  it('REFUSES a calendar holding events it did not write, and names them', async () => {
    // The disaster this prevents: pointing it at `Class Schedule` and writing
    // 37 tasks in. A mis-click in a dropdown is all it would take.
    const api = fakeGoogle();
    await api.insert('cal', { summary: 'Lecture: Thermodynamics' });
    await api.insert('cal', { summary: 'Dentist' });
    const r = await inspectCalendar(api, 'cal');
    expect(r.safe).toBe(false);
    expect(r.foreign).toBe(2);
    // Named, because "2 events that are not ours" is unactionable.
    expect(r.foreignSample).toContain('Lecture: Thermodynamics');
  });

  it('still accepts a calendar that holds only OUR events', async () => {
    const api = fakeGoogle();
    const s = sched();
    const plan = planSync(s.toJSON().tasks, [], emptyState());
    await applyPlan(api, 'cal', plan, {});
    const r = await inspectCalendar(api, 'cal');
    expect(r.ours).toBe(2);
    expect(r.safe).toBe(true);
  });
});

describe('the round trip, through a fake Google', () => {
  it('pushes tasks and reads them back intact', async () => {
    const api = fakeGoogle();
    const s = sched();
    const local = s.toJSON().tasks;

    const plan = planSync(local, [], emptyState());
    expect(plan.create).toHaveLength(2);
    const applied = await applyPlan(api, 'cal', plan, {});
    expect(applied.failed).toHaveLength(0);
    expect(applied.synced).toHaveLength(2);

    const back = await pull(api, 'cal');
    expect(back.dropped).toHaveLength(0);
    expect(back.tasks.map((t) => t.task.title).sort()).toEqual(['Orientation', 'Read for seminar']);
    // Google's ids, not ours — ours are not legal Google event ids. It is a
    // LIST because one task can be several events (see encodeTaskParts).
    expect(back.tasks[0].googleEventIds).toHaveLength(1);
    expect(back.tasks[0].googleEventIds[0]).toMatch(/^ev\d+$/);
  });

  it('is idempotent — a second sync writes nothing', async () => {
    const api = fakeGoogle();
    const s = sched();
    const local = s.toJSON().tasks;

    let state = emptyState();
    const applied = await applyPlan(api, 'cal', planSync(local, [], state), {});
    state = advanceState(state, applied, api._now());

    const before = api.calls.length;
    const second = planSync(local, (await pull(api, 'cal')).tasks, state);
    await applyPlan(api, 'cal', second, {});
    expect(api.calls.length).toBe(before); // not one extra write
  });

  it('an edit UPDATES the same event rather than creating a second one', async () => {
    // ⚠️ The update path has to record the event id it patched, or the next
    // sync sees the task as never-synced and CREATES it again — one task, two
    // events, forever. Mutation found this untested.
    const api = fakeGoogle();
    const s = sched();
    let state = emptyState();
    let applied = await applyPlan(api, 'cal', planSync(s.toJSON().tasks, [], state), {});
    state = advanceState(state, applied, api._now());
    expect(api._events.size).toBe(2);

    // Edit locally and sync again.
    const edited = s.toJSON().tasks.map(
      (t) => (t.title === 'Orientation' ? { ...t, title: 'Orientation, moved' } : t),
    );
    const plan = planSync(edited, (await pull(api, 'cal')).tasks, state);
    expect(plan.update).toHaveLength(1);
    expect(plan.create).toHaveLength(0);
    applied = await applyPlan(api, 'cal', plan, {});
    state = advanceState(state, applied, api._now());

    expect(api._events.size).toBe(2);                       // no duplicate
    const back = await pull(api, 'cal');
    expect(back.tasks.map((t) => t.task.title).sort()).toEqual(['Orientation, moved', 'Read for seminar']);

    // And a third pass settles rather than churning.
    const third = planSync(edited, back.tasks, state);
    expect(third.create).toHaveLength(0);
    expect(third.update).toHaveLength(0);
  });

  it('propagates a local delete to Google', async () => {
    const api = fakeGoogle();
    const s = sched();
    let state = emptyState();
    const applied = await applyPlan(api, 'cal', planSync(s.toJSON().tasks, [], state), {});
    state = advanceState(state, applied, api._now());
    expect(api._events.size).toBe(2);

    // Delete one locally, then sync.
    const remaining = s.toJSON().tasks.filter((t) => t.title !== 'Orientation');
    const plan = planSync(remaining, (await pull(api, 'cal')).tasks, state);
    expect(plan.deleteRemote).toHaveLength(1);
    const r = await applyPlan(api, 'cal', plan, {});
    expect(r.forgotten).toHaveLength(1);
    expect(api._events.size).toBe(1);
  });

  it('sees an edit made in Google as a remote change', async () => {
    const api = fakeGoogle();
    const s = sched();
    let state = emptyState();
    const applied = await applyPlan(api, 'cal', planSync(s.toJSON().tasks, [], state), {});
    state = advanceState(state, applied, api._now());

    // Somebody moves it in Google Calendar.
    const [id] = [...api._events.keys()];
    api._touch(id);

    const plan = planSync(s.toJSON().tasks, (await pull(api, 'cal')).tasks, state);
    expect(plan.adopt.length + plan.conflicts.length).toBeGreaterThan(0);
  });
});

describe('⚠️ partial failure — the obligation the planner handed over', () => {
  it('reports ONLY confirmed writes, so a failure is retried not forgotten', async () => {
    // If this file ever reported the PLAN instead of the CONFIRMED results, the
    // failed task would be marked as pushed and never sent again: it exists
    // here, not there, and every later sync calls it "unchanged". Silent,
    // permanent divergence.
    const api = fakeGoogle({ failOn: (op, body) => op === 'insert' && body.summary === 'Read for seminar' });
    const s = sched();
    const local = s.toJSON().tasks;

    let state = emptyState();
    const applied = await applyPlan(api, 'cal', planSync(local, [], state), {});
    expect(applied.synced).toHaveLength(1);
    expect(applied.failed).toHaveLength(1);
    expect(applied.failed[0].op).toBe('create');

    state = advanceState(state, applied, api._now());
    // The failed one must still look un-synced.
    const retry = planSync(local, (await pull(api, 'cal')).tasks, state);
    expect(retry.create.map((t) => t.title)).toEqual(['Read for seminar']);
  });

  it('one bad write does not abort the rest of the run', async () => {
    const api = fakeGoogle({ failOn: (op, body) => op === 'insert' && body.summary === 'Orientation' });
    const s = sched();
    const applied = await applyPlan(api, 'cal', planSync(s.toJSON().tasks, [], emptyState()), {});
    expect(applied.synced).toHaveLength(1);
    expect(applied.failed).toHaveLength(1);
  });

  it('refuses to record a create that came back without an id', async () => {
    // Nothing to update next time, so recording it would strand the task.
    const api = fakeGoogle();
    api.insert = async () => ({});
    const applied = await applyPlan(api, 'cal', planSync(sched().toJSON().tasks, [], emptyState()), {});
    expect(applied.synced).toHaveLength(0);
    expect(applied.failed).toHaveLength(2);
  });
});

describe('a task split across several events (the gym)', () => {
  // Mon 16:15, Wed 19:00, Sat 14:00 — three times, so three Google events,
  // because an RRULE carries exactly one time.
  const gymTask = () => Task.fromJSON({
    id: 'gym-0001',
    title: 'Gym',
    startTime: new Date(2026, 8, 7, 16, 15).getTime(),
    endTime: new Date(2026, 8, 7, 17, 15).getTime(),
    recurrence: {
      anchorDate: null,
      exceptions: [],
      periods: [{
        windows: [
          { day: 'mon', start: '16:15', end: '17:15' },
          { day: 'wed', start: '19:00', end: '20:00' },
          { day: 'sat', start: '14:00', end: '15:00' },
        ],
        interval: 1,
        effectiveFrom: null,
        effectiveUntil: null,
      }],
    },
  }).toJSON();

  it('writes three events and reads back ONE task', async () => {
    const api = fakeGoogle();
    const local = [gymTask()];
    const applied = await applyPlan(api, 'cal', planSync(local, [], emptyState()), {});
    expect(applied.failed).toHaveLength(0);
    expect(api._events.size).toBe(3);

    const back = await pull(api, 'cal');
    // ONE task, not three — otherwise the app would grow a duplicate per part.
    expect(back.tasks).toHaveLength(1);
    expect(back.tasks[0].task.id).toBe('gym-0001');
    expect(back.tasks[0].googleEventIds).toHaveLength(3);
    expect(back.incomplete).toHaveLength(0);
  });

  it('keeps the three real times, which is the whole point', async () => {
    const api = fakeGoogle();
    await applyPlan(api, 'cal', planSync([gymTask()], [], emptyState()), {});
    const times = [...api._events.values()]
      .map((e) => new Date(e.start.dateTime))
      .map((d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
      .sort();
    expect(times).toEqual(['14:00', '16:15', '19:00']);
  });

  it('every part carries a rule Google will accept', async () => {
    // Google rejects an RRULE whose BYDAY excludes DTSTART — that is how a
    // repeating task vanished from the calendar entirely.
    const api = fakeGoogle();
    await applyPlan(api, 'cal', planSync([gymTask()], [], emptyState()), {});
    const code = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    for (const e of api._events.values()) {
      const day = code[new Date(e.start.dateTime).getDay()];
      const byday = /BYDAY=([^;]+)/.exec(e.recurrence[0])[1].split(',');
      expect(byday).toContain(day);
    }
  });

  it('an edit patches the three in place rather than duplicating them', async () => {
    const api = fakeGoogle();
    let state = emptyState();
    let applied = await applyPlan(api, 'cal', planSync([gymTask()], [], state), {});
    state = advanceState(state, applied, api._now());
    expect(api._events.size).toBe(3);

    const edited = { ...gymTask(), title: 'Gym (evenings)' };
    const plan = planSync([edited], (await pull(api, 'cal')).tasks, state);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].eventIds).toHaveLength(3);
    applied = await applyPlan(api, 'cal', plan, {});
    expect(applied.failed).toHaveLength(0);
    expect(api._events.size).toBe(3);                       // still three
    const back = await pull(api, 'cal');
    expect(back.tasks[0].task.title).toBe('Gym (evenings)');
  });

  it('deleting the task removes ALL of its events', async () => {
    const api = fakeGoogle();
    let state = emptyState();
    const applied = await applyPlan(api, 'cal', planSync([gymTask()], [], state), {});
    state = advanceState(state, applied, api._now());
    const plan = planSync([], (await pull(api, 'cal')).tasks, state);
    expect(plan.deleteRemote[0].eventIds).toHaveLength(3);
    await applyPlan(api, 'cal', plan, {});
    expect(api._events.size).toBe(0);                       // no orphans left
  });

  it('reports a task whose parts do not all come back', async () => {
    // Half a gym week is not a gym week. `sc.parts` is what makes that visible
    // instead of silently looking like a smaller routine.
    const api = fakeGoogle();
    await applyPlan(api, 'cal', planSync([gymTask()], [], emptyState()), {});
    const [firstId] = [...api._events.keys()];
    api._events.delete(firstId);                            // deleted by hand

    const back = await pull(api, 'cal');
    expect(back.incomplete).toHaveLength(1);
    expect(back.incomplete[0]).toMatchObject({ id: 'gym-0001', found: 2, expected: 3 });
  });
});

describe('the library', () => {
  it('round-trips through the calendar', async () => {
    const api = fakeGoogle();
    const json = seed().toJSON();
    await pushLibrary(api, 'cal', json);
    const back = await pull(api, 'cal');
    expect(back.library).toEqual(libraryFrom(json));
  });

  it('replaces the old one rather than accumulating', async () => {
    const api = fakeGoogle();
    const json = seed().toJSON();
    await pushLibrary(api, 'cal', json);
    const r = await pushLibrary(api, 'cal', json);
    expect(r.replaced).toBeGreaterThan(0);
    const libs = [...api._events.values()].filter(
      (e) => e.extendedProperties?.private?.['sc.kind'] === 'library',
    );
    expect(libs).toHaveLength(r.events);
    // and it still decodes — two libraries at once would be rejected
    expect((await pull(api, 'cal')).library).toEqual(libraryFrom(json));
  });

  it('keeps the OLD library if writing the new one fails', async () => {
    // ⚠️ Crash-safety, and the reason the delete comes after the writes. Losing
    // power between them must leave a DUPLICATE library — which decodeLibrary
    // rejects loudly — rather than NONE, which looks like a first run and would
    // silently start the user over with an empty library.
    //
    // Invisible from the final state, so it needs the write to actually fail.
    const api = fakeGoogle();
    const json = seed().toJSON();
    await pushLibrary(api, 'cal', json);
    const before = [...api._events.values()].filter(
      (e) => e.extendedProperties?.private?.['sc.kind'] === 'library',
    ).length;
    expect(before).toBeGreaterThan(0);

    api.insert = async () => { throw new Error('Google said 500'); };
    await expect(pushLibrary(api, 'cal', json)).rejects.toThrow();

    const after = [...api._events.values()].filter(
      (e) => e.extendedProperties?.private?.['sc.kind'] === 'library',
    ).length;
    expect(after).toBe(before);          // the old one survived
    expect((await pull(api, 'cal')).library).toEqual(libraryFrom(json));
  });

  it('does not mistake library events for tasks', async () => {
    const api = fakeGoogle();
    await pushLibrary(api, 'cal', seed().toJSON());
    const back = await pull(api, 'cal');
    expect(back.tasks).toHaveLength(0);
    expect(back.dropped).toHaveLength(0);
  });
});

describe('reading a calendar that has junk in it', () => {
  it('skips foreign events silently but REPORTS ones of ours that will not decode', async () => {
    // A calendar may hold anything, so a foreign event is not an error. One of
    // OURS that will not decode is corruption, and staying quiet about it is how
    // it becomes permanent.
    const api = fakeGoogle();
    await api.insert('cal', { summary: 'Dentist' });
    await applyPlan(api, 'cal', planSync(sched().toJSON().tasks, [], emptyState()), {});
    const [, id] = [...api._events.keys()];
    const ev = api._events.get(id);
    ev.extendedProperties.private['sc.json.0'] = 'wrecked';

    const back = await pull(api, 'cal');
    expect(back.dropped).toHaveLength(1);
    expect(back.dropped[0].error).toMatch(/checksum/);
    expect(back.tasks).toHaveLength(1); // the healthy one still comes through
  });

  it('names WHICH TASK is unreadable, not just which event', async () => {
    // ⚠️ The event id is useless to the planner. It needs the TASK id, or it
    // sees the task as absent from Google and deletes the local copy —
    // corruption finished off by the check that caught it. `sc.id` is its own
    // property, so it survives a wrecked payload.
    const api = fakeGoogle();
    const s = sched();
    await applyPlan(api, 'cal', planSync(s.toJSON().tasks, [], emptyState()), {});
    const [id] = [...api._events.keys()];
    const wrecked = api._events.get(id);
    const taskId = wrecked.extendedProperties.private['sc.id'];
    wrecked.extendedProperties.private['sc.json.0'] = 'wrecked';

    const back = await pull(api, 'cal');
    expect(back.dropped[0].taskId).toBe(taskId);
    expect(back.unreadable.has(taskId)).toBe(true);

    // And end to end: the planner leaves it alone rather than deleting it.
    const state = {
      lastSyncAt: Date.now(),
      entries: Object.fromEntries(s.toJSON().tasks.map((t) => [t.id, { hash: 'x', eventId: null, dirtyAt: 0 }])),
    };
    const plan = planSync(s.toJSON().tasks, back.tasks, state, { unreadable: back.unreadable });
    expect(plan.deleteLocal).not.toContain(taskId);
    expect(plan.blocked).toContain(taskId);
  });
});
