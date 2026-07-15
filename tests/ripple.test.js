import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const T = (h, mi = 0) => {
  const d = new Date(MON.getTime());
  d.setHours(h, mi, 0, 0);
  return d;
};

describe('3B — rippleShift three-stage absorption', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('60-min delay with 45 min spare break padding shifts tasks by only 15', () => {
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    // Three downstream tasks, each preceded by a 20-min gap (15 compressible each = 45 total).
    const t1 = s.addFlexible({ title: 't1', startTime: T(10, 20), endTime: T(10, 50) });
    const t2 = s.addFlexible({ title: 't2', startTime: T(11, 10), endTime: T(11, 40) });
    const t3 = s.addFlexible({ title: 't3', startTime: T(12, 0), endTime: T(12, 30) });

    const res = s.rippleShift(pivot, 60);
    expect(res.absorbedByBreaks).toBe(45);
    expect(res.shifted.map((t) => t.id).sort()).toEqual([t1, t2, t3].map((t) => t.id).sort());
    expect(res.evacuated.length).toBe(0);
    // Absorption cascades: each 20-min gap gives up 15 and keeps the 5-min
    // minimum, so the chain's END shifts by the 15-min residual — but the head
    // has to move the full 45 to clear the pivot's new 11:00 end.
    expect(t1.startTime.getHours()).toBe(11);
    expect(t1.startTime.getMinutes()).toBe(5); // +45
    expect(t2.startTime.getHours()).toBe(11);
    expect(t2.startTime.getMinutes()).toBe(40); // +30
    expect(t3.startTime.getHours()).toBe(12);
    expect(t3.startTime.getMinutes()).toBe(15); // +15 — 3B's headline
    // Every gap sits at the 5-min minimum and nothing overlaps.
    expect(t1.startTime.getTime()).toBeGreaterThanOrEqual(T(11).getTime());
    expect(t1.overlaps(t2)).toBe(false);
    expect(t2.overlaps(t3)).toBe(false);
  });

  it('never shifts a task past its own deadline (§2.2 binds ripple too)', () => {
    // A plain shift has no deadline awareness, so rippling could push work past
    // its due date for free. It must be handed to scored placement instead.
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    const due = s.addFlexible({
      title: 'Due at noon', startTime: T(10, 30), endTime: T(11, 30), deadline: T(12),
    });

    s.rippleShift(pivot, 120); // would push it to 12:30 — past the deadline

    const endsInTime = due.endTime.getTime() <= T(12).getTime();
    // Either it found a legal pre-deadline slot, or it's visibly flagged —
    // never silently sitting past its deadline.
    expect(endsInTime || due.schedulingWarning).toBe(true);
    expect(due.overlaps(pivot)).toBe(false);
  });

  it('the head of the chain clears the grown pivot — no silent overlap (multi-gap)', () => {
    // Regression: slack used to be pooled across the whole chain and applied as
    // one uniform shift, which left the first task sitting under the pivot.
    const pivot = s.addFlexible({ title: 'Pivot', startTime: T(9), endTime: T(10) });
    const t1 = s.addFlexible({ title: 't1', startTime: T(10, 30), endTime: T(11, 30) });
    const t2 = s.addFlexible({ title: 't2', startTime: T(12), endTime: T(13) });

    s.rippleShift(pivot, 60);
    pivot.endTime = T(11); // the caller applies the pivot's real new end

    expect(t1.startTime.getTime()).toBeGreaterThanOrEqual(pivot.endTime.getTime());
    expect(t1.overlaps(pivot)).toBe(false);
    expect(t1.overlaps(t2)).toBe(false);
  });

  it('a downstream pinned task is a wall — it and everything after stay put', () => {
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    const flex = s.addFlexible({ title: 'flex', startTime: T(10, 5), endTime: T(10, 35) });
    const wall = s.addFixed({ title: 'wall', startTime: T(11, 0), endTime: T(12, 0) });
    wall.pinned = true;
    const wallStart = wall.startTime.getTime();
    s.rippleShift(pivot, 30);
    expect(wall.startTime.getTime()).toBe(wallStart); // unchanged
    // flex has only 5 min compressible before wall → evacuates forward (from the
    // pivot end), and never overlaps the wall.
    expect(flex.startTime.getTime()).toBeGreaterThanOrEqual(pivot.endTime.getTime());
    expect(flex.overlaps(wall)).toBe(false);
  });
});
