// @vitest-environment jsdom
// Todos — one all-day event each, synced per item (design/TODO-LIST.md §9.3,
// §9.4, and the audit in §9.11).
//
// Two halves. The encoding is pure and tested as such. The SYNC is driven
// through the REAL hook, the REAL `pull` and the REAL `applyPlan`, against a
// fake Google that is only a list of events — because HANDOFF's lesson is that
// the thing under test was always fine and everything around it was broken:
// what triggers it, what happens after a guard fires, whether it converges.
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  Schedule, Todo, UNDATED, defaultConfig, seedStarterBuckets, resetIds, setIdRandom,
} from '../src/core/index.js';
import {
  encodeTodo, decodeTodoEvent, isTodoEvent, KIND_TODO, TODO_ENCODING_VERSION,
} from '../src/core/googleTodos.js';
import { decodeEvent, ENCODING_VERSION } from '../src/core/googleEncode.js';
import { dayKindOf } from '../src/core/googleDayNotes.js';

vi.mock('../src/ui/google.js', () => ({
  getAccessToken: vi.fn(async () => 'token-1'),
  cachedAccessToken: () => 'token-1',
  clearAccessToken: () => {},
  readClientId: () => 'client',
  listAllEvents: vi.fn(),
  insertEvent: vi.fn(),
  patchEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

/** todo / library / daynote / blocked, and everything else of ours is a task. */
const NOT_TASKS = ['todo', 'library', 'daynote', 'blocked'];
const kindOfEvent = (ev) => {
  const k = ev.extendedProperties.private['sc.kind'];
  return NOT_TASKS.includes(k) ? k : 'task';
};

// ── A fake Google: a list of events, and a clock that only moves forward. ──
let clock = 0;
let calendar = [];
let log = [];
let failRemove = false;
const tick = () => { clock += 1000; return clock; };
const stamp = () => new Date(tick()).toISOString();
const fakeApi = {
  listAll: async () => calendar.map((e) => JSON.parse(JSON.stringify(e))),
  insert: async (_cal, body) => {
    const ev = { ...JSON.parse(JSON.stringify(body)), id: `ev-${tick()}`, updated: stamp() };
    calendar.push(ev);
    log.push(['insert', kindOfEvent(body), body.summary]);
    return ev;
  },
  patch: async (_cal, id, body) => {
    const i = calendar.findIndex((e) => e.id === id);
    if (i < 0) throw new Error('404');
    calendar[i] = { ...JSON.parse(JSON.stringify(body)), id, updated: stamp() };
    log.push(['patch', kindOfEvent(body), body.summary]);
    return calendar[i];
  },
  remove: async (_cal, id) => {
    if (failRemove) throw new Error('500');
    const i = calendar.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [gone] = calendar.splice(i, 1);
    log.push(['remove', kindOfEvent(gone), gone.summary]);
  },
};

vi.mock('../src/ui/googleSync.js', async (original) => ({
  ...(await original()),
  makeApi: () => fakeApi,
}));

const { useGoogleSync, SYNC_CALENDAR_KEY, SYNC_STATE_KEY } = await import('../src/ui/useGoogleSync.js');
const { pull } = await import('../src/ui/googleSync.js');

const D = (d, h = 0, m = 0) => new Date(2026, 6, d, h, m, 0, 0);
const wideCfg = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });

beforeEach(() => {
  resetIds();
  clock = Date.UTC(2026, 6, 15, 12);
  calendar = [];
  log = [];
  failRemove = false;
  window.localStorage.clear();
});
afterEach(() => { setIdRandom(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('the encoding', () => {
  const priv = (ev) => ev.extendedProperties.private;

  it('a dated todo is an all-day event on its due day, and never marks you busy', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'Email the registrar', deadline: '2026-10-03', tags: ['admin'] }));
    expect(ev.summary).toBe('Email the registrar');
    expect(ev.start).toEqual({ date: '2026-10-03' });
    expect(ev.end).toEqual({ date: '2026-10-04' }); // exclusive
    expect(ev.transparency).toBe('transparent');
    expect(priv(ev)['sc.kind']).toBe(KIND_TODO);
    expect(priv(ev)['sc.id']).toBe('t1');
    expect(ev.recurrence).toBeUndefined();
  });

  it('an undated one sits on 1970-01-01, out of sight, for ONE day', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'x' }));
    expect(ev.start).toEqual({ date: UNDATED });
    expect(ev.end).toEqual({ date: '1970-01-02' });
  });

  it('the native fields are not carried twice', () => {
    const p = priv(encodeTodo(new Todo({ id: 't1', label: 'Secret label', deadline: '2026-10-03' })));
    const payload = Object.keys(p).filter((k) => /^sc\.json\.\d+$/.test(k)).map((k) => p[k]).join('');
    expect(payload).not.toMatch(/Secret label/);
    expect(payload).not.toMatch(/2026-10-03/);
  });

  it.each([
    ['dated', { id: 't1', label: 'A', deadline: '2026-10-03', tags: ['admin'], durationMin: 15, durationMax: 45 }],
    ['undated', { id: 't2', label: 'B' }],
  ])('⚠️ %s: decodes to EXACTLY what the todo serialises as', (_n, data) => {
    // Not tidiness. The sync hashes both; a `null` missing or a key out of
    // order reads as an edit on every pass and never settles.
    const todo = new Todo(data);
    const back = decodeTodoEvent(encodeTodo(todo));
    expect(back.ok).toBe(true);
    expect(JSON.stringify(back.todo)).toBe(JSON.stringify(todo.toJSON()));
  });

  it('a rename in Google lands (GS-4)', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'Old' }));
    expect(decodeTodoEvent({ ...ev, summary: 'New' }).todo.label).toBe('New');
  });

  it('dragged onto a day in Google, it gains that deadline; dragged back to 1970, it loses it', () => {
    const undated = encodeTodo(new Todo({ id: 't1', label: 'x' }));
    const moved = { ...undated, start: { date: '2026-11-02' }, end: { date: '2026-11-03' } };
    expect(decodeTodoEvent(moved).todo.deadline).toBe('2026-11-02');

    const dated = encodeTodo(new Todo({ id: 't1', label: 'x', deadline: '2026-11-02' }));
    const back = { ...dated, start: { date: UNDATED }, end: { date: '1970-01-02' } };
    expect(decodeTodoEvent(back).todo.deadline).toBeNull();
  });

  it('given a TIME in Google, its day is still the deadline', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'x', deadline: '2026-11-02' }));
    const timed = { ...ev, start: { dateTime: '2026-11-05T14:00:00-05:00' }, end: { dateTime: '2026-11-05T15:00:00-05:00' } };
    expect(decodeTodoEvent(timed).todo.deadline).toBe('2026-11-05');
  });

  it('⚠️ a corrupt one is REFUSED with its id — unreadable, never "deleted"', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'x', tags: ['admin'] }));
    ev.extendedProperties.private['sc.json.0'] += 'garbage';
    const d = decodeTodoEvent(ev);
    expect(d.ok).toBe(false);
    expect(d.id).toBe('t1');
    expect(d.error).toBeTruthy();
  });

  it('an instance of a todo somebody made repeat in Google is skipped, not read as the todo', () => {
    const ev = { ...encodeTodo(new Todo({ id: 't1', label: 'x' })), recurringEventId: 'master' };
    expect(decodeTodoEvent(ev)).toMatchObject({ ok: false, skip: true, id: 't1' });
  });

  it('a todo written by a NEWER build is refused, not half-read', () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'x' }));
    ev.extendedProperties.private['sc.v'] = String(TODO_ENCODING_VERSION + 1);
    expect(decodeTodoEvent(ev)).toMatchObject({ ok: false, id: 't1' });
  });

  it('something that is not a todo is not ours to decode', () => {
    expect(isTodoEvent({ extendedProperties: { private: { 'sc.id': 'x' } } })).toBe(false);
    expect(decodeTodoEvent({}).notOurs).toBe(true);
  });
});

describe('⚠️ an OLD bundle on the other device must not eat todos (§9.11 A-1)', () => {
  // An old `pull` does not know `sc.kind = 'todo'`. It routes on `sc.id`, finds
  // `dayKindOf` null, and hands the event to the TASK decoder — which ignores
  // `sc.kind` and accepts any version up to its own. At the shared version it
  // adopted every todo as a task and wrote it back as a timed one. These two
  // facts are what an old bundle does; the third is what stops it.
  const ev = () => encodeTodo(new Todo({ id: 't1', label: 'Email the registrar', deadline: '2026-10-03' }));

  it('the day-kind router does not claim it, so it reaches the task decoder', () => {
    expect(dayKindOf(ev())).toBeNull();
  });

  it('and the task decoder REFUSES it as newer, reporting its id (so: unreadable, left alone)', () => {
    const r = decodeEvent(ev());
    expect(r.ok).toBe(false);
    expect(r.id).toBe('t1');
    expect(TODO_ENCODING_VERSION).toBeGreaterThan(ENCODING_VERSION);
  });

  it('whereas at the shared version it would have been read as a task — the bug', () => {
    const e = ev();
    e.extendedProperties.private['sc.v'] = String(ENCODING_VERSION);
    expect(decodeEvent(e).ok).toBe(true);
  });
});

describe('pull routes a todo to `todos`, never to `tasks`', () => {
  it('reads it back, and reports a corrupt one as unreadable by id', async () => {
    const good = { ...encodeTodo(new Todo({ id: 't1', label: 'Good', deadline: '2026-10-03' })), id: 'ev-1', updated: '2026-07-15T12:00:00Z' };
    const bad = { ...encodeTodo(new Todo({ id: 't2', label: 'Bad', tags: ['a'] })), id: 'ev-2', updated: '2026-07-15T12:00:00Z' };
    bad.extendedProperties.private['sc.json.0'] += 'x';
    calendar = [good, bad];

    const remote = await pull(fakeApi, 'cal');

    expect(remote.tasks).toHaveLength(0);
    expect(remote.todos.map((r) => [r.task.id, r.task.label, r.task.deadline, r.googleEventIds])).toEqual([
      ['t1', 'Good', '2026-10-03', ['ev-1']],
    ]);
    expect([...remote.unreadableTodos]).toEqual(['t2']);
    expect([...remote.unreadable]).toEqual([]); // not a TASK's problem
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Two devices, one fake calendar, the real hook.
// ═══════════════════════════════════════════════════════════════════════════

/** Let every pending promise in a pass finish. */
const settle = async () => {
  for (let i = 0; i < 60; i += 1) await act(async () => { await Promise.resolve(); });
};

/**
 * A device: its own schedule, its own in-memory sync record. localStorage is
 * shared by jsdom, so the stored record is cleared before each mount — a hook
 * reads it once, on mount, and keeps its own copy after that.
 */
async function device() {
  const sched = new Schedule({ config: wideCfg() });
  seedStarterBuckets(sched);
  const toasts = [];
  window.localStorage.removeItem(SYNC_STATE_KEY);
  window.localStorage.setItem(SYNC_CALENDAR_KEY, JSON.stringify('cal-1'));
  const hook = renderHook(() => useGoogleSync({
    enabled: true, sched, mutate: (fn) => fn(sched), version: 1, showToast: (m) => toasts.push(m), now: tick,
  }));
  await settle();
  const sync = async () => { await act(async () => { await hook.result.current.syncNow(); }); await settle(); };
  return { sched, toasts, hook, sync, status: () => hook.result.current.status, error: () => hook.result.current.lastError };
}

const todoEvents = () => calendar.filter((e) => kindOfEvent(e) === 'todo');
const taskEvents = () => calendar.filter((e) => kindOfEvent(e) === 'task');
const quietPass = async (dev) => {
  const before = log.length;
  await dev.sync();
  return log.slice(before).filter(([, kind]) => kind !== 'library');
};

describe('two devices', () => {
  it('a todo added on one arrives on the other, and then everything is QUIET', async () => {
    const a = await device();
    const b = await device();

    a.sched.addTodo({ label: 'Email the registrar', deadline: '2026-10-03', tags: ['admin'] });
    await a.sync();
    expect(todoEvents().map((e) => [e.summary, e.start.date, e.extendedProperties.private['sc.v']]))
      .toEqual([['Email the registrar', '2026-10-03', '2']]);

    await b.sync();
    expect(b.sched.todos.map((t) => [t.label, t.deadline, t.tags])).toEqual([['Email the registrar', '2026-10-03', ['admin']]]);
    expect(b.sched.todos[0]).toBeInstanceOf(Todo);
    expect(b.sched.todos[0].id).toBe(a.sched.todos[0].id);

    // ⚠️ Convergence. Every sync bug in this project's history that a single
    // pass could not see: nobody writes anything on the passes that follow.
    expect(await quietPass(a)).toEqual([]);
    expect(await quietPass(b)).toEqual([]);
    expect(await quietPass(a)).toEqual([]);
    expect([a.status(), b.status()]).toEqual(['idle', 'idle']);
  });

  it('⚠️ DONE on one: it leaves the other, its task arrives, and it never comes back', async () => {
    const a = await device();
    const b = await device();
    const todo = a.sched.addTodo({ label: 'Return library books' });
    await a.sync();
    await b.sync();
    expect(b.sched.todos).toHaveLength(1);

    a.sched.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });
    const before = log.length;
    await a.sync();
    const wrote = log.slice(before).filter(([, kind]) => kind !== 'library');
    // The todo goes BEFORE the task is written.
    expect(wrote.map(([op, kind]) => `${op} ${kind}`)).toEqual(['remove todo', 'insert task']);
    expect(todoEvents()).toHaveLength(0);
    expect(taskEvents()).toHaveLength(1);

    await b.sync();
    expect(b.sched.todos).toHaveLength(0);
    expect(b.sched.tasks.map((t) => t.title)).toEqual(['Return library books']);

    expect(await quietPass(a)).toEqual([]);
    // B took the TASK in from the calendar, and a task (unlike a todo) is only
    // recorded as synced once it has been echoed back up — existing behaviour,
    // see `recordLocalHalf`. So B's next pass may patch that task once. What
    // must not happen is any write to a TODO, and it must then go quiet.
    expect((await quietPass(b)).filter(([, kind]) => kind === 'todo')).toEqual([]);
    expect(await quietPass(b)).toEqual([]);
    await a.sync();
    expect(await quietPass(a)).toEqual([]);
    expect(await quietPass(b)).toEqual([]);
    expect(a.sched.todos).toHaveLength(0);
    expect(b.sched.todos).toHaveLength(0);
    expect(todoEvents()).toHaveLength(0);
    expect(taskEvents()).toHaveLength(1);
  });

  it('done on A while B edited it, before either synced: done wins, and B is not left with a ghost', async () => {
    const a = await device();
    const b = await device();
    const todo = a.sched.addTodo({ label: 'Call the bank' });
    await a.sync();
    await b.sync();

    a.sched.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });
    b.sched.updateTodo(todo.id, { label: 'Call the bank about the card' });
    await a.sync();
    await b.sync();

    expect(b.sched.todos).toHaveLength(0);
    expect(todoEvents()).toHaveLength(0);
    expect(b.sched.tasks.map((t) => t.title)).toEqual(['Call the bank']);
  });

  it('a rename made IN GOOGLE is adopted, once, and then it is quiet', async () => {
    const a = await device();
    a.sched.addTodo({ label: 'Draft outline' });
    await a.sync();

    const ev = todoEvents()[0];
    ev.summary = 'Draft lit review outline';
    ev.updated = stamp();
    await a.sync();

    expect(a.sched.todos[0].label).toBe('Draft lit review outline');
    expect(await quietPass(a)).toEqual([]);
  });

  it('an edit here goes up as a PATCH to the same event — a deadline moves it, nothing is re-created', async () => {
    const a = await device();
    const t = a.sched.addTodo({ label: 'x' });
    await a.sync();
    const id = todoEvents()[0].id;

    a.sched.updateTodo(t.id, { deadline: '2026-10-09' });
    const wrote = await quietPass(a);

    expect(wrote.map(([op, kind]) => `${op} ${kind}`)).toEqual(['patch todo']);
    expect(todoEvents().map((e) => [e.id, e.start.date])).toEqual([[id, '2026-10-09']]);
  });

  it('a corrupt todo event is left ALONE on both sides', async () => {
    const a = await device();
    const t = a.sched.addTodo({ label: 'x', tags: ['admin'] });
    await a.sync();
    todoEvents()[0].extendedProperties.private['sc.json.0'] += 'garbage';

    await a.sync();

    expect(a.sched.todos.map((x) => x.id)).toEqual([t.id]);
    expect(todoEvents()).toHaveLength(1);
  });
});

describe('⚠️ the bulk-delete guard, for a list whose whole point is being finished', () => {
  const four = async () => {
    const a = await device();
    const b = await device();
    const todos = ['One', 'Two', 'Three', 'Four'].map((label) => a.sched.addTodo({ label }));
    await a.sync();
    await b.sync();
    expect(b.sched.todos).toHaveLength(4);
    return { a, b, todos };
  };

  it('finishing 3 of 4 on the phone does NOT stop the laptop\'s sync', async () => {
    // "≥3 and ≥half" is what a productive afternoon looks like.
    const { a, b, todos } = await four();
    todos.slice(0, 3).forEach((t, i) => a.sched.placeActivity(t, D(15, 14 + i), 30, { now: D(15, 13) }));
    await a.sync();

    await b.sync();

    expect(b.status()).toBe('idle');
    expect(b.sched.todos.map((t) => t.label)).toEqual(['Four']);
    expect(b.sched.tasks).toHaveLength(3);
  });

  it('⚠️ finishing ALL of them does not stop it either — and the device still syncs afterwards', async () => {
    // "The calendar has no todos" was the first discriminator tried, and it is
    // exactly what an emptied list looks like: B ended in `error` for good, the
    // four tasks never arrived, and nothing B added was ever pushed.
    const { a, b, todos } = await four();
    todos.forEach((t, i) => a.sched.placeActivity(t, D(15, 14 + i), 30, { now: D(15, 13) }));
    await a.sync();

    await b.sync();

    expect(b.status()).toBe('idle');
    expect(b.sched.todos).toHaveLength(0);
    expect(b.sched.tasks).toHaveLength(4);

    b.sched.addTodo({ label: 'A new one, from the laptop' });
    await b.sync();
    expect(todoEvents().map((e) => e.summary)).toEqual(['A new one, from the laptop']);
  });

  it('but a calendar holding NOTHING of ours still stops it, and removes nothing', async () => {
    // What a re-made calendar looks like: not "no todos", but nothing at all.
    const { b } = await four();
    calendar = [];

    await b.sync();

    expect(b.status()).toBe('error');
    expect(b.error()).toMatch(/todos/);
    expect(b.sched.todos).toHaveLength(4);
  });
});

describe('bug-check, 2026-10-04', () => {
  it('⚠️ a copy of a todo made in Google does not bring the finished todo back', async () => {
    // Two events, one `sc.id`. Listed separately the planner kept one and
    // "Do it now" deleted one; the survivor re-adopted the todo everywhere.
    const a = await device();
    const todo = a.sched.addTodo({ label: 'Dup me' });
    await a.sync();
    const copy = { ...JSON.parse(JSON.stringify(todoEvents()[0])), id: 'ev-copy', updated: stamp() };
    calendar.push(copy);
    await a.sync();
    expect(a.sched.todos).toHaveLength(1); // still ONE todo

    a.sched.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });
    await a.sync();
    await a.sync();

    expect(todoEvents()).toHaveLength(0);
    expect(a.sched.todos).toHaveLength(0);
    expect(a.sched.tasks).toHaveLength(1);
  });

  it('⚠️ "this device is right" does not make the sync deaf to a todo renamed in Google', async () => {
    // `pushAllTasksNow` rebuilt the baseline from tasks alone, so the todo's
    // event dropped out of it and its next edit read as "never seen".
    const a = await device();
    a.sched.addTodo({ label: 'Draft' });
    await a.sync();

    await act(async () => { await a.hook.result.current.pushAllTasksNow(); });
    const ev = todoEvents()[0];
    ev.summary = 'Renamed in Google';
    ev.updated = stamp();
    await a.sync();

    expect(a.sched.todos[0].label).toBe('Renamed in Google');
  });

  it('a todo event with no id is refused — not adopted under a new random id each pull', async () => {
    const ev = encodeTodo(new Todo({ id: 't1', label: 'x' }));
    ev.extendedProperties.private['sc.id'] = '';
    expect(decodeTodoEvent(ev)).toMatchObject({ ok: false, id: null });

    const a = await device();
    calendar.push({ ...ev, id: 'ev-noid', updated: stamp() });
    await a.sync();
    await a.sync();
    expect(a.sched.todos).toHaveLength(0);
  });

  it('a corrupt TODO does not freeze a TASK that happens to share its id', async () => {
    const a = await device();
    const b = await device();
    const task = a.sched.addFlexible({ title: 'Shared', startTime: D(15, 9), endTime: D(15, 10) });
    await a.sync();
    await b.sync();
    await b.sync();
    const bad = { ...encodeTodo(new Todo({ id: task.id, label: 'Shared', tags: ['x'] })), id: 'ev-bad', updated: stamp() };
    bad.extendedProperties.private['sc.json.0'] += 'garbage';
    calendar.push(bad);

    a.sched.removeTask(task.id);
    await a.sync();
    await b.sync();

    // The task's deletion still reaches B; only the corrupt todo is left alone.
    expect(b.sched.tasks).toHaveLength(0);
    expect(calendar.some((e) => e.id === 'ev-bad')).toBe(true);
  });
});

describe('a failed delete is retried, not forgotten', () => {
  it('the todo event that would not go is removed on the next pass', async () => {
    const a = await device();
    const todo = a.sched.addTodo({ label: 'x' });
    await a.sync();

    a.sched.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });
    failRemove = true;
    await a.sync();
    expect(todoEvents()).toHaveLength(1); // still there
    expect(a.sched.todos).toHaveLength(0); // and NOT adopted back as a new todo

    failRemove = false;
    await a.sync();
    expect(todoEvents()).toHaveLength(0);
    expect(a.sched.todos).toHaveLength(0);
  });
});
