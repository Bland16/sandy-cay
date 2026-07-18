// @vitest-environment jsdom
// Wrap report (§7.1 / R-7) + the week-rollover trigger, driven through the real
// <App/> against the real engine.
//
// The cases that matter most here are the undignified ones: an empty week, an
// untrained model, a week with no planned baseline. Blind QA flagged exactly
// those, and they are where a report starts printing "0/0" and NaN.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, Task, defaultConfig, weekStart as weekStartOf, addDays, dateKey } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';
import { buildWrapReport, applySuggestion, weekRangeLabel } from '../src/ui/report.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const persist = (sched) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sched.toJSON()));

/** Saves are debounced 1.5s (useEngine), so reading localStorage straight after
 *  an interaction reads the state from BEFORE it. Drive the timer rather than
 *  weaken the assertion — the persisted bytes are the thing under test. */
const readSaved = () => {
  act(() => { vi.advanceTimersByTime(2500); });
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY));
};
const thisWeek = () => weekStartOf(new Date());
const at = (offset, h, m = 0) => {
  const d = addDays(thisWeek(), offset);
  d.setHours(h, m, 0, 0);
  return d;
};

/** Open Week ⋯ → Wrap report. */
const openReport = () => {
  fireEvent.click(screen.getByLabelText(/week menu/i));
  fireEvent.click(screen.getByText(/wrap report/i));
};

describe('§7.1 — the Wrap report view', () => {
  it('opens from the week ⋯ menu and renders as a document', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Team standup', tags: ['work'], startTime: at(0, 9), endTime: at(0, 10) });
    t.completion = 'done';
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByRole('heading', { name: /your week at sandy cay/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /what you got done/i })).toBeTruthy();
    expect(screen.getByText('Team standup')).toBeTruthy();
  });

  it('sets document.title to the PDF filename, and restores it on the way out', () => {
    const before = document.title;
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'A', startTime: at(0, 9), endTime: at(0, 10) });
    persist(s);

    render(<App />);
    openReport();
    // "Save as PDF" defaults to document.title — this IS the filename (§7.1).
    expect(document.title).toMatch(/^wrap-\d{4}-W\d{2}$/);

    fireEvent.click(screen.getByText(/back to the week/i));
    expect(document.title).toBe(before);
  });

  it('window.print() is the renderer — no PDF library (OD-15)', () => {
    const print = vi.fn();
    window.print = print;
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'A', startTime: at(0, 9), endTime: at(0, 10) });
    persist(s);

    render(<App />);
    openReport();
    fireEvent.click(screen.getByText(/print \/ save as pdf/i));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('an EMPTY week renders with dignity — no zeroes, no NaN, no telling-off', () => {
    persist(new Schedule({ config: defaultConfig }));
    render(<App />);
    openReport();

    expect(screen.getByText(/nothing was scheduled this week/i)).toBeTruthy();
    const sheet = document.querySelector('.rp-sheet');
    expect(sheet.textContent).not.toMatch(/NaN/);
    expect(sheet.textContent).not.toMatch(/0\/0/);
    // No statistics tables invented out of an empty week.
    expect(within(sheet).queryByRole('heading', { name: /shape of the week/i })).toBeNull();
  });

  it('a 2-shell rating reads as 2 — not as five shell shapes (§10: never colour alone)', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'The one task', tags: ['work'], startTime: at(0, 9), endTime: at(0, 10) });
    t.completion = 'done';
    t.satisfaction = { overall: 2, timingFit: 0, durationFit: 0, energy: 0 };
    persist(s);

    render(<App />);
    openReport();

    // Reported from the first real print: rated 2, read as 5. The data was
    // always right; five shapes sat on the page and only the tint differed, so
    // the reader counted shapes. The numeral is the fix and the assertion.
    const sheet = document.querySelector('.rp-sheet');
    const group = sheet.querySelector('.rp-shells');

    // The value is on the page as TEXT — the part that was missing, and the
    // only part that survives a greyscale printer.
    expect(group.querySelector('.rp-shells-num').textContent).toBe('2');
    // Exactly two of the five glyphs are filled...
    expect(group.querySelectorAll('.on')).toHaveLength(2);
    expect(group.querySelectorAll('.off')).toHaveLength(3);
    // ...and the label states it for anyone who can't see tint at all.
    expect(group.getAttribute('aria-label')).toBe('2.0 out of 5');
  });

  it('the week average is the average, not the maximum', () => {
    const s = new Schedule({ config: defaultConfig });
    const a = s.addFixed({ title: 'Low', startTime: at(0, 9), endTime: at(0, 10) });
    a.completion = 'done';
    a.satisfaction = { overall: 2, timingFit: 0, durationFit: 0, energy: 0 };
    const b = s.addFixed({ title: 'High', startTime: at(1, 9), endTime: at(1, 10) });
    b.completion = 'done';
    b.satisfaction = { overall: 4, timingFit: 0, durationFit: 0, energy: 0 };

    const r = buildWrapReport(s, thisWeek());
    expect(r.accomplished.avgShells).toBe(3);
    expect(r.accomplished.ratedCount).toBe(2);
  });

  it('skipped work is a quiet count, never a list (§7.1)', () => {
    const s = new Schedule({ config: defaultConfig });
    const done = s.addFixed({ title: 'Went for a run', startTime: at(0, 9), endTime: at(0, 10) });
    done.completion = 'done';
    const skipped = s.addFixed({ title: 'Tax return', startTime: at(1, 9), endTime: at(1, 10) });
    skipped.completion = 'skipped';
    persist(s);

    render(<App />);
    openReport();

    const sheet = document.querySelector('.rp-sheet');
    expect(within(sheet).getByText('Went for a run')).toBeTruthy();
    // The count is there...
    expect(sheet.textContent).toMatch(/1 thing was let go/i);
    // ...but the thing itself is never named. This is the P-1 line.
    expect(within(sheet).queryByText('Tax return')).toBeNull();
  });
});

describe('§7.1 — the report view model', () => {
  it('omits planned-vs-actual entirely when the week has no baseline', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'Manual', startTime: at(0, 9), endTime: at(0, 10) });
    const r = buildWrapReport(s, thisWeek());
    // Not a zeroed section — absent. A week with no plan didn't "go to plan".
    expect(r.stats.plan).toBeNull();
  });

  it('reports planned-vs-actual once a baseline exists', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFlexible({ title: 'Drifter', durationMin: 60, from: thisWeek(), to: addDays(thisWeek(), 6) });
    s.autoSchedule({ weekStart: thisWeek(), now: thisWeek() });

    const r0 = buildWrapReport(s, thisWeek());
    expect(r0.stats.plan.movedCount).toBe(0);

    t.moveTo(addDays(t.startTime, 1));
    const r1 = buildWrapReport(s, thisWeek());
    expect(r1.stats.plan.movedCount).toBe(1);
    expect(r1.stats.plan.biggest.title).toBe('Drifter');
  });

  it('says nothing about the model below the cold-start floor (§5)', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addFixed({ title: 'A', startTime: at(0, 9), endTime: at(0, 10) });
    const r = buildWrapReport(s, thisWeek());
    expect(r.insight.cold).toBe(true);
    expect(r.insight.needed).toBe(defaultConfig.coldStartRatings);
  });

  it('every suggestion carries an exit of equal weight (P-1)', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Starved thing', startTime: at(0, 9), endTime: at(0, 10) });
    t.history.displacedCount = 2;
    t.history.carriedCount = 2;

    const r = buildWrapReport(s, thisWeek());
    const starve = r.suggestions.find((x) => x.kind === 'starvation');
    expect(starve).toBeTruthy();
    expect(starve.actions).toHaveLength(2);
    // The graceful exit exists and is a real action, not a dismissal.
    expect(starve.actions.map((a) => a.kind)).toContain('letgo');
  });

  it('an answered suggestion never comes back', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Starved thing', startTime: at(0, 9), endTime: at(0, 10) });
    t.history.displacedCount = 3;

    const before = buildWrapReport(s, thisWeek());
    const sugg = before.suggestions.find((x) => x.kind === 'starvation');
    applySuggestion(s, sugg, 'letgo', new Date());

    // Answered → gone, and gone across a reload: an observation that returns
    // every Monday until you give in is nagging with extra steps.
    expect(buildWrapReport(s, thisWeek()).suggestions.find((x) => x.id === sugg.id)).toBeUndefined();
    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(revived.isSuggestionDismissed(sugg.id)).toBe(true);
  });

  it('"Pin it next week" pins; "Let it go" releases without deleting', () => {
    const s = new Schedule({ config: defaultConfig });
    const a = s.addFixed({ title: 'Pin me', startTime: at(0, 9), endTime: at(0, 10) });
    a.history.displacedCount = 3;
    const sugA = buildWrapReport(s, thisWeek()).suggestions.find((x) => x.taskId === a.id);
    applySuggestion(s, sugA, 'apply');
    expect(a.pinned).toBe(true);

    const s2 = new Schedule({ config: defaultConfig });
    const b = s2.addFixed({ title: 'Release me', startTime: at(0, 9), endTime: at(0, 10) });
    b.history.carriedCount = 3;
    const sugB = buildWrapReport(s2, thisWeek()).suggestions.find((x) => x.taskId === b.id);
    applySuggestion(s2, sugB, 'letgo');
    expect(b.completion).toBe('skipped');
    expect(s2.tasks).toContain(b); // released, not deleted — nothing vanishes
  });

  it('labels a week range, including one that crosses a month', () => {
    expect(weekRangeLabel(new Date(2026, 6, 13))).toBe('July 13 – 19, 2026');
    expect(weekRangeLabel(new Date(2026, 5, 29))).toBe('June 29 – July 5, 2026');
  });
});

describe('R-7 — the rollover offer', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  it('a first-ever run records the week and offers nothing', () => {
    render(<App />);
    expect(screen.queryByText(/last week wrapped up/i)).toBeNull();
    // Recorded, so the first rollover it sees is a real one.
    expect(readSaved().lastSeenWeek).toBe(dateKey(thisWeek()));
  });

  it('offers the report when a week has closed, and never carries anything itself', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Unfinished', startTime: at(-6, 9), endTime: at(-6, 10) });
    s.markWeekSeen(addDays(thisWeek(), -7)); // last seen: last week
    persist(s);

    render(<App />);
    expect(screen.getByText(/last week wrapped up/i)).toBeTruthy();

    // The offer is an offer. Nothing was relocated or marked while we were away.
    const savedTask = readSaved().tasks.find((x) => x.title === 'Unfinished');
    expect(savedTask.completion).toBeNull();
    expect(savedTask.history.carriedCount).toBe(0);
    expect(new Date(savedTask.startTime).getTime()).toBe(t.startTime.getTime());
  });

  it('"Not now" is a real answer — it does not come back', () => {
    const s = new Schedule({ config: defaultConfig });
    s.markWeekSeen(addDays(thisWeek(), -7));
    persist(s);

    render(<App />);
    fireEvent.click(screen.getByText(/not now/i));
    expect(screen.queryByText(/last week wrapped up/i)).toBeNull();

    // The week is recorded as seen, so a reload does not re-ask.
    expect(readSaved().lastSeenWeek).toBe(dateKey(thisWeek()));
  });

  it('reading the offer opens the report for the week that closed, not this one', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = new Task({ title: 'Last week thing', startTime: at(-6, 9), endTime: at(-6, 10) });
    t.completion = 'done';
    s.tasks.push(t);
    s.markWeekSeen(addDays(thisWeek(), -7));
    persist(s);

    render(<App />);
    fireEvent.click(screen.getByText(/read the wrap report/i));
    expect(screen.getByText('Last week thing')).toBeTruthy();
  });
});

describe('regression — "I tried to schedule a break for today and it scheduled for Monday"', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  it('adds a task into today, not into Monday’s leftover gap', () => {
    // The panel used to search from the week's Monday with the UNSCORED
    // findFreeSlot and hand back the first gap it saw — two days gone by
    // Wednesday. Now it starts from "now" and lets scored placement decide.
    const now = new Date();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);

    render(<App />);
    fireEvent.click(screen.getByLabelText('Add task'));
    const panel = document.querySelector('.panel');
    fireEvent.change(within(panel).getByPlaceholderText(/call plumber/i), { target: { value: 'Break' } });
    fireEvent.click(within(panel).getByText(/add to the week/i));

    const added = readSaved().tasks.find((x) => x.title === 'Break');
    expect(added).toBeTruthy();
    // Whatever slot it picked, it is not in hours that have already gone.
    expect(new Date(added.startTime).getTime()).toBeGreaterThanOrEqual(todayStart);
  });
});

describe('deadline buffer — facts, never a verdict', () => {
  const MON = weekStartOf(new Date(2026, 6, 13)); // Monday 2026-07-13
  const on = (offset, h) => { const d = addDays(MON, offset); d.setHours(h, 0, 0, 0); return d; };

  it('reports how close the week\'s deadlined work ran, and which bucket ran closest', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'School', tags: ['study'] });
    s.addBucket({ label: 'Chores', tags: ['home'] });
    // essay: finished Wed 17:00, due Wed 20:00 → 3h to spare (close)
    const essay = s.addFixed({ title: 'Essay', tags: ['study'], startTime: on(2, 15), endTime: on(2, 17) });
    essay.deadline = on(2, 20); essay.completion = 'done';
    // dishes: finished Mon 10:00, due Fri 20:00 → days of buffer (roomy)
    const dishes = s.addFixed({ title: 'Dishes', tags: ['home'], startTime: on(0, 9), endTime: on(0, 10) });
    dishes.deadline = on(4, 20); dishes.completion = 'done';

    const d = buildWrapReport(s, MON).stats.deadlines;
    expect(d.count).toBe(2);
    expect(d.closeCount).toBe(1); // only the essay was under a day
    expect(d.tightest.title).toBe('Essay');
    expect(d.closestBucket.label).toBe('School'); // School ran closest to the wire
  });

  it('is absent when nothing carried a deadline', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFixed({ title: 'Walk', tags: ['x'], startTime: on(0, 9), endTime: on(0, 10) });
    t.completion = 'done';
    expect(buildWrapReport(s, MON).stats.deadlines.count).toBe(0);
  });
});
