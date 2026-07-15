// AddTaskPanel — quick capture. Title is the only required field (submit blocked
// on empty, case 7A). Includes the shared recurrence editor so a task can be made
// repeatable at creation. Submit places it immediately via a scored free slot.
import { useState } from 'react';
import { addDays, dateFromKey } from '../../../core/index.js';
import { buildRecurrence, emptyRecurrence } from '../../recurrenceModel.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';
import TagEditor, { tagsInUse } from '../TagEditor.jsx';
import RecurrenceEditor from '../RecurrenceEditor.jsx';

export default function AddTaskPanel({ sched, mutate, weekStart, onClose, showToast }) {
  const [type, setType] = useState('flexible');
  const [title, setTitle] = useState('');
  const [dur, setDur] = useState(60);
  const [tags, setTags] = useState([]);
  const [priority, setPriority] = useState(3);
  const [pinned, setPinned] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [recModel, setRecModel] = useState(emptyRecurrence);

  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const data = {
      title: title.trim(),
      tags,
      priority,
      pinned,
      from: weekStart,
      deadline: deadline ? dateFromKey(deadline) : null,
    };
    const rec = buildRecurrence(recModel, weekStart);
    if (rec) data.recurrence = rec;
    if (!rec) {
      const slot = sched.findFreeSlot({ from: weekStart, to: addDays(weekStart, 6), durationMin: dur });
      if (slot) { data.startTime = slot.start; data.endTime = slot.end; }
    }
    mutate((s) => (type === 'fixed' ? s.addFixed(data) : s.addFlexible(data)));
    showToast(`Added "${data.title}" to the week`);
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
      <p className="psub-note">Placed immediately by score — no unscheduled tray.</p>
      <button type="button" className="btn cta" style={{ marginTop: 8 }} disabled={!canSubmit} onClick={submit}>Add to the week</button>
    </>
  );
}
