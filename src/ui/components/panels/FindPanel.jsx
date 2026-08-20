// FindPanel — global free-slot search (cases 1C/1D). Duration + optional
// time-of-day window over this week → findFreeSlots; results list + Copy as text.
import { useState } from 'react';
import {
  addDays, formatHHMM, rankOpenings, ratingsUntilLearned,
} from '../../../core/index.js';
import { DAY_NAMES } from '../../format.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';

export default function FindPanel({ sched, weekStart, onClose, showToast }) {
  const [dur, setDur] = useState(60);
  const [tag, setTag] = useState('');
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState('11:30');
  const [to, setTo] = useState('13:30');

  const window = useWindow ? { start: from, end: to } : null;
  const found = sched.findFreeSlots({ from: weekStart, to: addDays(weekStart, 6), durationMin: dur, window });

  // design/FIND-A-TIME.md. A separate pass over what `findFreeSlots` returned —
  // it stays deliberately unscored (sharp edge #13), and this reorders a copy.
  // With no tag the order is exactly what it has always been.
  const ranked = rankOpenings(sched, found, { tag: tag.trim() || null, durationMin: dur });
  const slots = ranked.rows.map((r) => r.slot);
  const reasonOf = new Map(ranked.rows.map((r) => [r.slot.start.getTime(), r.reason]));
  const learning = ratingsUntilLearned(sched);

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
        <div className="flabel">
          What is it for? <span className="lc">(optional — sorts by what suits it)</span>
        </div>
        <input
          className="tagin"
          value={tag}
          placeholder="study, people…"
          onChange={(e) => setTag(e.target.value)}
          aria-label="Tag to rank openings by"
        />
      </div>
      <div className="fieldrow">
        <div className="flabel">This week · {slots.length} openings</div>
        {/* ⚠️ WHICH RULE IS IN FORCE, always said. The two orderings behave
            differently and a silent switch between them is the surprise P-1
            exists to prevent — and the "still learning" count is the shape the
            energy card already uses rather than a fabricated confidence. */}
        {ranked.rule === 'learned' && (
          <p className="insight">Sorted by what you have actually done with <b>{tag.trim()}</b>.</p>
        )}
        {ranked.rule === 'energy' && (
          <p className="insight">
            Sorted by which day it leaves least drained — still learning your preferences
            {' '}({learning.have} of {learning.need} ratings).
          </p>
        )}
        <div className="slotlist">
          {slots.length === 0 && <div className="empty">No openings match. Try a shorter block.</div>}
          {/* Sorted BEFORE slicing (F-3), or the cap silently drops the best. */}
          {slots.slice(0, 30).map((s, i) => (
            <div className="slot" key={i}>
              <span>{DAY_NAMES[(s.start.getDay() + 6) % 7]}</span>
              <span>{formatHHMM(s.start)}–{formatHHMM(s.end)}</span>
              {reasonOf.get(s.start.getTime()) && (
                <span className="slotwhy">{reasonOf.get(s.start.getTime())}</span>
              )}
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
