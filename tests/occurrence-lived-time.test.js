// F-4 — a recurring session is drawn at the time it ACTUALLY sat, not at the
// time the pattern declares.
//
// `rateOccurrence` stamps `at`/`endAt` as the record of when the session really
// ran, and `buildOccurrence` rebuilt the occurrence field by field while ignoring
// them. Measured on the user's real week: a session recorded at 20:15 for 90
// minutes was rebuilt at the pattern's 18:15 for 60, the focused total printed
// 48h 38m against 49h 8m true, one tag read 2h 35m against 3h 5m, and the "When
// it happened" strip drew the block TWO HOURS EARLY — in the section that exists
// to answer "it put the tasks at 11pm".
//
// The user's rule (2026-09-20): *"it should record it at the time it was moved at
// in that instance, but as an instance of that type."* So the clock comes from
// the record and the identity stays the pattern's.
//
// ⚠️ THE WHOLE SUITE PASSED BEFORE THIS FILE EXISTED. 1385 tests, none of them
// covering it — which is why the defect survived.

import { describe, it, expect } from 'vitest';
import { Schedule, dateKey } from '../src/core/index.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026

function withPattern() {
  const s = new Schedule({});
  const t = s.addFixed({
    title: 'Gym',
    tags: ['gym'],
    startTime: new Date(2026, 8, 15, 18, 15, 0),
    endTime: new Date(2026, 8, 15, 19, 15, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'tue', start: '18:15', end: '19:15' }], interval: 1, effectiveFrom: MON }],
      anchorDate: MON,
      exceptions: [],
    },
  });
  return { s, t };
}

const occOf = (s, t) => s.getTasksForWeek(MON).find((o) => o.isOccurrence && o.parentId === t.id);

describe('F-4 — the lived time wins over the pattern time', () => {
  it('draws the session where it actually sat', () => {
    const { s, t } = withPattern();
    const occ = occOf(s, t);
    expect(occ.startTime.getHours()).toBe(18); // the pattern's time, before rating

    // Rated as having run 20:15–21:45 — later, and 90 minutes rather than 60.
    s.rateOccurrence(occ, {
      completion: 'done',
      satisfaction: { overall: 4 },
      at: new Date(2026, 8, 15, 20, 15, 0),
      endAt: new Date(2026, 8, 15, 21, 45, 0),
    });

    const after = occOf(s, t);
    expect(after.startTime.getHours()).toBe(20);   // was 18
    expect(after.startTime.getMinutes()).toBe(15);
    expect(after.getDuration()).toBe(90);          // was 60
  });

  it('stays an instance of the same pattern — the type is not lost', () => {
    const { s, t } = withPattern();
    s.rateOccurrence(occOf(s, t), {
      completion: 'done',
      satisfaction: { overall: 4 },
      at: new Date(2026, 8, 15, 20, 15, 0),
      endAt: new Date(2026, 8, 15, 21, 45, 0),
    });
    const after = occOf(s, t);
    expect(after.isOccurrence).toBe(true);
    expect(after.parentId).toBe(t.id);
    expect(after.occurrenceDate).toBe('2026-09-15'); // the key is unchanged
    expect(after.title).toBe('Gym');
  });

  it('the duration reaches the totals that were understating it', () => {
    const { s, t } = withPattern();
    const before = s.getTasksForDay(new Date(2026, 8, 15))
      .filter((x) => x.isOccurrence).reduce((n, x) => n + x.getDuration(), 0);
    s.rateOccurrence(occOf(s, t), {
      completion: 'done',
      satisfaction: { overall: 4 },
      at: new Date(2026, 8, 15, 20, 15, 0),
      endAt: new Date(2026, 8, 15, 21, 45, 0),
    });
    const after = s.getTasksForDay(new Date(2026, 8, 15))
      .filter((x) => x.isOccurrence).reduce((n, x) => n + x.getDuration(), 0);
    expect(before).toBe(60);
    expect(after).toBe(90);
  });

  it('⚠️ REFUSES a lived time on a different DAY — membership must not desync', () => {
    const { s, t } = withPattern();
    // A record claiming the Tuesday session ran on Wednesday. `expandRecurrence`
    // decides week/day membership by the DECLARED start, so honouring this would
    // leave the occurrence inside a day it no longer sits in. Moving a session
    // across days is a `move` exception's job.
    s.rateOccurrence(occOf(s, t), {
      completion: 'done',
      satisfaction: { overall: 4 },
      at: new Date(2026, 8, 16, 20, 15, 0),
      endAt: new Date(2026, 8, 16, 21, 45, 0),
    });
    const after = occOf(s, t);
    expect(dateKey(after.startTime)).toBe('2026-09-15'); // still the Tuesday
    expect(after.startTime.getHours()).toBe(18);         // pattern time kept
  });

  it('falls back to the pattern when the record is absent or incoherent', () => {
    const { s, t } = withPattern();
    // Rated, but with no stamped times at all (a pre-fix rating).
    s.rateOccurrence(occOf(s, t), { completion: 'done', satisfaction: { overall: 4 } });
    expect(occOf(s, t).startTime.getHours()).toBe(18);
    expect(occOf(s, t).getDuration()).toBe(60);
  });
});
