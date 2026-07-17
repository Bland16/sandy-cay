// EnergyCard — the Cabana's read-out of today's energy budget (design/ENERGY-MODEL.md,
// L-1). Deterministic accountant: how much of each reserve today's plan spends,
// with a gentle over-budget flag. Physics, never a scold (P-1) — the same voice
// as "this won't fit the time", applied to "this won't fit your energy".
import { AXES, AXIS_META } from '../energyMeta.js';

export default function EnergyCard({ sched, now = new Date() }) {
  const budget = sched.energyBudget(now);
  const anyOver = AXES.some((a) => budget[a].over);

  return (
    <div className="cabcard">
      <div className="cabsign">Energy today</div>
      <p className="insight">What today&apos;s plan spends across your reserves — a budget, not a scold.</p>
      {AXES.map((a) => {
        const x = budget[a];
        const pct = Math.max(0, Math.min(100, Math.round((x.net / (x.capacity || 1)) * 100)));
        const tag = x.over ? 'over budget' : x.net < 0 ? 'surplus' : `${x.net}/${x.capacity}`;
        return (
          <div className="insight" key={a}>
            <span>
              <span aria-hidden="true">{AXIS_META[a].glyph}</span> <b>{AXIS_META[a].label}</b>
              {' · '}
              <span style={x.over ? { color: 'var(--warning)' } : undefined}>{tag}</span>
            </span>
            <div className="bar2"><i style={{ width: `${pct}%`, ...(x.over ? { background: 'var(--warning)' } : {}) }} /></div>
          </div>
        );
      })}
      <p className="insight" style={{ marginTop: 8, opacity: 0.7 }}>
        {anyOver
          ? 'Something’s over today — a restful pick would give it back. No pressure.'
          : 'Comfortably within budget.'}
      </p>
    </div>
  );
}
