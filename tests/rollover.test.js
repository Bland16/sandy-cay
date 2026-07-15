import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { checkRollover, commitRollover } from '../src/core/rollover.js';
import { defaultConfig } from '../src/core/config.js';
import { dateKey } from '../src/core/time.js';

// Weeks of 2026: Jul 13 (W29), Jul 20 (W30), Aug 3 (W32).
const MON_W29 = new Date(2026, 6, 13, 0, 0, 0, 0);
const WED_W29 = new Date(2026, 6, 15, 10, 0, 0, 0);
const MON_W30 = new Date(2026, 6, 20, 9, 0, 0, 0);
const MON_W32 = new Date(2026, 7, 3, 9, 0, 0, 0);

describe('R-7 — week rollover detection', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('a first-ever run is not a rollover — it only records the starting point', () => {
    const r = checkRollover(s, WED_W29);
    expect(r.firstRun).toBe(true);
    expect(r.rolled).toBe(false);
    expect(r.closedWeek).toBeNull();
  });

  it('does not fire twice in the same week', () => {
    s.markWeekSeen(MON_W29);
    expect(checkRollover(s, WED_W29).rolled).toBe(false);
  });

  it('fires once when the week advances', () => {
    s.markWeekSeen(WED_W29);
    const r = checkRollover(s, MON_W30);
    expect(r.rolled).toBe(true);
    expect(r.weeksAway).toBe(1);
    expect(dateKey(r.closedWeek)).toBe('2026-07-13'); // the week that closed
  });

  it('browsing a past week is not a rollover', () => {
    s.markWeekSeen(MON_W30);
    // `now` is still W30; the user merely navigated the grid backwards.
    expect(checkRollover(s, new Date(2026, 6, 22)).rolled).toBe(false);
  });

  it('away three weeks offers ONE report, on the last week actually lived', () => {
    s.markWeekSeen(WED_W29);
    const r = checkRollover(s, MON_W32);
    expect(r.rolled).toBe(true);
    expect(r.weeksAway).toBe(3);
    // Not the empty fortnight they were away for — the week they were here.
    expect(dateKey(r.closedWeek)).toBe('2026-07-13');
  });

  it('commitRollover retrains, records the week, and never fires again', () => {
    s.markWeekSeen(WED_W29);
    const r = commitRollover(s, MON_W30);
    expect(dateKey(r.closedWeek)).toBe('2026-07-13');
    expect(typeof r.sampleCount).toBe('number');
    expect(s.lastSeenWeek).toBe('2026-07-20');
    // Second check in the same week is silent — an un-recorded rollover would
    // re-offer the report on every reload.
    expect(checkRollover(s, MON_W30).rolled).toBe(false);
  });

  it('rollover never carries tasks over on its own (P-1 / §3.6)', () => {
    const t = s.addFixed({ title: 'Unfinished', startTime: new Date(2026, 6, 15, 9), endTime: new Date(2026, 6, 15, 10) });
    s.markWeekSeen(WED_W29);
    const before = t.startTime.getTime();
    commitRollover(s, MON_W30);
    // The task is exactly where the user left it. Carrying it forward is the
    // past-week banner's job, and only if they say so.
    expect(t.startTime.getTime()).toBe(before);
    expect(t.completion).toBeNull();
    expect(t.history.carriedCount).toBe(0);
  });

  it('markWeekSeen survives a JSON round-trip', () => {
    s.markWeekSeen(WED_W29);
    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(revived.lastSeenWeek).toBe('2026-07-13');
    // ...so the rollover it already handled does not fire again after a reload.
    expect(checkRollover(revived, WED_W29).rolled).toBe(false);
    expect(checkRollover(revived, MON_W30).rolled).toBe(true);
  });

  it('a save written before rollover existed loads as a first run, not a rollover', () => {
    const old = { schemaVersion: 1, tasks: [], zones: [], config: defaultConfig };
    const revived = Schedule.fromJSON(old);
    expect(revived.lastSeenWeek).toBeNull();
    expect(checkRollover(revived, MON_W30).firstRun).toBe(true);
  });
});

describe('§6J — the planned baseline', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it("captures at a week's FIRST autoSchedule and never overwrites it", () => {
    s.addFlexible({ title: 'Drifter', from: MON_W29 });
    s.autoSchedule({ weekStart: MON_W29, now: MON_W29 });
    const planned = s.plannedSnapshot(MON_W29);
    expect(planned).not.toBeNull();
    const originalStart = Object.values(planned)[0].start;

    // A Thursday re-optimize must not rewrite history: the report's whole point
    // is that it remembers the original intent.
    s.autoSchedule({ weekStart: MON_W29, now: new Date(2026, 6, 16, 9) });
    expect(Object.values(s.plannedSnapshot(MON_W29))[0].start).toBe(originalStart);
  });

  it('a week never auto-scheduled has no baseline — the report omits the section', () => {
    s.addFixed({ title: 'Manual only', startTime: new Date(2026, 6, 14, 9), endTime: new Date(2026, 6, 14, 10) });
    expect(s.plannedSnapshot(MON_W29)).toBeNull();
  });

  it('resolves the baseline from any day of the week, not just the Monday', () => {
    s.addFlexible({ title: 'A', from: MON_W29 });
    s.autoSchedule({ weekStart: MON_W29, now: MON_W29 });
    expect(s.plannedSnapshot(WED_W29)).not.toBeNull();
  });

  it('survives a JSON round-trip — otherwise the report can only diff a week against itself', () => {
    s.addFlexible({ title: 'Persisted', from: MON_W29 });
    s.autoSchedule({ weekStart: MON_W29, now: MON_W29 });
    const before = s.plannedSnapshot(MON_W29);

    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(revived.plannedSnapshot(MON_W29)).toEqual(before);
  });

  it('an old save with no snapshots key loads clean', () => {
    const old = { schemaVersion: 1, tasks: [], zones: [], config: defaultConfig };
    const revived = Schedule.fromJSON(old);
    expect(revived.plannedSnapshot(MON_W29)).toBeNull();
  });
});
