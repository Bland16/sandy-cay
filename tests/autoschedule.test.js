import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

// Monday 2026-07-13 is the reference week start.
const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const D = (offset, h, mi = 0) => {
  const d = new Date(MON.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(h, mi, 0, 0);
  return d;
};

describe('2E — urgency-aware sort (slack trips priority)', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('Monday packed → lower-priority Wed task places before higher-priority Thu task', () => {
    // Pack Monday fully with a fixed anchor 08:00–18:00.
    s.tasks.push(new Task({ title: 'All-day Monday offsite', type: 'fixed', startTime: D(0, 8), endTime: D(0, 18) }));

    // A: due Wednesday, LOW priority, 5h. Slack over Tue only trips urgency.
    const a = s.addFlexible({ title: 'A-wed-assignment', priority: 2, startTime: D(1, 8), endTime: D(1, 13), deadline: D(2, 8) });
    // B: due Thursday, HIGH priority, 3h. Not endangered yet.
    const b = s.addFlexible({ title: 'B-thu-assignment', priority: 5, startTime: D(1, 8), endTime: D(1, 11), deadline: D(3, 8) });

    const res = s.autoSchedule({ now: MON, weekStart: MON });
    const orderA = res.placed.indexOf(a);
    const orderB = res.placed.indexOf(b);
    expect(orderA).toBeGreaterThanOrEqual(0);
    expect(orderA).toBeLessThan(orderB); // urgent A placed before higher-priority B
    // A lands on Tuesday (only pre-Wed capacity), no warning.
    expect(a.getDayIndex(MON)).toBe(1);
    expect(a.schedulingWarning).toBe(false);
    expect(res.warnings.length).toBe(0);
  });

  it('priority resumes control once nobody is endangered', () => {
    // Plenty of room; two non-urgent tasks → higher priority first.
    const low = s.addFlexible({ title: 'low', priority: 2, startTime: D(0, 10), endTime: D(0, 11) });
    const high = s.addFlexible({ title: 'high', priority: 5, startTime: D(0, 10), endTime: D(0, 11) });
    const res = s.autoSchedule({ now: MON, weekStart: MON });
    expect(res.placed.indexOf(high)).toBeLessThan(res.placed.indexOf(low));
  });
});

describe('2D — constraint precedence: deadline > zone > windows', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
    s.addZone({ label: 'Study', matchTags: ['study'], windows: [{ day: 'sat', start: '08:00', end: '12:00' }], exclusive: true });
  });

  it('places a study task inside its zone when capacity exists', () => {
    const t = s.addFlexible({ title: 'hw', tags: ['study'], startTime: D(5, 8), endTime: D(5, 9), from: MON });
    s.autoSchedule({ now: MON, weekStart: MON });
    expect(t.getDayIndex(MON)).toBe(5); // Saturday
    expect(t.schedulingInfo).toBe(null);
  });

  it('relaxes the zone with an info flag when the deadline precedes zone capacity', () => {
    // Zone only on Saturday, but deadline is Wednesday → must leave the zone.
    const t = s.addFlexible({ title: 'hw-due-wed', tags: ['study'], startTime: D(5, 8), endTime: D(5, 9), deadline: D(2, 8), from: MON });
    s.autoSchedule({ now: MON, weekStart: MON });
    expect(t.schedulingInfo).toBe('outside-zone');
    expect(t.endTime.getTime()).toBeLessThanOrEqual(D(2, 8).getTime());
    expect(t.schedulingWarning).toBe(false);
  });

  it('parks with schedulingWarning when there is no capacity anywhere pre-deadline', () => {
    // Fill Monday completely; deadline Tue 08:00 (nothing free before it).
    s.tasks.push(new Task({ title: 'wall', type: 'fixed', startTime: D(0, 8), endTime: D(0, 18) }));
    const t = s.addFlexible({ title: 'impossible', tags: ['study'], startTime: D(0, 8), endTime: D(0, 17), deadline: D(1, 8), from: MON });
    s.autoSchedule({ now: MON, weekStart: MON });
    expect(t.schedulingWarning).toBe(true);
  });
});

describe('2B — protected tags survive autoSchedule', () => {
  it('a protected (rest) task is treated as an anchor, not a candidate', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const movie = s.addFlexible({ title: 'Movie night', tags: ['rest'], startTime: D(4, 20), endTime: D(4, 22) });
    const before = movie.startTime.getTime();
    s.autoSchedule({ now: MON, weekStart: MON });
    expect(movie.startTime.getTime()).toBe(before); // never moved
  });
});

describe('autoSchedule preserves placedBy (F6 regression)', () => {
  beforeEach(() => resetIds());

  it('a hand-placed task stays placedBy:user across re-optimizes', () => {
    // OD-3 makes placedBy a SOFT preference: it earns a stability bonus so the
    // algorithm prefers not to move it. Stamping 'auto' after each placement
    // erased that memory, permanently disabling w.stability (0.15 of the score).
    const s = new Schedule({ config: defaultConfig });
    const t = s.addFlexible({ title: 'Deep work', startTime: D(0, 8), endTime: D(0, 9) });
    t.placedBy = 'user'; // the user dragged it here

    s.autoSchedule({ weekStart: MON });
    expect(t.placedBy).toBe('user');
    s.autoSchedule({ weekStart: MON });
    expect(t.placedBy).toBe('user'); // still remembered on the second run
  });
});
