// design/RATINGS-AND-LEARNING.md — a rating on a recurring session must reach
// the model. Before this, twelve rated sessions trained nothing.
import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/Schedule.js';
import { Task } from '../src/core/Task.js';
import { defaultConfig } from '../src/core/config.js';
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

// ════════════════════════════════════════════════════════════════════════════
// THE FOURTH READER. Reported 2026-09-07: "does this take routines into
// consideration because it is pretty inaccurate".
//
// It did not. `ratedSamples()`'s own header says "Two readers, one of them
// forgotten." There were four, and three walked `schedule.tasks` — where a
// recurring session's rating has never lived, because `rateOccurrence` writes it
// to `parent.occurrenceData[date].satisfaction`.
// ════════════════════════════════════════════════════════════════════════════
describe('routine touchpoints are ordinary evidence', () => {
  // Asked for directly, twice. A touchpoint is a plain `Task` carrying
  // `routineId`/`stepIndex` — nothing routes on that field, so it opens the
  // ordinary TaskPanel, its rating block renders unconditionally with the full
  // facet row, and the write goes through `updateTask` where `satisfaction` is
  // whitelisted. It has always counted; this pins it, because the door has been
  // rewritten twice since (a time window, and one-session-one-sample) and either
  // could have dropped them without anything else noticing.
  it('a rated touchpoint reaches the pool and the detector', async () => {
    const { durationFitSuggestion } = await import('../src/core/detectors.js');
    const { RoutineInstance } = await import('../src/core/RoutineInstance.js');
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Rest', tags: ['break'], load: { mental: -1 } });
    const r = new RoutineInstance({
      label: 'Morning out', startTime: MON, travelMin: 10,
      steps: [{ kind: 'task', label: 'Coffee', durationMin: 20 }],
    });
    s.routineInstances.push(r);

    for (let i = 0; i < 6; i += 1) {
      const d = addDays(MON, -i * 3); // inside the evidence window
      const t = new Task({
        title: 'Coffee break', tags: ['break'], type: 'fixed',
        startTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0),
        endTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 20),
        routineId: r.id, stepIndex: 0,
      });
      s.tasks.push(t);
      // Exactly the path TaskPanel takes for a non-occurrence.
      s.updateTask(t.id, { completion: 'done', satisfaction: { overall: 2, durationFit: 1 } });
    }

    const pool = s.ratedSamples({ since: addDays(MON, -56) });
    expect(pool.filter((t) => t.routineId)).toHaveLength(6);

    // ⚠️ THE CONTROL IS THE CASE. "Six samples exist" would pass just as well if
    // the detector ignored them; removing the touchpoints must remove the
    // finding, which is what proves they were the evidence behind it.
    expect(durationFitSuggestion(pool, 'break', defaultConfig))
      .toMatchObject({ suggest: true, count: 6, total: 6 });
    expect(durationFitSuggestion(pool.filter((t) => !t.routineId), 'break', defaultConfig).suggest)
      .toBe(false);
  });
});

describe('one lived session is one sample', () => {
  // ⚠️ A TASK RATED AS A ONE-OFF AND LATER MADE RECURRING WAS COUNTED TWICE. The
  // panel does not clear `satisfaction` when it turns a task into a pattern, so
  // the same evening sat both on the task and in `occurrenceData`, and this door
  // emitted both at the same minute with the same answers:
  //
  //   gym-0001              2026-09-08T18:00  durationFit=1
  //   gym-0001@2026-09-08   2026-09-08T18:00  durationFit=1
  //
  // A single "that ran long" became "2 of 2". Every count built on this door
  // inherited the inflation — which is how a report tells someone their exercise
  // ran long three times out of four when they said it once.
  const ratedOneOff = () => {
    const s = new Schedule({ config: defaultConfig });
    const t = new Task({
      title: 'Gym', tags: ['exercise'], type: 'fixed',
      startTime: new Date(2026, 8, 8, 18, 0), endTime: new Date(2026, 8, 8, 19, 30),
    });
    t.completion = 'done';
    t.satisfaction = { overall: 5, durationFit: 1 };
    s.tasks.push(t);
    return { s, t };
  };
  const makeRecurring = (t, withOccurrenceData) => {
    t.recurrence = {
      freq: 'weekly', interval: 1,
      periods: [{ from: null, until: null, windows: [{ day: 'tue', start: '18:00', end: '19:30' }] }],
      exceptions: [],
    };
    if (withOccurrenceData) {
      t.occurrenceData = {
        '2026-09-08': {
          at: new Date(2026, 8, 8, 18, 0).toISOString(),
          endAt: new Date(2026, 8, 8, 19, 30).toISOString(),
          completion: 'done',
          satisfaction: { overall: 5, durationFit: 1 },
        },
      };
    }
  };

  it('does not count the same evening twice when a one-off becomes a pattern', () => {
    const { s, t } = ratedOneOff();
    expect(s.ratedSamples()).toHaveLength(1);
    makeRecurring(t, true);
    const samples = s.ratedSamples();
    expect(samples).toHaveLength(1);
    // The OCCURRENCE wins, per §4.4 — a recurring session's lived data belongs
    // in occurrenceData, never on the pattern.
    expect(samples[0].isOccurrence).toBe(true);
  });

  // …and the parent's own rating is not thrown away when nothing covers it.
  // It is real evidence, just stored in the older place; dropping every
  // pre-conversion rating would trade a double count for a silent data loss.
  it('keeps a pre-conversion rating that no occurrence covers', () => {
    const { s, t } = ratedOneOff();
    makeRecurring(t, false); // recurrence on, but no occurrenceData yet
    const samples = s.ratedSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].isOccurrence).toBeFalsy();
    expect(samples[0].satisfaction.durationFit).toBe(1);
  });
});

describe('every rated-sample reader goes through the one door', () => {
  it('duration-fit counts recurring sessions', async () => {
    const { durationFitSuggestion } = await import('../src/core/detectors.js');
    const { s } = withGym();
    // Twelve weekly sessions, every one of them "too long".
    //
    // ⚠️ RATED 3, NOT 4, AND THAT MATTERS NOW. The suggestion no longer
    // second-guesses something the user rates well (mean overall ≥
    // `durationFitContentAt`), so a fixture rated 4 would be silenced by THAT
    // rule and stop testing this one — which is about whether recurring sessions
    // reach the detector at all.
    const n = rateWeeks(s, 12, { satisfaction: { durationFit: 1, overall: 3 } });
    expect(n).toBe(12);

    // What the report used to ask, and what it got: nothing at all.
    expect(durationFitSuggestion(s.tasks, 'gym', defaultConfig).suggest).toBe(false);

    const fit = durationFitSuggestion(s.ratedSamples(), 'gym', defaultConfig);
    expect(fit).toMatchObject({ suggest: true, direction: 'shorter', count: 12, total: 12 });
  });

  it('the sentence now states a denominator the reader can check', async () => {
    // ⚠️ The visible half of the bug. With one-offs alone the pools were 3, 4
    // and 5, and the floor was `answered.length < 3` — so TWO complaints out of
    // THREE cleared the 60% bar and printed as a finding.
    //
    // An earlier note here said the floor stayed at 3 deliberately, on the
    // grounds that counting routines would fix the denominators. It did not:
    // the same suggestion was reported unfounded a second time, still at 2-of-3
    // and 3-of-4. The floor is `detectors.durationFitMin` = 6 now.
    const { durationFitSuggestion } = await import('../src/core/detectors.js');
    const { s } = withGym();
    rateWeeks(s, 8, { satisfaction: { durationFit: 0, overall: 5 } });
    // Eight sessions that all said "just right" must produce silence.
    expect(durationFitSuggestion(s.ratedSamples(), 'gym', defaultConfig).suggest).toBe(false);
  });

  it('what-to-do sees a draining recurring session', async () => {
    const { Schedule } = await import('../src/core/Schedule.js');
    const s2 = new Schedule({});
    expect(typeof s2.ratedSamples).toBe('function');
    const { s, gym } = withGym();
    const occ = s.getTasksForWeek(MON).find((t) => t.isOccurrence);
    s.rateOccurrence(occ, { satisfaction: { energy: -1, overall: 3 } });
    // The rating is nowhere in `schedule.tasks` — which is what `drainedToday`
    // used to walk.
    expect(s.tasks.find((t) => t.id === gym.id).satisfaction).toBe(null);
    expect(s.ratedSamples().some((t) => t.satisfaction && t.satisfaction.energy === -1)).toBe(true);
  });
});
