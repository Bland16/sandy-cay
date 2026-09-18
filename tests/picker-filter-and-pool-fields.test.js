// Three fixes from session 9's audit, each proven against the failure it fixes.
//
// F-1  the category filter ran AFTER the limit, so picking a category showed
//      nothing unless one of its activities made an unfiltered top five
// F-2a `ratedSamples()` dropped `activityId` from materialised occurrences
// F-2b `ratedSamples()` dropped `load` from the same literal
//
// Each test below was run against the UNFIXED code first and observed to fail —
// a regression test that passes before the fix proves nothing (NEXT-AGENT.md).

import { describe, it, expect } from 'vitest';
import { Schedule } from '../src/core/index.js';
import { suggestActivities } from '../src/core/suggest.js';

const MON = new Date(2026, 8, 14, 9, 0, 0); // Mon 14 Sep 2026, 09:00

/** An opening wide enough that every activity below fits it. */
const opening = (minutes = 240) => ({
  start: new Date(MON),
  end: new Date(MON.getTime() + minutes * 60000),
  minutes,
  nextTask: null,
  startsLater: false,
});

/**
 * Six activities in two buckets. `rest` is authored FIRST and alphabetically
 * early so it wins the unfiltered ranking; `making` sits behind it. That is the
 * shape of the real bug: a category whose activities exist, fit, and are simply
 * not in the top five.
 */
function libraryOf() {
  const s = new Schedule({ tasks: [] });
  const rest = s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -1.5, physical: -1 } });
  const making = s.addBucket({ label: 'Making', tags: ['making'], load: { creative: 1.5 } });
  // Five in the bucket that wins, so a top-5 is filled entirely from it.
  for (const label of ['Aa nap', 'Ab tea', 'Ac water', 'Ad journal', 'Ae phone break']) {
    s.addActivity({ label, bucketId: rest.id, tags: ['rest'], durationMin: 15, durationMax: 60 });
  }
  // One in the bucket that loses. It fits; it is simply ranked sixth or later.
  s.addActivity({ label: 'Zz write poetry', bucketId: making.id, tags: ['making'], durationMin: 30, durationMax: 90 });
  return s;
}

describe('F-1 — a category always returns something (filter before the limit)', () => {
  it('returns the losing bucket\'s activity when that category is asked for', () => {
    const s = libraryOf();

    // Control: unfiltered, the top five are all from the winning bucket, and the
    // `making` activity is nowhere in them. This is what made the bug invisible.
    const top5 = suggestActivities(s, MON, { opening: opening(), limit: 5 });
    expect(top5).toHaveLength(5);
    expect(top5.some((p) => p.activity.tags.includes('making'))).toBe(false);

    // The fix: narrowing to `making` must return it, not an empty panel.
    const filtered = suggestActivities(s, MON, { opening: opening(), limit: 5, tags: ['making'] });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered[0].activity.label).toBe('Zz write poetry');
  });

  it('every category with a fitting activity returns at least one pick', () => {
    const s = libraryOf();
    for (const tag of ['rest', 'making']) {
      const picks = suggestActivities(s, MON, { opening: opening(), limit: 5, tags: [tag] });
      expect(picks.length, `category "${tag}" came back empty`).toBeGreaterThan(0);
      // And nothing from another category leaks in.
      for (const p of picks) expect(p.activity.tags).toContain(tag);
    }
  });

  it('several tags union rather than intersect, and no tags means no filter', () => {
    const s = libraryOf();
    const both = suggestActivities(s, MON, { opening: opening(), limit: 10, tags: ['rest', 'making'] });
    expect(both).toHaveLength(6);

    for (const empty of [undefined, null, []]) {
      const all = suggestActivities(s, MON, { opening: opening(), limit: 10, tags: empty });
      expect(all).toHaveLength(6);
    }
  });

  it('the limit still applies AFTER the filter', () => {
    const s = libraryOf();
    const picks = suggestActivities(s, MON, { opening: opening(), limit: 2, tags: ['rest'] });
    expect(picks).toHaveLength(2);
  });

  it('a category whose activities do not fit the opening still returns empty, honestly', () => {
    const s = libraryOf();
    // 'Zz write poetry' needs 30; a 20-minute opening cannot hold it.
    const picks = suggestActivities(s, MON, { opening: opening(20), limit: 5, tags: ['making'] });
    expect(picks).toHaveLength(0);
  });
});

describe('F-2 — ratedSamples carries activityId and load through to the pool', () => {
  /** A weekly pattern carrying both fields, with one rated occurrence. */
  function ratedOccurrence(extra = {}) {
    const s = new Schedule({});
    const parent = s.addFixed({
      title: 'Gym',
      tags: ['gym'],
      startTime: new Date(2026, 8, 15, 18, 0, 0),
      endTime: new Date(2026, 8, 15, 19, 0, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'tue', start: '18:00', end: '19:00' }], interval: 1, effectiveFrom: MON }],
        anchorDate: MON,
        exceptions: [],
      },
      ...extra,
    });
    const occs = s.getTasksForWeek(MON).filter((t) => t.isOccurrence);
    expect(occs.length, 'fixture produced no occurrence').toBeGreaterThan(0);
    s.rateOccurrence(occs[0], { completion: 'done', satisfaction: { overall: 4, energy: 1 } });
    return { s, parent };
  }

  const WITH_FIELDS = { activityId: 'gym-act', load: { physical: 2 } };

  it('the parent carries both fields (fixture guard)', () => {
    const { parent } = ratedOccurrence(WITH_FIELDS);
    expect(parent.activityId).toBe('gym-act');
    expect(parent.load).toMatchObject({ physical: 2 });
  });

  it('a materialised rated occurrence carries activityId', () => {
    const { s } = ratedOccurrence(WITH_FIELDS);
    const sample = s.ratedSamples().find((t) => t.isOccurrence);
    expect(sample, 'no occurrence reached the pool').toBeTruthy();
    expect(sample.activityId).toBe('gym-act');
  });

  it('a materialised rated occurrence carries its own load, not its tags\' buckets', () => {
    const { s } = ratedOccurrence(WITH_FIELDS);
    const sample = s.ratedSamples().find((t) => t.isOccurrence);
    expect(sample.load).toMatchObject({ physical: 2 });
  });

  it('a pattern carrying neither field yields null for both, not undefined', () => {
    const { s } = ratedOccurrence();
    const sample = s.ratedSamples().find((t) => t.isOccurrence);
    expect(sample.activityId).toBeNull();
    expect(sample.load).toBeNull();
  });
});
