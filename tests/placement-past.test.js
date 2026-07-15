// Regression: nothing auto-places into hours that have already happened.
//
// Reported as "I was trying to schedule a break for today and it scheduled for
// Monday" — on a Wednesday. Three separate defects fed it; each gets a test.

import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { findBestSlot } from '../src/core/placement.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);   // week start
const WED_2PM = new Date(2026, 6, 15, 14, 0, 0, 0);
const D = (offset, h, mi = 0) => new Date(2026, 6, 13 + offset, h, mi, 0, 0);

describe('placement never reaches backwards', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('honours `from` when a window is entirely behind it', () => {
    // Mon–Fri windows are 08:00–18:00. Searching from 19:00 must not offer
    // 08:00 that same morning: the clamp used to require `from < win.end`, so a
    // window already passed was walked from its own start — eleven hours ago.
    const t = new Task({ title: 'Evening break', startTime: D(2, 19), endTime: D(2, 20) });
    const best = findBestSlot(s, t, { from: D(2, 19), to: D(2, 23, 59), occupied: [] });
    if (best) expect(best.slot.start.getTime()).toBeGreaterThanOrEqual(D(2, 19).getTime());
  });

  it('places from `from`, not from the start of the day', () => {
    const t = new Task({ title: 'Afternoon', startTime: WED_2PM, endTime: D(2, 15) });
    const best = findBestSlot(s, t, { from: WED_2PM, to: D(2, 18), occupied: [] });
    expect(best).not.toBeNull();
    expect(best.slot.start.getTime()).toBeGreaterThanOrEqual(WED_2PM.getTime());
  });

  it('a task added mid-week lands today, not in Monday’s leftover gap', () => {
    // What the Add-task panel now does: no pre-computed slot, `from` floored at
    // "now", scored placement inside the viewed week.
    const t = s.addFlexible({ title: 'Break', durationMin: 30, from: WED_2PM, to: D(6, 0) });
    expect(t.startTime.getTime()).toBeGreaterThanOrEqual(WED_2PM.getTime());
    expect(t.getDuration()).toBe(30); // the length you chose survives placement
  });

  it('durationMin sets the span without pinning a start', () => {
    // The bug underneath the bug: the panel used to pre-compute a slot to carry
    // the duration, and setting startTime made addFlexible skip placement.
    const t = new Task({ title: 'Short', durationMin: 25 });
    expect(t.getDuration()).toBe(25);

    const placed = s.addFlexible({ title: 'Placed', durationMin: 45, from: WED_2PM, to: D(6, 0) });
    expect(placed.getDuration()).toBe(45);
    expect(placed.startTime.getTime()).toBeGreaterThanOrEqual(WED_2PM.getTime());
  });

  it('defaults to config.defaultDuration when no duration is given (7A)', () => {
    expect(new Task({ title: 'Plain' }).getDuration()).toBe(defaultConfig.defaultDuration);
  });

  it('`to` keeps the search inside the week the user is looking at', () => {
    // Without `to`, the search runs from..from+maxPlacementLookahead and can
    // spill into next week — a task added on Saturday landing on Tuesday.
    const sat = D(5, 10);
    const t = s.addFlexible({ title: 'Weekend thing', durationMin: 60, from: sat, to: D(6, 0) });
    expect(t.startTime.getTime()).toBeLessThan(D(7, 0).getTime());
  });

  it('a past week still places from its own Monday — the floor is "now", not "Monday"', () => {
    // Viewing a week that has already gone, there is no "now" inside it to
    // floor at, so the whole week is fair game (that is how you reconstruct one).
    const lastWeek = new Date(2026, 6, 6, 0, 0, 0, 0);
    const t = s.addFlexible({ title: 'Past week', durationMin: 60, from: lastWeek, to: new Date(2026, 6, 12) });
    expect(t.startTime.getTime()).toBeGreaterThanOrEqual(lastWeek.getTime());
    expect(t.startTime.getTime()).toBeLessThan(MON.getTime());
  });
});
