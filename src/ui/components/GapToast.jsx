// GapToast — the removal / early-completion offer (SPEC §3.8 3C, §3.9 3D).
//
// P-1: three fates, equal visual weight, none imposed. "Leave open" is the
// default and the auto-dismiss lands on it, so ignoring the toast is a real
// answer rather than a deferred one. Nothing here is a warning — a freed hour
// is not a problem, and none of it is coloured like one.
import { useEffect, useRef } from 'react';
import { fmtDur } from '../format.js';

export default function GapToast({ label, minutes, canBackfill, backfillHint, onLeave, onBackfill, onProtect }) {
  const ref = useRef(null);

  // The default holds focus, so Enter takes the offer's default and Esc — from
  // anywhere — leaves the gap open. Both are the same answer.
  useEffect(() => {
    if (ref.current) ref.current.focus();
  }, []);

  // Not role="status": this holds focus and holds controls, which makes it a
  // dialog, not a live region. It also keeps the plain toast the only
  // role="status" on screen, so the two never compete to be read out.
  return (
    <div className="gaptoast" role="dialog" aria-label="What should happen to the freed time?">
      <div className="gt">
        {label} — <b>{fmtDur(minutes)}</b> free
      </div>
      <div className="gopts">
        <button type="button" ref={ref} className="opt" onClick={onLeave} title="The gap simply exists">
          Leave open
          <small>default</small>
        </button>
        <button
          type="button"
          className="opt"
          disabled={!canBackfill}
          title={canBackfill ? backfillHint : 'Nothing this week fits here on its own'}
          onClick={onBackfill}
        >
          Backfill
          <small>{canBackfill ? backfillHint : 'nothing fits'}</small>
        </button>
        <button type="button" className="opt" onClick={onProtect} title="Keep the time as rest">
          Protect
          <small>make it rest</small>
        </button>
      </div>
      <div className="chint">Enter · leave it open &nbsp;|&nbsp; Esc · dismiss</div>
    </div>
  );
}
