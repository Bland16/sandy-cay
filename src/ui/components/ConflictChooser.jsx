// ConflictChooser — the inline ripple/displace choice (OD-8, SPEC §3.2).
//
// Always shown when a drop or resize collides with a flexible task; the cost
// heuristic only decides which option is *pre-highlighted* (and therefore what
// Enter commits, since the default option holds focus). Esc snaps back.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDur } from '../format.js';

const W = 208; // keep in sync with .chooser max-width
const PAD = 8;

/**
 * @param anchor  screen rect of the card that just landed
 * @param def     'ripple' | 'displace' — the pre-highlighted default
 */
export default function ConflictChooser({
  anchor, def, rippleEnabled, label, deltaMin, downstreamCount,
  onRipple, onDisplace, onCancel,
}) {
  const ref = useRef(null);
  const defaultRef = useRef(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top + anchor.height + 6 });

  // Anchor near the card, but never off-screen (nothing may spill the viewport).
  useLayoutEffect(() => {
    const h = ref.current ? ref.current.offsetHeight : 96;
    const left = Math.min(Math.max(PAD, anchor.left), window.innerWidth - W - PAD);
    let top = anchor.top + anchor.height + 6;
    if (top + h > window.innerHeight - PAD) top = Math.max(PAD, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    if (defaultRef.current) defaultRef.current.focus();
  }, []);

  const rippleDefault = def === 'ripple' && rippleEnabled;

  return (
    <div
      className="chooser"
      ref={ref}
      role="dialog"
      aria-label="Resolve the conflict"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
    >
      <div className="ct">{label}</div>
      <div className="copt">
        <button
          type="button"
          ref={rippleDefault ? defaultRef : null}
          className={`opt${rippleDefault ? ' pick' : ''}`}
          disabled={!rippleEnabled}
          title={
            rippleEnabled
              ? `Shift the rest of the day by up to ${fmtDur(deltaMin)}`
              : 'Nothing downstream to ripple'
          }
          onClick={onRipple}
        >
          Ripple day →
          <small>
            {rippleEnabled
              ? `${downstreamCount} task${downstreamCount === 1 ? '' : 's'} · ${fmtDur(deltaMin)}`
              : 'nothing downstream'}
          </small>
        </button>
        <button
          type="button"
          ref={!rippleDefault ? defaultRef : null}
          className={`opt${!rippleDefault ? ' pick' : ''}`}
          title="Move the collided task to its best free slot"
          onClick={onDisplace}
        >
          Displace
          <small>find it a new slot</small>
        </button>
      </div>
      <div className="chint">Enter · highlighted &nbsp;|&nbsp; Esc · snap back</div>
    </div>
  );
}
