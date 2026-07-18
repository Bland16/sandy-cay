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

function Axis({ axis, value, onChange }) {
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
        aria-valuetext={WORDS[Math.round(value) + 2]}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        style={{ '--wave': `url(${WAVE})` }}
      >
        <span className="enfloat" style={{ left: `${pctOf(value)}%` }}>
          {/* the tube: a crisp SVG life-ring (pink + white) — no PNG segmentation residue */}
          <svg className="entube" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" fill="none" stroke="#f4efe6" strokeWidth="11" />
            <circle cx="20" cy="20" r="16" fill="none" stroke="#e26d84" strokeWidth="11" strokeDasharray="11 14.13" transform="rotate(45 20 20)" />
            <circle cx="20" cy="20" r="21.5" fill="none" stroke="rgba(40,30,20,.35)" strokeWidth="1" />
            <circle cx="20" cy="20" r="10.5" fill="none" stroke="rgba(40,30,20,.35)" strokeWidth="1" />
          </svg>
          <img className={`enrider en-${axis}`} src={CRITTER[axis]} alt="" aria-hidden="true" title={AXIS_META[axis].label} />
        </span>
      </div>
    </div>
  );
}

/** value: a load object {mental,physical,social,creative} (or null → neutral).
 *  onChange: (nextLoad) => void. Loads are continuous floats in [-2, 2]. */
export default function EnergyControl({ value, onChange }) {
  const load = value || { mental: 0, physical: 0, social: 0, creative: 0 };
  const setAxis = (axis, v) => onChange({ ...load, [axis]: v });
  return (
    <div className="energyctl">
      <div className="enends"><span>restore</span><span>spend</span></div>
      {AXES.map((a) => (
        <Axis key={a} axis={a} value={load[a] ?? 0} onChange={(v) => setAxis(a, v)} />
      ))}
    </div>
  );
}
