// `task.energyAt` — the four-axis reserve a task was BEGUN under, snapshotted
// when it is rated (WEEKLY-PLANNING, the learning extension).
//
// Why it has to be recorded rather than derived: to learn "I rated that badly
// because I was already drained", the model needs the reserve as it was THEN.
// Recomputing it later from the current schedule would train on a day that
// never happened — tasks have since been added, moved and deleted. `dayFill`
// has sat dead in `featureVector` for exactly this reason; this is the fix for
// that class of problem, and it is the long pole, because every week used
// without it is training data that cannot be recovered.
import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { addDays, weekStart } from '../src/core/time.js';

const MON = weekStart(new Date(2026, 5, 1)); // Mon 1 Jun 2026
const at = (day, h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0, 0);

/** A schedule whose tags carry real load: study drains, gym restores. */
function loaded() {
  const s = new Schedule();
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, physical: 0, social: 0, creative: 1 } });
  s.addBucket({ label: 'Gym', tags: ['gym'], load: { mental: -2, physical: 3, social: 0, creative: 0 } });
  return s;
}

describe('when the snapshot is taken', () => {
  beforeEach(() => resetIds());

  it('is recorded the moment a task is rated', () => {
    const s = loaded();
    const t = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    expect(t.energyAt).toBeNull();

    s.updateTask(t.id, { satisfaction: { overall: 4 } });
    expect(t.energyAt).toBeTruthy();
    expect(Object.keys(t.energyAt).sort()).toEqual(['creative', 'mental', 'physical', 'social']);
  });

  it('is NOT recorded for a task that has merely been completed', () => {
    const s = loaded();
    const t = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(t.id, { completion: 'done' });
    expect(t.energyAt).toBeNull(); // no opinion given, nothing to explain
  });

  it('captures the state you ARRIVED in, not the state the task left you in', () => {
    // Otherwise cause and effect are conflated and the feature learns nothing:
    // every rated study block would look "drained" purely because it drains.
    const s = loaded();
    const solo = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(solo.id, { satisfaction: { overall: 4 } });
    expect(solo.energyAt.mental).toBe(0); // nothing preceded it — it began fresh
  });

  it('reflects a hard morning when one happened', () => {
    const s = loaded();
    for (const h of [8, 10, 12]) {
      s.addFixed({ title: `am ${h}`, startTime: at(MON, h), endTime: at(MON, h + 2), tags: ['study'] });
    }
    const pm = s.addFixed({ title: 'Study pm', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(pm.id, { satisfaction: { overall: 2 } });
    expect(pm.energyAt.mental).toBeLessThan(0);
  });

  it('is written ONCE — changing your mind does not rewrite the day', () => {
    const s = loaded();
    const t = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(t.id, { satisfaction: { overall: 2 } });
    const first = { ...t.energyAt };

    // Pile work in afterwards and re-rate: the reserve you were under then has
    // not changed just because your opinion or your schedule has.
    s.addFixed({ title: 'Later', startTime: at(MON, 8), endTime: at(MON, 14), tags: ['study'] });
    s.updateTask(t.id, { satisfaction: { overall: 5 } });
    expect(t.energyAt).toEqual(first);
  });

  it('every task has a start time, so the snapshot always has an anchor', () => {
    // Worth locking rather than assuming: `Task` defaults startTime to "now"
    // when omitted (Task.js), so there is no such thing as a task without one.
    // A guard for "no start time" would be dead code, and the snapshot can
    // always be taken. What stops a merely-created task acquiring one is that
    // nothing rates it — covered above.
    const t = new Task({ title: 'Unplaced', type: 'flexible', durationMin: 60 });
    expect(t.startTime).toBeInstanceOf(Date);
    expect(t.energyAt).toBeNull(); // unrated, so still nothing recorded
  });
});

describe('it survives the round trip', () => {
  beforeEach(() => resetIds());

  it('is written by toJSON AND read by the constructor', () => {
    // A field present in only one of the two is silently dropped — exactly how
    // `freq` was lost from recurrence periods and `snapshots` from an import.
    const s = loaded();
    const t = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(t.id, { satisfaction: { overall: 4 } });

    const round = new Task(JSON.parse(JSON.stringify(t.toJSON())));
    expect(round.energyAt).toEqual(t.energyAt);
  });

  it('is absent, not undefined, on a task that was never rated', () => {
    expect(new Task({ title: 'x' }).toJSON().energyAt).toBeNull();
  });
});

describe('the feature carries signal — synthetic weeks with a planted rule', () => {
  beforeEach(() => resetIds());

  it('separates a drained start from a fresh one across 8 weeks', () => {
    // The hidden rule: a brutal morning, then the same afternoon study block.
    // If the snapshot cannot distinguish those two worlds, the whole learning
    // extension is not worth building — so this is the go/no-go check.
    const s = loaded();
    const drained = [];
    const fresh = [];

    for (let d = 0; d < 56; d++) {
      const day = addDays(MON, d);
      const heavyMorning = d % 2 === 0; // deterministic, no Math.random
      if (heavyMorning) {
        for (const h of [8, 10, 12]) {
          s.addFixed({ title: `am ${d}-${h}`, startTime: at(day, h), endTime: at(day, h + 2), tags: ['study'] });
        }
      } else {
        s.addFixed({ title: `gym ${d}`, startTime: at(day, 9), endTime: at(day, 10), tags: ['gym'] });
      }
      const pm = s.addFixed({ title: `pm ${d}`, startTime: at(day, 15), endTime: at(day, 17), tags: ['study'] });
      s.updateTask(pm.id, { satisfaction: { overall: heavyMorning ? 2 : 5 } });
      (heavyMorning ? drained : fresh).push(pm.energyAt.mental);
    }

    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(drained.length).toBe(28);
    expect(fresh.length).toBe(28);
    expect(avg(drained)).toBeLessThan(avg(fresh)); // the signal is there
    expect(avg(fresh) - avg(drained)).toBeGreaterThan(5); // and it is not marginal
  });

  it('measures depletion only — the reserve caps at full, so "fresh" is 0', () => {
    // Worth locking: the battery cannot bank credit, so a well-rested start and
    // a gym-restored start are indistinguishable at 0. The feature answers "how
    // drained was I", never "how rested was I". Anything reading it as a
    // two-sided scale is reading it wrong.
    const s = loaded();
    s.addFixed({ title: 'Gym', startTime: at(MON, 9), endTime: at(MON, 12), tags: ['gym'] });
    const pm = s.addFixed({ title: 'Study', startTime: at(MON, 15), endTime: at(MON, 17), tags: ['study'] });
    s.updateTask(pm.id, { satisfaction: { overall: 5 } });
    expect(pm.energyAt.mental).toBe(0); // restored, but never above full
  });
});
