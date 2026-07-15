// The engine-facing half of the M2.1 drag/resize physics (src/ui/interaction.js).
// Runs in the node env: interaction.js is DOM-free by design, so the physics is
// testable without a grid. The pointer/geometry half is covered by ui-drag.test.jsx.
//
// OD-8's chooseConflictStrategy quartet is already covered in conflicts.test.js;
// what's new here is that the *dayState we feed it* is computed honestly, and
// that a committed ripple never leaves an overlap behind.
import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import {
  affectedChain,
  blockerKind,
  buildDayState,
  commitDisplace,
  commitRipple,
  findBlockers,
  isHardBlocker,
  snapTo,
} from '../src/ui/interaction.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const T = (h, mi = 0) => {
  const d = new Date(MON.getTime());
  d.setHours(h, mi, 0, 0);
  return d;
};

let s;
beforeEach(() => {
  resetIds();
  s = new Schedule({ config: defaultConfig });
});

describe('snapping (OD-1 — 15 minutes, nearest)', () => {
  it('rounds to the nearest quarter hour in both directions', () => {
    expect(snapTo(607)).toBe(600); // 10:07 → 10:00
    expect(snapTo(608)).toBe(615); // 10:08 → 10:15
    expect(snapTo(0)).toBe(0);
  });
});

describe('blocker classification (§3.1 / 7B)', () => {
  it('finds real overlaps and ignores the task itself', () => {
    const a = s.addFlexible({ title: 'a', startTime: T(9), endTime: T(10) });
    s.addFlexible({ title: 'b', startTime: T(10), endTime: T(11) });
    expect(findBlockers(s, a, T(9), T(10)).map((t) => t.title)).toEqual([]);
    expect(findBlockers(s, a, T(9, 30), T(10, 30)).map((t) => t.title)).toEqual(['b']);
  });

  it('names each anchor the way §3.1\'s toast does', () => {
    const pinned = s.addFlexible({ title: 'p', startTime: T(9), endTime: T(10) });
    pinned.pinned = true;
    const fixed = s.addFixed({ title: 'f', startTime: T(11), endTime: T(12) });
    const rest = s.addFlexible({ title: 'r', tags: ['rest'], startTime: T(13), endTime: T(14) });
    const flex = s.addFlexible({ title: 'x', startTime: T(15), endTime: T(16) });

    expect(blockerKind(s, pinned)).toBe('pinned');
    expect(blockerKind(s, fixed)).toBe('fixed');
    expect(blockerKind(s, rest)).toBe('protected');
    expect(blockerKind(s, flex)).toBe('flexible');

    for (const t of [pinned, fixed, rest]) expect(isHardBlocker(s, t)).toBe(true);
    expect(isHardBlocker(s, flex)).toBe(false);
  });
});

describe('dayState is read from the real day (§3.2)', () => {
  it('mirrors rippleShift\'s own chain + break arithmetic', () => {
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    // Three downstream tasks, each behind a 20-min gap → 15 compressible each.
    s.addFlexible({ title: 't1', startTime: T(10, 20), endTime: T(10, 50) });
    s.addFlexible({ title: 't2', startTime: T(11, 10), endTime: T(11, 40) });
    s.addFlexible({ title: 't3', startTime: T(12), endTime: T(12, 30) });

    const ds = buildDayState(s, pivot, pivot.endTime, []);
    expect(ds.downstreamCount).toBe(3);
    expect(ds.spareBreakMin).toBe(45); // == the engine's absorbedByBreaks for delta 60
    expect(ds.taskMin).toBe(30);
    // Mon window ends 18:00; the chain's tail is 12:30 → 330 minutes of room.
    expect(ds.tailRoomMin).toBe(330);
    expect(ds.displaceMoveMin).toBe(0); // no blockers passed → nothing to evict
  });

  it('stops the chain at a wall, exactly like rippleShift', () => {
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    s.addFlexible({ title: 'flex', startTime: T(10, 30), endTime: T(11) });
    const wall = s.addFixed({ title: 'wall', startTime: T(12), endTime: T(13) });
    wall.pinned = true;
    s.addFlexible({ title: 'after', startTime: T(14), endTime: T(15) });

    const { affected, wall: found } = affectedChain(s, pivot, pivot.endTime);
    expect(affected.map((t) => t.title)).toEqual(['flex']);
    expect(found.title).toBe('wall');

    const ds = buildDayState(s, pivot, pivot.endTime, []);
    expect(ds.downstreamCount).toBe(1);
    expect(ds.tailRoomMin).toBe(60); // 11:00 → the wall at 12:00
  });

  it('asks the engine how far an evicted task would actually travel', () => {
    const pivot = s.addFixed({ title: 'Drop', startTime: T(9), endTime: T(10) });
    const victim = s.addFlexible({ title: 'victim', startTime: T(9, 30), endTime: T(10, 30) });
    const ds = buildDayState(s, pivot, pivot.endTime, [victim]);
    expect(ds.displaceMoveMin).toBeGreaterThan(0);
    expect(victim.startTime.getTime()).toBe(T(9, 30).getTime()); // estimate only, no mutation
  });
});

describe('commit paths never leave a silent overlap', () => {
  const overlapsOnDay = () => {
    const day = s.getTasksForDay(MON);
    const bad = [];
    for (let i = 0; i < day.length; i += 1) {
      for (let j = i + 1; j < day.length; j += 1) {
        if (day[i].overlaps(day[j])) bad.push([day[i].title, day[j].title]);
      }
    }
    return bad;
  };

  it('commitRipple shifts the chain and clears the pivot', () => {
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    const t1 = s.addFlexible({ title: 't1', startTime: T(10, 20), endTime: T(10, 50) });

    // Sand-resize 10:00 → 10:30, then ripple by the growth from the old end.
    const oldEnd = new Date(pivot.endTime.getTime());
    s.updateTask(pivot.id, { endTime: T(10, 30) });
    const res = commitRipple(s, pivot, oldEnd, 30);

    expect(res.absorbedByBreaks).toBe(15); // the 20-min gap compresses to 5
    expect(t1.startTime.getTime()).toBe(T(10, 35).getTime()); // shifted by the residual
    expect(overlapsOnDay()).toEqual([]);
    expect(pivot.endTime.getTime()).toBe(T(10, 30).getTime()); // pivot's end restored
  });

  it('commitRipple cascades the chain clear of the resized pivot — no eviction needed', () => {
    // Two downstream gaps. The engine used to pool their slack and shift nobody,
    // leaving t1 sitting under the resized pivot for the integrity pass to
    // evict. With cascaded absorption t1 simply moves, the first gap gives up
    // what it can, and the cleanup pass finds nothing left to resolve.
    const pivot = s.addFixed({ title: 'Meeting', startTime: T(9), endTime: T(10) });
    const t1 = s.addFlexible({ title: 't1', startTime: T(10, 20), endTime: T(10, 50) });
    s.addFlexible({ title: 't2', startTime: T(11, 10), endTime: T(11, 40) });

    const oldEnd = new Date(pivot.endTime.getTime());
    s.updateTask(pivot.id, { endTime: T(10, 30) });
    const res = commitRipple(s, pivot, oldEnd, 30);

    expect(res.shifted.map((t) => t.id)).toContain(t1.id);
    expect(t1.startTime.getTime()).toBeGreaterThanOrEqual(pivot.endTime.getTime());
    expect(res.cleanup.displaced.length).toBe(0); // the engine no longer leaves a mess
    expect(overlapsOnDay()).toEqual([]);
  });

  it('commitDisplace evicts the collided task only (R-1: priority ignored)', () => {
    const victim = s.addFlexible({
      title: 'victim', priority: 5, startTime: T(12), endTime: T(13),
    });
    const dropped = s.addFixed({ title: 'dropped', priority: 1, startTime: T(9), endTime: T(10) });
    dropped.moveTo(T(12)); // the drag

    const res = commitDisplace(s, dropped);
    expect(res.displaced.map((t) => t.id)).toContain(victim.id);
    expect(dropped.startTime.getTime()).toBe(T(12).getTime()); // the drop wins
    expect(overlapsOnDay()).toEqual([]);
  });

  it('a drop onto an anchor is rejected by the engine before anything moves', () => {
    const gym = s.addFixed({ title: 'Gym', startTime: T(12), endTime: T(13) });
    gym.pinned = true;
    const other = s.addFlexible({ title: 'other', startTime: T(15), endTime: T(16) });
    const dropped = s.addFlexible({ title: 'dropped', startTime: T(9), endTime: T(10) });
    dropped.moveTo(T(12));

    const res = commitDisplace(s, dropped);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('Conflicts with pinned: Gym');
    expect(other.startTime.getTime()).toBe(T(15).getTime()); // nothing displaced
  });
});
