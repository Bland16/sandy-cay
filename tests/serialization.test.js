import { describe, it, expect, beforeEach } from 'vitest';
import { Task, Zone, Schedule, resetIds, seed } from '../src/core/index.js';
import { addDays, dateKey } from '../src/core/time.js';

const W0 = new Date(2026, 6, 13, 0, 0, 0, 0);

describe('§9 round-trip serialization', () => {
  beforeEach(() => resetIds());

  it('Task with recurrence + occurrenceData + chunking round-trips', () => {
    const t = new Task({
      title: 'Complex',
      tags: ['study', 'work'],
      priority: 4,
      startTime: new Date(2026, 6, 13, 9, 0),
      endTime: new Date(2026, 6, 13, 10, 30),
      deadline: new Date(2026, 6, 15, 8, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '09:00', end: '10:30' }], interval: 2, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [{ date: dateKey(W0), action: 'move', start: '11:00', end: '12:30' }],
      },
      occurrenceData: { [dateKey(W0)]: { completion: 'done', satisfaction: { overall: 5, timingFit: 1, durationFit: 0, energy: 1 }, history: { moveCount: 1, displacedCount: 0, rippleCount: 0, carriedCount: 0 } } },
    });
    const json = JSON.parse(JSON.stringify(t.toJSON()));
    const back = Task.fromJSON(json);
    expect(back.toJSON()).toEqual(t.toJSON());
    expect(back.recurrence.periods[0].interval).toBe(2);
    expect(back.occurrenceData[dateKey(W0)].satisfaction.overall).toBe(5);
    expect(json.schemaVersion).toBe(1);
  });

  it('Zone round-trips', () => {
    const z = new Zone({ label: 'Study', matchTags: ['study'], windows: [{ day: 'tue', start: '18:00', end: '21:00' }], exclusive: true });
    const back = Zone.fromJSON(JSON.parse(JSON.stringify(z.toJSON())));
    expect(back.toJSON()).toEqual(z.toJSON());
  });

  it('full Schedule (tasks, zones, config, model weights) round-trips deep-equal', () => {
    const s = seed(W0);
    // Train the model so weights are non-trivial.
    for (let i = 0; i < 10; i += 1) {
      const t = s.addFlexible({ title: `r${i}`, tags: ['study'], startTime: new Date(2026, 6, 13, 9, 0), endTime: new Date(2026, 6, 13, 10, 0) });
      t.satisfaction = { overall: 5, timingFit: 0, durationFit: 0, energy: 0 };
    }
    s.retrain();
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    const back = Schedule.fromJSON(json);
    const reJson = JSON.parse(JSON.stringify(back.toJSON()));
    expect(reJson.tasks.length).toBe(json.tasks.length);
    expect(reJson.zones).toEqual(json.zones);
    expect(reJson.model.weights).toEqual(json.model.weights);
    expect(reJson.model.sampleCount).toBe(10);
    expect(reJson.schemaVersion).toBe(1);
  });
});

describe('task ids stay unique across reloads (duplicate-id bug)', () => {
  const D = (d, h) => new Date(2026, 6, d, h, 0, 0, 0);

  it('a same-titled task added after a reload does not collide with a saved one', () => {
    resetIds();
    const morning = new Schedule({ config: undefined });
    const m = morning.addFixed({ title: 'Work on website', startTime: D(17, 9), endTime: D(17, 11) });
    const saved = JSON.parse(JSON.stringify(morning.toJSON()));

    resetIds(); // the id counter resets on every page load
    const afternoon = Schedule.fromJSON(saved);
    const a = afternoon.addFixed({ title: 'Work on website', startTime: D(17, 13), endTime: D(17, 14) });

    expect(a.id).not.toBe(m.id);
    expect(new Set(afternoon.tasks.map((t) => t.id)).size).toBe(afternoon.tasks.length);

    // Editing the second must not touch the first.
    afternoon.updateTask(a.id, { endTime: D(17, 15) });
    expect(afternoon.tasks[0].endTime.getHours()).toBe(11); // morning untouched
    expect(afternoon.tasks[1].endTime.getHours()).toBe(15); // afternoon extended
  });

  it('repairs a save that already has two tasks sharing an id', () => {
    const corrupt = {
      schemaVersion: 1,
      tasks: [
        { id: 'work-on-website-0001', title: 'Work on website', type: 'fixed', startTime: D(17, 9).getTime(), endTime: D(17, 11).getTime() },
        { id: 'work-on-website-0001', title: 'Work on website', type: 'fixed', startTime: D(17, 13).getTime(), endTime: D(17, 14).getTime() },
      ],
    };
    const s = Schedule.fromJSON(corrupt);
    expect(new Set(s.tasks.map((t) => t.id)).size).toBe(2);
  });
});
