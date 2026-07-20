// AddTaskPanel — quick capture. Title is the only required field (submit blocked
// on empty, case 7A).
//
// Two ways in, and the type decides which:
//   FIXED    — you say when. "Dentist, Friday 2pm" (7B) is the whole point of a
//              fixed task; auto-placing one would be nonsense.
//   FLEXIBLE — placed immediately by score, no unscheduled tray (7A) — unless
//              you tick "pick a time" and say where it goes yourself.
// A time you chose means placedBy:'user', so re-optimize prefers to leave it be.
import { useState } from 'react';
import { addDays, addMinutes, atTime, dateFromKey, formatHHMM } from '../../../core/index.js';
import { buildRecurrence, emptyRecurrence } from '../../recurrenceModel.js';
import { DAY_NAMES } from '../../format.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';
import TagEditor, { tagsInUse } from '../TagEditor.jsx';
import RecurrenceEditor from '../RecurrenceEditor.jsx';

/** Today if it's in the viewed week, else Monday — the likeliest day you mean. */
function defaultDayIndex(weekStart) {
  const idx = Math.floor((Date.now() - weekStart.getTime()) / 86400000);
  return idx >= 0 && idx <= 6 ? idx : 0;
}

/**
 * Where auto-placement should start looking: now, when the viewed week is the
 * one we're living in — otherwise the week's own Monday.
 *
 * A break added on Wednesday belongs today, not in Monday's leftover gap. The
 * search used to start at `weekStart` unconditionally, which offered up hours
 * that had already happened.
 */
function placementFrom(weekStart, now = new Date()) {
  const end = addDays(weekStart, 7);
  return now >= weekStart && now < end ? now : weekStart;
}

/** The next quarter-hour — a sane "when", not 00:00. */
function defaultStart() {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return formatHHMM(d);
}

export default function AddTaskPanel({ sched, mutate, weekStart, onClose, showToast }) {
  const [type, setType] = useState('flexible');
  const [title, setTitle] = useState('');
  const [dur, setDur] = useState(60);
  const [tags, setTags] = useState([]);
  const [priority, setPriority] = useState(3);
  const [pinned, setPinned] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [recModel, setRecModel] = useState(emptyRecurrence);
  const [pickTime, setPickTime] = useState(false);
  const [day, setDay] = useState(() => defaultDayIndex(weekStart));
  const [start, setStart] = useState(defaultStart);

  const canSubmit = title.trim().length > 0;
  const repeats = !!recModel.enabled;
  // A fixed task IS a time — the choice isn't optional. A repeating task gets
  // its times from the pattern's windows instead.
  const timed = !repeats && (type === 'fixed' || pickTime);

  const submit = () => {
    if (!canSubmit) return;
    const data = {
      title: title.trim(),
      tags,
      priority,
      pinned,
      // Bound the scored search to the week you're looking at, starting from now
      // if that week is the current one.
      from: placementFrom(weekStart),
      to: addDays(weekStart, 6),
      deadline: deadline ? dateFromKey(deadline) : null,
    };
    const rec = buildRecurrence(recModel, weekStart);
    if (rec) data.recurrence = rec;

    if (timed) {
      const s = atTime(addDays(weekStart, day), start);
      data.startTime = s;
      data.endTime = addMinutes(s, dur);
      data.placedBy = 'user'; // you chose it; don't let re-optimize wander it
    } else if (!rec) {
      // Deliberately no slot pre-computation here. This used to call the
      // UNSCORED findFreeSlot({from: weekStart}) and assign its result — which
      // handed back the week's first gap (Monday 08:00, already two days gone)
      // and, by setting startTime, made addFlexible skip scored placement
      // altogether. 7A says a new task is "placed immediately via scored
      // placement"; leaving startTime unset is what lets that actually happen.
      // durationMin carries the length you chose without pinning a time.
      data.durationMin = dur;
    }

    const added = mutate((s) => (type === 'fixed' ? s.addFixed(data) : s.addFlexible(data)));

    // A time you picked can land on something. R-1 says your action wins, so
    // flexibles move aside; an anchor won't, and you're told rather than left
    // with a silent overlap.
    let note = '';
    if (timed && added) {
      const res = mutate((s) => s.resolveDropConflicts(added));
      if (res && res.rejected) note = ` · overlaps ${res.reason ? res.reason.split(': ').pop() : 'something fixed'}`;
      else if (res && res.displaced.length) note = ` · ${res.displaced.length} moved aside`;
    }
    showToast(`Added "${data.title}"${timed ? ` at ${start}` : ''}${note}`);
    onClose();
  };

  return (
    <>
      <PanelHeader title="Add task" sub="quick capture" onClose={onClose} />
      <div className="fieldrow">
        <div className="chips">
          <button type="button" className={`pill${type === 'fixed' ? ' on' : ''}`} onClick={() => setType('fixed')}>Fixed</button>
          <button type="button" className={`pill${type === 'flexible' ? ' on' : ''}`} onClick={() => setType('flexible')}>Flexible</button>
        </div>
      </div>
      <div className="fieldrow">
        <div className="flabel">Title <span className="lc">(only required field)</span></div>
        <input className="input" autoFocus placeholder="Call plumber…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </div>
      <div className="fieldrow">
        <div className="flabel">Duration</div>
        <DurationControl minutes={dur} onChange={setDur} />
      </div>

      {/* When. A fixed task must say; a flexible one may. A repeating task takes
          its times from the pattern, so asking twice would just contradict it. */}
      {!repeats && (
        <div className="fieldrow">
          <div className="flabel">
            {type === 'fixed' ? 'When' : 'When '}
            {type !== 'fixed' && (
              <label style={{ textTransform: 'none', letterSpacing: 0, cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={pickTime}
                  onChange={(e) => setPickTime(e.target.checked)}
                  style={{ marginRight: 5, verticalAlign: '-2px' }}
                />
                pick a time
              </label>
            )}
          </div>
          {timed ? (
            <div className="winrow">
              <select className="input" style={{ flex: 1 }} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Day">
                {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              <input
                className="timein"
                type="time"
                step="900"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="Start time"
              />
            </div>
          ) : (
            <p className="psub-note">Placed immediately by score — no unscheduled tray.</p>
          )}
        </div>
      )}
      <div className="fieldrow">
        <div className="flabel">Tags</div>
        <TagEditor tags={tags} onChange={setTags} suggestions={tagsInUse(sched)} />
      </div>
      <div className="fieldrow split">
        <div>
          <div className="flabel">Priority</div>
          <select className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
        </div>
        <div>
          <div className="flabel">Pin</div>
          <button type="button" className={`tw${pinned ? ' on' : ''}`} role="switch" aria-checked={pinned} aria-label="Pin" onClick={() => setPinned(!pinned)}><span className="knob" /></button>
        </div>
        <div>
          <div className="flabel">Deadline</div>
          <input className="timein" style={{ width: 140 }} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="flabel">Repeat?</div>
        <RecurrenceEditor model={recModel} onChange={setRecModel} />
      </div>
      <button type="button" className="btn cta" style={{ marginTop: 8 }} disabled={!canSubmit} onClick={submit}>Add to the week</button>
    </>
  );
}
