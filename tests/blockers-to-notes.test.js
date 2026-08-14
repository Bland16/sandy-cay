// Whole-day blocker TASKS become day NOTES (design/DAY-NOTES.md §1–§2, D-6).
//
// The case this was written for is real: a schedule arrived with its holidays
// modelled as tasks — "No classes", fixed, 08:00–23:00, one per day — so
// Thanksgiving drew as THREE full-height cards standing where the day's actual
// contents belong.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, defaultConfig, resetIds,
  isFullDayBlocker, planBlockerConversion, convertBlockersToDayNotes,
} from '../src/core/index.js';

const at = (y, m, d, hh, mm = 0) => new Date(y, m, d, hh, mm, 0, 0);

/** Their config: the day window was widened to 23:00 in session 8. */
const cfg = () => ({
  ...defaultConfig,
  windows: {
    ...defaultConfig.windows,
    monFri: { ...defaultConfig.windows.monFri, start: '08:00', end: '23:00' },
    sat: { ...defaultConfig.windows.sat, start: '08:00', end: '23:00' },
    sun: { ...defaultConfig.windows.sun, start: '08:00', end: '23:00' },
  },
});

/** A blocker exactly as it appears in the real file. */
const blocker = (s, day, label = 'No classes') => {
  const t = new Task({
    title: label, tags: ['rest'], type: 'fixed', placedBy: 'user',
    startTime: at(2026, 10, day, 8), endTime: at(2026, 10, day, 23),
  });
  s.tasks.push(t);
  return t;
};

const seed = () => { resetIds(); return new Schedule({ config: cfg() }); };

describe('detecting a whole-day blocker', () => {
  it('recognises one by its SPAN, not its title or tag', () => {
    const s = seed();
    const b = blocker(s, 25, 'Anything at all');
    b.tags = [];
    expect(isFullDayBlocker(s, b)).toBe(true);
  });

  it('leaves an ordinary appointment alone', () => {
    const s = seed();
    const cls = new Task({
      title: 'CHEM1109 General Chemistry I', type: 'fixed',
      startTime: at(2026, 10, 25, 9), endTime: at(2026, 10, 25, 10),
    });
    s.tasks.push(cls);
    expect(isFullDayBlocker(s, cls)).toBe(false);
  });

  it('leaves a flexible task alone however long it is', () => {
    const s = seed();
    const t = new Task({
      title: 'Long study', type: 'flexible',
      startTime: at(2026, 10, 25, 8), endTime: at(2026, 10, 25, 23),
    });
    s.tasks.push(t);
    expect(isFullDayBlocker(s, t)).toBe(false);
  });

  it('leaves a recurring session alone — a pattern is not a day fact', () => {
    const s = seed();
    const t = blocker(s, 25);
    t.recurrence = { periods: [], anchorDate: at(2026, 10, 25, 0), exceptions: [] };
    expect(isFullDayBlocker(s, t)).toBe(false);
  });
});

describe('converting', () => {
  it('collapses consecutive same-label days into ONE multi-day note', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26); blocker(s, 27); // Thanksgiving Wed–Fri
    const plan = planBlockerConversion(s);
    // The whole point: three cards become one run, not three marks.
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0]).toMatchObject({ label: 'No classes', from: '2026-11-25', to: '2026-11-27' });
    expect(plan.taskIds).toHaveLength(3);
  });

  it('does not join across a gap, or across a change of label', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26);
    blocker(s, 28);                       // a day's gap
    blocker(s, 29, 'Spring break');       // adjacent, different label
    const plan = planBlockerConversion(s);
    expect(plan.notes.map((n) => [n.label, n.from, n.to])).toEqual([
      ['No classes', '2026-11-25', '2026-11-26'],
      ['No classes', '2026-11-28', '2026-11-28'],
      ['Spring break', '2026-11-29', '2026-11-29'],
    ]);
  });

  it('removes the tasks and adds the notes — the card is what was wrong', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26); blocker(s, 27);
    const cls = new Task({
      title: 'CHEM1109', type: 'fixed',
      startTime: at(2026, 10, 25, 9), endTime: at(2026, 10, 25, 10),
    });
    s.tasks.push(cls);

    const res = convertBlockersToDayNotes(s);
    expect(res).toEqual({ notesAdded: 1, tasksRemoved: 3, daysBlocked: 3 });
    expect(s.tasks.map((t) => t.title)).toEqual(['CHEM1109']); // the class survives
    expect(s.dayNotes).toHaveLength(1);
  });

  it('KEEPS the day unavailable — the card was wrong, the blocking was right', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26); blocker(s, 27);
    convertBlockersToDayNotes(s);
    // A full-window blocker did two jobs: drew a card (wrong) and kept
    // automatic placement off the day (right). Converting must not trade the
    // second away for the first.
    for (const d of [25, 26, 27]) expect(s.isDayBlocked(at(2026, 10, d, 12))).toBe(true);
    expect(s.isDayBlocked(at(2026, 10, 24, 12))).toBe(false);
  });

  it('blocks every day of a multi-day run, not just its first', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26); blocker(s, 27);
    const res = convertBlockersToDayNotes(s);
    expect(res.daysBlocked).toBe(3);
    expect(s.blockedDays).toEqual(['2026-11-25', '2026-11-26', '2026-11-27']);
  });

  it('the note then covers every day it spans — the run the grid draws', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26); blocker(s, 27);
    convertBlockersToDayNotes(s);
    for (const d of [25, 26, 27]) {
      expect(s.notesForDate(at(2026, 10, d, 12)).map((n) => n.label)).toEqual(['No classes']);
    }
    expect(s.notesForDate(at(2026, 10, 24, 12))).toEqual([]);
    expect(s.notesForDate(at(2026, 10, 28, 12))).toEqual([]);
  });

  it('is a no-op on a schedule that has none, and is idempotent', () => {
    const s = seed();
    expect(convertBlockersToDayNotes(s)).toEqual({ notesAdded: 0, tasksRemoved: 0, daysBlocked: 0 });
    blocker(s, 25);
    convertBlockersToDayNotes(s);
    // Running it twice must not duplicate the note or invent a second one.
    expect(convertBlockersToDayNotes(s)).toEqual({ notesAdded: 0, tasksRemoved: 0, daysBlocked: 0 });
    expect(s.dayNotes).toHaveLength(1);
  });

  it('survives a save/load round trip as notes, not tasks', () => {
    const s = seed();
    blocker(s, 25); blocker(s, 26);
    convertBlockersToDayNotes(s);
    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.dayNotes.map((n) => [n.label, n.from, n.to])).toEqual([['No classes', '2026-11-25', '2026-11-26']]);
    expect(back.tasks).toHaveLength(0);
  });
});
