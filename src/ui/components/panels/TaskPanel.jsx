// TaskPanel — full inline detail-edit for a selected task (SPEC §11 / B+C).
// Handles regular tasks and recurring occurrences (edits route to the parent
// pattern; per-occurrence "skip" writes an exception). All edits call the engine
// then the app re-reads.
import { useState } from 'react';
import {
  addMinutes, atTime, addDays, dateKey, formatHHMM,
  addException, splitPeriod, temporaryChange, endRecurrence, dayStart, dateFromKey,
} from '../../../core/index.js';
import { DAY_NAMES, fmtRange } from '../../format.js';
import { modelFromTask, buildRecurrence } from '../../recurrenceModel.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';
import TagEditor, { tagsInUse } from '../TagEditor.jsx';
import RecurrenceEditor from '../RecurrenceEditor.jsx';
import Icon from '../../Icon.jsx';

// Satisfaction facets are tri-state in the engine (-1 | 0 | 1), so the control
// cycles = → ↑ → ↓ and says what each state means (R-5). Neither arrow is a
// judgement — no warning colour on a rating (P-1).
const FACETS = [
  { key: 'timingFit', label: 'timing', zero: 'just right', pos: 'too late', neg: 'too early' },
  { key: 'durationFit', label: 'duration', zero: 'just right', pos: 'too long', neg: 'too short' },
  { key: 'energy', label: 'energy', zero: 'neutral', pos: 'energized me', neg: 'drained me' },
];
const facetGlyph = (v) => (v === 1 ? '↑' : v === -1 ? '↓' : '=');
const facetWord = (f, v) => (v === 1 ? f.pos : v === -1 ? f.neg : f.zero);
const cycleFacet = (v) => (!v ? 1 : v === 1 ? -1 : 0);

export default function TaskPanel({ task, sched, mutate, weekStart, onClose, showToast }) {
  // Resolve the editable underlying task: an occurrence edits its parent.
  const editable = task.isOccurrence ? sched.tasks.find((t) => t.id === task.parentId) : task;
  const [recModel, setRecModel] = useState(() => modelFromTask(editable || task));
  const [slots, setSlots] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [extraDay, setExtraDay] = useState(0);
  const [extraStart, setExtraStart] = useState('18:00');

  if (!editable) {
    return (<><PanelHeader title={task.title} sub="occurrence" onClose={onClose} /><p className="empty">This occurrence's task is gone.</p></>);
  }

  const isOcc = !!task.isOccurrence;
  const durMin = task.getDuration();
  const dayIdx = ((task.startTime.getDay() + 6) % 7);
  // §4.4: an occurrence's lived data lives in the parent's occurrenceData, never
  // on the pattern. Reading `editable.satisfaction` here would show every session
  // the same rating; writing it would make Friday's gym overwrite Monday's, and
  // leave retrain() seeing ONE sample no matter how many sessions were rated.
  const sat = (isOcc ? task.satisfaction : editable.satisfaction) || {};

  const upd = (changes) => mutate((s) => s.updateTask(editable.id, changes));

  /** Merge satisfaction into the right home: occurrenceData for a session,
   *  the task itself otherwise (mirrors App.jsx's completion path). */
  const updSatisfaction = (patch) => {
    if (!isOcc) { upd({ satisfaction: { ...sat, ...patch } }); return; }
    mutate((s) => {
      const parent = s.tasks.find((t) => t.id === editable.id);
      if (!parent) return;
      const key = task.occurrenceDate;
      const prev = parent.occurrenceData[key] || {};
      parent.occurrenceData = {
        ...parent.occurrenceData,
        [key]: { ...prev, satisfaction: { ...(prev.satisfaction || {}), ...patch } },
      };
    });
  };

  const setDuration = (mins) => {
    if (isOcc) return; // occurrence duration is governed by the pattern window
    upd({ endTime: addMinutes(task.startTime, mins) });
  };
  const setDay = (idx) => {
    const start = atTime(addDays(weekStart, idx), formatHHMM(task.startTime));
    upd({ startTime: start, endTime: addMinutes(start, durMin) });
  };
  const setStart = (hhmm) => {
    const start = atTime(dayStart(task.startTime), hhmm);
    upd({ startTime: start, endTime: addMinutes(start, durMin) });
  };
  const setShells = (n) => updSatisfaction({ overall: n });
  const setFacet = (key, v) => updSatisfaction({ [key]: v });

  const applyPattern = () => {
    mutate((s) => {
      const parent = s.tasks.find((t) => t.id === editable.id);
      if (!parent) return;
      const windows = recModel.windows.map((w) => ({ ...w }));
      if (!recModel.enabled) { parent.recurrence = null; return; }
      if (!parent.recurrence) { parent.recurrence = buildRecurrence(recModel, weekStart); return; }
      if (recModel.temporary && recModel.temporary.from && recModel.temporary.until) {
        temporaryChange(parent, dateFromKey(recModel.temporary.from), dateFromKey(recModel.temporary.until), windows, { interval: recModel.interval });
      } else if (recModel.scope === 'future') {
        splitPeriod(parent, new Date(), windows, { interval: recModel.interval });
      } else {
        const active = parent.recurrence.periods.find((p) => !p.effectiveUntil) || parent.recurrence.periods[0];
        active.windows = windows;
        active.interval = Number(recModel.interval) || 1;
      }
    });
    showToast('Pattern updated');
  };

  /** An extra session this week only — an `add` exception, not a pattern change
   *  (§4.2). It keeps the task's identity, so the rating still counts toward the
   *  same history. */
  const addOneOff = () => {
    const day = addDays(weekStart, extraDay);
    const start = atTime(day, extraStart);
    const end = addMinutes(start, durMin || 60);
    mutate((s) => {
      const parent = s.tasks.find((t) => t.id === editable.id);
      if (!parent) return;
      addException(parent, dateKey(day), 'add', { start: extraStart, end: formatHHMM(end) });
    });
    showToast(`Extra session added ${DAY_NAMES[extraDay]} — the pattern is unchanged`);
  };

  const skipOccurrence = () => {
    mutate((s) => {
      const parent = s.tasks.find((t) => t.id === editable.id);
      if (parent) addException(parent, task.occurrenceDate, 'skip');
    });
    showToast('Skipped this occurrence');
    onClose();
  };

  const doFind = () => {
    const found = sched.findFreeSlots({ from: weekStart, to: addDays(weekStart, 6), durationMin: durMin });
    setSlots(found.slice(0, 6));
  };
  const placeAt = (slot) => {
    upd({ startTime: slot.start, endTime: slot.end });
    setSlots(null);
    showToast('Moved to a new slot');
  };

  const duplicate = () => {
    mutate((s) => { const copy = editable.duplicate(); s.tasks.push(copy); });
    showToast('Duplicated (lived data reset)');
  };

  const del = (mode) => {
    mutate((s) => {
      const parent = s.tasks.find((t) => t.id === editable.id);
      if (!parent) return;
      if (!parent.recurrence) { s.removeTask(parent.id); return; }
      if (mode === 'occurrence') addException(parent, task.occurrenceDate || dateKey(task.startTime), 'skip');
      else if (mode === 'future') endRecurrence(parent, task.startTime);
      else s.removeTask(parent.id);
    });
    showToast('Deleted');
    onClose();
  };

  return (
    <>
      <PanelHeader
        title={editable.title}
        sub={[editable.type, editable.recurrence ? 'recurring' : null, editable.deadline ? 'has deadline' : null].filter(Boolean).join(' · ')}
        onClose={onClose}
      />

      <div className="fieldrow">
        <div className="flabel">Title</div>
        <input className="input" value={editable.title} onChange={(e) => upd({ title: e.target.value || editable.title })} />
      </div>

      {!isOcc && (
        <div className="fieldrow split">
          <div style={{ flex: 1 }}>
            <div className="flabel">Day</div>
            <select className="input" value={dayIdx} onChange={(e) => setDay(Number(e.target.value))}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div className="flabel">Start</div>
            <input className="timein" style={{ width: '100%' }} type="time" value={formatHHMM(task.startTime)} onChange={(e) => setStart(e.target.value)} />
          </div>
        </div>
      )}

      <div className="fieldrow">
        <div className="flabel">{fmtRange(task)} · duration</div>
        {isOcc ? <p className="psub-note">Occurrence length follows the pattern below.</p> : <DurationControl minutes={durMin} onChange={setDuration} />}
      </div>

      <div className="fieldrow">
        <div className="flabel">Tags</div>
        <TagEditor tags={editable.tags} onChange={(tags) => upd({ tags })} suggestions={tagsInUse(sched)} />
      </div>

      <div className="fieldrow split">
        <div>
          <div className="flabel">Priority</div>
          <select className="input" value={editable.priority} onChange={(e) => upd({ priority: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
        </div>
        <div>
          <div className="flabel">Pinned</div>
          <button type="button" className={`tw${editable.pinned ? ' on' : ''}`} role="switch" aria-checked={editable.pinned} aria-label="Pinned" onClick={() => upd({ pinned: !editable.pinned })}><span className="knob" /></button>
        </div>
        <div>
          <div className="flabel">Deadline</div>
          <input className="timein" style={{ width: 140 }} type="date" value={editable.deadline ? dateKey(editable.deadline) : ''} onChange={(e) => upd({ deadline: e.target.value ? dateFromKey(e.target.value) : null })} />
        </div>
      </div>

      <div className="divide" />
      <div className="fieldrow">
        <div className="flabel">Recurrence</div>
        <RecurrenceEditor model={recModel} onChange={setRecModel} allowScope={!!editable.recurrence} />
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={applyPattern}>
          <Icon name="loop" /> {editable.recurrence ? 'Update pattern' : 'Make repeating'}
        </button>
        {isOcc && <button type="button" className="linkish soft" onClick={skipOccurrence}>Skip this occurrence</button>}

        {editable.recurrence && (
          <div className="fieldrow" style={{ marginTop: 10 }}>
            <div className="flabel">Add a one-off session <span style={{ textTransform: 'none', letterSpacing: 0 }}>(this week only)</span></div>
            <div className="winrow">
              <select className="input" style={{ flex: 1 }} value={extraDay} onChange={(e) => setExtraDay(Number(e.target.value))} aria-label="Extra session day">
                {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              <input className="timein" type="time" value={extraStart} onChange={(e) => setExtraStart(e.target.value)} aria-label="Extra session start" />
              <button type="button" className="btn" style={{ width: 'auto' }} onClick={addOneOff}>＋ session</button>
            </div>
            <p className="psub-note">Adds a single extra session — the pattern stays as it is.</p>
          </div>
        )}
      </div>

      <div className="divide" />
      <div className="fieldrow">
        <div className="flabel">How did it fit?</div>
        <div className="shells">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className="sh" aria-label={`${n} shells`} onClick={() => setShells(n)}>
              <Icon name="shell" className={sat.overall >= n ? '' : 'off'} />
            </button>
          ))}
        </div>
        <div className="facets">
          {FACETS.map((f) => {
            const v = sat[f.key] || 0;
            return (
              <button
                key={f.key}
                type="button"
                className={`facet${v ? ' on' : ''}`}
                onClick={() => setFacet(f.key, cycleFacet(v))}
                title={`${f.label}: ${facetWord(f, v)} — click to cycle = ↑ ↓`}
                aria-label={`${f.label}: ${facetWord(f, v)}. Click to cycle.`}
              >
                {f.label}
                <b aria-hidden="true" style={{ margin: '0 4px', fontSize: '1.1em' }}>{facetGlyph(v)}</b>
                <span style={{ opacity: 0.7 }}>{facetWord(f, v)}</span>
              </button>
            );
          })}
        </div>
        <p className="psub-note" style={{ marginTop: 4 }}>Optional — click a facet to cycle: <b>=</b> just right · <b>↑</b> more · <b>↓</b> less.</p>
      </div>

      <div className="fieldrow">
        <button type="button" className="btn" onClick={doFind}><Icon name="spyglass" /> Find another time</button>
        {slots && (
          <div className="slotlist" style={{ marginTop: 8 }}>
            {slots.length === 0 && <div className="empty">No openings this week.</div>}
            {slots.map((sl, i) => (
              <button key={i} className="slot" onClick={() => placeAt(sl)}>
                <span>{DAY_NAMES[(sl.start.getDay() + 6) % 7]}</span>
                <span>{formatHHMM(sl.start)}–{formatHHMM(sl.end)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rowbtns">
        <button type="button" className="btn" onClick={duplicate}>Duplicate</button>
        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>
      </div>

      {confirmDelete && (
        <div className="fieldrow" style={{ marginTop: 8 }}>
          {editable.recurrence ? (
            <>
              <div className="flabel">Delete a recurring task</div>
              <button type="button" className="btn" onClick={() => del('occurrence')}>This occurrence</button>
              <div style={{ height: 6 }} />
              <button type="button" className="btn" onClick={() => del('future')}>This &amp; future</button>
              <div style={{ height: 6 }} />
              <button type="button" className="btn danger" onClick={() => { if (window.confirm('Delete every occurrence, forever?')) del('all'); }}>Everything</button>
            </>
          ) : (
            <button type="button" className="btn danger" onClick={() => del('all')}>Confirm delete</button>
          )}
        </div>
      )}
    </>
  );
}
