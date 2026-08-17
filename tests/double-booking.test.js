// Three SILENT double-booking defects, found by probe agents 2026-08-16.
//
// Silent is the word that matters: no warning, no coral, no schedulingWarning.
// A task simply sits on top of another one, and 776 green tests saw nothing.
// Two of the three were found independently by two agents from opposite sides.
//
// Each test was verified to BITE by reverting its own fix and watching only it
// fail (design/probes/probe-verify-doublebook.mjs prints all three).
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, defaultConfig, resetIds, addDays, resolveDropConflicts,
} from '../src/core/index.js';

const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

/** A weekly Monday 09:00–11:00 lecture, as a real recurring anchor. */
function withLecture(s, MON) {
  const a = new Date(MON); a.setHours(9, 0, 0, 0);
  const b = new Date(MON); b.setHours(11, 0, 0, 0);
  s.tasks.push(new Task({
    title: 'Lecture',
    tags: ['classes'],
    type: 'fixed',
    pinned: true,
    startTime: a,
    endTime: b,
    recurrence: {
      periods: [{
        windows: [{ day: 'mon', start: '09:00', end: '11:00' }],
        interval: 1,
        effectiveFrom: null,
        effectiveUntil: null,
      }],
      anchorDate: MON,
      exceptions: [],
    },
  }));
}

describe('a ZONE hour outside config.windows is not free time', () => {
  it('does not place on top of what is already in it', () => {
    // Since SPEC §2.1's amendment a zone DEFINES the window for its own tags
    // and is no longer clipped to the day window — but `findBestSlot` sliced
    // its occupied set by `dayWindowBounds`, so an hour inside the zone and
    // outside `config.windows` was dropped and then walked as if empty.
    //
    // Stock config is enough: Sunday opens at 10:00, so any Sunday-morning zone
    // does it. Measured before the fix: Stretch placed 08:00–08:45 on top of an
    // 08:00–09:00 run.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    s.addZone({
      label: 'Runs',
      matchTags: ['run'],
      windows: [{ day: 'sun', start: '08:00', end: '10:00' }],
      exclusive: false,
    });
    const SUN = addDays(new Date(2026, 8, 7), 6);
    const st = new Date(SUN); st.setHours(8, 0, 0, 0);
    const en = new Date(SUN); en.setHours(9, 0, 0, 0);
    const run = s.addFixed({ title: 'Long run', tags: ['run'], startTime: st, endTime: en });
    const stretch = s.addFlexible({ title: 'Stretch', tags: ['run'], durationMin: 45, from: SUN, to: SUN });
    expect(overlaps(stretch, run)).toBe(false);
  });
});

describe('the occupied set spans the SEARCH range, not one week', () => {
  it('sees next Monday when the 3-day lookahead crosses Sunday', () => {
    // `_occupiedExcluding` expanded recurrence for `weekStart(from)` alone,
    // while `findBestSlot` runs `from … from + maxPlacementLookahead` (3 days)
    // and crosses the Sun→Mon seam. Sharp edge #3, reintroduced.
    // Measured before the fix: Essay landed 08:00–10:00 on the Monday, on top
    // of the 09:00–11:00 lecture.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const MON = new Date(2026, 8, 14); MON.setHours(0, 0, 0, 0);
    withLecture(s, MON);
    const SAT = addDays(MON, -2);
    const satFrom = new Date(SAT); satFrom.setHours(8, 0, 0, 0);
    const sunTo = addDays(SAT, 1); sunTo.setHours(23, 0, 0, 0);
    s.addFixed({ title: 'Weekend away', startTime: satFrom, endTime: sunTo });

    const essay = s.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 120, from: satFrom });
    for (const occ of s.getTasksForWeek(MON).filter((t) => t.title === 'Lecture')) {
      expect(overlaps(essay, occ)).toBe(false);
    }
  });

  it('sees it during DISPLACEMENT too', () => {
    // The same blindness in conflicts.js: it built occupied from `ws` while
    // re-placing each evictee over three days from the target's own day.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const MON = new Date(2026, 8, 14); MON.setHours(0, 0, 0, 0);
    withLecture(s, MON);
    const SAT = addDays(MON, -2);
    const vFrom = new Date(SAT); vFrom.setHours(14, 0, 0, 0);
    const vTo = new Date(SAT); vTo.setHours(16, 0, 0, 0);
    const victim = s.addFlexible({ title: 'Victim', tags: ['study'], startTime: vFrom, endTime: vTo });
    const fillFrom = new Date(SAT); fillFrom.setHours(8, 0, 0, 0);
    const fillTo = addDays(SAT, 1); fillTo.setHours(23, 0, 0, 0);
    const dropped = new Task({ title: 'Big drop', type: 'fixed', startTime: fillFrom, endTime: fillTo });
    s.tasks.push(dropped);

    resolveDropConflicts(s, dropped, [victim], { now: fillFrom });
    for (const occ of s.getTasksForWeek(MON).filter((t) => t.title === 'Lecture')) {
      expect(overlaps(victim, occ)).toBe(false);
    }
  });
});
