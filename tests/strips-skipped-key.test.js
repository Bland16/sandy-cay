// F-10 — the sand bars and the day strips disagree on every week that skipped
// anything, and the page said so only when the week skipped EVERYTHING.
//
// Measured on a real week: the bars drew Saturday at 13h while the strips drew
// it at 4h 30m, an inch apart on one page, because 510 minutes of that day were
// let go. Both numbers are right — `getWeekLoad` counts what was scheduled (a
// let-go block still occupied the grid, and placement's balance term needs it)
// and the strips draw what ran. What was missing was the page admitting it.
//
// The existing explanation lived in the `nothingRan` branch, which needs the
// WHOLE week skipped — the rarest case. These assertions were run against the
// unfixed builder and watched to fail.

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { buildWrapReport } from '../src/ui/report.js';

const MON = new Date(2026, 8, 14, 0, 0, 0, 0); // Mon 14 Sep 2026
const at = (day, h, mi = 0) => new Date(2026, 8, day, h, mi, 0, 0);

function weekWith({ ran, letGo }) {
  const s = new Schedule({});
  ran.forEach(([day, from, to], i) => {
    const t = s.addFixed({ title: `Ran ${i}`, tags: ['study'], startTime: at(day, from), endTime: at(day, to) });
    s.updateTask(t.id, { completion: 'done' });
  });
  letGo.forEach(([day, from, to], i) => {
    const t = s.addFixed({ title: `Gone ${i}`, tags: ['study'], startTime: at(day, from), endTime: at(day, to) });
    s.updateTask(t.id, { completion: 'skipped' });
  });
  return s;
}

describe('F-10 — a week that skipped SOME work names the gap', () => {
  it('carries the skipped count and minutes on a week that also ran things', () => {
    const s = weekWith({
      ran: [[14, 9, 11]],              // 120 min ran
      letGo: [[19, 9, 12], [19, 13, 17]], // 180 + 240 = 420 min let go
    });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.strips).toBeTruthy();
    expect(stats.strips.nothingRan).toBeFalsy(); // something DID run
    expect(stats.strips.skipped).toBe(2);        // was undefined on this branch
    expect(stats.strips.skippedMin).toBe(420);   // was undefined on this branch
  });

  it('the bars and the strips really do disagree by that amount', () => {
    const s = weekWith({ ran: [[14, 9, 11]], letGo: [[19, 9, 12], [19, 13, 17]] });
    const { stats } = buildWrapReport(s, MON);
    // The bars count scheduled minutes, so they include the let-go work...
    const barMin = stats.load.perDay.reduce((n, d) => n + d.scheduledMin, 0);
    // ...and the strips draw only what ran.
    const stripMin = stats.strips.days
      .flatMap((d) => d.items)
      .reduce((n, it) => n + (it.to - it.from), 0);
    expect(barMin).toBeGreaterThan(stripMin);
    // And the difference is exactly what the new key names.
    expect(stats.strips.skippedMin).toBe(420);
  });

  it('says nothing when nothing was skipped', () => {
    const s = weekWith({ ran: [[14, 9, 11], [15, 9, 10]], letGo: [] });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.strips.skipped).toBe(0);
    expect(stats.strips.skippedMin).toBe(0);
  });

  it('the whole-week-skipped branch still carries both figures', () => {
    const s = weekWith({ ran: [], letGo: [[14, 9, 11]] });
    const { stats } = buildWrapReport(s, MON);
    expect(stats.strips.nothingRan).toBe(true);
    expect(stats.strips.skipped).toBe(1);
    expect(stats.strips.skippedMin).toBe(120);
  });
});
