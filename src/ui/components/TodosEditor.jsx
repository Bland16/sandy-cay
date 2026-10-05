// TodosEditor — one-off things, listed until you do them.
//
// design/TODO-LIST.md §4 D-5, §8.3. The SAME drill-in idiom as commitments,
// routines, zones and buckets: a card of its own, a list you pick from, a
// focused editor for the one you picked. Not a section of the Buckets card — a
// todo is not in the library, and showing it there would be two homes for one
// thing.
//
// ⚠️ NOT `ActivityEditor`, though a todo is an Activity. That editor brings a
// bucket select, a priority and the energy dial, none of which a todo has (its
// energy comes from its own tags), and it calls `onBack()` DURING RENDER when
// its item is missing. A todo goes missing all the time — "Do it now" removes
// it, and so does the other device finishing it — so this falls back to the
// list the way `CommitmentsEditor` does: `find(...) || null`.
//
// There is no "done" tick here. A todo is done by being placed ("Do it now",
// in the Right-now panel), which turns it into a task; removing one from this
// card is deleting it, and says so.
import { useEffect, useState } from 'react';
import { dateKey } from '../../core/index.js';
import { todoMeta } from '../format.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import { DrillList, DrillEditor, DrillRow, Field } from './Drill.jsx';

/** 15 minutes is the shortest block the grid can hold (OD-1) — a grid fact. */
const clampLen = (v) => {
  const n = Number(v);
  return Math.max(15, Math.round(Number.isFinite(n) ? n : 15));
};

/**
 * A field you can TYPE in. The draft is local, and it reaches the model when it
 * is something the model can hold — on blur, on Enter, or at once when `ready`
 * says the text is already a whole value.
 *
 * ⚠️ WHY NOT `value={model} onChange={patch}`, which is what this card first
 * had and what the other editors' number boxes still do. Every keystroke went
 * through the model's own guards and came straight back:
 *   · typing "45" — the "4" is below the 15-minute floor, so the box snapped to
 *     15 before the "5" could be typed;
 *   · typing a year into the due date — "0002-10-03" is not a date, so it was
 *     refused, the field was told it was empty, and it blanked itself.
 * A guard belongs on a finished value, not on the way to one.
 */
function Draft({ value, commit, ready = () => false, ...rest }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  // The model changed under us (a clamp, the other device, "clear") → show it.
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const send = (text) => { if (String(text) !== String(value ?? '')) commit(text); };
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => { setDraft(e.target.value); if (ready(e.target.value)) send(e.target.value); }}
      onBlur={() => { send(draft); setDraft(String(value ?? '')); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

/** A whole date, or cleared. "0002-10-03" is a date being typed, not one typed. */
const wholeDate = (v) => v === '' || /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v);

export default function TodosEditor({ sched, mutate, now }) {
  const [editingId, setEditingId] = useState(null);
  // Injected so a surface that depends on the date is testable at a fixed one
  // (sharp edge #8). The component may read the clock; the engine may not.
  const todayKey = dateKey(now || new Date());
  const todos = sched.todos || [];
  // ⚠️ Not `tagsInUse` alone — that reads TASKS. A todo's energy comes from the
  // BUCKET its tag belongs to, so bucket tags are the ones worth offering, and
  // a tag only another todo carries should be offered too.
  const suggestions = Array.from(new Set([
    ...tagsInUse(sched),
    ...(sched.buckets || []).flatMap((b) => b.tags || []),
    ...todos.flatMap((t) => t.tags || []),
  ])).filter((t) => !sched.isTagRetired(t));

  const patch = (id, changes) => mutate((s) => s.updateTodo(id, changes));
  const add = () => {
    const t = mutate((s) => s.addTodo({ label: 'New todo' }));
    setEditingId(t.id);
  };

  // Gone (done from the panel, or on the other device) → back to the list.
  const editing = todos.find((t) => t.id === editingId) || null;

  if (editing) {
    const t = editing;
    return (
      <DrillEditor
        title="Todo"
        backLabel="Todos"
        onBack={() => setEditingId(null)}
        onRemove={() => { mutate((s) => s.removeTodo(t.id)); setEditingId(null); }}
        removeLabel="Remove todo"
        removeAria={`Remove todo ${t.label}`}
      >
        <Field label="name">
          <input
            // Keyed by id: the same input must not carry one todo's text into
            // the next when the list re-orders under an open editor.
            key={t.id}
            className="control grow"
            defaultValue={t.label}
            onBlur={(e) => {
              const label = e.target.value.trim();
              // Unchanged, or emptied: leave it. A blur is not an edit.
              if (label && label !== t.label) patch(t.id, { label });
            }}
            aria-label="Todo name"
          />
        </Field>

        <Field label="tags" help="Tags set its energy, the way a task's do.">
          <TagEditor tags={t.tags} onChange={(tags) => patch(t.id, { tags })} suggestions={suggestions} />
        </Field>

        {/* LENGTH — bounds, like an activity's. It fills the gap you do it in. */}
        <Field label="length" ctlClass="rangefield" help="It fills the gap you do it in, within these bounds.">
          <Draft
            className="control num"
            type="number"
            min="15"
            step="5"
            value={t.durationMin}
            commit={(v) => patch(t.id, { durationMin: clampLen(v) })}
            aria-label="Todo minimum minutes"
          />
          <span className="rdash">–</span>
          <Draft
            className="control num"
            type="number"
            min="15"
            step="5"
            value={t.durationMax}
            commit={(v) => patch(t.id, { durationMax: clampLen(v) })}
            aria-label="Todo maximum minutes"
          />
          <span className="runit">min</span>
        </Field>

        {/* DUE — optional, a real date. Cleared, the todo simply has none. */}
        <Field label="due">
          <Draft
            className="control"
            type="date"
            value={t.deadline || ''}
            ready={wholeDate}
            commit={(v) => { if (wholeDate(v)) patch(t.id, { deadline: v || null }); }}
            aria-label="Todo due date"
          />
          {t.deadline && (
            <button type="button" className="linkish soft" onClick={() => patch(t.id, { deadline: null })}>
              clear
            </button>
          )}
        </Field>
      </DrillEditor>
    );
  }

  return (
    <DrillList
      title="Todos"
      blurb="One-off things. Each leaves this list when you do it, and becomes a task."
      isEmpty={todos.length === 0}
      empty="No todos yet."
      actions={<button className="btn2" onClick={add} aria-label="Add a todo">＋ Add a todo</button>}
    >
      {/* Bounded, however many there are — the card must not push the rest of
          the Cabana off a phone's screen (the Buckets card does the same). */}
      <div className="todorows">
        {/* In the order they were made, as the mock-up draws them. The picker is
            where a due todo is lifted; here the list stays where you left it. */}
        {todos.map((t) => (
          <DrillRow
            key={t.id}
            label={t.label}
            meta={todoMeta(t, todayKey)}
            onOpen={() => setEditingId(t.id)}
            ariaLabel={`Edit todo ${t.label}`}
          />
        ))}
      </div>
    </DrillList>
  );
}
