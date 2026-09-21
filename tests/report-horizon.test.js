// F-9 — the report does not read from days that have not happened, and what is
// still ahead gets its own section in its own tense.
//
// Measured on the user's real sick week, generated on the Friday: the sheet
// reported "how it felt: 4.7 out of 5 (12 rated)" — the HIGHEST average of all
// four weeks, on the week they were ill — and carried 630 scheduled minutes of
// Saturday and Sunday inside its energy figures for days that had not arrived.
// Nothing on the page said the week was unfinished.
//
// The user's call (2026-09-20): *"Does it matter? I think I know the day of week.
// You can do a what's on the horizon."* So future days leave the readings AND the
// charts, and the tense gets a section of its own — which is also what removes
// the need for a caption explaining a chart that draws days it will not total.

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { buildWrapReport } from '../src/ui/report.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026
const at = (day, h) => new Date(2026, 8, day, h, 0, 0, 0);

/** Two lived days rated 2, and two future days that would rate 5 if counted. */
function midweek() {
  const s = new Schedule({});
  // Monday and Tuesday: done, and rated poorly.
  for (const day of [14, 15]) {
    const t = s.addFixed({ title: `Lived ${day}`, tags: ['study'], startTime: at(day, 9), endTime: at(day, 11) });
    s.updateTask(t.id, { completion: 'done', satisfaction: { overall: 2 } });
  }
  // Saturday and Sunday: scheduled, not happened. If the report counted them
  // they would drag the week's average UP, which is the measured failure.
  for (const day of [19, 20]) {
    const t = s.addFixed({ title: `Ahead ${day}`, tags: ['study'], startTime: at(day, 9), endTime: at(day, 14) });
    s.updateTask(t.id, { satisfaction: { overall: 5 } });
  }
  return s;
}

// Generated on the Wednesday — two days lived, two still ahead.
const NOW = () => at(16, 12);

describe('F-9 — future days leave the readings', () => {
  it('does not count a day that has not happened in the satisfaction average', () => {
    const { accomplished } = buildWrapReport(midweek(), MON, NOW());
    // Only the two lived days are rated, both 2. Counting the future days would
    // give (2+2+5+5)/4 = 3.5 — the shape of the real sick week's 4.7.
    expect(accomplished.ratedCount).toBe(2);
    expect(accomplished.avgShells).toBeCloseTo(2.0, 5);
  });

  it('does not put future minutes into the energy figures', () => {
    const s = midweek();
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    const { stats } = buildWrapReport(s, MON, NOW());
    // Two lived days of 2h at +2/hr = 8 load-hours. The two future days carry
    // 5h each and would add 20 more.
    expect(stats.energy.totals.spend).toBeCloseTo(8, 5);
  });

  it('counts the whole week once the week is over', () => {
    const { accomplished } = buildWrapReport(midweek(), MON, at(22, 12));
    // The Sunday has passed, so its item is elapsed and in scope — it is
    // unmarked, so it is not "accomplished", but it IS rated, and a rating on a
    // day that happened is real.
    expect(accomplished.ratedCount).toBe(4);
  });
});

describe('F-9 — the horizon section', () => {
  it('names the days still ahead, with counts and minutes', () => {
    const { stats } = buildWrapReport(midweek(), MON, NOW());
    expect(stats.horizon).toBeTruthy();
    expect(stats.horizon.dayCount).toBe(2);
    expect(stats.horizon.itemCount).toBe(2);
    expect(stats.horizon.minutes).toBe(600); // 2 × 5h
    expect(stats.horizon.days.map((d) => d.key)).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('is CHRONOLOGICAL, never ranked — a ranking of undone work is a verdict', () => {
    const s = new Schedule({});
    // Friday light, Saturday heavy. A size ordering would put Saturday first.
    s.addFixed({ title: 'Fri', tags: ['study'], startTime: at(18, 9), endTime: at(18, 10) });
    s.addFixed({ title: 'Sat', tags: ['study'], startTime: at(19, 9), endTime: at(19, 15) });
    const { stats } = buildWrapReport(s, MON, at(16, 12));
    expect(stats.horizon.days.map((d) => d.key)).toEqual(['2026-09-18', '2026-09-19']);
    expect(stats.horizon.days[0].minutes).toBeLessThan(stats.horizon.days[1].minutes);
  });

  it('is ABSENT once the week is over, rather than printing "0 days to come"', () => {
    const { stats } = buildWrapReport(midweek(), MON, at(22, 12));
    expect(stats.horizon).toBeNull();
  });

  it('is absent when the rest of the week holds nothing', () => {
    const s = new Schedule({});
    s.addFixed({ title: 'Mon', tags: ['study'], startTime: at(14, 9), endTime: at(14, 10) });
    const { stats } = buildWrapReport(s, MON, at(16, 12));
    expect(stats.horizon).toBeNull();
  });
});
