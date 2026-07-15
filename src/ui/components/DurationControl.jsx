// DurationControl — the mockup's slider + manual minute input + quick chips.
// Controlled: parent owns `minutes`, we report changes up. Slider caps at 240
// for ergonomics; the number field accepts 5–600 so long tasks aren't clipped.
import { fmtDur } from '../format.js';

const CHIPS = [
  { label: '30m', v: 30 },
  { label: '1h', v: 60 },
  { label: '90m', v: 90 },
  { label: '2h', v: 120 },
];

export default function DurationControl({ minutes, onChange }) {
  const set = (v) => {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = 5;
    onChange(Math.max(5, Math.min(600, n)));
  };
  return (
    <div className="dur">
      <div className="durtop">
        <span className="durval">{fmtDur(minutes)}</span>
        <span className="durhint">drag or type</span>
      </div>
      <input
        type="range"
        className="durrange"
        min="15"
        max="240"
        step="15"
        value={Math.max(15, Math.min(240, minutes))}
        onChange={(e) => set(e.target.value)}
        aria-label="Duration"
      />
      <div className="durmanual">
        <input
          type="number"
          className="durnum"
          min="5"
          max="600"
          step="5"
          value={minutes}
          onChange={(e) => set(e.target.value)}
          aria-label="Duration in minutes"
        />
        <span className="u">min</span>
        <div className="durchips">
          {CHIPS.map((c) => (
            <button key={c.v} type="button" className="pill" onClick={() => set(c.v)}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
