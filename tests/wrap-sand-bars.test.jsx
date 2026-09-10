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
import { Schedule, Task, DayNote, RoutineInstance, defaultConfig, weekStart as weekStartOf, addDays, dateKey } from '../src/core/index.js';
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
    // ⚠️ Was asserted against the pale window band's right edge; the band is gone
    // (2026-09-07) and the axis is the denominator now. A 23:00 block on an axis
    // stretched to hold it lands in the last stretch of the row, which is what
    // makes it read as late.
    expect(left(blocks[0])).toBeGreaterThan(70);
    // The bars, meanwhile, still say the day held nothing — by design.
    expect(bars()[0].querySelector('.rp-bar-fill').style.height).toBe('0%');
  });

  // ⚠️ REPLACES "draws each day's own window inside the shared axis" (user's
  // call, 2026-09-07): "The background should be a gradient based on levels of
  // exaustion and it shouldn't only be during day hours. This gives less
  // information."
  //
  // The pale band is gone. It spent the background — the one channel with room
  // for a continuous quantity — on a near-constant fact the grid already states,
  // and it CLIPPED the energy wash to day hours, so the late night was the one
  // stretch of the chart with no shading at all.
  it('washes the whole day, not just the open window', () => {
    const s = new Schedule({ config: defaultConfig });
    // A bucket, so the tag actually draws on a load axis — without one the
    // reserve never dips and there is nothing to shade.
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    // A heavy block late in the evening: the reserve it leaves behind must still
    // be drawn after the window has closed.
    s.addFixed({
      title: 'Late slog', tags: ['study'],
      startTime: at(0, 21), endTime: at(0, 23),
    });
    persist(s);

    render(<App />);
    openReport();

    expect(document.querySelector('.rp-strip-window')).toBe(null);
    const shades = [...[...document.querySelectorAll('.rp-strip')][0]
      .querySelectorAll('.rp-strip-shade')];
    expect(shades.length).toBeGreaterThan(0);
    // Something is shaded past the point the old band stopped at, which the
    // clipped version could not do.
    const rightmost = Math.max(...shades.map((el) => left(el) + width(el)));
    expect(rightmost).toBeGreaterThan(95);
  });

  // ⚠️ ONE INK WEIGHT, AND SKIPPED WORK IS NOT DRAWN (user's call, 2026-09-05).
  // Completion state was four different fills; for someone who schedules after
  // doing and moves what they do not do it is near-constant, so the chart's
  // strongest channel was carrying its least informative variable while the
  // energy behind it had none. With one weight, drawing a skipped block would
  // claim it happened — and this section is called "when it happened".
  it('draws every block the same, and does not draw skipped work at all', () => {
    const s = new Schedule({ config: defaultConfig });
    const done = s.addFixed({ title: 'Done', startTime: at(0, 9), endTime: at(0, 10) });
    done.completion = 'done';
    const part = s.addFixed({ title: 'Part', startTime: at(0, 11), endTime: at(0, 12) });
    part.completion = 'partial';
    const planned = s.addFixed({ title: 'Planned', startTime: at(0, 14), endTime: at(0, 15) });
    void planned;
    const skip = s.addFixed({ title: 'Skip', startTime: at(0, 16), endTime: at(0, 17) });
    skip.completion = 'skipped';
    persist(s);

    render(<App />);
    openReport();

    const blocks = [...rowBlocks(0)];
    expect(blocks).toHaveLength(3); // the skipped one is absent, not outlined
    // No per-state class survives, and no inline colour was introduced.
    for (const b of blocks) {
      expect(b.className).toBe('rp-strip-block');
      expect(b.style.color).toBe('');
    }
  });

  // The background is the energy curve, in absolute load-hours — not scaled to
  // the week's own worst day, which is what made the deleted day-shapes chart
  // draw a punishing week and a gentle one identically.
  it('shades the background by how much had been spent by that hour', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    for (let h = 8; h < 13; h += 1) {
      s.addFixed({ title: `AM${h}`, tags: ['study'], startTime: at(0, h), endTime: at(0, h + 1) });
    }
    persist(s);

    render(<App />);
    openReport();

    const shades = [...document.querySelectorAll('.rp-strip')][0]
      .querySelectorAll('.rp-strip-shade');
    expect(shades.length).toBeGreaterThan(1);
    // It gets darker as the morning goes on: the last band is heavier than the
    // first, which is the whole claim the wash is making.
    const op = (el) => parseFloat(el.style.opacity);
    expect(op(shades[shades.length - 1])).toBeGreaterThan(op(shades[0]));
  });

  // ⚠️ A TASK NESTED INSIDE A LONGER ONE. `reserveWalk` sorts by START and stamps
  // each point at that task's END, and `energyTrajectory` handed those points on
  // as though they were in time order. They are not, the moment one task sits
  // inside another — so the strip's walk moved `prev` BACKWARDS and emitted
  // overlapping segments. Measured before the fix, a five-hour call inside a
  // nine-hour lab:
  //
  //        0 → 1200  depth  0.00
  //     1020 → 1440  depth 42.00     ← overlaps the row above
  //
  // Two translucent fills stacked over 17:00–20:00 read darker than the scale's
  // own maximum allows, and the nine hours holding the day's entire workload
  // were painted at depth 0 — the wash said you were fresh straight through it.
  //
  // ⚠️ THE MORNING BLOCK IS LOad-BEARING, not scenery. The wash only draws
  // segments with depth above zero, so with the nested pair ALONE the earlier
  // segment is invisible and there is nothing for the later one to overlap —
  // the first draft of this case passed against the unfixed code for exactly
  // that reason. Something has to have been spent BEFORE the pair for the
  // double-painting to become visible, which is also the realistic shape: the
  // nested call happens in the middle of a day already under way.
  it('never paints two washes over the same hour', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, creative: 1 } });
    s.addFixed({ title: 'Morning', tags: ['study'], startTime: at(0, 9), endTime: at(0, 11) });
    s.addFixed({ title: 'Long lab', tags: ['study'], startTime: at(0, 11), endTime: at(0, 20) });
    s.addFixed({ title: 'Nested call', tags: ['study'], startTime: at(0, 12), endTime: at(0, 17) });
    persist(s);

    render(<App />);
    openReport();

    const shades = [...[...document.querySelectorAll('.rp-strip')][0]
      .querySelectorAll('.rp-strip-shade')];
    expect(shades.length).toBeGreaterThan(0);
    expect(shades.length).toBeGreaterThanOrEqual(2); // or there is nothing to overlap
    const spans = shades.map((el) => ({
      from: pct(el, 'left'), to: pct(el, 'left') + pct(el, 'width'),
    })).sort((a, b) => a.from - b.from);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].to - 1e-6);
    }
  });

  // …and THE DEPTHS. Fixing the geometry alone leaves a subtler wrong: the
  // strip's `Math.max` guard stops `prev` moving backwards, which collapses the
  // out-of-order points into ONE drawn band covering everything after 17:00 —
  // no overlap, and no wash at all over the nine hours holding the day's entire
  // workload. Re-sorting the points does not fix it either, because each one
  // carries a cumulative total from its position in the START order, not from
  // its own hour: sorted, the row read 42 load-hours at 17:00 dropping to 27 at
  // 20:00, as though finishing the lab had rested you.
  //
  // ⚠️ ASSERT TWO BANDS BEFORE COMPARING THEM. With one band the ordering check
  // below is vacuously true, which is exactly how the first draft of this case
  // passed against the unfixed code.
  it('deepens at each hour work finished, and never lightens while spending', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, creative: 1 } });
    s.addFixed({ title: 'Long lab', tags: ['study'], startTime: at(0, 11), endTime: at(0, 20) });
    s.addFixed({ title: 'Nested call', tags: ['study'], startTime: at(0, 12), endTime: at(0, 17) });
    persist(s);

    render(<App />);
    openReport();

    const shades = [...[...document.querySelectorAll('.rp-strip')][0]
      .querySelectorAll('.rp-strip-shade')]
      .sort((a, b) => pct(a, 'left') - pct(b, 'left'));
    // Two tasks finish at different hours, so the wash steps twice.
    expect(shades.length).toBeGreaterThanOrEqual(2);
    const ops = shades.map((el) => parseFloat(el.style.opacity));
    for (let i = 1; i < ops.length; i += 1) expect(ops[i]).toBeGreaterThan(ops[i - 1]);
  });

  // ⚠️ THE WASH AND THE TRACK ARE ONE DRAWING. The shade is built in day
  // coordinates (0…1440) before the axis is known, and the axis is the union of
  // every day's window and every task — so a week whose axis ran 480→1500 put
  // the first segment at −47.1% of the track and left 1440→1500 with no
  // background at all, which is the same complaint that moved the wash off the
  // open window in the first place ("it shouldn't only be during day hours").
  //
  // ⚠️ NO MIDNIGHT-CROSSING TASK IN THIS FIXTURE, deliberately. One would push
  // `axisTo` out to 25 hours all by itself and the tail would fit inside the
  // track for the wrong reason — which is how the first draft of this case
  // passed against the unfixed code. The overflow needs a day whose LAST task
  // ends before the window closes, so the debt it leaves behind lands past the
  // end of the axis: measured at 114% of the track, drawn off the end of the row.
  it('never runs the wash off the end of the track', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, creative: 1 } });
    s.addFixed({ title: 'Evening', tags: ['study'], startTime: at(0, 18), endTime: at(0, 21) });
    persist(s);

    render(<App />);
    openReport();

    const shades = [...[...document.querySelectorAll('.rp-strip')][0]
      .querySelectorAll('.rp-strip-shade')];
    expect(shades.length).toBeGreaterThan(0);
    const right = Math.max(...shades.map((el) => pct(el, 'left') + pct(el, 'width')));
    const left = Math.min(...shades.map((el) => pct(el, 'left')));
    expect(right).toBeLessThanOrEqual(100 + 1e-6);
    expect(left).toBeGreaterThanOrEqual(-1e-6);
    // …and it must still REACH the end: the debt a late block leaves behind is
    // the most informative stretch on the row, and clipping it to the old axis
    // deleted the day's only shading outright.
    expect(right).toBeGreaterThan(95);
  });

  // ⚠️ THE CALIBRATION, WHICH HAD NO GRADIENT IN IT. The wash caps at four steps
  // so it never competes with the ink of the blocks, and the step was 2
  // load-hours — putting the whole useful range of the scale inside one morning.
  // Measured on an ordinary week: a 90-minute lecture arrived at 3 of 4 steps,
  // and a 9.5-hour Wednesday was INDISTINGUISHABLE from a 5-hour Thursday. What
  // was asked for was "a gradient based on levels of exaustion".
  //
  // Asserted on the two days a reader most wants told apart, not on the constant
  // — a test that reads `shadeStep` back would agree with any value at all.
  it('tells a heavy day apart from a merely busy one', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, creative: 1 } });
    s.addBucket({ label: 'Class', tags: ['class'], load: { mental: 2, social: 1 } });
    // Mon: one lecture. Tue: a five-hour day. Wed: a nine-and-a-half hour one.
    s.addFixed({ title: 'Lecture', tags: ['class'], startTime: at(0, 10), endTime: at(0, 11, 30) });
    s.addFixed({ title: 'Gym-ish', tags: ['class'], startTime: at(1, 9), endTime: at(1, 11) });
    s.addFixed({ title: 'Thesis', tags: ['study'], startTime: at(1, 11), endTime: at(1, 14) });
    s.addFixed({ title: 'Seminar', tags: ['class'], startTime: at(2, 9), endTime: at(2, 13) });
    s.addFixed({ title: 'Problem set', tags: ['study'], startTime: at(2, 14), endTime: at(2, 19) });
    persist(s);

    render(<App />);
    openReport();

    const darkest = (i) => Math.max(0, ...[...[...document.querySelectorAll('.rp-strip')][i]
      .querySelectorAll('.rp-strip-shade')].map((el) => parseFloat(el.style.opacity)));

    // The two full days must not read the same. This is the assertion the old
    // calibration failed: both sat pinned at the four-step maximum.
    expect(darkest(2)).toBeGreaterThan(darkest(1));
    // And one lecture must not already be most of the way to the darkest shade.
    expect(darkest(0)).toBeLessThan(darkest(2) / 2);
  });

  // ⚠️ THE STRIP WAS ANSWERING THE WRONG QUESTION. Asked directly, looking at the
  // printed sheet: "how am I supposed to use this information — it would be
  // easier if there were colors for like different buckets so I can see where my
  // time goes." The wash answered "how drained was I", which is a feeling the
  // reader already has. Blocks now carry their bucket's colour and the energy
  // moved to a lane of its own underneath.
  describe('colour says which bucket, and the legend says it in words', () => {
    const coloured = () => {
      const s = new Schedule({ config: defaultConfig });
      // Loads, or there is no energy to draw and the lane case below passes
      // vacuously against a strip that renders no lane at all.
      s.addBucket({ label: 'Deep work', tags: ['study'], color: '#457b9d', load: { mental: 3, creative: 1 } });
      s.addBucket({ label: 'Exercise', tags: ['gym'], color: '#e07a5f', load: { physical: 2 } });
      s.addFixed({ title: 'Thesis', tags: ['study'], startTime: at(0, 9), endTime: at(0, 12) });
      s.addFixed({ title: 'Reading', tags: ['study'], startTime: at(1, 9), endTime: at(1, 11) });
      s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(2, 7), endTime: at(2, 8) });
      // Untagged work belongs to no bucket and must not be given one.
      s.addFixed({ title: 'Errand', startTime: at(3, 15), endTime: at(3, 16) });
      return s;
    };
    const swatchColours = () => [...document.querySelectorAll('.rp-strip-swatch')]
      .map((el) => el.style.background);

    it('draws each block in its bucket colour', () => {
      persist(coloured());
      render(<App />);
      openReport();

      const mon = [...rowBlocks(0)];
      const wed = [...rowBlocks(2)];
      expect(mon).toHaveLength(1);
      expect(wed).toHaveLength(1);
      expect(mon[0].style.background).toBeTruthy();
      // Two different buckets must not render the same colour, or the channel
      // is carrying nothing.
      expect(wed[0].style.background).not.toBe(mon[0].style.background);
    });

    // ⚠️ §10 — NEVER MEANING BY COLOUR ALONE. Stated structurally rather than by
    // counting rows: every colour that appears ON the strip must be named in the
    // legend. A test that checked "the legend has 2 entries" would pass while a
    // third colour went unnamed.
    it('names every colour it uses', () => {
      persist(coloured());
      render(<App />);
      openReport();

      const used = new Set([...document.querySelectorAll('.rp-strip-block')]
        .map((el) => el.style.background)
        .filter(Boolean));
      expect(used.size).toBeGreaterThan(1); // or there is nothing to name
      const named = new Set(swatchColours());
      for (const c of used) expect(named.has(c)).toBe(true);
    });

    it('orders the legend by where the time actually went', () => {
      persist(coloured());
      render(<App />);
      openReport();

      const rows = [...document.querySelectorAll('.rp-strip-legend li')]
        .map((el) => el.textContent);
      // study 3h + 2h = 5h, gym 1h. Largest first, because that order IS the
      // finding the section was asked for.
      expect(rows[0]).toMatch(/Deep work/);
      expect(rows[0]).toMatch(/5h/);
      expect(rows[1]).toMatch(/Exercise/);
      expect(rows[1]).toMatch(/1h/);
      // The untagged errand has no bucket, so it is not invented into one.
      expect(rows.join(' ')).not.toMatch(/Errand|other|Other/);
    });

    // The energy reading survives the move — it is a lane now, not a background.
    it('keeps the energy reading, in its own lane', () => {
      const s = coloured();
      persist(s);
      render(<App />);
      openReport();

      const lanes = [...document.querySelectorAll('.rp-strip-energy')];
      expect(lanes.length).toBeGreaterThan(0);
      const shaded = lanes.flatMap((l) => [...l.querySelectorAll('.rp-strip-shade')]);
      expect(shaded.length).toBeGreaterThan(0);
      // and the wash is no longer inside the block track, where it competed
      // with the colours for the same pixels.
      for (const track of document.querySelectorAll('.rp-strip-track')) {
        expect(track.querySelector('.rp-strip-shade')).toBeNull();
      }
    });
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

  // ⚠️ TWO SECTIONS OF ONE PAGE, TWO DENOMINATORS, AND NOTHING SAYING SO. On a
  // week where every session was marked skipped this block returned null and
  // disappeared, while the sand bars above went on reporting 1200 minutes over
  // five days — `getWeekLoad` counts what was SCHEDULED and is right to, since a
  // skipped block still occupied the grid and placement's balance term needs it.
  // A reader saw a full week of bars and no clock at all, with no explanation.
  it('does not vanish on a week whose sessions were all skipped', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3 } });
    for (let d = 0; d < 5; d += 1) {
      const t = s.addFixed({ title: `Block ${d}`, tags: ['study'], startTime: at(d, 9), endTime: at(d, 13) });
      t.completion = 'skipped';
    }
    persist(s);

    render(<App />);
    openReport();

    // The bars still report the scheduled hours…
    expect(bars().length).toBeGreaterThan(0);
    // …and the clock is still on the page, saying why it is empty.
    expect(strips()).toBeTruthy();
    const said = strips().textContent;
    expect(said).toMatch(/sessions that ran/);
    expect(said).toMatch(/5 are marked\s+skipped/);
    // A COUNT, never a list (§7.1) — no session titles anywhere in it.
    expect(said).not.toMatch(/Block \d/);
    // And no verdict about the reader (P-1).
    expect(said).not.toMatch(/you (didn|did not|failed|missed)/i);
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
describe('§7.1 — a finding names the evidence that is actually behind it', () => {
  // ⚠️ IT FIRED ON WORK THAT WAS ALREADY DONE, AND ON WORK STRANDED IN THE PAST.
  // The guard excluded `skipped` and nothing else, and the loop walks
  // `sched.tasks` — every task ever, not this week's. Measured on an otherwise
  // empty September report: "Tax forms keeps getting pushed · Pinning it gives
  // it right of way next week", about a task COMPLETED IN MARCH.
  const pushed = (title, start, completion) => {
    const t = new Task({
      title, type: 'flexible',
      startTime: start, endTime: new Date(start.getTime() + 3600000),
    });
    t.history.displacedCount = 2;
    t.history.carriedCount = 1;
    t.completion = completion;
    return t;
  };
  const starveHeadlines = () => [...document.querySelectorAll('.rp-sugg-head')]
    .map((el) => el.textContent)
    .filter((x) => /keeps getting pushed/.test(x));

  it('does not say finished work keeps getting pushed', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(pushed('Done in March', new Date(2026, 2, 10, 9, 0), 'done'));
    s.tasks.push(pushed('Stranded in March', new Date(2026, 2, 11, 9, 0), null));
    s.tasks.push(pushed('Live this week', at(1, 9), null));
    persist(s);

    render(<App />);
    openReport();

    const said = starveHeadlines();
    // ⚠️ THE LIVE ONE MUST SURVIVE. "No starvation findings" passes just as well
    // against a detector that has been switched off; the case is that it keeps
    // the true one and drops the two false ones.
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Live this week/);
  });

  // `displacedCount`/`carriedCount` are lifetime counters with no timestamps, so
  // "3 times" invited the reader to assume a period the app cannot back.
  it('names the period of a count it cannot bound', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(pushed('Live this week', at(1, 9), null));
    persist(s);

    render(<App />);
    openReport();

    const detail = [...document.querySelectorAll('.rp-sugg-detail')]
      .map((el) => el.textContent)
      .find((x) => /Moved or carried/.test(x));
    expect(detail).toMatch(/3 times in all/);
  });
});

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

// A10 — what a routine cost your evening, against what it cost your attention.
// The gap between the two IS the waiting, and no other surface can state it:
// the grid shows touchpoints and a lot of space between them, and the space is
// the point. Both numbers come from the same frozen program, so nothing here is
// estimated and nothing needs gating.
describe('§7.1 — what routines actually cost', () => {
  const laundry = (s) => {
    // The run is built directly rather than through the authoring flow: an
    // active load, a passive wait, an active fold. That is the shape the report
    // reads — `steps` is the frozen program, and both numbers come from it.
    s.routineInstances.push(new RoutineInstance({
      label: 'Laundry',
      startTime: at(0, 18),
      travelMin: 0,
      steps: [
        { kind: 'active', label: 'load', durationMin: 10 },
        { kind: 'passive', label: 'wash', durationMin: 115 },
        { kind: 'active', label: 'fold', durationMin: 15 },
      ],
    }));
    return s;
  };

  it('states elapsed time and attention as two separate facts', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = laundry(new Schedule({ config: defaultConfig }));
    const rows = buildWrapReport(s, ws()).stats.routines;

    expect(rows).toBeTruthy();
    expect(rows[0].label).toBe('Laundry');
    expect(rows[0].spanMin).toBe(140); // 10 + 115 + 15
    expect(rows[0].attentionMin).toBe(25); // the active steps only
    expect(rows[0].waitingMin).toBe(115); // the difference IS the waiting
  });

  // ⚠️ P-1. A big gap means the routine is WORKING — the machine ran while you
  // did something else. No ratio, no "efficiency", no verdict of any kind.
  it('draws no conclusion from the gap', () => {
    const s = laundry(new Schedule({ config: defaultConfig }));
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet').textContent;
    expect(sheet).toMatch(/what your routines actually cost/i);
    expect(sheet).not.toMatch(/efficien|wasted|only \d+ minutes of/i);
    expect(sheet).not.toMatch(/\d+% of the routine/i);
  });

  it('says nothing when no routine ran this week', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    expect(buildWrapReport(s, ws()).stats.routines).toBeNull();
  });
});

// The empty-week page is right for a week that is genuinely empty, and was
// swallowing a week that owed hours and laid out none of them.
describe('§7.1 — a week that owed hours is not an empty week', () => {
  const owing = () => {
    const s = new Schedule({ config: defaultConfig });
    s.addCommitment({
      title: 'Maths', tags: ['study'], amountMinPerWeek: 240,
      from: dateKey(addDays(ws(), -7)), until: dateKey(addDays(ws(), 60)),
    });
    return s;
  };

  it('does not call it empty, and does not say there is nothing to report', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const r = buildWrapReport(owing(), ws());
    expect(r.isEmpty).toBe(false);
    expect(r.owedButUnplaced).toBe(240);
  });

  it('says what was never laid out, with the packer as the subject', () => {
    persist(owing());
    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet').textContent;
    expect(sheet).toMatch(/never laid out/i);
    expect(sheet).not.toMatch(/nothing to report and nothing to fix/i);
    // Still no accusation: the hours were not laid out, not "missed".
    expect(sheet).not.toMatch(/you (missed|failed|didn't do)/i);
  });

  it('still gives a genuinely empty week the quiet page it had', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const r = buildWrapReport(new Schedule({ config: defaultConfig }), ws());
    expect(r.isEmpty).toBe(true);
    expect(r.owedButUnplaced).toBe(0);
  });
});
