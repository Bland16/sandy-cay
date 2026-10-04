// Todos — the model (design/TODO-LIST.md §9.1, §9.2, §9.5, §9.6).
//
// A todo is an Activity that lives in `schedule.todos` and is done by being
// placed. These tests are the audit's list (§9.11 A-7…A-13): every one names
// the failure it would have caught.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Schedule, Todo, Activity, UNDATED, resetIds, setIdRandom, defaultConfig, seedStarterBuckets,
} from '../src/core/index.js';
import {
  libraryFrom, missingFromLibrary, applyLibrary, RESTORABLE_KEYS, LIBRARY_KEYS,
} from '../src/core/googleLibrary.js';
import { taskHash } from '../src/core/syncPlan.js';

const D = (d, h = 0, m = 0) => new Date(2026, 6, d, h, m, 0, 0); // July 2026; the 15th is a Wednesday
const wideCfg = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });
const fresh = () => {
  const s = new Schedule({ config: wideCfg() });
  seedStarterBuckets(s);
  return s;
};

beforeEach(() => resetIds());
afterEach(() => setIdRandom());

describe('a Todo is an Activity, with a todo\'s defaults', () => {
  it('defaults to 15–30 minutes, not an activity\'s 15–60', () => {
    const t = new Todo({ label: 'Email the registrar' });
    expect([t.durationMin, t.durationMax]).toEqual([15, 30]);
    expect(t).toBeInstanceOf(Activity);
    expect(t.isTodo).toBe(true);
    expect(new Activity({ label: 'Read' }).isTodo).toBeUndefined();
  });

  it('⚠️ can never be a routine, hold a bucket, a dial or a priority', () => {
    const t = new Todo({
      label: 'x', steps: [{ label: 'a', kind: 'active', durationMin: 5 }], travelMin: 20,
      bucketId: 'study-bkt', load: { mental: 2 }, priority: 3,
    });
    expect(t.isRoutine).toBe(false);
    expect([t.steps, t.travelMin, t.bucketId, t.load, t.priority]).toEqual([null, 0, null, null, null]);
  });

  it('inherits the fill-the-opening rule', () => {
    const t = new Todo({ label: 'x', durationMin: 15, durationMax: 30 });
    expect(t.durationFor(20)).toBe(20);
    expect(t.durationFor(90)).toBe(30);
    expect(t.fits(10)).toBe(false);
  });
});

describe('the deadline is a real date or nothing', () => {
  it.each([
    ['2026-10-03', '2026-10-03'],
    [new Date(2026, 9, 3, 23, 30), '2026-10-03'], // a LOCAL date, late in the evening
    [null, null],
    ['', null],
    ['garbage', null],
    ['2026-02-31', null],  // not a day
    ['2026-13-01', null],
    [UNDATED, null],       // the out-of-sight sentinel is never a deadline
  ])('%s → %s', (given, want) => {
    expect(new Todo({ label: 'x', deadline: given }).deadline).toBe(want);
  });

  it('isDueBy: on or before today, and never when undated', () => {
    const t = new Todo({ label: 'x', deadline: '2026-10-03' });
    expect(t.isDueBy('2026-10-02')).toBe(false);
    expect(t.isDueBy('2026-10-03')).toBe(true);
    expect(t.isDueBy(new Date(2026, 9, 20))).toBe(true); // overdue stays due
    expect(new Todo({ label: 'y' }).isDueBy('2099-01-01')).toBe(false);
  });
});

describe('revival', () => {
  it('⚠️ a Todo comes back as a Todo, deadline and all', () => {
    // `Activity.fromJSON` said `new Activity`, so `Todo.fromJSON` handed back a
    // plain Activity and the deadline was gone.
    const back = Todo.fromJSON(JSON.parse(JSON.stringify(new Todo({ label: 'x', deadline: '2026-10-03', tags: ['admin'] }))));
    expect(back).toBeInstanceOf(Todo);
    expect(back.deadline).toBe('2026-10-03');
    expect(back.tags).toEqual(['admin']);
  });

  it('an undated one round-trips as null, not undefined', () => {
    const json = new Todo({ label: 'x' }).toJSON();
    expect(json.deadline).toBeNull();
    expect(Todo.fromJSON(json).toJSON()).toEqual(json);
  });

  it('through a whole Schedule', () => {
    const s = fresh();
    s.addTodo({ label: 'Call the bank', deadline: '2026-10-09' });
    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.todos).toHaveLength(1);
    expect(back.todos[0]).toBeInstanceOf(Todo);
    expect(back.todos[0].toJSON()).toEqual(s.todos[0].toJSON());
  });

  it('a save from before todos existed loads with none', () => {
    const json = fresh().toJSON();
    delete json.todos;
    expect(Schedule.fromJSON(json).todos).toEqual([]);
  });
});

describe('ids are random, so two devices cannot mint the same one', () => {
  it('an injected source gives an exact id', () => {
    setIdRandom(() => 0);
    expect(new Todo({ label: 'New todo' }).id).toBe('new-todo-000000');
    setIdRandom(() => 0.999999);
    expect(new Todo({ label: 'New todo' }).id).toBe('new-todo-zzzzzz');
  });

  it('⚠️ two todos with one name are two ids — and a deleted id is not reused', () => {
    // `slug(label) + '-act'` gave every "New todo" the same id, and the next
    // one made after a delete inherited it.
    const s = fresh();
    const a = s.addTodo({ label: 'New todo' });
    const b = s.addTodo({ label: 'New todo' });
    expect(a.id).not.toBe(b.id);
    s.removeTodo(a.id);
    expect(s.addTodo({ label: 'New todo' }).id).not.toBe(a.id);
  });

  it('a collision is repaired with the RANDOM minter, not the per-session counter', () => {
    setIdRandom(() => 0.5);
    const s = new Schedule({ config: wideCfg(), todos: [{ id: 'dup', label: 'A' }, { id: 'dup', label: 'B' }] });
    expect(s.todos[0].id).toBe('dup');
    expect(s.todos[1].id).toMatch(/^b-[0-9a-z]{6}$/);
  });
});

describe('the store\'s doors', () => {
  it('⚠️ updateTodo cannot smuggle a routine, a bucket or a dial back in', () => {
    const s = fresh();
    const t = s.addTodo({ label: 'x' });
    const u = s.updateTodo(t.id, {
      label: 'y', deadline: '2026-10-03', steps: [{ label: 'a', kind: 'active', durationMin: 5 }],
      bucketId: 'study-bkt', load: { mental: 2 }, id: 'hijacked',
    });
    expect(u.id).toBe(t.id);
    expect(u.label).toBe('y');
    expect(u.deadline).toBe('2026-10-03');
    expect([u.steps, u.bucketId, u.load]).toEqual([null, null, null]);
    expect(s.todos).toHaveLength(1);
    expect(s.todos[0]).toBeInstanceOf(Todo);
  });

  it('upsertTodoFromJSON adds, then replaces by id', () => {
    const s = fresh();
    s.upsertTodoFromJSON({ id: 't1', label: 'A' });
    s.upsertTodoFromJSON({ id: 't1', label: 'A renamed', deadline: '2026-10-03' });
    expect(s.todos.map((t) => [t.id, t.label, t.deadline])).toEqual([['t1', 'A renamed', '2026-10-03']]);
  });

  it('a missing id is a no-op, not a throw', () => {
    const s = fresh();
    expect(s.updateTodo('nope', { label: 'x' })).toBeNull();
    expect(s.removeTodo('nope')).toBeNull();
  });
});

describe('⚠️ todos are NOT in the library', () => {
  it('a todo changes nothing the library sync compares (the deploy-freeze guard)', () => {
    // M-1: had todos been activities with new fields, every device's library
    // would have differed from the calendar's on deploy, and frozen.
    const s = fresh();
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read' });
    const before = taskHash(libraryFrom(s.toJSON()));
    s.addTodo({ label: 'Email the registrar', deadline: '2026-10-03' });
    expect(taskHash(libraryFrom(s.toJSON()))).toBe(before);
    expect(LIBRARY_KEYS).not.toContain('todos');
  });

  it('and it never appears among the activities', () => {
    const s = fresh();
    s.addTodo({ label: 'x' });
    expect(s.activities.some((a) => a.isTodo)).toBe(false);
    expect(s.toJSON().activities).toHaveLength(0);
  });

  it('but it has a home, so the homeless-collection guard stays quiet', () => {
    const s = fresh();
    s.addTodo({ label: 'x' });
    expect(missingFromLibrary(s.toJSON())).toEqual([]);
  });

  it('"Restore setup only" leaves your todos alone (T-2)', () => {
    const backup = fresh();
    backup.addTodo({ label: 'Done since the backup' });
    const now = fresh();
    now.addTodo({ label: 'Current' });
    applyLibrary(now, backup.toJSON(), { keys: RESTORABLE_KEYS });
    expect(now.todos.map((t) => t.label)).toEqual(['Current']);
  });
});

describe('"Do it now": a todo becomes a task and leaves the list', () => {
  it('creates the task, sized to the opening, and removes the todo', () => {
    const s = fresh();
    const todo = s.addTodo({ label: 'Email the registrar', tags: ['admin'] });

    const out = s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });

    expect(out.task.title).toBe('Email the registrar');
    expect((out.task.endTime - out.task.startTime) / 60000).toBe(30);
    expect(out.task.tags).toEqual(['admin']);
    expect(out.task.placedBy).toBe('user');
    expect(s.todos).toHaveLength(0);
  });

  it('⚠️ the task does not point back at a template that no longer exists', () => {
    const s = fresh();
    const todo = s.addTodo({ label: 'x' });
    expect(s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) }).task.activityId).toBeNull();
    // A library activity still records where it came from.
    const a = s.addActivity({ bucketId: s.buckets[0].id, label: 'Read' });
    expect(s.placeActivity(a, D(15, 16), 45, { now: D(15, 13) }).task.activityId).toBe(a.id);
  });

  it('⚠️ pressed twice, it makes ONE task — with the same stale object', () => {
    const s = fresh();
    const todo = s.addTodo({ label: 'x' });
    s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });
    const again = s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });

    expect(again).toMatchObject({ task: null, gone: true });
    expect(s.tasks).toHaveLength(1);
  });

  it('⚠️ and a todo the sync already removed is not done from a stale panel', () => {
    const s = fresh();
    const todo = s.addTodo({ label: 'x' });
    s.removeTodo(todo.id); // done on the other device; the sync took it away
    expect(s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) })).toMatchObject({ task: null, gone: true });
    expect(s.tasks).toHaveLength(0);
  });

  it('it places the LIVE todo, not the object the panel was holding', () => {
    // A sync upsert replaces the instance, so the panel's copy may be stale.
    const s = fresh();
    const held = s.addTodo({ label: 'Old name', durationMax: 30 });
    s.upsertTodoFromJSON({ ...held.toJSON(), label: 'Renamed elsewhere', durationMax: 60 });

    const out = s.placeActivity(held, D(15, 14), 120, { now: D(15, 13) });

    expect(out.task.title).toBe('Renamed elsewhere');
    expect((out.task.endTime - out.task.startTime) / 60000).toBe(60);
    expect(s.todos).toHaveLength(0);
  });

  it('⚠️ a REFUSED placement keeps the todo, and leaves no task', () => {
    // A-7: remove-then-check would have deleted a todo for a task that never
    // landed.
    const s = fresh();
    s.addFixed({ title: 'Lecture', tags: ['x'], startTime: D(15, 14), endTime: D(15, 15) });
    const todo = s.addTodo({ label: 'x' });

    const out = s.placeActivity(todo, D(15, 14), 45, { now: D(15, 13) });

    expect(out.rejected).toBe(true);
    expect(out.reason).toMatch(/Lecture/);
    expect(s.todos.map((t) => t.id)).toEqual([todo.id]);
    expect(s.tasks).toHaveLength(1);
  });
});
