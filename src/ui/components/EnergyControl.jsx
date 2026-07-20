// EnergyControl — the load vector as a tube-float on a wave (design/EDITOR-REDESIGN.md §5).
// One wave per axis; drag the life-ring left (restore, −) or right (spend, +), or
// arrow-key it. The axis critter RIDES IN the tube (centred in the ring), tinted
// blue so it reads as part of the water. NO numbers on screen — position on the
// wave IS the reading. The value is a continuous float in [-2, 2] (smooth drag,
// no snapping); keyboard steps by whole numbers for coarse a11y control. A real
// slider (position carries the value → greyscale/print safe, §10).
import { useRef } from 'react';
import { AXES, AXIS_META } from '../energyMeta.js';

const WAVE = new URL('../../assets/icons/wave.png', import.meta.url).href;
const CRITTER = {
  mental: new URL('../../assets/icons/seagull.png', import.meta.url).href,
  physical: new URL('../../assets/icons/surfboard.png', import.meta.url).href,
  social: new URL('../../assets/icons/beach-ball.png', import.meta.url).href,
  creative: new URL('../../assets/icons/crab.png', import.meta.url).href,
};
const WORDS = ['restores a lot', 'restores', 'neutral', 'spends', 'spends a lot'];
const clampF = (v) => Math.max(-2, Math.min(2, v));
// Visual position is inset 10–90% so the tube stays fully on the track at the
// extremes (drag still reads the full width → the whole [-2,2] range).
const pctOf = (v) => 10 + ((v + 2) / 4) * 80; // −2→10%  0→50%  +2→90%

// The social critter as a crisp SVG beach ball — the muted PNG couldn't CSS-tint
// to anything but flat white, so it's drawn: coloured plastic wedges + a gloss
// highlight, distinct from the seagull's feathery white.
function BeachBall() {
  const w = (a1, a2, fill) => {
    const p = (deg) => `${(16 + 13 * Math.cos((deg * Math.PI) / 180)).toFixed(2)},${(16 + 13 * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
    return <path d={`M16,16 L${p(a1)} A13,13 0 0 1 ${p(a2)} Z`} fill={fill} />;
  };
  return (
    <svg className="enrider enball" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="#f4efe6" />
      {w(0, 60, '#e2685f')}{w(120, 180, '#e8b94d')}{w(240, 300, '#2e8c99')}
      <circle cx="16" cy="16" r="2.6" fill="#f4efe6" stroke="rgba(40,30,20,.4)" strokeWidth="0.8" />
      <ellipse cx="12" cy="11.5" rx="3.2" ry="2" fill="#fff" opacity="0.55" />
      <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(40,30,20,.45)" strokeWidth="1" />
    </svg>
  );
}

function Axis({ axis, value, onChange, ghost = false }) {
  const trackRef = useRef(null);
  // continuous float, rounded to 2dp so the stored value is clean but smooth
  const set = (raw) => { const v = Math.round(clampF(raw) * 100) / 100; if (v !== value) onChange(v); };
  const fromX = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    set(frac * 4 - 2);
  };
  const onPointerDown = (e) => {
    e.preventDefault();
    fromX(e.clientX);
    const move = (ev) => fromX(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onKeyDown = (e) => {
    // whole-number steps regardless of the current float position (clean a11y nav)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(Math.ceil(value - 1e-6) - 1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(Math.floor(value + 1e-6) + 1); }
    else if (e.key === 'Home') { e.preventDefault(); set(-2); }
    else if (e.key === 'End') { e.preventDefault(); set(2); }
  };
  return (
    <div className="enrow">
      <span className="enlabel">{AXIS_META[axis].label}</span>
      <div
        className="entrack"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`${AXIS_META[axis].label} energy`}
        aria-valuemin={-2}
        aria-valuemax={2}
        aria-valuenow={value}
        aria-valuetext={ghost ? `${WORDS[Math.round(value) + 2]} (inherited)` : WORDS[Math.round(value) + 2]}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        style={{ '--wave': `url(${WAVE})` }}
      >
        <span className={ghost ? 'enfloat ghost' : 'enfloat'} style={{ left: `${pctOf(value)}%` }}>
          {/* the tube: a crisp SVG life-ring (pink + white) — no PNG segmentation residue */}
          <svg className="entube" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" fill="none" stroke="#f4efe6" strokeWidth="11" />
            <circle cx="20" cy="20" r="16" fill="none" stroke="#e26d84" strokeWidth="11" strokeDasharray="11 14.13" transform="rotate(45 20 20)" />
            <circle cx="20" cy="20" r="21.5" fill="none" stroke="rgba(40,30,20,.35)" strokeWidth="1" />
            <circle cx="20" cy="20" r="10.5" fill="none" stroke="rgba(40,30,20,.35)" strokeWidth="1" />
          </svg>
          {axis === 'social'
            ? <BeachBall />
            : <img className={`enrider en-${axis}`} src={CRITTER[axis]} alt="" aria-hidden="true" title={AXIS_META[axis].label} />}
        </span>
      </div>
    </div>
  );
}

/** value: a load object {mental,physical,social,creative} (or null → neutral).
 *  onChange: (nextLoad) => void. Loads are continuous floats in [-2, 2].
 *
 *  Inherit mode (EDITOR-REDESIGN §5.3). Load resolves own → bucket → neutral, so
 *  the control has two looks:
 *    - inheriting: ghost tubes sitting at the INHERITED position, with a
 *      `.field-help` naming the source. Touching a float commits an explicit
 *      value (onChange fires with the full vector, so the untouched axes keep
 *      what they were showing rather than snapping to zero).
 *    - explicit: solid tubes + a "↺ inherit" link (onInherit) back to null.
 *  inheritedFrom: source label (e.g. a bucket name) or null.
 *  inheriting: whether `value` is currently the inherited vector.
 *  onInherit: () => void — revert to inheriting; omit if there's nothing to
 *  revert to. (Spelled out rather than inferred from the §5.5 prop list, so a
 *  caller can't land in an ambiguous half-state.) */
export default function EnergyControl({
  value, onChange, inheritedFrom = null, inheriting = false, onInherit = null,
}) {
  const load = value || { mental: 0, physical: 0, social: 0, creative: 0 };
  const setAxis = (axis, v) => onChange({ ...load, [axis]: v });
  const source = inheritedFrom || 'its bucket';
  return (
    <div className={inheriting ? 'energyctl inheriting' : 'energyctl'}>
      <div className="enends"><span>restore</span><span>spend</span></div>
      {AXES.map((a) => (
        <Axis key={a} axis={a} value={load[a] ?? 0} onChange={(v) => setAxis(a, v)} ghost={inheriting} />
      ))}
      {inheriting ? (
        <div className="field-help">
          inheriting from <strong>{source}</strong> — move a float to set its own
        </div>
      ) : onInherit ? (
        <div className="field-help">
          its own energy · <button type="button" className="linklike" onClick={onInherit}>↺ inherit {source}</button>
        </div>
      ) : null}
    </div>
  );
}
