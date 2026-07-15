// FindPanel — global free-slot search (cases 1C/1D). Duration + optional
// time-of-day window over this week → findFreeSlots; results list + Copy as text.
import { useState } from 'react';
import { addDays, formatHHMM } from '../../../core/index.js';
import { DAY_NAMES } from '../../format.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';

export default function FindPanel({ sched, weekStart, onClose, showToast }) {
  const [dur, setDur] = useState(60);
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState('11:30');
  const [to, setTo] = useState('13:30');

  const window = useWindow ? { start: from, end: to } : null;
  const slots = sched.findFreeSlots({ from: weekStart, to: addDays(weekStart, 6), durationMin: dur, window });

  const asText = () => slots
    .map((s) => `${DAY_NAMES[(s.start.getDay() + 6) % 7]} ${formatHHMM(s.start)}–${formatHHMM(s.end)}`)
    .join('\n');

  const copy = async () => {
    const text = asText();
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      showToast('Copied your open times');
    } catch {
      showToast('Copy failed — select the list manually');
    }
  };

  return (
    <>
      <PanelHeader title="Find times" sub="free-slot search" onClose={onClose} />
      <div className="fieldrow">
        <div className="flabel">How much time do you need?</div>
        <DurationControl minutes={dur} onChange={setDur} />
      </div>
      <div className="fieldrow">
        <div className="flabel">
          Only between <span className="lc">(optional)</span>
          <label className="toggle" style={{ float: 'right' }}>
            <button type="button" className={`tw${useWindow ? ' on' : ''}`} role="switch" aria-checked={useWindow} aria-label="Limit to a time window" onClick={() => setUseWindow(!useWindow)}><span className="knob" /></button>
          </label>
        </div>
        {useWindow && (
          <div className="winrow">
            <input className="timein" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From time" />
            <span className="arr">→</span>
            <input className="timein" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To time" />
          </div>
        )}
      </div>
      <div className="fieldrow">
        <div className="flabel">This week · {slots.length} openings</div>
        <div className="slotlist">
          {slots.length === 0 && <div className="empty">No openings match. Try a shorter block.</div>}
          {slots.slice(0, 30).map((s, i) => (
            <div className="slot" key={i}>
              <span>{DAY_NAMES[(s.start.getDay() + 6) % 7]}</span>
              <span>{formatHHMM(s.start)}–{formatHHMM(s.end)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rowbtns">
        <button type="button" className="btn cta" disabled={slots.length === 0} onClick={copy}>Copy as text</button>
      </div>
    </>
  );
}
