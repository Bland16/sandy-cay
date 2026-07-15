import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { sliceChunks, shrinkChunk, growChunk, deleteChunk, finishProject } from '../src/core/projects.js';
import { defaultConfig } from '../src/core/config.js';
import { addDays } from '../src/core/time.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);

function childrenOf(s, parentId) {
  return s.tasks.filter((t) => t.parentId === parentId);
}
function totalMin(s, parentId) {
  return childrenOf(s, parentId).reduce((sum, t) => sum + t.getDuration(), 0);
}

describe('§3.7 / OD-14 — projects & work conservation', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('sliceChunks divides total into valid [min,max] pieces', () => {
    expect(sliceChunks(360, 60, 120)).toEqual([120, 120, 120]);
    expect(sliceChunks(600, 60, 180).reduce((a, b) => a + b, 0)).toBe(600);
    expect(sliceChunks(90, 60, 120)).toEqual([90]);
  });

  it('addProject materializes children summing to the total', () => {
    const { parent, children } = s.addProject({
      title: 'Thesis',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    expect(children.length).toBe(3);
    expect(totalMin(s, parent.id)).toBe(360);
  });

  it('shrink chunk → Δ flows to siblings, total conserved', () => {
    const { parent } = s.addProject({
      title: 'Thesis',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const first = childrenOf(s, parent.id)[0];
    shrinkChunk(s, first.id, 60); // shrink by 1h
    expect(first.getDuration()).toBe(60);
    expect(totalMin(s, parent.id)).toBe(360); // conserved
  });

  it('grow chunk → siblings shrink/dissolve, total conserved', () => {
    const { parent } = s.addProject({
      title: 'Thesis',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const first = childrenOf(s, parent.id)[0];
    growChunk(s, first.id, 60);
    expect(first.getDuration()).toBe(180);
    expect(totalMin(s, parent.id)).toBe(360); // conserved
  });

  it('delete chunk: remove shrinks total; redistribute conserves', () => {
    const p1 = s.addProject({
      title: 'A',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const c1 = childrenOf(s, p1.parent.id)[0];
    const dur = c1.getDuration();
    deleteChunk(s, c1.id, 'remove');
    expect(totalMin(s, p1.parent.id)).toBe(360 - dur);

    const p2 = s.addProject({
      title: 'B',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const c2 = childrenOf(s, p2.parent.id)[0];
    deleteChunk(s, c2.id, 'redistribute');
    expect(totalMin(s, p2.parent.id)).toBe(360); // conserved
  });

  it('no capacity anywhere → parent schedulingWarning', () => {
    const { parent } = s.addProject({
      title: 'Huge',
      tags: ['thesis'],
      // 20h into a single Sunday (10:00–14:00 window) → cannot fit.
      chunking: { totalMinutes: 1200, minChunk: 120, maxChunk: 120, range: { from: addDays(MON, 6), until: addDays(MON, 6) } },
    });
    expect(parent.schedulingWarning).toBe(true);
  });

  it('finishProject removes incomplete chunks and records actual-vs-planned', () => {
    const { parent } = s.addProject({
      title: 'Thesis',
      tags: ['thesis'],
      chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    const kids = childrenOf(s, parent.id);
    kids[0].completion = 'done';
    const res = finishProject(s, parent.id);
    expect(parent.completion).toBe('done');
    expect(res.actual).toBe(kids[0].getDuration());
    expect(childrenOf(s, parent.id).filter((t) => t.completion === null).length).toBe(0);
  });
});

describe('placement respects recurrence occurrences (F3 regression)', () => {
  beforeEach(() => resetIds());

  /** A pinned recurring gym, Mon/Tue 08:00–09:00 — same shape as seed(). */
  function withGym() {
    const s = new Schedule({ config: defaultConfig });
    const gym = s.addFixed({ title: 'Morning gym', startTime: new Date(2026, 6, 13, 8), endTime: new Date(2026, 6, 13, 9) });
    gym.pinned = true;
    gym.recurrence = {
      periods: [{
        windows: [
          { day: 'mon', start: '08:00', end: '09:00' },
          { day: 'tue', start: '08:00', end: '09:00' },
        ],
        interval: 1, effectiveFrom: null, effectiveUntil: null,
      }],
      anchorDate: MON,
      exceptions: [],
    };
    return s;
  }

  /** Do any of `tasks` sit on top of a materialized gym occurrence? */
  function clashesWithGym(s, tasks) {
    const occs = s.getTasksForWeek(MON).filter((t) => t.isOccurrence);
    return tasks.some((t) => occs.some((o) => t.overlaps(o)));
  }

  it('project chunks are not placed through a pinned recurring gym', () => {
    // The occupied set filtered the recurring PARENT out (right — it's a pattern
    // record) but never added its occurrences back, so 08:00–09:00 looked free.
    const s = withGym();
    const { children } = s.addProject({
      title: 'Thesis',
      chunking: { totalMinutes: 240, minChunk: 60, maxChunk: 120, range: { from: MON, until: addDays(MON, 5) } },
    });
    expect(children.length).toBeGreaterThan(0);
    expect(clashesWithGym(s, children)).toBe(false);
  });

  it('evacuateDay does not relocate onto a recurring occurrence', () => {
    const s = withGym();
    const victim = s.addFlexible({ title: 'Victim', startTime: new Date(2026, 6, 15, 10), endTime: new Date(2026, 6, 15, 11) });
    s.evacuateDay(new Date(2026, 6, 15), { blockDay: false });
    expect(clashesWithGym(s, [victim])).toBe(false);
  });

  it('carryOver does not carry a task onto a recurring occurrence', () => {
    const s = withGym();
    const late = s.addFlexible({ title: 'Unfinished', startTime: new Date(2026, 6, 7, 8), endTime: new Date(2026, 6, 7, 9) });
    s.carryOver(addDays(MON, -7), MON, { now: new Date(2026, 6, 13, 12) });
    expect(clashesWithGym(s, [late])).toBe(false);
  });
});
