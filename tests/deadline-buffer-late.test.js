// F-7 — `buildDeadlineBuffer` printed a false sentence two ways at once.
//
// Measured on a real week: the report said "7 deadlined tasks were finished
// this week; 2 came in later than the plan aims for — about a day clear of the
// deadline." Three had finished AFTER their deadline (by 16h, 19h and 36h), the
// two worst were excluded, one that finished 23 hours EARLY was included, and
// the "about a day" was the 4th of 5 sorted targets rather than the median.
//
// Each expectation below was run against the unfixed code and watched to fail.

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { buildWrapReport } from '../src/ui/report.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026
const at = (day, h, mi = 0) => new Date(2026, 8, day, h, mi, 0, 0);

/** A finished task with a deadline, placed inside the week. */
function finished(s, title, { start, end, deadline }) {
  const t = s.addFixed({ title, tags: ['study'], startTime: start, endTime: end, deadline });
  s.updateTask(t.id, { completion: 'done' });
  return t;
}

describe('F-7 — late work is counted, and counted apart from tight work', () => {
  it('counts a task that finished AFTER its deadline, even with no runway', () => {
    const s = new Schedule({});
    // Deadline sits exactly at the week's start, so `targetHoursFor` returns
    // null — there is no runway to take a fifth of. The task finished 16 hours
    // past it. That is late regardless, and used to be dropped entirely.
    finished(s, 'Late essay', {
      start: at(14, 12, 0),
      end: at(14, 16, 0),
      deadline: MON,
    });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.deadlines.count).toBe(1);
    expect(stats.deadlines.lateCount).toBe(1); // was 0 — the row was invisible
  });

  it('does NOT call a task that finished early "late"', () => {
    const s = new Schedule({});
    // Deadline late in the week → a long runway → a large target. The task
    // finishes comfortably before the deadline but inside the target, which is
    // "tighter than aimed for" and emphatically not "after the deadline".
    finished(s, 'Early enough', {
      start: at(15, 18, 0),
      end: at(15, 20, 0),
      deadline: at(15, 23, 0),
    });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.deadlines.lateCount).toBe(0);
    expect(stats.deadlines.closeCount).toBe(1);
  });

  it('separates the two: one late, one merely tight', () => {
    const s = new Schedule({});
    finished(s, 'Late one', { start: at(14, 12), end: at(14, 16), deadline: MON });
    finished(s, 'Tight one', { start: at(15, 18), end: at(15, 20), deadline: at(15, 23) });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.deadlines.count).toBe(2);
    expect(stats.deadlines.lateCount).toBe(1);
    expect(stats.deadlines.closeCount).toBe(1);
  });

  it('the median target indexes the array it sorted, not the unfiltered rows', () => {
    const s = new Schedule({});
    // Three rows WITH a runway (targets 24h, 48h, 96h → median 48h) plus two
    // with none. Indexing by `rows.length / 2` = 2 into a 3-element array gives
    // 96h; the true median is 48h.
    finished(s, 'D1', { start: at(14, 9), end: at(14, 10), deadline: at(19, 0) });   // runway 120h → target 24h
    finished(s, 'D2', { start: at(14, 11), end: at(14, 12), deadline: at(24, 0) });  // runway 240h → target 48h
    finished(s, 'D3', { start: at(14, 13), end: at(14, 14), deadline: at(34, 0) });  // runway 480h → target 96h
    finished(s, 'N1', { start: at(15, 9), end: at(15, 10), deadline: MON });
    finished(s, 'N2', { start: at(15, 11), end: at(15, 12), deadline: MON });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.deadlines.count).toBe(5);
    expect(stats.deadlines.medianTargetHours).toBeCloseTo(48, 5); // was 96
  });

  it('an even number of targets takes the mean of the two middle values', () => {
    const s = new Schedule({});
    finished(s, 'D1', { start: at(14, 9), end: at(14, 10), deadline: at(19, 0) });   // target 24h
    finished(s, 'D2', { start: at(14, 11), end: at(14, 12), deadline: at(24, 0) });  // target 48h
    const { stats } = buildWrapReport(s, MON);
    expect(stats.deadlines.medianTargetHours).toBeCloseTo(36, 5); // (24 + 48) / 2
  });
});
