// RoutinesEditor — author a procedure in the Cabana (design/ROUTINES.md R-C).
//
// The same DrillList → DrillEditor idiom as zones, buckets, activities and
// commitments, so it costs no new vocabulary.
//
// ⚠️ THE PROCEDURE IS THE UNIT, and that is the user's framing (2026-08-17):
// **"a part of a procedure is nothing without the procedure itself."** So a
// routine is named as a whole, it is created and deleted as a whole, and a step
// only ever exists inside one. There is no way to make a loose step, and the
// name-match promotion (later) matches the ROUTINE'S name, never a step's.
//
// A routine is stored as an `Activity` carrying `steps` (R-A) — so this card
// lists `activities.filter(isRoutine)` and needs no collection of its own.
// Derived, not stored: an activity that loses its last step honestly stops
// being a routine.
import { useState } from 'react';
import { weekStart as weekStartOf, addDays } from '../../core/index.js';
import { fmtDur } from '../format.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import { DrillList, DrillEditor, DrillRow, Field } from './Drill.jsx';
import RoutineSteps from './RoutineSteps.jsx';

/** "3 touchpoints · 2h start to finish · 14m of your attention" */
export function routineMeta(a) {
  const steps = a.steps || [];
  const touch = steps.filter((s) => s.kind === 'active').length;
  const elapsed = steps.reduce((n, s) => n + s.durationMin, a.travelMin || 0);
  const attention = steps.filter((s) => s.kind === 'active')
    .reduce((n, s) => n + s.durationMin, a.travelMin || 0);
  if (!steps.length) return 'no steps yet';
  return `${touch} touchpoint${touch === 1 ? '' : 's'} · ${fmtDur(elapsed)} start to finish`
    + ` · ${fmtDur(attention)} of your attention`;
}

export default function RoutinesEditor({ sched, mutate, weekStart }) {
  const [editingId, setEditingId] = useState(null);
  // Derived — a routine IS an activity with steps. No parallel collection to
  // drift, and dropping the last step honestly stops it being a routine.
  const routines = sched.activities.filter((a) => a.isRoutine);
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const addRoutine = () => {
    const a = mutate((s) => s.addActivity({
      label: 'New routine',
      bucketId: null,
      // Created WITH a step, because a procedure with no parts is not a
      // procedure — and an activity with no steps is not a routine, so an empty
      // one would vanish from this list the moment it was made.
      steps: [{ label: '', kind: 'active', durationMin: 15, durationMax: 15, maxWaitMin: null }],
    }));
    if (a) setEditingId(a.id);
  };
  const patch = (id, changes) => mutate((s) => s.updateActivity(id, changes));
  const remove = (id) => mutate((s) => s.removeActivity(id));

  const editing = routines.find((a) => a.id === editingId) || null;

  // ---- drill-in routine editor ------------------------------------------
  if (editing) {
    const a = editing;
    // The preview runs from a real weekday morning rather than "now", so the
    // times it shows are stable while you type. 08:00 next Monday.
    const previewFrom = (() => {
      const d = addDays(weekStartOf(weekStart || new Date()), 0);
      d.setHours(8, 0, 0, 0);
      return d;
    })();

    return (
      <DrillEditor
        title="Edit routine"
        backLabel="All routines"
        onBack={() => setEditingId(null)}
        onRemove={() => { remove(a.id); setEditingId(null); }}
        removeLabel="remove routine"
        removeAria={`Remove routine ${a.label}`}
      >
        <Field label="name">
          <input
            className="control grow"
            defaultValue={a.label}
            onBlur={(e) => patch(a.id, { label: e.target.value.trim() || a.label })}
            aria-label="Routine name"
          />
        </Field>

        <Field label="tags">
          <TagEditor tags={a.tags} onChange={(tags) => patch(a.id, { tags })} suggestions={suggestions} />
        </Field>

        {/* Travel is an active LEAD-IN fused to the first touchpoint, so the
            gym reserves one contiguous block (Decision 4, v1 = lead-in only). */}
        <Field label="travel" help="Added to the first step, so it reserves one unbroken block.">
          <input
            className="control num"
            type="number"
            min="0"
            value={a.travelMin || 0}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              patch(a.id, { travelMin: Number.isFinite(n) && n > 0 ? n : 0 });
            }}
            aria-label="Routine travel minutes"
          />
          <span className="runit">min</span>
        </Field>

        <Field label="steps" stack>
          <RoutineSteps
            steps={a.steps}
            travelMin={a.travelMin || 0}
            previewFrom={previewFrom}
            onChange={(steps) => patch(a.id, { steps })}
          />
        </Field>
      </DrillEditor>
    );
  }

  // ---- routine list -----------------------------------------------------
  return (
    <DrillList
      title="Routines"
      blurb="A procedure with waits in it — laundry, the dishwasher, the oven."
      isEmpty={routines.length === 0}
      empty="No routines yet."
      actions={<button className="btn2" onClick={addRoutine} aria-label="Add routine">＋ Add routine</button>}
      footer={routines.length > 0 && (
        <p className="insight" style={{ marginTop: 10 }}>
          A <b>timed step</b> is something you do; a <b>wait</b> is time that has
          to pass while you are free to do other things. The waits are ordinary
          open time — the schedule fills them for you.
        </p>
      )}
    >
      {routines.map((a) => (
        <DrillRow
          key={a.id}
          label={a.label}
          meta={routineMeta(a)}
          onOpen={() => setEditingId(a.id)}
          ariaLabel={`Edit routine ${a.label}`}
        />
      ))}
    </DrillList>
  );
}
