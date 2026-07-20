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

describe('§2.2 — ripple honours exclusive zones (the automatic guarantee)', () => {
  // Wide day window so there's room outside the 09:00–18:30 work zone.
  const cfg = {
    ...defaultConfig,
    windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } },
  };
  const workZone = (extra = {}) => ({
    label: 'Work',
    matchTags: ['work'],
    windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({ day, start: '09:00', end: '18:30' })),
    exclusive: true,
    ...extra,
  });
  const inZone = (d) => {
    const h = d.getHours() + d.getMinutes() / 60;
    return d.getDay() >= 1 && d.getDay() <= 5 && h >= 9 && h < 18.5;
  };

  beforeEach(() => resetIds());

  it('a plain shift never slides a non-matching task into an exclusive zone', () => {
    const s = new Schedule({ config: cfg });
    s.addZone(workZone());
    const pivot = s.addFixed({ title: 'Pivot', tags: ['personal'], startTime: T(6), endTime: T(7) });
    const errand = s.addFlexible({ title: 'Errand', tags: ['personal'], startTime: T(7, 30), endTime: T(8, 30) });

    // The pivot grew by 90 min; the raw arithmetic would slide the errand to
    // ~08:35–09:35, straddling the 09:00 work zone. Before the zone check the
    // errand was merely *shifted* there, silently; now it must *evacuate* clear.
    s.rippleShift(pivot, 90);

    expect(s.tasks.find((t) => t.title === 'Errand')).toBe(errand);
    // Evacuated, not shifted — and wherever it lands, not inside the zone.
    expect(inZone(errand.startTime)).toBe(false);
    expect(inZone(new Date(errand.endTime.getTime() - 1))).toBe(false);
  });

  it('reports the intruder as evacuated, not shifted', () => {
    const s = new Schedule({ config: cfg });
    s.addZone(workZone());
    const pivot = s.addFixed({ title: 'Pivot', tags: ['personal'], startTime: T(6), endTime: T(7) });
    const errand = s.addFlexible({ title: 'Errand', tags: ['personal'], startTime: T(7, 30), endTime: T(8, 30) });

    const res = s.rippleShift(pivot, 90);
    expect(res.evacuated.map((t) => t.id)).toContain(errand.id);
    expect(res.shifted.map((t) => t.id)).not.toContain(errand.id);
  });

  it('leaves a matching task inside its own zone — it is shifted, not evicted', () => {
    const s = new Schedule({ config: cfg });
    s.addZone(workZone());
    const pivot = s.addFixed({ title: 'WPivot', tags: ['work'], startTime: T(9), endTime: T(10) });
    const wtask = s.addFlexible({ title: 'Wtask', tags: ['work'], startTime: T(10, 30), endTime: T(11, 30) });

    const res = s.rippleShift(pivot, 60);
    expect(res.evacuated.length).toBe(0);
    expect(res.shifted.map((t) => t.id)).toContain(wtask.id);
    // Still inside the work zone the task belongs to.
    expect(inZone(wtask.startTime)).toBe(true);
  });

  it('a non-exclusive zone does not block a shift (it only routes matching work)', () => {
    const s = new Schedule({ config: cfg });
    s.addZone(workZone({ exclusive: false }));
    const pivot = s.addFixed({ title: 'Pivot', tags: ['personal'], startTime: T(6), endTime: T(7) });
    const errand = s.addFlexible({ title: 'Errand', tags: ['personal'], startTime: T(7, 30), endTime: T(8, 30) });

    const res = s.rippleShift(pivot, 90);
    // No exclusive reservation → the ordinary shift stands, no evacuation.
    expect(res.evacuated.length).toBe(0);
    expect(res.shifted.map((t) => t.id)).toContain(errand.id);
  });

  it('an expired zone no longer blocks a shift into its old hours', () => {
    const s = new Schedule({ config: cfg });
    // Zone ended before this Monday (effectiveUntil is exclusive: last day = Sun).
    s.addZone(workZone({ effectiveUntil: new Date(2026, 6, 13) }));
    const pivot = s.addFixed({ title: 'Pivot', tags: ['personal'], startTime: T(6), endTime: T(7) });
    const errand = s.addFlexible({ title: 'Errand', tags: ['personal'], startTime: T(7, 30), endTime: T(8, 30) });

    const res = s.rippleShift(pivot, 90);
    // The zone isn't in force today, so its hours are ordinary time again.
    expect(res.evacuated.length).toBe(0);
    expect(res.shifted.map((t) => t.id)).toContain(errand.id);
  });
});
