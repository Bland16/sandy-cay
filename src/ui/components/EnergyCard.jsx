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
  const dip = (a) => -budget[a].low; // ≥ 0, the deepest debt reached today (load-hours)

  // ⚠️ ONE CARD, AND THE CEILING IS DECIDED PER AXIS.
  //
  // This used to branch on `energyCalibration().calibrated`, which is GLOBAL —
  // ratings across N weeks — while the evidence behind a ceiling is per-axis.
  // `learnedCapacity` was fixed on 2026-09-03 to return null for an axis with
  // no evidence rather than substituting the config prior, and this card did
  // not follow: `x.capacity || 1` turned that null into 1, so an axis the user
  // has never spent a minute on rendered a FULL bar labelled "8.0/null" — the
  // word null, printed on the card, over a bar reading as maxed out.
  //
  // So: an axis with an earned ceiling is drawn against it. An axis without one
  // states its dip and draws no bar at all. Drawing no bar claims nothing,
  // which is the same argument EnergyShape makes for drawing no ring — and it
  // means a ceiling appearing later contradicts nothing shown before it.
  const anyOver = AXES.some((a) => budget[a].over);
  const anyCeiling = AXES.some((a) => budget[a].capacity != null);

  return (
    <div className="cabcard">
      <div className="cabsign">Energy today</div>
      <p className="insight">
        How far each reserve dips as today unfolds — resting between demanding
        blocks keeps it shallow.
      </p>
      {AXES.map((a) => {
        const x = budget[a];
        const d = dip(a);
        const hasCeiling = x.capacity != null;
        const pct = hasCeiling
          ? Math.max(0, Math.min(100, Math.round((d / x.capacity) * 100)))
          : 0;
        // ⚠️ NO VERDICT WITHOUT A CEILING. `over` is false whenever capacity is
        // null (energyBudget guarantees it), so "in the red" cannot fire on an
        // axis that never earned a limit — which is what P-2 is protecting.
        const tag = hasCeiling
          ? (x.over ? 'in the red' : d <= 0 ? 'full' : `${fmt(d)}/${fmt(x.capacity)}`)
          : (d > 0 ? `${fmt(d)} spent` : 'steady');
        return (
          <div className="insight" key={a}>
            <span>
              <span aria-hidden="true">{AXIS_META[a].glyph}</span> <b>{AXIS_META[a].label}</b>
              {' · '}
              <span style={x.over ? { color: 'var(--warning)' } : undefined}>{tag}</span>
            </span>
            {hasCeiling && (
              <div className="bar2">
                <i style={{ width: `${pct}%`, ...(x.over ? { background: 'var(--warning)' } : {}) }} />
              </div>
            )}
          </div>
        );
      })}
      {/* ⚠️ NO QUOTA AND NO HOMEWORK. This said "(0 of 3 weeks rated)" and
          "Rate how your tasks leave you and this becomes a real reserve in a few
          weeks" — a progress bar against work the reader has to do, and an
          explicit ask, on a card they see every day. P-2 is a statement about
          what the APP knows; it is not a bill. And the closing line said "Your
          reserves stay topped up", which is praise, and praise is a verdict
          whose absence tomorrow is a demerit.

          What is left says only what the card is showing, and only when there
          is something to say. */}
      {!anyCeiling && (
        <p className="insight" style={{ marginTop: 8, opacity: 0.7 }}>
          No ceiling is drawn: a limit would have to come from how your own days
          actually leave you.
        </p>
      )}
      {anyOver && (
        <p className="insight" style={{ marginTop: 8, opacity: 0.7 }}>
          Something went past its usual depth today. Resting between blocks helps
          more than resting after.
        </p>
      )}
    </div>
  );
}
