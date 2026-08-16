// Two silent drops, both found by audit on 2026-08-14.
//
//   1. `buildOccurrence` rebuilds a session field by field and did not carry
//      `load`, so every recurring task with a per-task override fell back to
//      its bucket and the energy battery read a fraction of the real drain.
//   2. `resizeChunk` clamped to a 15-minute floor and never to the project's own
//      `chunking.maxChunk`, so a drag could silently exceed the maximum sitting
//      the user had stated.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, Bucket, defaultConfig, resetIds,
  weekStart as weekStartOf, addDays, energyBudget, loadForTask, resizeChunk, addProject,
} from '../src/core/index.js';

const MON = weekStartOf(new Date(2026, 10, 23));
const at = (o, h) => { const d = addDays(MON, o); d.setHours(h, 0, 0, 0); return d; };

const seed = () => {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  // A bucket the tag matches, with a MILDER load than the task's own override —
  // so falling back to it is measurable rather than merely different.
  s.buckets.push(new Bucket({
    label: 'Exercise', tags: ['gym'],
    load: { mental: 0, physical: 0.5, social: 0, creative: 0 },
  }));
  return s;
};

describe('a recurring session keeps its own load', () => {
  const withLoad = (s, recurring) => {
    const t = new Task({
      title: 'Gym', tags: ['gym'], type: 'fixed',
      startTime: at(0, 9), endTime: at(0, 11), // 2 hours
      load: { mental: 0, physical: 2, social: 0, creative: 0 },
      ...(recurring ? {
        recurrence: {
          periods: [{ windows: [{ day: 'mon', start: '09:00', end: '11:00' }], interval: 1, effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
          anchorDate: new Date(2026, 8, 1), exceptions: [],
        },
      } : {}),
    });
    s.tasks.push(t);
    return t;
  };

  it('carries the override onto the materialized session', () => {
    const s = seed();
    withLoad(s, true);
    const occ = s.getTasksForWeek(MON).find((t) => t.title === 'Gym');
    expect(occ).toBeTruthy();
    expect(occ.isOccurrence).toBe(true);
    // It used to be null here, and only here.
    expect(occ.load).toMatchObject({ physical: 2 });
    expect(loadForTask(s, occ)).toMatchObject({ physical: 2 });
  });

  it('reads the SAME drain whether or not the task repeats', () => {
    const once = seed(); withLoad(once, false);
    const repeats = seed(); withLoad(repeats, true);

    const a = energyBudget(once, at(0, 12)).physical;
    const b = energyBudget(repeats, at(0, 12)).physical;
    // 2 hours at +2 = 4. Falling back to the bucket gave 2h at +0.5 = 1 — a
    // quarter of the truth, with nothing on screen to say so.
    expect(a.net).toBeCloseTo(4, 6);
    expect(b.net).toBeCloseTo(a.net, 6);
    expect(b.low).toBeCloseTo(a.low, 6);
  });

  it('still inherits the bucket when the task has no override', () => {
    const s = seed();
    const t = new Task({
      title: 'Gym', tags: ['gym'], type: 'fixed',
      startTime: at(0, 9), endTime: at(0, 11),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '09:00', end: '11:00' }], interval: 1, effectiveFrom: new Date(2026, 8, 1), effectiveUntil: null }],
        anchorDate: new Date(2026, 8, 1), exceptions: [],
      },
    });
    s.tasks.push(t);
    const occ = s.getTasksForWeek(MON).find((x) => x.title === 'Gym');
    expect(occ.load).toBeNull();
    expect(loadForTask(s, occ)).toMatchObject({ physical: 0.5 }); // the bucket's
  });

  it('carries activityId, so a session remembers where it came from', () => {
    const s = seed();
    const t = withLoad(s, true);
    t.activityId = 'gym-session';
    const occ = s.getTasksForWeek(MON).find((x) => x.title === 'Gym');
    expect(occ.activityId).toBe('gym-session');
  });
});

describe('resizeChunk does NOT clamp to maxChunk — the hand wins (R-1)', () => {
  // HANDOFF item 3, decided 2026-08-15. `resizeChunk` sets placedBy 'user', so
  // it IS the hand, and R-1 gives a manual action its autonomy: automatic
  // re-optimizing carries the guarantees, a drag does not have to. `maxChunk` is
  // what you told the SLICER; it is not a cage around your own mouse.
  //
  // The alternative was tried and reverted within the hour: clamping broke
  // `tests/projects.test.js`, which asserts a 120-max chunk growing to 180 — so
  // the behaviour was already intended and already written down.
  const project = () => {
    const s = seed();
    const { parent } = addProject(s, {
      title: 'Thesis', tags: ['study'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const child = s.tasks.find((t) => t.parentId === parent.id);
    return { s, child };
  };

  it('lets you make a sitting longer than you said you could sit for', () => {
    const { s, child } = project();
    expect(child).toBeTruthy();
    resizeChunk(s, child.id, 300);
    expect(child.getDuration()).toBe(300);
    // ...and it is recorded as YOURS, which is what stops the scheduler undoing
    // it on the next pass.
    expect(child.placedBy).toBe('user');
  });

  it('still honours the 15-minute floor, which is physics not preference', () => {
    const { s, child } = project();
    resizeChunk(s, child.id, 5);
    expect(child.getDuration()).toBe(15);
  });
});

describe('a project does not lay chunks into time that has gone', () => {
  // Reported 2026-08-15: "Projects can be scheduled before the current time."
  // `placeTask`'s past-placement guard is relative to the `from` it is handed,
  // and `redistribute` handed it `range.from` — so a project whose range began
  // on Monday laid chunks on Monday and Tuesday when it was already Wednesday.
  const WED_NOON = (() => { const d = addDays(MON, 2); d.setHours(12, 0, 0, 0); return d; })();

  const projectFromMonday = (now) => {
    const s = seed();
    const { parent, children } = addProject(s, {
      title: 'Thesis', tags: ['study'], now,
      chunking: { totalMinutes: 300, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    return { s, parent, children };
  };

  it('places nothing before now when the range is already underway', () => {
    const { children } = projectFromMonday(WED_NOON);
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      expect(c.startTime.getTime()).toBeGreaterThanOrEqual(WED_NOON.getTime());
    }
  });

  it('still lays out from the project’s own start when it has not begun', () => {
    // A project starting next month must not be dragged forward to today.
    const s = seed();
    const future = addDays(MON, 30);
    const { children } = addProject(s, {
      title: 'Later', tags: ['study'], now: MON,
      chunking: { totalMinutes: 120, minChunk: 60, maxChunk: 120, range: { from: future, until: addDays(future, 5) } },
    });
    for (const c of children) {
      expect(c.startTime.getTime()).toBeGreaterThanOrEqual(future.getTime());
    }
  });

  it('conserves the total either way', () => {
    const { s, parent } = projectFromMonday(WED_NOON);
    const total = s.tasks
      .filter((t) => t.parentId === parent.id)
      .reduce((n, t) => n + t.getDuration(), 0);
    expect(total).toBe(300);
  });
});
