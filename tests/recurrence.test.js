import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { expandRecurrence, addException, splitPeriod, temporaryChange } from '../src/core/recurrence.js';
import { defaultConfig } from '../src/core/config.js';
import { addDays, dateKey } from '../src/core/time.js';

const W0 = new Date(2026, 6, 13, 0, 0, 0, 0); // Monday
const W1 = addDays(W0, 7);
const W2 = addDays(W0, 14);

function gymTask() {
  return new Task({
    title: 'Gym',
    type: 'fixed',
    tags: ['sports'],
    startTime: new Date(2026, 6, 13, 18, 0, 0, 0),
    endTime: new Date(2026, 6, 13, 19, 0, 0, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'mon', start: '18:00', end: '19:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
      anchorDate: W0,
      exceptions: [],
    },
  });
}

describe('§4 recurrence', () => {
  beforeEach(() => resetIds());

  it('materializes virtual occurrences with identity taskId@date', () => {
    const t = gymTask();
    const occs = expandRecurrence(t, W0);
    expect(occs.length).toBe(1);
    expect(occs[0].id).toBe(`${t.id}@${dateKey(W0)}`);
    expect(occs[0].isOccurrence).toBe(true);
    expect(occs[0].startTime.getHours()).toBe(18);
  });

  it('4A — skip exception omits one occurrence, keeps the pattern', () => {
    const t = gymTask();
    addException(t, dateKey(W0), 'skip');
    expect(expandRecurrence(t, W0).length).toBe(0);
    expect(expandRecurrence(t, W1).length).toBe(1); // pattern intact next week
  });

  it('4C — move exception relocates a single occurrence (pattern untouched)', () => {
    const t = gymTask();
    addException(t, dateKey(W0), 'move', { start: '08:00', end: '09:00' });
    const occ = expandRecurrence(t, W0)[0];
    expect(occ.startTime.getHours()).toBe(8);
    // Next week still the pattern time.
    expect(expandRecurrence(t, W1)[0].startTime.getHours()).toBe(18);
    // occurrenceData / exceptions never mutated the pattern windows.
    expect(t.recurrence.periods[0].windows[0].start).toBe('18:00');
  });

  it('4C — dropping onto an occurrence opens the occurrence menu (no silent default)', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = gymTask();
    s.tasks.push(t);
    const appt = new Task({ title: 'Appointment', type: 'fixed', startTime: new Date(2026, 6, 13, 18, 0), endTime: new Date(2026, 6, 13, 19, 0) });
    s.tasks.push(appt);
    const res = s.resolveDropConflicts(appt);
    expect(res.occurrenceMenu).toBe(true);
    expect(res.options).toEqual(['move', 'skip', 'cancel']);
  });

  it('4D — every-other-week via interval + anchorDate parity', () => {
    const t = gymTask();
    t.recurrence.periods[0].interval = 2;
    expect(expandRecurrence(t, W0).length).toBe(1); // week 0 → parity 0
    expect(expandRecurrence(t, W1).length).toBe(0); // week 1 → parity 1
    expect(expandRecurrence(t, W2).length).toBe(1); // week 2 → parity 0
  });

  it('4B — permanent period split "from now on"', () => {
    const t = gymTask();
    splitPeriod(t, W2, [{ day: 'mon', start: '08:00', end: '09:00' }]);
    expect(expandRecurrence(t, W0)[0].startTime.getHours()).toBe(18); // before split
    expect(expandRecurrence(t, W2)[0].startTime.getHours()).toBe(8); // after split
  });

  it('4E — temporary change builds a period sandwich', () => {
    const t = gymTask();
    // Summer only: from W1 until W2, +2h.
    temporaryChange(t, W1, W2, [{ day: 'mon', start: '20:00', end: '21:00' }]);
    expect(expandRecurrence(t, W0)[0].startTime.getHours()).toBe(18); // normal before
    expect(expandRecurrence(t, W1)[0].startTime.getHours()).toBe(20); // temp during
    expect(expandRecurrence(t, W2)[0].startTime.getHours()).toBe(18); // normal after
  });

  it('occurrenceData isolates per-occurrence lived data', () => {
    const t = gymTask();
    t.occurrenceData[dateKey(W0)] = { completion: 'done', satisfaction: { overall: 5 }, history: { moveCount: 0, displacedCount: 0, rippleCount: 0, carriedCount: 0 } };
    const occ0 = expandRecurrence(t, W0)[0];
    const occ1 = expandRecurrence(t, W1)[0];
    expect(occ0.completion).toBe('done');
    expect(occ1.completion).toBe(null); // isolated
  });
});
