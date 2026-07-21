// WrapReport — the §7.1 / R-7 weekly report. A full page (like the Cabana), not
// a modal, for one concrete reason: window.print() renders the DOCUMENT, so the
// report has to be able to hide the entire app around it. A page can; an overlay
// stacked on a live grid cannot.
//
// window.print() IS the renderer — no PDF library (OD-15). The user's own
// "Save as PDF" writes the file, and document.title decides its default name.
//
// P-1 is the whole design brief here. Read `report.js` for the data rules; this
// file's job is to not undo them typographically — no red numbers, no progress
// bars racing a target, no "0%" where the honest answer is "—".
import { useEffect, useMemo, useState } from 'react';
import { buildWrapReport, applySuggestion } from '../report.js';
import { fmtDur, DAY_NAMES } from '../format.js';
import Icon from '../Icon.jsx';

// Deadline buffer, in plain words — hours under a day, whole days beyond it.
const fmtBuf = (h) => {
  const a = Math.abs(h);
  if (a < 24) return `${Math.round(a)}h`;
  const d = Math.round(a / 24);
  return d === 1 ? 'a day' : `${d} days`;
};
const bufPhrase = (h) => (h < 0 ? `finished ${fmtBuf(h)} after it was due` : `finished ${fmtBuf(h)} before it was due`);

/**
 * Shells as the satisfaction glyph (§10) — filled to the rating, ghosted past it.
 *
 * The numeral is not decoration, it's the actual answer. Five shell shapes always
 * sit on the page and only two of them are gold; a reader counts SHAPES and sees
 * five. A rating of 2 read as "5 shells" in the very first print of this report.
 * §10 also forbids meaning by colour alone, which on/off-by-tint alone was, and
 * a greyscale printer would have flattened the distinction completely.
 */
function Shells({ value, size = 12 }) {
  if (value == null) return <span className="rp-dim">—</span>;
  const filled = Math.round(value);
  return (
    <span className="rp-shells" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= filled ? 'on' : 'off'} aria-hidden="true">
          <Icon name="shell" size={size} />
        </span>
      ))}
      <b className="rp-shells-num" aria-hidden="true">
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </b>
    </span>
  );
}

/** The sand-bar day-load chart (§7.1). Bars are scheduled-vs-capacity, which is
 *  physics — how full the day was — and explicitly not a score. */
function SandBars({ load }) {
  const peak = Math.max(1, ...load.perDay.map((d) => d.scheduledMin));
  return (
    <div className="rp-chart" role="img" aria-label="Scheduled hours per day">
      {load.perDay.map((d, i) => (
        <div className="rp-bar" key={d.date}>
          <div className="rp-bar-track">
            <div
              className="rp-bar-fill"
              style={{ height: `${Math.round((d.scheduledMin / peak) * 100)}%` }}
            />
          </div>
          <span className="rp-bar-day">{DAY_NAMES[i].slice(0, 3)}</span>
          <span className="rp-bar-val">{d.scheduledMin > 0 ? fmtDur(d.scheduledMin) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rp-stat">
      <span className="rp-stat-val">{value}</span>
      <span className="rp-stat-label">{label}</span>
      {hint && <span className="rp-stat-hint">{hint}</span>}
    </div>
  );
}

export default function WrapReport({ sched, weekStart, version, onBack, onOpenTask, mutate, showToast }) {
  const [, force] = useState(0);
  void version;
  const r = useMemo(() => buildWrapReport(sched, weekStart), [sched, weekStart, version]);

  // "Save as PDF" defaults to document.title, so the filename in SPEC §7.1
  // (wrap-YYYY-'W'ww) comes from here. Restored on unmount — leaving the app
  // titled after a report you closed is a small lie that persists in the tab.
  useEffect(() => {
    const previous = document.title;
    document.title = `wrap-${r.weekKey}`;
    return () => { document.title = previous; };
  }, [r.weekKey]);

  const act = (suggestion, action) => {
    if (action.kind === 'open') {
      onOpenTask(suggestion.taskId);
      return;
    }
    const line = mutate((s) => applySuggestion(s, suggestion, action.kind));
    force((n) => n + 1);
    if (line) showToast(line);
  };

  const { accomplished: acc, stats, insight } = r;

  return (
    <div className="rp-page">
      {/* Screen-only chrome. The printed sheet is the document; a "Print" button
          on a piece of paper is a bug. */}
      <div className="rp-chrome">
        <button className="btn2" onClick={onBack}><Icon name="back" size={14} /> Back to the week</button>
        <span className="grow" />
        <span className="rp-chrome-hint">Print → “Save as PDF” → <code>wrap-{r.weekKey}.pdf</code></span>
        <button className="cta" onClick={() => window.print()}><Icon name="cal" size={14} /> Print / Save as PDF</button>
      </div>

      <article className="rp-sheet">
        {/* Silent-film title card (FRONTEND-SPEC §6). */}
        <header className="rp-title">
          <span className="rp-title-rule" aria-hidden="true" />
          <h1>Your Week at Sandy Cay</h1>
          <p className="rp-range">{r.range}</p>
          <p className="rp-weekkey">{r.weekKey}</p>
          <span className="rp-title-rule" aria-hidden="true" />
        </header>

        {r.isEmpty ? (
          // A week with nothing in it is a legitimate week (P-1). It gets a
          // sentence, not a page of zeroes — and certainly not a telling-off.
          <section className="rp-empty">
            <Icon name="crab" size={30} />
            <p>Nothing was scheduled this week.</p>
            <p className="rp-dim">A quiet week is a week. There’s nothing to report and nothing to fix.</p>
          </section>
        ) : (
          <>
            {/* ---- 1. Accomplished — leads, always (§7.1) ---- */}
            <section className="rp-section">
              <h2>What you got done</h2>

              <div className="rp-stats">
                <Stat label="focused" value={acc.focusedMin > 0 ? fmtDur(acc.focusedMin) : '—'} />
                <Stat label={acc.completedCount === 1 ? 'finished' : 'finished'} value={acc.completedCount} />
                {acc.partialCount > 0 && <Stat label="part-done" value={acc.partialCount} />}
                <Stat
                  label="how it felt"
                  value={<Shells value={acc.avgShells} />}
                  hint={acc.ratedCount > 0 ? `${acc.ratedCount} rated` : 'none rated'}
                />
              </div>

              {acc.items.length > 0 ? (
                <ul className="rp-list">
                  {acc.items.map((it) => (
                    <li key={it.id}>
                      <span className="rp-check" aria-hidden="true">
                        <Icon name={it.partial ? 'starfish' : 'check'} size={13} />
                      </span>
                      <span className="rp-item-title">{it.title}</span>
                      {it.tags.map((t) => <span className="rp-tag" key={t}>{t}</span>)}
                      <span className="grow" />
                      <span className="rp-dur">{fmtDur(it.durationMin)}</span>
                      {it.shells != null && <Shells value={it.shells} size={10} />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rp-dim">
                  Nothing was marked done this week — which may mean it was a week for
                  living rather than ticking.
                </p>
              )}

              {acc.projects.length > 0 && (
                <div className="rp-projects">
                  {acc.projects.map((p) => (
                    <div className="rp-project" key={p.id}>
                      <Icon name="castle" size={14} />
                      <span className="rp-item-title">{p.title}</span>
                      <span className="grow" />
                      <span className="rp-dim">{fmtDur(p.doneMin)} of {fmtDur(p.totalMin)}</span>
                      <span className="rp-progress" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, Math.round((p.doneMin / p.totalMin) * 100))}%` }} />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* The quiet count. Never a list — §7.1 is explicit. */}
              {acc.skippedCount > 0 && (
                <p className="rp-skipped">
                  {acc.skippedCount} {acc.skippedCount === 1 ? 'thing was' : 'things were'} let go this week.
                </p>
              )}
            </section>

            {/* ---- 2. Statistics ---- */}
            <section className="rp-section">
              <h2>The shape of the week</h2>
              <SandBars load={stats.load} />

              <div className="rp-cols">
                <div>
                  <h3>Where the hours went</h3>
                  {stats.tags.length === 0 ? (
                    <p className="rp-dim">No tags on this week’s tasks.</p>
                  ) : (
                    <table className="rp-table">
                      <thead>
                        <tr><th>tag</th><th>scheduled</th><th>done</th><th>felt</th></tr>
                      </thead>
                      <tbody>
                        {/* Uncapped. This was the top 8 purely to fit two pages
                            — a cap that silently dropped your quieter tags to
                            save paper. The budget is ~5 pages now; a busy week
                            gets to be a busy week. */}
                        {stats.tags.map((t) => (
                          <tr key={t.tag}>
                            <td>{t.tag}</td>
                            <td>{fmtDur(t.scheduledMin)}</td>
                            <td>{t.completedMin > 0 ? fmtDur(t.completedMin) : <span className="rp-dim">—</span>}</td>
                            <td><Shells value={t.avgShells} size={10} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <h3>Breathing room</h3>
                  {stats.breaks.gapCount === 0 ? (
                    <p className="rp-dim">
                      No back-to-back sessions this week, so there were no gaps to measure.
                    </p>
                  ) : (
                    <>
                      <p className="rp-line">
                        Average gap between sessions: <b>{fmtDur(Math.round(stats.breaks.avgBreak))}</b>.
                      </p>
                      {stats.breaks.tightGaps > 0 && (
                        <p className="rp-line">
                          {stats.breaks.tightGaps} of {stats.breaks.gapCount} gaps were at the{' '}
                          {stats.breaks.tiers.minimum}-minute floor.
                        </p>
                      )}
                      <p className="rp-dim">
                        Gaps are what the packer left you between one thing and the next.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Tag × time-of-day — only worth a table once there's signal in it. */}
              {stats.matrix.rows.length > 0 && (
                <div className="rp-sub">
                  <h3>How things felt, by time of day</h3>
                  <table className="rp-table rp-matrix">
                    <thead>
                      <tr>
                        <th>tag</th>
                        {stats.matrix.buckets.map((b) => <th key={b}>{b}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.matrix.rows.map((row) => (
                        <tr key={row.tag}>
                          <td>{row.tag}</td>
                          {row.cells.map((c) => (
                            <td key={c.bucket}>
                              {c.avg == null
                                ? <span className="rp-dim">·</span>
                                : <b>{c.avg.toFixed(1)}</b>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Planned-vs-actual. Absent entirely without a baseline — see
                  buildPlanDiff. Framed as observation, per 6J. */}
              {stats.plan && (
                <div className="rp-sub">
                  <h3>Plan versus what happened</h3>
                  {stats.plan.movedCount === 0 ? (
                    <p className="rp-line">The week ran exactly as it was planned.</p>
                  ) : (
                    <>
                      <p className="rp-line">
                        {stats.plan.intactCount} of {stats.plan.intactCount + stats.plan.movedCount} sessions
                        stayed where they were planned; {stats.plan.movedCount} moved,
                        totalling {fmtDur(stats.plan.totalDriftMin)} of shuffling.
                      </p>
                      {stats.plan.biggest && (
                        <p className="rp-line">
                          The biggest single change: <b>{stats.plan.biggest.title}</b>,{' '}
                          {fmtDur(Math.abs(stats.plan.biggest.deltaMin))}{' '}
                          {stats.plan.biggest.deltaMin > 0 ? 'later' : 'earlier'} than planned.
                        </p>
                      )}
                      {stats.plan.intactDays.length > 0 && (
                        <p className="rp-line">
                          Went to plan: {stats.plan.intactDays.map((i) => DAY_NAMES[i]).join(', ')}.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Deadlines — how close to the wire things ran. Facts, never a
                  verdict (P-1): derived from your deadlines + when work sat, never
                  from what you skipped, and never euphemised. */}
              {stats.deadlines.count > 0 && (
                <div className="rp-sub">
                  <h3>Deadlines</h3>
                  <p className="rp-line">
                    {stats.deadlines.count} {stats.deadlines.count === 1 ? 'task had' : 'tasks had'} a deadline this week
                    {stats.deadlines.closeCount > 0
                      ? `; ${stats.deadlines.closeCount} ${stats.deadlines.closeCount === 1 ? 'was' : 'were'} finished with under ${fmtBuf(stats.deadlines.thresholdHours)} to spare.`
                      : ', all finished with room to spare.'}
                  </p>
                  {stats.deadlines.tightest && (
                    <p className="rp-line">
                      Closest to the wire: <b>{stats.deadlines.tightest.title}</b>, {bufPhrase(stats.deadlines.tightest.bufferHours)}.
                    </p>
                  )}
                  {stats.deadlines.closestBucket && (
                    <p className="rp-line">
                      Of your buckets, <b>{stats.deadlines.closestBucket.label}</b> ran closest — a median of {fmtBuf(stats.deadlines.closestBucket.medianBufferHours)} of buffer.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ---- 3. Suggestions ---- */}
            <section className="rp-section rp-suggestions">
              <h2>Worth a look</h2>

              {insight.cold ? (
                <p className="rp-dim">
                  {insight.sampleCount === 0
                    ? 'No ratings yet, so there’s nothing learned to report.'
                    : `${insight.sampleCount} of ${insight.needed} ratings so far — the model stays quiet until it has enough to be worth trusting.`}
                </p>
              ) : (
                <div className="rp-sub">
                  <h3>What the model has learned</h3>
                  <ul className="rp-plain">
                    {insight.top.map((w) => (
                      <li key={w.label}>
                        {w.label}: <b>{w.weight >= 0 ? 'rates higher' : 'rates lower'}</b>
                      </li>
                    ))}
                  </ul>
                  <p className="rp-dim">From {insight.sampleCount} ratings. This is what nudges auto-placement.</p>
                </div>
              )}

              {r.suggestions.length === 0 ? (
                <p className="rp-dim">Nothing else stands out this week.</p>
              ) : (
                r.suggestions.map((s) => (
                  <div className="rp-sugg" key={s.id}>
                    <div className="rp-sugg-head">{s.headline}</div>
                    <p className="rp-sugg-detail">{s.detail}</p>
                    {/* Equal weight, always (P-1). Neither button is the .cta;
                        neither is styled as the answer the app is hoping for. */}
                    {s.actions && (
                      <div className="rp-sugg-actions">
                        {s.actions.map((a) => (
                          <button className="btn2" key={a.kind} onClick={() => act(s, a)}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          </>
        )}

        <footer className="rp-foot">
          <span>Sandy Cay · {r.range}</span>
          <span className="grow" />
          <span>{r.weekKey}</span>
        </footer>
      </article>
    </div>
  );
}
