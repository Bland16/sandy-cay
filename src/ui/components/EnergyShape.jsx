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
//      255 — a contrast ratio of 1.03:1, i.e. the same grey on paper. So hue
//      carries NOTHING here and three other channels carry it instead: left/right
//      position, the `restored ◀ / ▶ spent` header in words, and restore drawn
//      as a 45° hatch against spend's solid fill (styles.css). The hatch replaces
//      the dashed stroke that left with the diamond.
//   2. NO invented ceiling (P-2). `learnedCapacity` is null until roughly three
//      weeks of ratings calibrate it, and nothing here draws one.
//   3. NOT coral (P-1). Coral is for scheduling physics, never for moral
//      bookkeeping, and a heavy week is not a fault.

import { LOAD_AXES } from '../../core/index.js';

const fx = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** The axis top: load-hours rounded up to a whole tick, never below one tick. */
const TICK = 2; // load-hours
function axisTop(axes) {
  const biggest = Math.max(0, ...LOAD_AXES.map((a) => Math.max(axes[a].spend, axes[a].restore)));
  return Math.max(TICK, Math.ceil(biggest / TICK) * TICK);
}

/**
 * Restore left, spend right, one row per axis. Exact, and it prints.
 *
 * ⚠️ THE SCALE IS LOAD-HOURS, NOT THE WEEK'S OWN LARGEST VALUE. It used to
 * divide by `max` — the biggest number in this week — which is the same defect
 * the sand bars had and the same one that sank the day-shapes chart: a length
 * measured against itself. Every week filled the track the same amount, so no
 * two printed sheets could be compared, in a section whose entire subject is
 * how this week went.
 *
 * There is no learned ceiling available to divide by instead — `capacity` is
 * null until ratings earn it (P-2) — so the denominator is an ABSOLUTE unit
 * with a labelled tick axis. Bar length is then in load-hours a reader can name,
 * two weeks are comparable by reading the ticks, and nothing about a ceiling is
 * claimed. `capacity` is deliberately no longer consulted here at all: it drew
 * an invisible reference that silently shortened every bar for a calibrated
 * user with nothing on the page to explain why.
 */
function Butterfly({ axes }) {
  const top = axisTop(axes);
  const ticks = [];
  for (let v = 0; v <= top; v += TICK) ticks.push(v);

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
            <span className="rp-bffill" style={{ width: `${Math.min(100, (axes[a].restore / top) * 100)}%` }} />
            <span className="rp-bfnum">{fx(axes[a].restore)}</span>
          </span>
          <span className="rp-bftrack rp-r">
            <span className="rp-bffill" style={{ width: `${Math.min(100, (axes[a].spend / top) * 100)}%` }} />
            <span className="rp-bfnum">{fx(axes[a].spend)}</span>
          </span>
        </div>
      ))}
      {/* The denominator, drawn AND named. §10's lesson generalised past colour:
          no quantity may live in a single fragile channel, so the scale is a
          tick axis and a unit in words, not an implication of bar length. */}
      <div className="rp-bfaxis" aria-hidden="true">
        <span className="rp-bfax" />
        <span className="rp-bfscale rp-l">
          {ticks.slice().reverse().map((v) => <span key={v}>{v}</span>)}
        </span>
        <span className="rp-bfscale rp-r">
          {ticks.map((v) => <span key={v}>{v}</span>)}
        </span>
      </div>
      <p className="rp-bfunit">load-hours — hours × how heavily the tag draws</p>
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
  // ⚠️ `capacity` IS NOT READ. It used to widen the scale so bars sat against a
  // learned ceiling that nothing drew — so a calibrated user's bars silently
  // shrank with no mark on the page to explain it, and an uncalibrated user's
  // did not, which meant the same week drew two different pictures depending on
  // a value the chart never showed. The scale is absolute load-hours now.
  const { axes, totals } = energy;

  return (
    <div className="rp-energy">
      <div className="rp-echarts">
        <Butterfly axes={axes} />
      </div>
      {/* The totals, and nothing else. The chart's rationale is documented at the
          top of this file, which is where it belongs — a report that explains
          its own design is a report with a paragraph you skip. A fact, and no
          verdict on it: "you overdid it" is the judgement §7.1 forbids.

          P-2 is still satisfied without a sentence about it. Drawing no ring
          claims nothing, so a ring appearing once ratings calibrate contradicts
          nothing printed earlier — the forbidden thing was inventing a ceiling,
          not declining to narrate its absence. */}
      {/* ⚠️ NO `net`. It printed spend − restore as one signed number, and a
          single signed balance has exactly one idiom: positive means overdrawn.
          That is "you overdid it", the judgement the comment above forbids, four
          lines below where it forbids it. Worse, restorative tags are rare, so
          net is positive for essentially every real week — the section ended on
          a permanent deficit no reader could ever clear. Two facts, kept apart,
          which is the same reason the chart keeps them on opposite sides. */}
      <p className="rp-etot">
        Spent <b>{fx(totals.spend)}</b> · restored <b>{fx(totals.restore)}</b>{' '}
        <span className="rp-dim">load-hours</span>
      </p>
    </div>
  );
}
