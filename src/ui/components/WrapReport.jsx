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
import { fmtDur, DAY_NAMES, DAY_FULL } from '../format.js';
import EnergyShape from './EnergyShape.jsx';
import Icon from '../Icon.jsx';

// Deadline buffer, in plain words — hours under a day, whole days beyond it.
const fmtBuf = (h) => {
  const a = Math.abs(h);
  // ⚠️ MINUTES UNDER THE HOUR. `Math.round` alone printed a 24-minute buffer as
  // "0h" — both wrong and a worse read than the truth, in the one section that
  // is meant to be pure physics.
  if (a < 1) return `${Math.max(1, Math.round(a * 60))}m`;
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
  // ⚠️ AGAINST CAPACITY, NOT AGAINST THE WEEK'S BUSIEST DAY. The docblock above
  // has always claimed "scheduled-vs-capacity, which is physics" and the code
  // normalised to `peak` instead — so the fullest day was 100% tall in EVERY
  // week ever printed, a 3-hour week and a 60-hour week drew the identical
  // picture, and no two weeks could be compared. `getWeekLoad` computes
  // `capacityMin` and `fillRatio` per day and both were thrown away.
  //
  // This is the same defect that sank the day-shapes section: a chart whose
  // quantity has no denominator a reader can name. Here the denominator existed
  // all along.
  const capOf = (d) => (d.capacityMin > 0 ? d.capacityMin : 0);
  const anyCap = load.perDay.some((d) => capOf(d) > 0);
  // Over-full days exist (they are physics, not a failing), so the axis grows to
  // fit them rather than clipping the bar at the line.
  const top = Math.max(1, ...load.perDay.map((d) => Math.max(d.scheduledMin, capOf(d))));
  return (
    <div
      className="rp-chart"
      role="img"
      aria-label={anyCap ? 'Hours scheduled each day, against that day’s available window' : 'Scheduled hours per day'}
    >
      {load.perDay.map((d, i) => (
        <div className="rp-bar" key={d.date}>
          <div className="rp-bar-track">
            <div
              className="rp-bar-fill"
              style={{ height: `${Math.round((d.scheduledMin / top) * 100)}%` }}
            />
            {/* The day's own window — what "full" actually means for a Sunday
                that opens at 10:00 versus a Monday that opens at 08:00. */}
            {capOf(d) > 0 && (
              <span
                className="rp-bar-cap"
                style={{ bottom: `${Math.round((capOf(d) / top) * 100)}%` }}
                aria-hidden="true"
              />
            )}
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
                {/* ⚠️ "—", NEVER "0". The file's own header rule at the top —
                    'no "0%" where the honest answer is "—"' — was applied to
                    durations and not to counts, so a week with nothing marked
                    rendered a bare 0 as the largest glyph on the page. (The
                    label was also a dead ternary: both branches read
                    'finished', a pluralisation written and never finished.) */}
                <Stat
                  label="marked done"
                  value={acc.completedCount > 0 ? acc.completedCount : '—'}
                />
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

              {/* What the week CONTAINED, as facts (A1; DAY-NOTES.md D-4).
                  ⚠️ NOUNS AND COUNTS, NEVER A REASON. D-4's own rule: "a fact
                  explains, a story excuses. 'Thanksgiving fell on Thursday' is
                  a fact. 'You did less because of Thanksgiving' is the report
                  doing your thinking for you, and 'understandably quiet week'
                  is sympathy — both are the judgement §7.1 forbids. State the
                  day, state the count, stop." So nothing here may be joined to
                  the bars above with "because".

                  It sits directly under the chart because that is what it
                  repairs: a zero-height Thursday reads as a failure until the
                  sheet says the day was blocked, and then it reads as a
                  decision. The data has been loaded and invisible all along. */}
              {stats.context.any && (
                <p className="rp-context">
                  {stats.context.notes.map((n, i) => (
                    <span key={n.id}>
                      {i > 0 && ' · '}
                      <b>{n.label}</b> fell on {DAY_FULL[n.dayIndex]}
                    </span>
                  ))}
                  {stats.context.blockedCount > 0 && (
                    <span>
                      {stats.context.notes.length > 0 && ' · '}
                      {stats.context.blockedCount}{' '}
                      {stats.context.blockedCount === 1 ? 'day' : 'days'} blocked (
                      {stats.context.blockedSpans
                        .map((s) => (s.from === s.to
                          ? DAY_NAMES[s.from]
                          : `${DAY_NAMES[s.from]}–${DAY_NAMES[s.to]}`))
                        .join(', ')}
                      )
                    </span>
                  )}
                </p>
              )}

              <h3>What it took, and what it gave back</h3>
              <EnergyShape energy={stats.energy} />


              {/* ⚠️ SPEC.md §7.1 NAMES FIVE STATISTICS and the pruning pass of
                  2026-09-02 rendered two. The three below were cut with their
                  builders left running into a view model nothing read. They are
                  restored because the denominator rule that removed them is a
                  rule about CHARTS: length and area need a referent, but prose
                  carries its own, and "3 of 11 gaps" is a named denominator in
                  words. The report's own skipped count is the proof — it has no
                  denominator on purpose, because "3 of 14" would be a verdict.
                  What each one needed was a reframe, not a deletion. */}
              <h3>Where the hours went</h3>
              <div>
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

              {/* What the week owed, and what it held (A2).
                  ⚠️ A LEDGER, NOT A SHORTFALL. `owedMin` is a number the user
                  typed, which makes it the only denominator in the report that
                  is neither invented (P-2) nor a grade (P-1), and it belongs to
                  the week the sheet is about. Two facts they can check —
                  "1h 30m of 2h laid out" — and never "you missed 30m", which is
                  the same arithmetic worn as an accusation.

                  `remainingMin` is stated as hours that were never LAID OUT, not
                  hours failed: previewWeek's own rule is that a shortfall must
                  never be manufactured by the passage of time. And `settled` —
                  the user's mark that the week is finished, which the grid
                  cannot know — leads, with the arithmetic still reported beside
                  it rather than suppressed. */}
              {stats.commitments && (
                <div className="rp-sub">
                  <h3>What the week owed</h3>
                  <table className="rp-table">
                    <thead>
                      <tr><th>commitment</th><th>set</th><th>laid out</th><th>sittings</th></tr>
                    </thead>
                    <tbody>
                      {stats.commitments.map((c) => (
                        <tr key={c.id}>
                          <td>{c.title}</td>
                          <td>{fmtDur(c.owedMin)}</td>
                          <td>
                            {c.placedMin > 0 ? fmtDur(c.placedMin) : <span className="rp-dim">—</span>}
                            {c.settled && <span className="rp-dim"> · you called it finished</span>}
                            {!c.settled && c.remainingMin > 0 && (
                              <span className="rp-dim"> · {fmtDur(c.remainingMin)} never laid out</span>
                            )}
                          </td>
                          <td>{c.sittings > 0 ? c.sittings : <span className="rp-dim">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="rp-dim">
                    “Set” is the weekly amount you chose for each of these.
                  </p>
                </div>
              )}

              {/* Breathing room (§7.1 "break compression"). Restored verbatim
                  apart from the ratio: it was collateral damage from collapsing
                  the two-column grid, not a denominator failure. `dayGaps` is
                  shared with the grid's overpack notice SPECIFICALLY so the two
                  surfaces can never disagree — cutting this left the grid saying
                  the week was squeezed while the report said nothing.

                  The last sentence is the best P-1 line in the file: it blames
                  THE PACKER, not the reader. Keep it. */}
              {stats.breaks.gapCount > 0 && (
                <div className="rp-sub">
                  <h3>Breathing room</h3>
                  <p className="rp-line">
                    Average gap between sessions: <b>{fmtDur(Math.round(stats.breaks.avgBreak))}</b>.
                  </p>
                  {stats.breaks.tightGaps > 0 && (
                    <p className="rp-line">
                      The packer left {stats.breaks.tightGaps}{' '}
                      {stats.breaks.tightGaps === 1 ? 'gap' : 'gaps'} at its{' '}
                      {stats.breaks.tiers.minimum}-minute floor.
                    </p>
                  )}
                  <p className="rp-dim">
                    Gaps are what the packer left you between one thing and the next.
                  </p>
                </div>
              )}

              {/* Tag × time-of-day (§7.1 "satisfaction by tag×time").
                  ⚠️ THE CELL COUNTS ARE THE FIX. Its real defect was never the
                  denominator — every cell is a mean out of five — it was that a
                  5.0 from one rating looked identical to a 5.0 from six.
                  `getSatisfactionMatrix` returned `count` per cell all along and
                  the view discarded it. A cell under two ratings is dimmed
                  rather than hidden: thin evidence is a fact about the week too. */}
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
                            <td key={c.bucket} className={c.count > 0 && c.count < 2 ? 'rp-thin' : undefined}>
                              {c.avg == null
                                ? <span className="rp-dim">·</span>
                                : <><b>{c.avg.toFixed(1)}</b><span className="rp-dim">·{c.count}</span></>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="rp-dim">
                    Each cell is an average out of five, and how many ratings it rests on.
                  </p>
                </div>
              )}

              {/* Plan versus what happened (§7.1, via snapshot() diff).
                  ⚠️ THE PLAN IS THE SUBJECT, NOT THE READER. It used to open
                  with "N of M sessions stayed where they were planned", which is
                  a fidelity score, and close with "Went to plan: Tuesday,
                  Friday" — which makes every unlisted day a failure by omission,
                  an inverted skip list of exactly the kind §7.1 forbids. Both
                  are gone. A plan that needed reshuffling is a plan the app
                  mis-made, and that is the honest reading of this number. */}
              {stats.plan && stats.plan.movedCount > 0 && (
                <div className="rp-sub">
                  <h3>Plan versus what happened</h3>
                  <p className="rp-line">
                    The plan moved <b>{fmtDur(stats.plan.totalDriftMin)}</b> this week.
                  </p>
                  {stats.plan.biggest && (
                    <p className="rp-line">
                      The biggest change: <b>{stats.plan.biggest.title}</b>,{' '}
                      {fmtDur(Math.abs(stats.plan.biggest.deltaMin))}{' '}
                      {stats.plan.biggest.deltaMin > 0 ? 'later' : 'earlier'} than planned.
                    </p>
                  )}
                </div>
              )}

              {/* Deadlines — how close to the wire things ran. Facts, never a
                  verdict (P-1): derived from your deadlines + when work sat, never
                  from what you skipped, and never euphemised. */}
              {stats.deadlines.count > 0 && (
                <div className="rp-sub">
                  <h3>Deadlines</h3>
                  {/* ⚠️ "WERE FINISHED", NOT "HAD A DEADLINE". `count` counts
                      only tasks marked done or partial (buildDeadlineBuffer), so
                      the old phrasing made a claim about the WEEK from a figure
                      about COMPLETIONS: finish two of five deadlined tasks
                      comfortably and miss three, and the sheet printed "2 tasks
                      had a deadline this week, all finished with room to spare."
                      The friendliest sentence in the section was the one that
                      could be most wrong. "All finished with room to spare" is
                      also praise, and praise is a verdict whose absence next
                      week is a demerit — so it states the range instead. */}
                  <p className="rp-line">
                    {stats.deadlines.count} deadlined{' '}
                    {stats.deadlines.count === 1 ? 'task was' : 'tasks were'} finished this week
                    {stats.deadlines.closeCount > 0
                      ? `; ${stats.deadlines.closeCount} ${stats.deadlines.closeCount === 1 ? 'was' : 'were'} finished with under ${fmtBuf(stats.deadlines.thresholdHours)} to spare.`
                      : '.'}
                  </p>
                  {stats.deadlines.tightest && (
                    <p className="rp-line">
                      Closest to the wire: <b>{stats.deadlines.tightest.title}</b>, {bufPhrase(stats.deadlines.tightest.bufferHours)}.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ---- 3. Suggestions ---- */}
            <section className="rp-section rp-suggestions">
              <h2>Worth a look</h2>

              {/* What the model has to say, or nothing.
                  ⚠️ NO RATING COUNTER HERE. This printed "6 of 10 ratings so
                  far", which is a progress bar in prose against work the reader
                  has to do — P-2 is a statement about the MODEL's readiness, not
                  about the user's quota, and the report is not where a person
                  went to look at the model. The count belongs in the Cabana.
                  EnergyShape makes the argument this follows: declining to
                  narrate an absence claims nothing. */}
              {insight.cold ? (
                insight.sampleCount === 0 ? null : (
                  <p className="rp-dim">
                    Your ratings aren’t steering placement yet — this week was ordered by
                    time, balance and your deadlines.
                  </p>
                )
              ) : insight.top.length > 0 ? (
                <p className="rp-dim">
                  Across {insight.sampleCount} ratings,{' '}
                  {insight.top.map((w, i) => (
                    <span key={w.label}>
                      {i > 0 && (i === insight.top.length - 1 ? ', and ' : ', ')}
                      <b>{w.text}</b> run about{' '}
                      <b>
                        {Math.abs(w.shells) < 1.5 ? 'a shell' : `${Math.round(Math.abs(w.shells))} shells`}{' '}
                        {w.shells > 0 ? 'above' : 'below'}
                      </b>{' '}
                      your others
                    </span>
                  ))}
                  . That’s what nudges automatic placement.
                </p>
              ) : null}

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
                      <>
                        <div className="rp-sugg-actions">
                          {s.actions.map((a) => (
                            <button className="btn2" key={a.kind} onClick={() => act(s, a)}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                        {/* ⚠️ THE SAME CHOICES, AS TEXT, ON PAPER. The print
                            block hides the buttons — rightly, a printed button
                            lies about being pressable — but hiding them alone
                            printed the accusation and dropped the release. P-1
                            requires every diagnostic to offer a graceful exit
                            "with equal visual weight to the fix", and the PDF is
                            the artifact that persists: it goes in a folder and
                            gets reopened in March. Screen-hidden, print-only. */}
                        <p className="rp-sugg-onpaper" aria-hidden="true">
                          {s.actions.map((a) => a.label).join(' · ')}
                        </p>
                      </>
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
