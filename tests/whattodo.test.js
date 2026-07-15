import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds, currentOpening } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const D = (offset, h, mi = 0) => new Date(2026, 6, 13 + offset, h, mi, 0, 0);

describe('§6 whatToDo (cold start)', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('ranks by urgency/fit/priority, returns ≤3 with reasons', () => {
    s.addFlexible({ title: 'Low', priority: 1, startTime: D(0, 11), endTime: D(0, 12) });
    s.addFlexible({ title: 'Due tomorrow', priority: 3, startTime: D(0, 13), endTime: D(0, 14), deadline: D(1, 12) });
    s.addFlexible({ title: 'High', priority: 5, startTime: D(0, 14), endTime: D(0, 15) });
    s.addFlexible({ title: 'Other', priority: 2, startTime: D(0, 15), endTime: D(0, 16) });

    const now = D(0, 9, 0);
    const picks = s.whatToDo(now);
    expect(picks.length).toBeLessThanOrEqual(3);
    expect(picks.length).toBeGreaterThan(0);
    // Every pick carries at least one reason derived from scoring terms.
    for (const p of picks) expect(p.reasons.length).toBeGreaterThan(0);
    // Scores are sorted descending.
    for (let i = 1; i < picks.length; i += 1) expect(picks[i - 1].score).toBeGreaterThanOrEqual(picks[i].score);
  });

  it('a schedulingWarning task floats to the top', () => {
    const warn = s.addFlexible({ title: 'Parked', priority: 1, startTime: D(0, 16), endTime: D(0, 17) });
    warn.schedulingWarning = true;
    s.addFlexible({ title: 'Normal', priority: 3, startTime: D(0, 12), endTime: D(0, 13) });
    const picks = s.whatToDo(D(0, 9));
    expect(picks[0].task.id).toBe(warn.id);
  });

  it('the opening is clamped to the day window — 00:50 is not a 7-hour opening', () => {
    // Window is Mon–Fri 08:00–18:00; nothing else scheduled.
    const open = currentOpening(s, D(0, 0, 50));
    expect(open).not.toBeNull();
    // Starts at the window, not at 00:50, and is flagged as not-yet-open.
    expect(open.start.getHours()).toBe(8);
    expect(open.startsLater).toBe(true);
    expect(open.minutes).toBe(600); // 08:00 → 18:00
  });

  it('no opening once the day window has closed', () => {
    expect(currentOpening(s, D(0, 23, 30))).toBeNull();
  });

  it('the opening stops at the next task and steps past one in progress', () => {
    s.addFixed({ title: 'Standup', startTime: D(0, 9), endTime: D(0, 9, 30) });
    s.addFixed({ title: 'Later', startTime: D(0, 11), endTime: D(0, 12) });
    // 09:15 is inside Standup → the opening starts when it ends, and runs to 11:00.
    const open = currentOpening(s, D(0, 9, 15));
    expect(open.start.getHours()).toBe(9);
    expect(open.start.getMinutes()).toBe(30);
    expect(open.minutes).toBe(90);
    expect(open.nextTask.title).toBe('Later');
  });

  it('never suggests an anchor scheduled elsewhere (you cannot do Thursday\'s dentist now)', () => {
    s.addFixed({ title: 'Dentist', startTime: D(3, 14), endTime: D(3, 15) });
    s.addFlexible({ title: 'Movable', priority: 3, startTime: D(0, 15), endTime: D(0, 16) });
    const titles = s.whatToDo(D(0, 13)).map((p) => p.task.title);
    expect(titles).not.toContain('Dentist');
    expect(titles).toContain('Movable');
  });

  it('an anchor happening right now IS a valid pick', () => {
    s.addFixed({ title: 'On now', startTime: D(0, 13), endTime: D(0, 14) });
    const picks = s.whatToDo(D(0, 13, 20));
    expect(picks[0].task.title).toBe('On now');
    expect(picks[0].reasons).toContain('happening now');
  });

  it('tags narrow the candidates ("what should I do in study mode?")', () => {
    s.addFlexible({ title: 'Essay', tags: ['study'], priority: 3, startTime: D(0, 15), endTime: D(0, 16) });
    s.addFlexible({ title: 'Nap', tags: ['rest'], priority: 3, startTime: D(0, 16), endTime: D(0, 17) });
    const titles = s.whatToDo(D(0, 13), { tags: ['study'] }).map((p) => p.task.title);
    expect(titles).toEqual(['Essay']);
  });
});

describe('§6 whatToDo sees the session you are in', () => {
  beforeEach(() => { resetIds(); });

  it('a recurring session happening right now IS an answer to "what now?"', () => {
    // Recurring work lives in virtual occurrences, which are never in
    // schedule.tasks — so filtering the pattern out also hid the seminar you
    // are literally sitting in.
    const s = new Schedule({ config: defaultConfig });
    const sem = s.addFixed({ title: 'Seminar', startTime: D(0, 13), endTime: D(0, 15) });
    sem.recurrence = {
      periods: [{ windows: [{ day: 'mon', start: '13:00', end: '15:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
      anchorDate: MON,
      exceptions: [],
    };
    const picks = s.whatToDo(D(0, 13, 30)); // you are in it
    expect(picks[0].task.title).toBe('Seminar');
    expect(picks[0].reasons).toContain('happening now');
  });

  it('but a recurring session on another day is still not an answer', () => {
    const s = new Schedule({ config: defaultConfig });
    const sem = s.addFixed({ title: 'Seminar', startTime: D(0, 13), endTime: D(0, 15) });
    sem.recurrence = {
      periods: [{ windows: [{ day: 'mon', start: '13:00', end: '15:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
      anchorDate: MON,
      exceptions: [],
    };
    s.addFlexible({ title: 'Movable', priority: 3, startTime: D(0, 16), endTime: D(0, 17) });
    const titles = s.whatToDo(D(0, 10)).map((p) => p.task.title); // 10:00, seminar is at 13:00
    expect(titles).not.toContain('Seminar');
    expect(titles).toContain('Movable');
  });
});
