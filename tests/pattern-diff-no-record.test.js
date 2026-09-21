// F-8 — "N ran as written" was arithmetic (`scheduled − moved − skipped`) and
// never consulted completion, so any session the app had NO RECORD of was
// reported as having run.
//
// Measured on the user's real sick week: the sheet said "9 ran as written" when
// only 6 carried a completion. Two of the three it invented were the Tuesday
// they were too ill to get up; the third was a SATURDAY THAT HAD NOT HAPPENED
// YET when the report was generated.
//
// The app's whole vocabulary for an unrecorded session was "ran as written" or
// "you skipped", and it chose the first. There are now three states, split by
// the same day boundary the battery uses (design/AUDIT-UNMARKED-WORK.md §6).
//
// Each expectation below was run against the old arithmetic and watched to fail.

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { buildWrapReport } from '../src/ui/report.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026
const at = (day, h) => new Date(2026, 8, day, h, 0, 0, 0);

/** A weekday pattern running Mon–Fri at 09:00, with the given lived record. */
function weekdayPattern() {
  const s = new Schedule({});
  const t = s.addFixed({
    title: 'Seminar',
    tags: ['study'],
    startTime: at(14, 9),
    endTime: at(14, 10),
    recurrence: {
      periods: [{
        windows: [
          { day: 'mon', start: '09:00', end: '10:00' },
          { day: 'tue', start: '09:00', end: '10:00' },
          { day: 'wed', start: '09:00', end: '10:00' },
        ],
        interval: 1,
        effectiveFrom: MON,
      }],
      anchorDate: MON,
      exceptions: [],
    },
  });
  return { s, t };
}

/** Mark one occurrence of the pattern done. */
function rate(s, t, day) {
  const occ = s.getTasksForWeek(MON).find(
    (o) => o.isOccurrence && o.parentId === t.id && o.startTime.getDate() === day,
  );
  expect(occ, `no occurrence on the ${day}th`).toBeTruthy();
  s.rateOccurrence(occ, { completion: 'done', satisfaction: { overall: 4 } });
}

describe('F-8 — a session with no record is not reported as having run', () => {
  it('counts only the sessions that carry a completion', () => {
    const { s, t } = weekdayPattern();
    rate(s, t, 14); // Monday happened
    // Tuesday and Wednesday were never marked.
    const now = at(17, 12); // Thursday, so all three are in the past
    const { stats } = buildWrapReport(s, MON, now);

    expect(stats.pattern.scheduled).toBe(3);
    expect(stats.pattern.ranAsWritten).toBe(1); // was 3 under the old arithmetic
    expect(stats.pattern.noRecord).toBe(2);
    expect(stats.pattern.upcoming).toBe(0);
  });

  it('does not call a day that has not happened yet a shortfall', () => {
    const { s, t } = weekdayPattern();
    rate(s, t, 14); // Monday happened
    // Report generated on the Monday: Tue and Wed are still ahead.
    const now = at(14, 18);
    const { stats } = buildWrapReport(s, MON, now);

    expect(stats.pattern.ranAsWritten).toBe(1);
    expect(stats.pattern.noRecord).toBe(0);   // nothing is missing — it is Monday
    expect(stats.pattern.upcoming).toBe(2);
  });

  it('a session happening TODAY is still to come, not missing', () => {
    const { s, t } = weekdayPattern();
    rate(s, t, 14);
    // Tuesday morning, before the 09:00 session has been marked.
    const now = at(15, 7);
    const { stats } = buildWrapReport(s, MON, now);
    expect(stats.pattern.noRecord).toBe(0); // today is never "no record"
    expect(stats.pattern.upcoming).toBe(2); // Tuesday and Wednesday
  });

  it('a skipped session is skipped, not unrecorded', () => {
    const { s, t } = weekdayPattern();
    rate(s, t, 14);
    s.updateTask(t.id, {
      recurrence: {
        ...t.recurrence,
        exceptions: [{ date: '2026-09-15', action: 'skip' }],
      },
    });
    const now = at(17, 12);
    const { stats } = buildWrapReport(s, MON, now);
    expect(stats.pattern.skipped).toBe(1);
    expect(stats.pattern.ranAsWritten).toBe(1);
    expect(stats.pattern.noRecord).toBe(1); // only Wednesday
  });

  it('the three states plus moves and skips account for the whole week', () => {
    const { s, t } = weekdayPattern();
    rate(s, t, 14);
    const now = at(17, 12);
    const { stats } = buildWrapReport(s, MON, now);
    const p = stats.pattern;
    expect(p.ranAsWritten + p.noRecord + p.upcoming + p.moved + p.skipped)
      .toBe(p.scheduled);
  });
});
