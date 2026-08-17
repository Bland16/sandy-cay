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
import {
  weekStart as weekStartOf, addDays, instantiateRoutine, suggestRoutineStart,
  RoutineInstance,
} from '../../core/index.js';
import { fmtDur, MONTHS, DAY_NAMES } from '../format.js';
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

/**
 * "Mon 7 Sep 08:00  load · 2m" — one line per touchpoint, for the confirm.
 *
 * ⚠️ The LABEL is not decoration. §3 requires the preview to name each BLOCK,
 * and the first version printed only times — so the confirm listed three
 * moments with no way to tell the load from the fold. Caught by its own test.
 */
export function touchpointLine(t) {
  const d = t.startTime || t.from;
  const mins = t.getDuration ? t.getDuration() : Math.round((t.to - t.from) / 60000);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
    + ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    + `  ${t.label || 'step'} · ${fmtDur(mins)}`;
}

export default function RoutinesEditor({ sched, mutate, weekStart, now, showToast }) {
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
  const clock = now || new Date();

  /**
   * Put a run on the calendar. The Cabana is where this lives (the user's
   * call) — you author the procedure and start it from the same place.
   *
   * The engine SUGGESTS a start (Decision 3) and the confirm names every
   * touchpoint before anything is written, the same plan-then-apply shape the
   * blocker conversion and "Lay out this week" already use on this page. Then
   * you drag to place if the suggestion is not what you wanted: the touchpoints
   * are ordinary fixed anchors, and R-1 says your hand outranks the suggestion.
   */
  const addToCalendar = (a) => {
    const when = suggestRoutineStart(sched, a, clock, { withinDays: 6 });
    if (!when) {
      // A suggestion may honestly have none, and saying so beats inventing one.
      showToast(`No room for ${a.label} in the next week`);
      return;
    }
    // Preview through the REAL engine on a throwaway instance, so the confirm
    // names the actual blocks rather than a second guess at them.
    const probe = RoutineInstance.fromActivity(a, when);
    const lines = probe.offsets().map((o) => `      ${touchpointLine({
      label: o.label,
      from: new Date(when.getTime() + o.offsetMin * 60000),
      to: new Date(when.getTime() + (o.offsetMin + o.durationMin) * 60000),
    })}`);
    const ok = window.confirm(
      `Start ${a.label}?\n\n${lines.join('\n')}\n\n`
      + `${fmtDur(probe.spanMin)} start to finish, ${fmtDur(probe.attentionMin)} of it yours.\n`
      + 'The gaps stay free — drag any block afterwards and the rest follows.',
    );
    if (!ok) return;
    const r = mutate((s) => instantiateRoutine(s, a, when));
    showToast(
      `${a.label} started · ${r.touchpoints.length} touchpoint${r.touchpoints.length === 1 ? '' : 's'}`
      + (r.clashes.length ? ` · ${r.clashes.length} overlap${r.clashes.length === 1 ? '' : 's'}` : ''),
    );
  };

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
        <div className="chest drillactions" style={{ marginBottom: 8 }}>
          <button className="btn2" onClick={() => addToCalendar(a)} aria-label={`Add ${a.label} to the calendar`}>
            Add to the calendar
          </button>
        </div>
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
