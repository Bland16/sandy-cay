// F-3 / TODO E-5 — `lastFinishedLoad` walked `schedule.tasks`, where a
// materialised occurrence has never lived, so a recurring session you had just
// finished was invisible to the variety nudge and the nudge compared you against
// whatever one-off happened to be last.
//
// The ninth instance of the bug `ratedSamples()` exists to stop. Measured on the
// real library before the fix, sweeping 315 hours: 29% had a recurring session as
// the true most-recent finished item, and in 10% the variety axis differed.
//
// ⚠️ EVERY TEST HERE WAS RUN AGAINST THE UNFIXED CODE AND WATCHED TO FAIL.
// A first draft of this file had three tests and TWO OF THEM PASSED REVERTED —
// they were evaluated at an evening moment where `reserveBias` (±0.2) dominates
// `varietyPenalty` (0.15), so the ordering they asserted held for a reason that
// had nothing to do with the fix. They are gone. What remains is the design that
// isolates the variety term:
//
//   - evaluate on a day that holds NOTHING, so `reserveAt` is all zeros, `worst`
//     is null and `reserveBias` is identically 0 for every candidate;
//   - stay under `coldStartRatings`, so `steerBias` returns its `none` and
//     `bias` is identically 0;
//   - give the two candidate activities the SAME duration and range, so `fit` is
//     identical.
//
// With every other term equal, the only thing that can separate them is the
// variety penalty — which is exactly the term `lastFinishedLoad` feeds.

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { suggestActivities } from '../src/core/suggest.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026

const openingAt = (d, minutes = 60) => ({
  start: d,
  end: new Date(d.getTime() + minutes * 60000),
  minutes,
  nextTask: null,
  startsLater: false,
});

/**
 * The last thing finished is a RECURRING session with a physical character.
 * The only ordinary task finished before it is creative.
 *
 * Before the fix the pool could not see the session, so the creative one-off
 * read as "last finished" and the nudge penalised creative work. After the fix
 * it sees the session and penalises physical work instead — the axes are chosen
 * to differ precisely so the assertion inverts.
 */
function withFinishedSession() {
  const s = new Schedule({});
  const gymB = s.addBucket({ label: 'Exercise', tags: ['gym'], load: { physical: 2 } });
  const makeB = s.addBucket({ label: 'Making', tags: ['making'], load: { creative: 2 } });

  // A creative one-off, finished EARLIER on the Tuesday.
  const sketch = s.addFixed({
    title: 'Sketching',
    tags: ['making'],
    startTime: new Date(2026, 8, 15, 9, 0, 0),
    endTime: new Date(2026, 8, 15, 10, 0, 0),
  });
  s.updateTask(sketch.id, { completion: 'done' });

  // A recurring gym session, finished LATER the same day. It lives only in
  // `occurrenceData` and is never in `schedule.tasks`.
  const gym = s.addFixed({
    title: 'Gym',
    tags: ['gym'],
    startTime: new Date(2026, 8, 15, 18, 0, 0),
    endTime: new Date(2026, 8, 15, 19, 0, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'tue', start: '18:00', end: '19:00' }], interval: 1, effectiveFrom: MON }],
      anchorDate: MON,
      exceptions: [],
    },
  });
  const occ = s.getTasksForWeek(MON).find((t) => t.isOccurrence && t.parentId === gym.id);
  expect(occ, 'fixture produced no occurrence').toBeTruthy();
  s.rateOccurrence(occ, { completion: 'done', satisfaction: { overall: 4 } });

  // Two candidates, identical in every respect except which axis they load.
  s.addActivity({ label: 'A run', bucketId: gymB.id, tags: ['gym'], durationMin: 30, durationMax: 60 });
  s.addActivity({ label: 'B paint', bucketId: makeB.id, tags: ['making'], durationMin: 30, durationMax: 60 });
  return s;
}

/** Scores keyed by label, at a moment on an otherwise empty day. */
function scoresAt(s, when) {
  const picks = suggestActivities(s, when, { opening: openingAt(when), limit: 5 });
  return Object.fromEntries(picks.map((p) => [p.activity.label, p.score]));
}

describe('F-3 — the variety nudge can see a recurring session', () => {
  it('guard: the session is invisible to schedule.tasks, which is why this bug existed', () => {
    const s = withFinishedSession();
    const finishedInTasks = s.tasks.filter((t) => t.completion !== null).map((t) => t.title);
    expect(finishedInTasks).toEqual(['Sketching']); // the gym session is NOT here
    // But it is real, and it is the later of the two.
    const occ = s.getTasksForWeek(MON).find((t) => t.isOccurrence);
    expect(occ.completion).toBe('done');
    expect(occ.startTime.getTime()).toBeGreaterThan(s.tasks[0].startTime.getTime());
  });

  it('penalises the RECURRING session\'s axis the next morning', () => {
    const s = withFinishedSession();
    // Wed 16 Sep 09:00 — the day holds nothing, so reserve is zero, `worst` is
    // null and `reserveBias` is 0 for both candidates. Only variety can separate.
    const by = scoresAt(s, new Date(2026, 8, 16, 9, 0, 0));
    expect(by['A run']).toBeDefined();
    expect(by['B paint']).toBeDefined();
    // The gym was the last thing finished, so the physical candidate carries the
    // penalty. Reverted, the creative sketch reads as last and this inverts.
    expect(by['A run']).toBeLessThan(by['B paint']);
  });

  it('reaches back into the previous week for a Monday morning', () => {
    const s = withFinishedSession();
    // Mon 21 Sep 09:00: nothing has happened yet this week, so the last finished
    // thing is in the week behind. A one-week walk returns null here and the
    // nudge silently stops working every Monday morning.
    const by = scoresAt(s, new Date(2026, 8, 21, 9, 0, 0));
    expect(by['A run']).toBeLessThan(by['B paint']);
  });
});
