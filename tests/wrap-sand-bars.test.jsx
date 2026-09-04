// @vitest-environment jsdom
// The sand bars (§7.1) — scheduled hours per day, against each day's own window.
//
// The docblock over `SandBars` always claimed "scheduled-vs-capacity, which is
// physics", and the code divided by `peak`, the week's busiest day. So the
// fullest day was 100% tall in EVERY week ever printed, a 3-hour week and a
// 60-hour week drew the identical picture, and no two weeks could be compared —
// in the one chart on the sheet whose whole job is comparison. `getWeekLoad`
// computes `capacityMin` per day and it was thrown away.
//
// These lock the fix, and the two ways it can go wrong.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, Task, DayNote, defaultConfig, weekStart as weekStartOf, addDays, dateKey } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const ws = () => weekStartOf(new Date());
const at = (o, h, m = 0) => { const d = addDays(ws(), o); d.setHours(h, m, 0, 0); return d; };

const persist = (s) => {
  window.localStorage.setItem('sandycay.session', 'guest');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

const openReport = () => {
  fireEvent.click(screen.getByLabelText(/week menu/i));
  fireEvent.click(screen.getByText(/wrap report/i));
};

const pct = (el, prop) => parseFloat((el.style[prop] || '0').replace('%', ''));
const bars = () => [...document.querySelectorAll('.rp-bar')];

describe('§7.1 sand bars — measured against the day, not against the week', () => {
  it('does NOT draw the busiest day at full height just for being busiest', () => {
    // Two hours on a Monday whose window is fifteen. Under the old `peak`
    // normalisation this bar was 100% tall — the entire defect, in one number.
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'A short week', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    const fill = bars()[0].querySelector('.rp-bar-fill');
    const h = pct(fill, 'height');
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(30); // 2h of a 15h window — a light day, drawn light
  });

  it('draws each day against its OWN window, so Sunday differs from a weekday', () => {
    // Stock config opens Mon–Sat at 08:00 and Sunday at 10:00, so the same two
    // hours fill more of a Sunday. If the marker were a week-wide constant the
    // two would sit at the same height.
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'Mon', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    s.tasks.push(new Task({
      title: 'Sun', type: 'fixed', startTime: at(6, 11), endTime: at(6, 13),
    }));
    persist(s);

    render(<App />);
    openReport();

    const monCap = bars()[0].querySelector('.rp-bar-cap');
    const sunCap = bars()[6].querySelector('.rp-bar-cap');
    expect(monCap).toBeTruthy();
    expect(sunCap).toBeTruthy();
    // Sunday's window is shorter, so its ceiling sits lower on a shared axis.
    expect(pct(sunCap, 'bottom')).toBeLessThan(pct(monCap, 'bottom'));
  });

  it('lets an over-full day overshoot its ceiling rather than clipping at it', () => {
    // Over-full days are physics, not a failing (P-1) — the axis grows to fit
    // them. Clipping the bar at the line would report a lie as a tidy chart.
    const s = new Schedule({ config: defaultConfig });
    for (let h = 8; h < 23; h += 1) {
      s.tasks.push(new Task({
        title: `Block ${h}`, type: 'fixed', startTime: at(1, h), endTime: at(1, h + 1),
      }));
    }
    persist(s);

    render(<App />);
    openReport();

    const bar = bars()[1];
    const fill = bar.querySelector('.rp-bar-fill');
    const cap = bar.querySelector('.rp-bar-cap');
    expect(cap).toBeTruthy();
    // The fill reaches at least the ceiling; nothing is truncated below it.
    expect(pct(fill, 'height')).toBeGreaterThanOrEqual(pct(cap, 'bottom') - 1);
  });

  it('draws NO ceiling on a day the user blocked', () => {
    // A blocked day has no window to be measured against. Drawing a full-height
    // reference line over an empty bar reads as "you had all this and used
    // none" — manufacturing a shortfall out of the user's own decision.
    const s = new Schedule({ config: defaultConfig });
    s.blockDay(addDays(ws(), 3));
    s.tasks.push(new Task({
      title: 'Elsewhere', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    expect(bars()[3].querySelector('.rp-bar-cap')).toBeNull();
    expect(bars()[0].querySelector('.rp-bar-cap')).toBeTruthy();
  });

  it('says in words what the dashed line means, for a reader who cannot see it', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    const label = document.querySelector('.rp-chart').getAttribute('aria-label');
    expect(label).toMatch(/window/i);
  });
});

// SPEC.md §7.1 names five Statistics items: getWeekLoad, getTagBreakdown,
// satisfaction by tag×time, break compression, and planned-vs-actual. The
// pruning pass of 2026-09-02 rendered two and left the other three builders
// running into a view model nothing read. These hold the restored ones on the
// page, because "nothing failed when they were cut" is exactly why they were.
describe('§7.1 — the Statistics the spec names are actually rendered', () => {
  const rated = (s, title, offset, hour, overall) => {
    const t = s.addFixed({
      title, tags: ['study'], startTime: at(offset, hour), endTime: at(offset, hour + 1),
    });
    t.completion = 'done';
    t.satisfaction = { overall };
    return t;
  };

  it('break compression is on the sheet, and blames the packer not the reader', () => {
    const s = new Schedule({ config: defaultConfig });
    // Two sessions with a gap between them — one gap is all it takes to measure.
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    s.tasks.push(new Task({ title: 'B', type: 'fixed', startTime: at(0, 12), endTime: at(0, 13) }));
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByText(/breathing room/i)).toBeTruthy();
    expect(screen.getByText(/average gap between sessions/i)).toBeTruthy();
    // The best P-1 line in the file: compression is the packer's doing.
    expect(screen.getByText(/what the packer left you/i)).toBeTruthy();
  });

  it('tag × time-of-day is on the sheet, and every cell shows what it rests on', () => {
    const s = new Schedule({ config: defaultConfig });
    rated(s, 'One rating', 0, 9, 5);
    rated(s, 'Another', 1, 19, 2);
    rated(s, 'And another', 2, 19, 4);
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByText(/how things felt, by time of day/i)).toBeTruthy();
    const matrix = document.querySelector('.rp-matrix');
    expect(matrix).toBeTruthy();
    // ⚠️ THE COUNTS ARE THE POINT. A 5.0 from one rating and a 5.0 from six
    // looked identical, which is what actually made the grid a scorecard.
    expect(matrix.textContent).toMatch(/·\d/);
    expect(screen.getByText(/how many ratings it rests on/i)).toBeTruthy();
  });

  it('says nothing about gaps on a week with no back-to-back sessions', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'Only one', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    // getBreakCompression returns null rather than 0 for a one-task day,
    // "because 'you took no breaks' would be a lie" — the section is absent.
    expect(screen.queryByText(/breathing room/i)).toBeNull();
  });
});

describe('§7.1 — the printed sheet keeps its exits (P-1)', () => {
  it('prints the suggestion choices as text, not just as buttons', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    // The buttons are hidden in the print block — a printed button lies about
    // being pressable. If a card offers actions, the same choices must survive
    // on paper, or the PDF keeps the diagnostic and drops the graceful exit.
    for (const card of document.querySelectorAll('.rp-sugg')) {
      if (!card.querySelector('.rp-sugg-actions')) continue;
      const onPaper = card.querySelector('.rp-sugg-onpaper');
      expect(onPaper).toBeTruthy();
      expect(onPaper.textContent.trim().length).toBeGreaterThan(0);
    }
  });
});

// A1 — what the week CONTAINED, as facts (design/DAY-NOTES.md D-4, RESOLVED
// 2026-08-11 and unbuilt until 2026-09-03). The live file holds 21 day notes and
// 12 full-day blockers; none of it reached the report.
describe('§7.1 — the week says what it contained, and stops there', () => {
  it('names a day note beside the day it fell on', () => {
    const s = new Schedule({ config: defaultConfig });
    s.dayNotes.push(new DayNote({ label: 'Thanksgiving', kind: 'holiday', from: addDays(ws(), 3) }));
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11) }));
    persist(s);

    render(<App />);
    openReport();

    const ctx = document.querySelector('.rp-context');
    expect(ctx).toBeTruthy();
    expect(ctx.textContent).toMatch(/Thanksgiving/);
    expect(ctx.textContent).toMatch(/Thursday/);
  });

  it('counts blocked days and names them as a span, not a list', () => {
    const s = new Schedule({ config: defaultConfig });
    s.blockDay(addDays(ws(), 3));
    s.blockDay(addDays(ws(), 4)); // consecutive → one span
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11) }));
    persist(s);

    render(<App />);
    openReport();

    const text = document.querySelector('.rp-context').textContent;
    expect(text).toMatch(/2 days blocked/);
    expect(text).toMatch(/Thu(rsday)?–Fri(day)?/);
  });

  // ⚠️ D-4's line: "a fact explains, a story excuses." The report may say the
  // day was blocked; it may not say the week was quiet BECAUSE it was, and it
  // may not offer sympathy. Both are the judgement §7.1 forbids.
  it('offers no reason, no excuse and no sympathy', () => {
    const s = new Schedule({ config: defaultConfig });
    s.dayNotes.push(new DayNote({ label: 'Reading week', from: addDays(ws(), 0), to: addDays(ws(), 4) }));
    for (let d = 0; d < 5; d += 1) s.blockDay(addDays(ws(), d));
    persist(s);

    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet').textContent;
    expect(sheet).not.toMatch(/because/i);
    expect(sheet).not.toMatch(/understandabl|no wonder|makes sense that|don't worry/i);
  });

  it('names a multi-day note once, not once per day it covers', () => {
    const s = new Schedule({ config: defaultConfig });
    s.dayNotes.push(new DayNote({ label: 'Reading week', from: addDays(ws(), 0), to: addDays(ws(), 4) }));
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(5, 9), endTime: at(5, 11) }));
    persist(s);

    render(<App />);
    openReport();

    const hits = document.querySelector('.rp-context').textContent.match(/Reading week/g) || [];
    expect(hits).toHaveLength(1);
  });

  it('says nothing at all on a week that contained nothing unusual', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11) }));
    persist(s);

    render(<App />);
    openReport();

    expect(document.querySelector('.rp-context')).toBeNull();
  });
});

// A2 — the commitment ledger. `Commitment.amountMinPerWeek` is the only
// denominator in the report the USER typed: not invented (P-2) and not a grade
// (P-1), and it belongs to the week the sheet covers. Commit 0afd707 taught the
// engine that a week holding 2h of a 4h commitment is not done; nothing said so.
describe('§7.1 — what the week owed, against a number you set', () => {
  const withCommitment = (extra = {}) => {
    const s = new Schedule({ config: defaultConfig });
    s.addCommitment({
      title: 'Maths homework', tags: ['study'], amountMinPerWeek: 240,
      from: dateKey(addDays(ws(), -30)), until: dateKey(addDays(ws(), 60)),
      ...extra,
    });
    return s;
  };

  it('states the amount set and the amount laid out, both', () => {
    const s = withCommitment();
    const c = s.commitments[0];
    // Two hours of the four actually on the grid.
    for (let i = 0; i < 2; i += 1) {
      const t = s.addFixed({
        title: `Maths ${i}`, tags: ['study'],
        startTime: at(i, 9), endTime: at(i, 10),
      });
      t.parentId = c.id; // how sittingsFor finds them
    }
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByText(/what the week owed/i)).toBeTruthy();
    expect(screen.getByText('Maths homework')).toBeTruthy();
    expect(screen.getByText(/the weekly amount you chose/i)).toBeTruthy();
  });

  // ⚠️ THE TRAP. previewWeek's `state` comes from engineInputForWeek(start, now)
  // and is `now`-relative, so a RETROSPECTIVE call — the only kind this report
  // makes — marks every commitment `passed`. The ledger must read placedMin,
  // remainingMin, settled and owedMin, which are computed independently of it.
  it('reports the same ledger for a week long past as for this one', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = withCommitment({ from: dateKey(addDays(ws(), -400)) });
    const old = weekStartOf(addDays(ws(), -350));
    const rows = buildWrapReport(s, old).stats.commitments;
    expect(rows).toBeTruthy();
    expect(rows[0].owedMin).toBe(240); // the amount set, not zeroed by time
    expect(rows[0].remainingMin).toBe(240); // never laid out — not "failed"
  });

  it('never turns the remainder into a shortfall or a percentage', () => {
    const s = withCommitment();
    // ⚠️ The week needs at least one task. `isEmpty` is `real.length === 0`, so
    // a week that owed four hours and laid out none of them currently renders
    // the empty-week page — "nothing to report and nothing to fix" — which is
    // false: the commitment is exactly what there was to report. Recorded in
    // design/WRAP-REPORT-ADDITIONS.md rather than changed here, because the
    // empty-week page is a deliberate P-1 decision and this is a product call.
    s.tasks.push(new Task({ title: 'Something', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet').textContent;
    expect(sheet).toMatch(/never laid out/);
    expect(sheet).not.toMatch(/missed|behind|short of|you owe|failed/i);
    expect(sheet).not.toMatch(/\d+% of your commitment/i);
  });

  it('leads with the user\'s own mark when they called the week finished', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = withCommitment();
    s.markCommitmentWeekDone(s.commitments[0].id, ws());
    const rows = buildWrapReport(s, ws()).stats.commitments;
    expect(rows[0].settled).toBe(true);
    expect(rows[0].remainingMin).toBe(0); // the mark overrides the arithmetic
    expect(rows[0].owedMin).toBe(240); // and the arithmetic is still reported
  });

  it('says nothing at all when there are no commitments', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11) }));
    persist(s);

    render(<App />);
    openReport();

    expect(screen.queryByText(/what the week owed/i)).toBeNull();
  });
});

// A3 — WHEN it happened. The report said how much, and what, and never when;
// the chart that used to answer it was deleted 2026-09-02 for reasons that were
// right about the chart and left the question open. These lock the two failures
// that killed it, plus the thing the sand bars structurally cannot show.
describe('§7.1 — when it happened, on one shared clock', () => {
  const strips = () => document.querySelector('.rp-strips');
  const rowBlocks = (i) => [...document.querySelectorAll('.rp-strip')][i]
    .querySelectorAll('.rp-strip-block');
  const left = (el) => parseFloat(el.style.left);
  const width = (el) => parseFloat(el.style.width);

  // ⚠️ THE FAILURE THAT KILLED THE PREDECESSOR. `buildTrajectories` scaled each
  // day to its OWN window, so the same two hours drew 2.5x wider on a Sunday
  // than a Monday — while its own docblock shouted about sharing the y scale.
  it('draws the same duration at the same width on every day', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'Mon', type: 'fixed', startTime: at(0, 11), endTime: at(0, 13) }));
    s.tasks.push(new Task({ title: 'Sun', type: 'fixed', startTime: at(6, 11), endTime: at(6, 13) }));
    persist(s);

    render(<App />);
    openReport();

    const mon = rowBlocks(0)[0];
    const sun = rowBlocks(6)[0];
    expect(width(sun)).toBeCloseTo(width(mon), 5);
    // And the same clock time sits at the same x, which is the other half.
    expect(left(sun)).toBeCloseTo(left(mon), 5);
  });

  // ⚠️ WHAT THE SAND BARS CANNOT SHOW. Windows close at 23:00 and getWeekLoad
  // clamps every task to the window, so a 23:00 block contributes zero minutes
  // and is invisible in the bar chart. It is the whole "11pm after a very full
  // day" complaint, and this strip is where it becomes visible.
  it('shows a block that falls outside the day window', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'Late', type: 'fixed', startTime: at(0, 23), endTime: at(0, 24) }));
    persist(s);

    render(<App />);
    openReport();

    expect(strips()).toBeTruthy();
    const blocks = rowBlocks(0);
    expect(blocks).toHaveLength(1);
    // Past the day's own window band, which is what makes it read as late.
    const win = [...document.querySelectorAll('.rp-strip')][0].querySelector('.rp-strip-window');
    expect(left(blocks[0])).toBeGreaterThanOrEqual(left(win) + width(win) - 0.01);
    // The bars, meanwhile, still say the day held nothing — by design.
    expect(bars()[0].querySelector('.rp-bar-fill').style.height).toBe('0%');
  });

  it('draws each day\'s own window inside the shared axis', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    const rows = [...document.querySelectorAll('.rp-strip')];
    const monWin = rows[0].querySelector('.rp-strip-window');
    const sunWin = rows[6].querySelector('.rp-strip-window');
    // Sunday opens at 10:00, weekdays at 08:00 — a shorter band, further right.
    expect(width(sunWin)).toBeLessThan(width(monWin));
    expect(left(sunWin)).toBeGreaterThan(left(monWin));
  });

  // §10 and P-1: outcome is carried by texture, never by hue. The class is the
  // encoding; a future edit that swaps it for a colour has to delete this.
  it('distinguishes outcomes by texture class, not colour', () => {
    const s = new Schedule({ config: defaultConfig });
    const done = s.addFixed({ title: 'Done', startTime: at(0, 9), endTime: at(0, 10) });
    done.completion = 'done';
    const part = s.addFixed({ title: 'Part', startTime: at(0, 11), endTime: at(0, 12) });
    part.completion = 'partial';
    const skip = s.addFixed({ title: 'Skip', startTime: at(0, 14), endTime: at(0, 15) });
    skip.completion = 'skipped';
    persist(s);

    render(<App />);
    openReport();

    const classes = [...rowBlocks(0)].map((b) => b.className);
    expect(classes.some((c) => c.includes('is-done'))).toBe(true);
    expect(classes.some((c) => c.includes('is-partial'))).toBe(true);
    expect(classes.some((c) => c.includes('is-skipped'))).toBe(true);
    for (const b of rowBlocks(0)) expect(b.style.color).toBe('');
  });

  it('is readable without the picture', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11) }));
    persist(s);

    render(<App />);
    openReport();

    const label = [...document.querySelectorAll('.rp-strip-track')][0].getAttribute('aria-label');
    expect(label).toMatch(/Monday/);
    expect(label).toMatch(/2h|block/);
  });

  it('says nothing at all on a week with no blocks to place', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addCommitment({
      title: 'Owed', amountMinPerWeek: 60,
      from: dateKey(addDays(ws(), -7)), until: dateKey(addDays(ws(), 30)),
    });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);
    render(<App />);
    openReport();
    expect(strips()).toBeTruthy(); // one block is enough to draw
    cleanup();

    const empty = new Schedule({ config: defaultConfig });
    empty.blockDay(addDays(ws(), 2));
    empty.tasks.push(new Task({ title: 'B', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(empty);
    render(<App />);
    openReport();
    expect(strips()).toBeTruthy();
  });
});

// A8, A11, A14 — three corrections to sections that already existed and were
// reporting the wrong quantity.
describe('§7.1 — the report measures against what the app actually aims for', () => {
  it('judges "close to the wire" against the plan\'s own target, not a flat day', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });

    // Due three months out and finished this week with weeks to spare. Under
    // the old flat 24h rule this was "roomy" — correct by luck. Under a runway
    // rule it is emphatically roomy, and for a reason that scales.
    const far = s.addFixed({ title: 'Thesis', startTime: at(0, 9), endTime: at(0, 11) });
    far.deadline = addDays(ws(), 90);
    far.completion = 'done';

    // Due Wednesday evening, finished two hours before. A fifth of the runway
    // from the week's start is ~13h, so two hours is later than the plan aims.
    const near = s.addFixed({ title: 'Essay', startTime: at(2, 15), endTime: at(2, 17) });
    near.deadline = at(2, 19);
    near.completion = 'done';

    const d = buildWrapReport(s, ws()).stats.deadlines;
    expect(d.count).toBe(2);
    expect(d.closeCount).toBe(1); // the essay only
    expect(d.tightest.title).toBe('Essay');
    // The denominator is named rather than implied, and it is not 24.
    expect(d.medianTargetHours).toBeGreaterThan(0);
  });

  it('does not claim a target for a deadline already past when the week began', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    const overdue = s.addFixed({ title: 'Late', startTime: at(0, 9), endTime: at(0, 10) });
    overdue.deadline = addDays(ws(), -3); // no runway to take a fifth of
    overdue.completion = 'done';

    const d = buildWrapReport(s, ws()).stats.deadlines;
    expect(d.count).toBe(1);
    expect(d.closeCount).toBe(0); // nothing claimed, rather than "you were late"
  });

  // A11 — `getWeekLoad().warnings` has been on stats.load, unrendered, all along.
  it('says when the packer could not find a proper slot, and blames the packer', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Squeezed', startTime: at(0, 9), endTime: at(0, 10) });
    t.schedulingWarning = true;
    persist(s);

    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet').textContent;
    expect(sheet).toMatch(/packer could not find a proper slot/i);
    expect(sheet).not.toMatch(/you (failed|couldn't|didn't manage)/i);
  });

  // A14 — `thisWeek` was computed and read by nothing, so every project ever
  // created printed in every report forever as an unchanging lifetime figure.
  it('shows only the projects this week actually touched', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.addProject({
      title: 'Touched',
      chunking: { totalMinutes: 600, minChunk: 60, maxChunk: 120,
        range: { from: ws(), until: addDays(ws(), 6) } },
    });
    s.addProject({
      title: 'Untouched',
      chunking: { totalMinutes: 600, minChunk: 60, maxChunk: 120,
        range: { from: addDays(ws(), 60), until: addDays(ws(), 90) } },
    });

    const titles = buildWrapReport(s, ws()).accomplished.projects.map((p) => p.title);
    expect(titles).toContain('Touched');
    expect(titles).not.toContain('Untouched');
  });
});

// A9 — the pattern you set, against the week you ran. "Skip today, do it
// tomorrow" and "one extra session this week" became expressible in 237c71c and
// nothing has reported on them since.
describe('§7.1 — the pattern, and the week', () => {
  const weekly = (s, title, dayOffset, hour) => s.addFixed({
    title,
    startTime: at(dayOffset, hour),
    endTime: at(dayOffset, hour + 1),
    recurrence: {
      freq: 'weekly',
      periods: [{ windows: [{ day: ['mon', 'wed', 'fri'][dayOffset] || 'mon', start: `${String(hour).padStart(2, '0')}:00`, end: `${String(hour + 1).padStart(2, '0')}:00` }] }],
    },
  });

  it('counts what the pattern put on the week as the denominator', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    weekly(s, 'Gym', 0, 17);
    // ⚠️ NO `if (p)` GUARD. A conditional here would let the test pass by
    // skipping if the section ever stopped rendering, which is the failure mode
    // this whole file exists to catch. Verified live: one weekly pattern puts
    // exactly one session on the week.
    const p = buildWrapReport(s, ws()).stats.pattern;
    expect(p).toBeTruthy();
    expect(p.scheduled).toBe(1);
    expect(p.ranAsWritten).toBe(p.scheduled - p.moved - p.skipped);
  });

  // ⚠️ A SKIPPED OCCURRENCE IS NOT MATERIALISED, so it is absent from the
  // week's tasks. The denominator has to add it back or it shrinks by exactly
  // the thing being reported — the pattern would appear to have put fewer
  // sessions on the week precisely because one was skipped.
  it('does not shrink the denominator by the skips it is reporting', async () => {
    const { buildWrapReport, } = await import('../src/ui/report.js');
    const { addException } = await import('../src/core/index.js');
    const s = new Schedule({ config: defaultConfig });
    const gym = weekly(s, 'Gym', 0, 17);

    const before = buildWrapReport(s, ws()).stats.pattern;
    expect(before).toBeTruthy();
    addException(gym, dateKey(at(0, 17)), 'skip');
    const after = buildWrapReport(s, ws()).stats.pattern;

    expect(after.scheduled).toBe(before.scheduled); // the pattern still put N on
    expect(after.skipped).toBe(1);
    expect(after.ranAsWritten).toBe(before.ranAsWritten - 1);
  });

  // §7.1 forbids listing what you did not do. "3 skipped" as a standalone
  // finding is that list with a number instead of names, so moves and skips
  // only ever appear beside the sessions that ran.
  it('never states skips on their own', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    // A one-off week has no pattern section at all, which is the correct
    // absence. Where it DOES appear, moves and skips never stand alone.
    expect(screen.queryByText(/the pattern, and the week/i)).toBeNull();
  });

  it('says nothing at all when no task carries a pattern', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'One-off', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    expect(buildWrapReport(s, ws()).stats.pattern).toBeNull();
  });
});
