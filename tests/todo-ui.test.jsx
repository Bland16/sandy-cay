// @vitest-environment jsdom
// Todos — the picker's rules, the Right-now panel, and the Cabana card
// (design/TODO-LIST.md §4.1, §8.3, §8.5). Each case names the audit finding it
// answers; the panel and the card are RENDERED and read, not called.
import {
  describe, it, expect, afterEach, beforeEach,
} from 'vitest';
import { useState } from 'react';
import {
  render, cleanup, screen, fireEvent, within,
} from '@testing-library/react';
import {
  Schedule, resetIds, setIdRandom, waitingTodos, defaultConfig,
} from '../src/core/index.js';
import WhatToDoPanel from '../src/ui/components/panels/WhatToDoPanel.jsx';
import TodosEditor from '../src/ui/components/TodosEditor.jsx';
import { todoDueText, todoMeta } from '../src/ui/format.js';

afterEach(() => { cleanup(); setIdRandom(); });
beforeEach(() => resetIds());

const D = (d, h = 0, m = 0) => new Date(2026, 6, d, h, m, 0, 0);
const NOW = D(15, 14, 0);          // Wed 15 Jul 2026, 14:00
const TODAY = '2026-07-15';
const wideCfg = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });
const opening = (minutes) => ({ start: NOW, minutes });

/** A library big enough that a todo would never make the five on merit. */
function bigLibrary() {
  const s = new Schedule({ config: wideCfg() });
  const rest = s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: -1, social: 0, creative: 0 } });
  const work = s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2, physical: 0, social: 0, creative: 0 } });
  for (let i = 0; i < 12; i += 1) {
    s.addActivity({ bucketId: (i % 2 ? rest : work).id, label: `Activity ${String(i).padStart(2, '0')}`, tags: [i % 2 ? 'rest' : 'work'], durationMin: 15, durationMax: 45 });
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('the picker\'s rules (core)', () => {
  it('⚠️ P-1: a todo holds one of the five — it never made them on merit', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Zzz last by label', tags: ['admin'] });
    const picks = s.suggestActivities(NOW, { opening: opening(45), limit: 5 });

    expect(picks).toHaveLength(5);
    expect(picks.filter((p) => p.isTodo).map((p) => p.activity.label)).toEqual(['Zzz last by label']);
  });

  it('with a single place, it is NOT given to a todo — the best activity is still the answer', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Zzz todo' });
    const [only] = s.suggestActivities(NOW, { opening: opening(45), limit: 1 });
    expect(only.isTodo).toBe(false);
  });

  it('a todo that came and went leaves the five as they were', () => {
    const s = bigLibrary();
    const before = s.suggestActivities(NOW, { opening: opening(45), limit: 5 }).map((p) => p.activity.id);
    s.addTodo({ label: 'x' });
    s.removeTodo(s.todos[0].id);
    expect(s.suggestActivities(NOW, { opening: opening(45), limit: 5 }).map((p) => p.activity.id)).toEqual(before);
    expect(before.every((id) => id.endsWith('-act'))).toBe(true);
  });

  it('⚠️ P-2: due today and overdue go ABOVE the library, oldest first — a tier, before the limit', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Not due yet', deadline: '2026-07-20' });
    s.addTodo({ label: 'Due today', deadline: TODAY });
    s.addTodo({ label: 'Overdue', deadline: '2026-07-01' });
    const picks = s.suggestActivities(NOW, { opening: opening(45), limit: 5 });

    expect(picks.slice(0, 2).map((p) => [p.activity.label, p.due])).toEqual([['Overdue', 'overdue'], ['Due today', 'today']]);
    // The date is reported once, as `deadline` — not also folded into the
    // reasons, where the panel printed "due today" twice.
    expect(picks[1].deadline).toBe(TODAY);
    expect(picks[1].reasons.join(' ')).not.toMatch(/due/);
    // "Not due yet" ranks as a plain activity — and the todo place is already taken.
    expect(picks.slice(2).every((p) => !p.isTodo)).toBe(true);
  });

  it('the lift is not a score: a due todo\'s score is what an undated one\'s would be', () => {
    const s = bigLibrary();
    const a = s.addTodo({ label: 'A', deadline: TODAY, tags: ['work'] });
    const b = s.addTodo({ label: 'B', tags: ['work'] });
    const picks = s.suggestActivities(NOW, { opening: opening(45), limit: 50 });
    const score = (id) => picks.find((p) => p.activity.id === id).score;
    expect(score(a.id)).toBe(score(b.id));
  });

  it('P-3: todosOnly narrows to todos, and tags narrow it further (AND)', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Admin one', tags: ['admin'] });
    s.addTodo({ label: 'Work one', tags: ['work'] });
    const only = s.suggestActivities(NOW, { opening: opening(45), limit: 5, todosOnly: true });
    expect(only.map((p) => p.activity.label).sort()).toEqual(['Admin one', 'Work one']);

    const both = s.suggestActivities(NOW, { opening: opening(45), limit: 5, todosOnly: true, tags: ['admin'] });
    expect(both.map((p) => p.activity.label)).toEqual(['Admin one']);
  });

  it('⚠️ P-4: a todo too long for the opening is not offered — but it is not lost', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Short' });
    s.addTodo({ label: 'Long', durationMin: 60, durationMax: 120, deadline: '2026-07-01' });

    const picks = s.suggestActivities(NOW, { opening: opening(45), limit: 5, todosOnly: true });
    expect(picks.map((p) => p.activity.label)).toEqual(['Short']);
    expect(waitingTodos(s, NOW, { opening: opening(45) }).map((w) => [w.todo.label, w.needsMin])).toEqual([['Long', 60]]);
  });

  it('⚠️ P-4: with NO opening, every todo is waiting, due ones first', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'B undated' });
    s.addTodo({ label: 'A overdue', deadline: '2026-07-01' });
    expect(s.suggestActivities(NOW, { opening: null, todosOnly: true })).toEqual([]);
    expect(waitingTodos(s, NOW, { opening: null }).map((w) => w.todo.label)).toEqual(['A overdue', 'B undated']);
  });

  it('waiting order: due, then dated (soonest first), then undated', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Undated' });
    s.addTodo({ label: 'Later', deadline: '2026-09-01' });
    s.addTodo({ label: 'Sooner', deadline: '2026-08-01' });
    s.addTodo({ label: 'Overdue', deadline: '2026-07-01' });
    expect(waitingTodos(s, NOW, { opening: null }).map((w) => w.todo.label)).toEqual(['Overdue', 'Sooner', 'Later', 'Undated']);
  });
});

describe('a date is said as a fact', () => {
  it.each([
    [null, ''],
    [TODAY, 'due today'],
    ['2026-10-03', 'due 3 Oct'],
    ['2026-06-28', 'was due 28 Jun'],
  ])('%s → "%s"', (deadline, text) => {
    expect(todoDueText(deadline, TODAY)).toBe(text);
  });

  it('the row meta: length, then the date if there is one', () => {
    expect(todoMeta({ durationMin: 15, durationMax: 30, deadline: null }, TODAY)).toBe('15–30m');
    expect(todoMeta({ durationMin: 45, durationMax: 90, deadline: null }, TODAY)).toBe('45m–1h 30m');
    expect(todoMeta({ durationMin: 60, durationMax: 120, deadline: '2026-10-03' }, TODAY)).toBe('1h–2h · due 3 Oct');
    expect(todoMeta({ durationMin: 30, durationMax: 30, deadline: '2026-06-28' }, TODAY)).toBe('30m · was due 28 Jun');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
function PanelHarness({ sched, now = NOW, toasts = [] }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return (
    <WhatToDoPanel sched={sched} now={now} mutate={mutate} onOpenTask={() => {}} onClose={() => {}} showToast={(m) => toasts.push(m)} />
  );
}

describe('the Right-now panel', () => {
  it('shows no todos switch until there is a todo — and then it shows the count', () => {
    const s = bigLibrary();
    const { rerender } = render(<PanelHarness sched={s} />);
    expect(screen.queryByRole('button', { name: /^Todos ·/ })).toBeNull();
    s.addTodo({ label: 'One' });
    s.addTodo({ label: 'Two' });
    rerender(<PanelHarness sched={s} />);
    expect(screen.getByRole('button', { name: 'Todos · 2' })).toBeTruthy();
  });

  it('⚠️ the switch shows even when NO task has a tag (it is not in the tag row)', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'One' });
    render(<PanelHarness sched={s} />);
    expect(screen.queryByText('In the mood for')).toBeNull();
    expect(screen.getByRole('button', { name: 'Todos · 1' })).toBeTruthy();
  });

  it('"Do it now" on a todo: a task is made, the todo is gone, and the toast says where it went', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'Email the registrar', deadline: '2026-07-01' });
    const toasts = [];
    render(<PanelHarness sched={s} toasts={toasts} />);

    expect(screen.getByText('Email the registrar')).toBeTruthy();
    expect(screen.getByText('was due 1 Jul')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Do it now/ }));

    expect(s.todos).toHaveLength(0);
    expect(s.tasks.map((t) => t.title)).toEqual(['Email the registrar']);
    expect(toasts[0]).toMatch(/Email the registrar → 14:00 · moved off your todo list/);
  });

  it('⚠️ an overdue date is plain ink, never the coral of a warning', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'Return books', deadline: '2026-07-01' });
    render(<PanelHarness sched={s} />);
    const fact = screen.getByText('was due 1 Jul');
    expect(fact.className).toBe('duefact');
    expect(fact.className).not.toMatch(/dueno/);
  });

  it('the switch hides waiting tasks and shows only todos', () => {
    const s = bigLibrary();
    s.addFlexible({ title: 'Essay', tags: ['work'], startTime: D(15, 16), endTime: D(15, 17) });
    s.addTodo({ label: 'Call the bank' });
    render(<PanelHarness sched={s} />);
    expect(screen.getByText('Essay')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Todos · 1' }));

    expect(screen.queryByText('Essay')).toBeNull();
    expect(screen.getByText('Call the bank')).toBeTruthy();
    expect(screen.queryByText('from your library')).toBeNull();
  });

  it('⚠️ doing the LAST todo with the switch on does not strand the panel on "todos only"', () => {
    const s = bigLibrary();
    s.addTodo({ label: 'Only one' });
    render(<PanelHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos · 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Do it now/ }));

    // The switch is gone (nothing to filter) — and the library is back.
    expect(screen.queryByRole('button', { name: /^Todos ·/ })).toBeNull();
    expect(screen.getAllByText(/library/).length).toBeGreaterThan(0);
  });

  it('⚠️ P-4: a todo too long for the opening is LISTED, with what it needs, and no button', () => {
    const s = new Schedule({ config: wideCfg() });
    // A fixed task at 14:45 leaves a 45-minute opening.
    s.addFixed({ title: 'Seminar', tags: ['x'], startTime: D(15, 14, 45), endTime: D(15, 16) });
    s.addTodo({ label: 'Short' });
    s.addTodo({ label: 'Draft outline', durationMin: 60, durationMax: 120 });
    render(<PanelHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos · 2' }));

    const list = screen.getByLabelText('Todos that cannot be done right now');
    expect(within(list).getByText('Draft outline')).toBeTruthy();
    expect(within(list).getByText('needs 1h+')).toBeTruthy();
    expect(within(list).queryByRole('button')).toBeNull();
    expect(screen.getByText('Too long for this opening:')).toBeTruthy();
  });

  it('⚠️ P-4: with no opening the todos are still there, and the panel does not say "nothing"', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addTodo({ label: 'Return books', deadline: '2026-07-01' });
    s.addTodo({ label: 'Call the bank' });
    const late = D(15, 23, 55); // after the day's window
    render(<PanelHarness sched={s} now={late} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos · 2' }));

    expect(screen.getByText('Nothing can be done now, but these are waiting:')).toBeTruthy();
    const list = screen.getByLabelText('Todos that cannot be done right now');
    expect(within(list).getByText('Return books')).toBeTruthy();
    expect(within(list).getByText('was due 1 Jul')).toBeTruthy();
    expect(within(list).getByText('Call the bank')).toBeTruthy();
    expect(screen.queryByText(/Nothing waiting|Nothing tagged/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Do it now/ })).toBeNull();
  });

  it('⚠️ with the switch OFF and nothing else to offer, it still does not say "nothing" over a todo', () => {
    // "Todos · 1" directly above "Nothing waiting. Enjoy the shore."
    const s = new Schedule({ config: defaultConfig });
    s.addTodo({ label: 'Return books', deadline: '2026-07-01' });
    render(<PanelHarness sched={s} now={D(15, 23, 55)} />);

    expect(screen.getByRole('button', { name: 'Todos · 1' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/Nothing waiting|Nothing tagged/)).toBeNull();
    expect(within(screen.getByLabelText('Todos that cannot be done right now')).getByText('Return books')).toBeTruthy();
  });

  it('a tag only a TODO carries still gets a mood chip', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'Email the registrar', tags: ['admin'] });
    render(<PanelHarness sched={s} />);
    expect(screen.getByRole('button', { name: 'admin' })).toBeTruthy();
  });

  it('a todo due today says so ONCE', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'Email the registrar', deadline: TODAY });
    render(<PanelHarness sched={s} />);
    expect(screen.getAllByText(/due today/i)).toHaveLength(1);
  });

  it('"+ todo": a name is enough — 15–30 minutes, no tags, and it shows at once', () => {
    const s = new Schedule({ config: wideCfg() });
    const toasts = [];
    render(<PanelHarness sched={s} toasts={toasts} />);
    const box = screen.getByLabelText('New todo');
    expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);

    fireEvent.change(box, { target: { value: '  Return library books  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(s.todos.map((t) => [t.label, t.durationMin, t.durationMax, t.tags, t.deadline]))
      .toEqual([['Return library books', 15, 30, [], null]]);
    expect(box.value).toBe('');
    expect(screen.getByRole('button', { name: 'Todos · 1' })).toBeTruthy();
    expect(toasts[0]).toMatch(/Added to your todos: Return library books/);
  });

  it('an empty "+ todo" adds nothing', () => {
    const s = new Schedule({ config: wideCfg() });
    render(<PanelHarness sched={s} />);
    fireEvent.change(screen.getByLabelText('New todo'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('New todo').closest('form'));
    expect(s.todos).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
function CardHarness({ sched }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <TodosEditor sched={sched} mutate={mutate} now={NOW} />;
}

describe('the Todos card in the Cabana', () => {
  it('empty: says so, and offers to add one', () => {
    render(<CardHarness sched={new Schedule({ config: wideCfg() })} />);
    expect(screen.getByText('No todos yet.')).toBeTruthy();
    expect(screen.getByText(/Each leaves this list when you do it, and becomes a task/)).toBeTruthy();
  });

  it('lists each with its length and date, in the order they were made', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'Call the bank' });
    s.addTodo({ label: 'Email the registrar', deadline: '2026-10-03' });
    s.addTodo({ label: 'Return books', deadline: '2026-07-01' });
    render(<CardHarness sched={s} />);

    const rows = screen.getAllByRole('button', { name: /^Edit todo/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      'Call the bank15–30medit ›',
      'Email the registrar15–30m · due 3 Octedit ›',
      'Return books15–30m · was due 1 Juledit ›',
    ]);
  });

  it('"Add a todo" makes one and opens it', () => {
    const s = new Schedule({ config: wideCfg() });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a todo' }));
    expect(s.todos).toHaveLength(1);
    expect(screen.getByLabelText('Todo name').value).toBe('New todo');
  });

  it('the editor: name, length, a due date that can be cleared — and NO bucket, priority or dial', () => {
    const s = new Schedule({ config: wideCfg() });
    const t = s.addTodo({ label: 'Email the registrar' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo Email the registrar' }));

    fireEvent.blur(screen.getByLabelText('Todo name'), { target: { value: 'Email the bursar' } });
    fireEvent.change(screen.getByLabelText('Todo maximum minutes'), { target: { value: '45' } });
    fireEvent.blur(screen.getByLabelText('Todo maximum minutes'));
    fireEvent.change(screen.getByLabelText('Todo due date'), { target: { value: '2026-10-03' } });
    const live = () => s.todos.find((x) => x.id === t.id);
    expect([live().label, live().durationMax, live().deadline]).toEqual(['Email the bursar', 45, '2026-10-03']);

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(live().deadline).toBeNull();
    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();

    expect(screen.queryByLabelText(/bucket/i)).toBeNull();
    expect(screen.queryByLabelText(/priority/i)).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('a length below the grid\'s 15 minutes is held at 15', () => {
    const s = new Schedule({ config: wideCfg() });
    const t = s.addTodo({ label: 'x' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    const box = screen.getByLabelText('Todo minimum minutes');
    fireEvent.change(box, { target: { value: '5' } });
    fireEvent.blur(box);
    expect(s.todos.find((x) => x.id === t.id).durationMin).toBe(15);
    expect(box.value).toBe('15');
  });

  it('⚠️ you can TYPE 45: the "4" on the way there is not clamped to 15 under your fingers', () => {
    const s = new Schedule({ config: wideCfg() });
    const t = s.addTodo({ label: 'x' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    const box = screen.getByLabelText('Todo maximum minutes');

    fireEvent.change(box, { target: { value: '4' } });
    expect(box.value).toBe('4');                                   // still what was typed
    expect(s.todos.find((x) => x.id === t.id).durationMax).toBe(30); // and nothing saved yet
    fireEvent.change(box, { target: { value: '45' } });
    fireEvent.blur(box);
    expect(s.todos.find((x) => x.id === t.id).durationMax).toBe(45);
  });

  it('⚠️ typing a year into the due date does not wipe the field', () => {
    // A date input reports "0002-10-03" while the year is being typed. Sent to
    // the model that is not a date, so it was refused and the field blanked.
    const s = new Schedule({ config: wideCfg() });
    const t = s.addTodo({ label: 'x', deadline: '2026-09-01' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    const box = screen.getByLabelText('Todo due date');

    fireEvent.change(box, { target: { value: '0002-10-03' } });
    expect(box.value).toBe('0002-10-03');
    expect(s.todos.find((x) => x.id === t.id).deadline).toBe('2026-09-01'); // untouched
    fireEvent.change(box, { target: { value: '2026-10-03' } });
    expect(s.todos.find((x) => x.id === t.id).deadline).toBe('2026-10-03');
  });

  it('leaving the name as it was is not an edit', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'x' });
    let edits = 0;
    const Counting = () => {
      const [, setV] = useState(0);
      return <TodosEditor sched={s} now={NOW} mutate={(fn) => { edits += 1; const r = fn(s); setV((v) => v + 1); return r; }} />;
    };
    render(<Counting />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    fireEvent.blur(screen.getByLabelText('Todo name'));
    expect(edits).toBe(0);
  });

  it('the editor says what length means, and the remove button reads as the mock-up draws it', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addBucket({ label: 'Admin', tags: ['admin'] });
    s.addTodo({ label: 'x' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    expect(screen.getByText('It fills the gap you do it in, within these bounds.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove todo x' }).textContent).toBe('Remove todo');
  });

  it('"remove todo" deletes it and returns to the list', () => {
    const s = new Schedule({ config: wideCfg() });
    s.addTodo({ label: 'x' });
    render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove todo x' }));
    expect(s.todos).toHaveLength(0);
    expect(screen.getByText('No todos yet.')).toBeTruthy();
  });

  it('⚠️ a todo that vanishes under an open editor (done elsewhere) falls back to the list, without a crash', () => {
    // `ActivityEditor` calls `onBack()` during render when its item is missing;
    // a todo goes missing all the time, so this must not be built that way.
    const s = new Schedule({ config: wideCfg() });
    const t = s.addTodo({ label: 'Soon gone' });
    s.addTodo({ label: 'Stays' });
    const { rerender } = render(<CardHarness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit todo Soon gone' }));
    expect(screen.getByLabelText('Todo name')).toBeTruthy();

    s.removeTodo(t.id); // the sync took it
    rerender(<CardHarness sched={s} />);

    expect(screen.queryByLabelText('Todo name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit todo Stays' })).toBeTruthy();
  });
});
