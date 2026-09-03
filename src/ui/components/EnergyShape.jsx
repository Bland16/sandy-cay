// EnergyShape — the week's spend and restore (design/energy-radar-mockups.html).
//
// ONE chart, not two. A radar "diamond" stood beside the butterfly until
// 2026-09-02, on the argument that it was for shape recognition while the
// butterfly was for exactness. It was cut, on its own file's reasoning: the two
// rendered the SAME eight numbers and the totals line below made three. Its
// justification — "you learn what your own week looks like" — needs many weeks
// of prior reports to pay off, and nobody has them. Meanwhile `capacity` is null
// until calibration, so it drew four empty rings around a blob with no
// reference: the defect that also sank the day-shapes section below it.
//
// The comparative reading it was reaching for is real and unserved. It needs a
// strip of WEEKS on a shared absolute axis, not one glyph per week — see
// design/WRAP-REPORT-ADDITIONS.md. Do not restore the radar to get it.
//
// ⚠️ Three rules this chart has to obey, all of them learned the hard way here:
//
//   1. NEVER meaning by colour alone (§10). This project has already shipped
//      that bug once — the report's empty rating shells were a sand tint at full
//      opacity, so a 2-shell rating read as 5 to the person holding the page. So
//      every row states both numbers outright.
//      ⚠️ In greyscale --pinned (spend) and --rest (restore) are 173 and 176 of
//      255 — a contrast ratio of 1.03:1, i.e. the same grey on paper. Left/right
//      position and the `restored ◀ / ▶ spent` header carry the whole meaning.
//      The dashed treatment that used to back this up left with the diamond, so
//      do not lean on hue here; texture is the fix (styles.css).
//   2. NO invented ceiling (P-2). `learnedCapacity` is null until roughly three
//      weeks of ratings calibrate it, and nothing here draws one.
//   3. NOT coral (P-1). Coral is for scheduling physics, never for moral
//      bookkeeping, and a heavy week is not a fault.

import { LOAD_AXES } from '../../core/index.js';

const fx = (n) => (Math.round(n * 10) / 10).toFixed(1);

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
