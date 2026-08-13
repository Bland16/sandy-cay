// design/RATINGS-AND-LEARNING.md — a rating on a recurring session must reach
// the model. Before this, twelve rated sessions trained nothing.
import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/Schedule.js';
import { energyCalibration } from '../src/core/energy.js';
// Weeks advance with addDays, never `+ 7 * 86400000`. Twelve weeks from
// September crosses the 1 November DST change, and millisecond arithmetic loses
// an hour there — which silently dropped one week's occurrence when this test
// was first written.
import { addDays } from '../src/core/time.js';

const MON = new Date(2026, 8, 7, 0, 0, 0, 0);
const D = (d, h, mi = 0) => new Date(2026, 8, d, h, mi, 0, 0);

function withGym() {
  const s = new Schedule({});
  const gym = s.addFixed({
    title: 'Gym', tags: ['gym'],
    startTime: D(8, 7, 0), endTime: D(8, 8, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'tue', start: '07:00', end: '08:00' }], interval: 1, effectiveFrom: MON }],
      anchorDate: MON, exceptions: [],
    },
  });
  return { s, gym };
}

/** Rate N weeks of sessions through the real door. */
function rateWeeks(s, n, patch) {
  let ws = new Date(MON);
  let count = 0;
  for (let w = 0; w < n; w++) {
    for (const occ of s.getTasksForWeek(ws).filter((t) => t.isOccurrence)) {
      s.rateOccurrence(occ, patch);
      count += 1;
    }
    ws = addDays(ws, 7);
  }
  return count;
}

describe('ratedSamples — the one door', () => {
  it('THE REGRESSION: rated recurring sessions reach retrain()', () => {
    const { s } = withGym();
    const n = rateWeeks(s, 12, { completion: 'done', satisfaction: { overall: 4, timingFit: 1 } });
    expect(n).toBe(12);
    expect(s.retrain()).toBe(12); // was 0
  });

  it('still counts ordinary rated tasks', () => {
    const s = new Schedule({});
    const t = s.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 60 });
    s.updateTask(t.id, { completion: 'done', satisfaction: { overall: 4 } });
    expect(s.retrain()).toBe(1);
  });

  it('a session sample carries ITS OWN time, not the parent pattern time', () => {
    const { s } = withGym();
    rateWeeks(s, 3, { completion: 'done', satisfaction: { overall: 5 } });
    const samples = s.ratedSamples().filter((x) => x.isOccurrence);
    expect(samples).toHaveLength(3);
    const days = samples.map((x) => x.startTime.getDate()).sort((a, b) => a - b);
    expect(new Set(days).size).toBe(3); // three distinct dates, not one repeated
    for (const x of samples) expect(x.startTime.getHours()).toBe(7);
  });

  it('energy calibration reaches "calibrated" from recurring ratings alone', () => {
    const { s } = withGym();
    expect(energyCalibration(s).calibrated).toBe(false);
    rateWeeks(s, 4, { completion: 'done', satisfaction: { overall: 4, energy: 1 } });
    const cal = energyCalibration(s);
    expect(cal.weeksRated).toBeGreaterThanOrEqual(3);
    expect(cal.calibrated).toBe(true);
  });

  it('stamps the rating context once, and a re-rating does not overwrite it', () => {
    const { s, gym } = withGym();
    const occ = s.getTasksForWeek(MON).find((t) => t.isOccurrence);
    s.rateOccurrence(occ, { completion: 'done', satisfaction: { overall: 2 } });
    const first = s.tasks.find((t) => t.id === gym.id).occurrenceData[occ.occurrenceDate];
    expect(first.at).toBeInstanceOf(Date);
    expect(first.dayFill).toBeTypeOf('number');
    const stampedAt = new Date(first.at).getTime();
    s.rateOccurrence(occ, { satisfaction: { overall: 5 } });
    const second = s.tasks.find((t) => t.id === gym.id).occurrenceData[occ.occurrenceDate];
    expect(new Date(second.at).getTime()).toBe(stampedAt);
    expect(second.satisfaction.overall).toBe(5); // the opinion updates
  });

  it('an UNSTAMPED legacy rating is skipped, not guessed at', () => {
    const { s, gym } = withGym();
    const parent = s.tasks.find((t) => t.id === gym.id);
    parent.occurrenceData = { '2026-09-08': { completion: 'done', satisfaction: { overall: 5 } } };
    expect(s.ratedSamples().filter((x) => x.isOccurrence)).toHaveLength(0);
    expect(s.retrain()).toBe(0);
  });

  it('round-trips through JSON — stamped entries survive and still train', () => {
    const { s } = withGym();
    rateWeeks(s, 12, { completion: 'done', satisfaction: { overall: 4 } });
    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(revived.retrain()).toBe(12);
  });

  it('dayFill is stamped for an ordinary task too, and is written once', () => {
    const s = new Schedule({});
    const t = s.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 60 });
    expect(t.dayFillAtCompletion).toBeNull();
    s.updateTask(t.id, { satisfaction: { overall: 3 } });
    const first = t.dayFillAtCompletion;
    expect(first).toBeTypeOf('number');
    s.addFlexible({ title: 'More', durationMin: 240 });
    s.updateTask(t.id, { satisfaction: { overall: 5 } });
    expect(t.dayFillAtCompletion).toBe(first);
  });
});
