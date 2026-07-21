// EnergyCard — today's energy as a BATTERY (design/ENERGY-MODEL.md; design/
// RECONCILIATION.md P-2). Each axis has a reserve that drains on demanding work
// and refills on rest, walked in time order — so the reading is the DEEPEST DIP,
// and resting *between* blocks helps more than resting after. Capacity is LEARNED:
// until calibrated the card shows the dip SHAPE with no ceiling or verdict; once
// calibrated it flags an axis that bottoms into the red. Physics, never a scold (P-1).
import { AXES, AXIS_META } from '../energyMeta.js';

const fmt = (n) => (Math.round(n * 10) / 10).toString();

export default function EnergyCard({ sched, now = new Date() }) {
  const budget = sched.energyBudget(now);
  const cal = sched.energyCalibration();
  const dip = (a) => -budget[a].low; // ≥ 0, the deepest debt reached today (load-hours)

  // ---- still learning: the dip shape, no ceiling ------------------------
  if (!cal.calibrated) {
    const maxDip = Math.max(1, ...AXES.map(dip));
    return (
      <div className="cabcard">
        <div className="cabsign">Energy today</div>
        <p className="insight">
          How far each reserve dips as today unfolds — resting between demanding blocks keeps
          it shallow. We&apos;re still learning your rhythm, so no ceiling yet ({cal.weeksRated} of {cal.weeksNeeded} weeks rated).
        </p>
        {AXES.map((a) => {
          const d = dip(a);
          const pct = Math.round((d / maxDip) * 100);
          return (
            <div className="insight" key={a}>
              <span>
                <span aria-hidden="true">{AXIS_META[a].glyph}</span> <b>{AXIS_META[a].label}</b>
                {' · '}{d > 0.5 ? 'dips' : 'steady'}
              </span>
              <div className="bar2"><i style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
        <p className="insight" style={{ marginTop: 8, opacity: 0.7 }}>
          Rate how your tasks leave you and this becomes a real reserve in a few weeks.
        </p>
      </div>
    );
  }

  // ---- calibrated: the reserve, with a gentle "in the red" flag ----------
  const anyOver = AXES.some((a) => budget[a].over);
  return (
    <div className="cabcard">
      <div className="cabsign">Energy today</div>
      <p className="insight">How deep each reserve dips today — a battery, not a scold.</p>
      {AXES.map((a) => {
        const x = budget[a];
        const d = dip(a);
        const pct = Math.max(0, Math.min(100, Math.round((d / (x.capacity || 1)) * 100)));
        const tag = x.over ? 'in the red' : d <= 0 ? 'full' : `${fmt(d)}/${fmt(x.capacity)}`;
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
          ? 'Something bottomed out today — resting between blocks helps more than after. No pressure.'
          : 'Your reserves stay topped up.'}
      </p>
    </div>
  );
}
