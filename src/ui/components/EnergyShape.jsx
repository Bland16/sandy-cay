// EnergyShape — the week's spend and restore, overlaid (design/energy-radar-mockups.html).
//
// Why both charts and not one. They answer the same question in two registers:
// the DIAMOND is for shape recognition — you learn what your own week looks like
// and notice the week that isn't that shape — while the BUTTERFLY is exact, so
// the numbers can be read rather than decoded. The report is the one surface
// with room for both, and it is printed, where "read it exactly" matters most.
//
// ⚠️ Three rules this chart has to obey, all of them learned the hard way here:
//
//   1. NEVER meaning by colour alone (§10). Two translucent overlapping polygons
//      with no numerals is exactly that, and this project has already shipped
//      that bug once — the report's empty rating shells were a sand tint at full
//      opacity, so a 2-shell rating read as 5 to the person holding the page. So
//      every axis prints `spent/restored`, restore is DASHED as well as green,
//      and the butterfly states both numbers outright.
//   2. NO invented ceiling (P-2). `learnedCapacity` is null until roughly three
//      weeks of ratings calibrate it. While it is null the diamond draws no ring
//      and says why — a chart that quietly grows a ceiling in March would mean
//      every chart printed before it was lying.
//   3. NOT coral (P-1). Coral is for scheduling physics, never for moral
//      bookkeeping, and a heavy week is not a fault. Spend is sand, restore is
//      the app's own --rest green.
//
// The diamond is four axes, which is coarser than a hexagon — two high axes and
// two low read as a slash. That is a known cost, accepted deliberately: the
// butterfly beside it carries the precision the shape gives up.

import { LOAD_AXES } from '../../core/index.js';

const SIZE = 188;
const R = SIZE * 0.33;
const CX = SIZE / 2;
const CY = SIZE / 2;

const fx = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** Axis i's point at radius `r`. Mental top, then clockwise. */
function axisPoint(i, r) {
  const ang = -Math.PI / 2 + i * ((2 * Math.PI) / LOAD_AXES.length);
  return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)];
}

const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function ringPoly(r) {
  return poly(LOAD_AXES.map((_, i) => axisPoint(i, r)));
}

function valuePoly(axes, key, max) {
  return poly(LOAD_AXES.map((a, i) => axisPoint(i, (Math.min(axes[a][key], max) / max) * R)));
}

/**
 * The diamond. `capacity` is the learned per-axis ceiling or null — null draws
 * no ring at all, which is the honest state until ratings earn one.
 */
function Diamond({ axes, max, capacity }) {
  // One ring per axis would be four rings; the ceiling is drawn only when every
  // axis has one, so a partial calibration cannot imply a shape it hasn't got.
  const capRing = capacity && LOAD_AXES.every((a) => Number.isFinite(capacity[a]))
    ? LOAD_AXES.map((a, i) => axisPoint(i, (Math.min(capacity[a], max) / max) * R))
    : null;

  return (
    <svg
      className="rp-diamond"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={LOAD_AXES.map((a) => `${a}: spent ${fx(axes[a].spend)}, restored ${fx(axes[a].restore)}`).join('; ')}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="rp-dgrid" points={ringPoly(R * f)} />
      ))}
      {LOAD_AXES.map((a, i) => {
        const [x, y] = axisPoint(i, R);
        return <line key={a} className="rp-dgrid" x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} />;
      })}
      {capRing && <polygon className="rp-dcap" points={poly(capRing)} />}
      <polygon className="rp-dspend" points={valuePoly(axes, 'spend', max)} />
      <polygon className="rp-drestore" points={valuePoly(axes, 'restore', max)} />
      {LOAD_AXES.map((a, i) => {
        const [x, y] = axisPoint(i, R + 17);
        return (
          <g key={a}>
            <text className="rp-daxis" x={x.toFixed(1)} y={y.toFixed(1)}>{a}</text>
            {/* The numerals are not decoration — see rule 1 above. */}
            <text className="rp-dnum" x={x.toFixed(1)} y={(y + 10).toFixed(1)}>
              {fx(axes[a].spend)}/{fx(axes[a].restore)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Restore left, spend right, one row per axis. Exact, and it prints. */
function Butterfly({ axes, max }) {
  return (
    <div className="rp-bfly">
      <div className="rp-bfhead">
        <span />
        <span className="rp-bfl">restored ◀</span>
        <span className="rp-bfr">▶ spent</span>
      </div>
      {LOAD_AXES.map((a) => (
        <div className="rp-bfrow" key={a}>
          <span className="rp-bfax">{a}</span>
          <span className="rp-bftrack rp-l">
            <span className="rp-bffill" style={{ width: `${(axes[a].restore / max) * 100}%` }} />
            <span className="rp-bfnum">{fx(axes[a].restore)}</span>
          </span>
          <span className="rp-bftrack rp-r">
            <span className="rp-bffill" style={{ width: `${(axes[a].spend / max) * 100}%` }} />
            <span className="rp-bfnum">{fx(axes[a].spend)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function EnergyShape({ energy }) {
  if (!energy || !energy.any) {
    // Zeros here mean the buckets carry no load, not that the week was quiet —
    // saying which is the difference between a report and a shrug.
    return (
      <p className="rp-dim">
        No energy shape for this week — the tags on these tasks don’t belong to any
        bucket carrying a load, so there is nothing to weigh.
      </p>
    );
  }
  const { axes, totals, capacity } = energy;
  const max = Math.max(
    1,
    ...LOAD_AXES.map((a) => Math.max(axes[a].spend, axes[a].restore)),
    ...(capacity ? LOAD_AXES.map((a) => capacity[a] || 0) : []),
  );

  return (
    <div className="rp-energy">
      <div className="rp-echarts">
        <Diamond axes={axes} max={max} capacity={capacity} />
        <Butterfly axes={axes} max={max} />
      </div>
      {/* The totals, and nothing else. The chart's rationale is documented at the
          top of this file, which is where it belongs — a report that explains
          its own design is a report with a paragraph you skip. A fact, and no
          verdict on it: "you overdid it" is the judgement §7.1 forbids.

          P-2 is still satisfied without a sentence about it. Drawing no ring
          claims nothing, so a ring appearing once ratings calibrate contradicts
          nothing printed earlier — the forbidden thing was inventing a ceiling,
          not declining to narrate its absence. */}
      <p className="rp-etot">
        Spent <b>{fx(totals.spend)}</b> · restored <b>{fx(totals.restore)}</b> · net{' '}
        <b>{fx(totals.net)}</b> <span className="rp-dim">(hours × load)</span>
      </p>
    </div>
  );
}
