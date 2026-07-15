// OccurrenceMenu — dropping a one-off onto a recurring session (SPEC §4C).
//
// A materialized occurrence is a fixed anchor, so §3.1 as written would just
// reject the drop. That's too rigid: sometimes the appointment legitimately
// wins. So the drop opens this, and — deliberately — with **no silent default**.
// The cost heuristic that settles ripple-vs-displace (OD-8) does not apply:
// recurring-versus-one-off is a judgement call, not an arithmetic one, and
// neither option is pre-highlighted for Enter to take.
//
// The pattern is never touched. Both answers write a single exception against
// this date; next week materializes exactly as before.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDur } from '../format.js';

const W = 232;
const PAD = 8;

export default function OccurrenceMenu({ anchor, occurrence, moveTo, onMove, onSkip, onCancel }) {
  const ref = useRef(null);
  const firstRef = useRef(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top + anchor.height + 6 });

  useLayoutEffect(() => {
    const h = ref.current ? ref.current.offsetHeight : 120;
    const left = Math.min(Math.max(PAD, anchor.left), Math.max(PAD, window.innerWidth - W - PAD));
    let top = anchor.top + anchor.height + 6;
    if (top + h > window.innerHeight - PAD) top = Math.max(PAD, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor]);

  // Focus lands on the menu, not on an answer: nothing here is pre-chosen.
  useEffect(() => {
    if (firstRef.current) firstRef.current.focus();
  }, []);

  return (
    <div
      className="occmenu"
      ref={ref}
      role="dialog"
      aria-label={`${occurrence.title} is already here`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
    >
      <div className="ct">{occurrence.title} is already here</div>
      <p className="occsub">This session only — the pattern keeps going.</p>
      <div className="occopts">
        <button
          type="button"
          ref={firstRef}
          className="opt"
          disabled={!moveTo}
          title={moveTo ? 'Find this session another slot' : 'No free slot for it in the next few days'}
          onClick={onMove}
        >
          Move this session
          <small>{moveTo ? moveTo.label : 'nowhere to move it'}</small>
        </button>
        <button type="button" className="opt" onClick={onSkip} title="This session doesn't happen">
          Skip this session
          <small>just this once · {fmtDur(occurrence.getDuration())} freed</small>
        </button>
        <button type="button" className="opt" onClick={onCancel} title="Put the dropped task back">
          Cancel
          <small>snap back</small>
        </button>
      </div>
      <div className="chint">Esc · cancel</div>
    </div>
  );
}
