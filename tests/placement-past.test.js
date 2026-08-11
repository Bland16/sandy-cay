// Regression: nothing auto-places into hours that have already happened.
//
// Reported as "I was trying to schedule a break for today and it scheduled for
// Monday" — on a Wednesday. Three separate defects fed it; each gets a test.

import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { findBestSlot, placeTask } from '../src/core/placement.js';
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

  // ------------------------------------------------------------------
  // The LAST-RESORT PARK had the same bug the scored search was fixed for.
  // Found 2026-08-11 by an adversarial use case (UC-X4): "a deadline three
  // days in the past". Nothing can satisfy an impossible deadline, so
  // placeTask falls through to step 4, which parked at the day WINDOW's start
  // without clamping to `from` — landing an overdue task at 08:00 when it was
  // already 15:00. findBestSlot got this clamp in session 2; this branch was
  // missed, so the floor held everywhere except the one path that ignores it.
  // ------------------------------------------------------------------
  it('an impossible deadline parks the task at "now", never earlier', () => {
    const wed3pm = D(2, 15); // Wednesday 15:00
    const t = new Task({
      title: 'Submit expenses', type: 'flexible', durationMin: 20,
      deadline: D(0, 17), // Monday — already gone, so no slot can satisfy it
    });
    s.tasks.push(t);
    const r = placeTask(s, t, { from: wed3pm, to: D(6, 0) });

    expect(r.warning).toBe(true); // it IS a park, and says so
    // ...but a park is not a licence to schedule into hours already lived.
    expect(t.startTime.getTime()).toBeGreaterThanOrEqual(wed3pm.getTime());
  });

  it('parking still honours `from` when the day window has not opened yet', () => {
    // The mirror case: `from` BEFORE the window start must not drag the task
    // out of its window — the clamp takes the later of the two, not `from`.
    const wed4am = D(2, 4);
    const t = new Task({ title: 'Early bird', type: 'flexible', durationMin: 20, deadline: D(0, 17) });
    s.tasks.push(t);
    placeTask(s, t, { from: wed4am, to: D(6, 0) });
    expect(t.startTime.getHours()).toBeGreaterThanOrEqual(defaultConfig.windows.wed
      ? Number(String(defaultConfig.windows.wed.start).slice(0, 2)) : 8);
  });
});
