import { describe, it, expect, beforeEach } from 'vitest';
import {
  Schedule, Bucket, Activity, Task, resetIds,
  seedStarterBuckets, STARTER_BUCKETS,
  exportState, summarizeImport,
} from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const fresh = () => new Schedule({ config: defaultConfig });

describe('Bucket', () => {
  beforeEach(() => resetIds());

  it('constructs with a stable id, defaults, and a validated role', () => {
    const b = new Bucket({ label: 'Rest', role: 'rest', tags: ['rest', 'nap'] });
    expect(b.id).toBe('rest-bucket');
    expect(b.role).toBe('rest');
    expect(b.tags).toEqual(['rest', 'nap']);
    // An unknown role falls back to neutral rather than persisting garbage.
    expect(new Bucket({ label: 'X', role: 'bogus' }).role).toBe('neutral');
  });

  it('matches a task by tag intersection', () => {
    const b = new Bucket({ label: 'Work', role: 'work', tags: ['work', 'study'] });
    expect(b.matches({ tags: ['study'] })).toBe(true);
    expect(b.matches({ tags: ['rest'] })).toBe(false);
    expect(b.matches({})).toBe(false);
  });

  it('round-trips through JSON', () => {
    const b = new Bucket({ label: 'Creative', role: 'creative', tags: ['art'], color: '#123456' });
    const back = Bucket.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(back).toEqual(b);
  });
});

describe('Activity', () => {
  beforeEach(() => resetIds());

  it('guards the duration range (min ≥ 15 grid minimum, max ≥ min)', () => {
    expect(new Activity({ label: 'A', durationMin: 5 }).durationMin).toBe(15);
    const a = new Activity({ label: 'B', durationMin: 30, durationMax: 20 });
    expect(a.durationMin).toBe(30);
    expect(a.durationMax).toBe(30); // clamped up to min
  });

  it('durationFor fills the opening: clamp(opening, min, max)', () => {
    const a = new Activity({ label: 'Read', durationMin: 15, durationMax: 90 });
    expect(a.durationFor(30)).toBe(30);
    expect(a.durationFor(10)).toBe(15); // never below min
    expect(a.durationFor(120)).toBe(90); // never above max
  });

  it('fits an opening iff it is at least the minimum', () => {
    const a = new Activity({ label: 'Read', durationMin: 15, durationMax: 90 });
    expect(a.fits(10)).toBe(false);
    expect(a.fits(15)).toBe(true);
    expect(a.fits(200)).toBe(true);
  });

  it('round-trips through JSON', () => {
    const a = new Activity({ label: 'Sketch', bucketId: 'creative-bucket', tags: ['art'], durationMin: 20, durationMax: 60, priority: 3 });
    const back = Activity.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(back).toEqual(a);
  });
});

describe('Schedule — activity-library CRUD', () => {
  beforeEach(() => resetIds());

  it('adds / updates / removes buckets and activities', () => {
    const s = fresh();
    const b = s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] });
    expect(s.buckets).toHaveLength(1);
    s.updateBucket(b.id, { role: 'neutral' });
    expect(s.buckets[0].role).toBe('neutral');

    const a = s.addActivity({ label: 'Read', bucketId: b.id, tags: ['leisure'], durationMin: 15, durationMax: 90 });
    expect(s.activities).toHaveLength(1);
    s.updateActivity(a.id, { durationMax: 120 });
    expect(s.activities[0].durationMax).toBe(120);

    expect(s.removeActivity(a.id)).toBe(a);
    expect(s.activities).toHaveLength(0);
    expect(s.removeActivity('nope')).toBeNull();
  });

  it('removing a bucket orphans its activities rather than deleting them', () => {
    const s = fresh();
    const b = s.addBucket({ label: 'Home', role: 'work', tags: ['chores'] });
    const a = s.addActivity({ label: 'Dishes', bucketId: b.id, tags: ['chores'] });
    s.removeBucket(b.id);
    expect(s.buckets).toHaveLength(0);
    expect(s.activities).toHaveLength(1); // survives
    expect(s.activities[0].bucketId).toBeNull(); // orphaned
  });

  it('retires and un-retires tags', () => {
    const s = fresh();
    s.retireTag('deadline-crunch');
    s.retireTag('deadline-crunch'); // idempotent
    expect(s.retiredTags).toEqual(['deadline-crunch']);
    expect(s.isTagRetired('deadline-crunch')).toBe(true);
    s.unretireTag('deadline-crunch');
    expect(s.isTagRetired('deadline-crunch')).toBe(false);
  });

  it('resolves a task to its bucket role (first match, else neutral)', () => {
    const s = fresh();
    s.addBucket({ label: 'Work', role: 'work', tags: ['work', 'study'] });
    expect(s.roleOf(new Task({ title: 'Essay', tags: ['study'] }))).toBe('work');
    expect(s.roleOf(new Task({ title: 'Walk', tags: ['outdoors'] }))).toBe('neutral');
  });
});

describe('Schedule — persistence', () => {
  beforeEach(() => resetIds());

  it('round-trips buckets, activities and retired tags', () => {
    const s = fresh();
    const b = s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] });
    s.addActivity({ label: 'Read', bucketId: b.id, tags: ['leisure'], durationMin: 15, durationMax: 90 });
    s.retireTag('oldtag');

    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.buckets).toHaveLength(1);
    expect(back.buckets[0].role).toBe('rest');
    expect(back.activities).toHaveLength(1);
    expect(back.activities[0].label).toBe('Read');
    expect(back.activities[0].durationMax).toBe(90);
    expect(back.retiredTags).toEqual(['oldtag']);
  });

  it('loads a pre-feature save clean (no buckets/activities/retiredTags keys)', () => {
    const old = { schemaVersion: 1, tasks: [], zones: [], config: defaultConfig, model: null };
    const s = Schedule.fromJSON(old);
    expect(s.buckets).toEqual([]);
    expect(s.activities).toEqual([]);
    expect(s.retiredTags).toEqual([]);
  });

  it('footlocker export includes them and re-imports (replace path, sharp edge #15)', () => {
    const s = fresh();
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] });
    s.addActivity({ label: 'Read' });
    s.retireTag('x');

    const { data } = exportState(s, new Date(2026, 6, 15));
    const sum = summarizeImport(data);
    expect(sum.valid).toBe(true);
    expect(sum.bucketCount).toBe(1);
    expect(sum.activityCount).toBe(1);

    const back = Schedule.fromJSON(data); // what useEngine#replace consumes
    expect(back.buckets).toHaveLength(1);
    expect(back.activities).toHaveLength(1);
    expect(back.retiredTags).toEqual(['x']);
  });
});

describe('seedStarterBuckets', () => {
  beforeEach(() => resetIds());

  it('seeds the six starter buckets when empty, and is idempotent', () => {
    const s = fresh();
    const added = seedStarterBuckets(s);
    expect(added).toHaveLength(STARTER_BUCKETS.length);
    expect(s.buckets).toHaveLength(6);
    expect(s.buckets.map((b) => b.role)).toEqual(
      expect.arrayContaining(['rest', 'work', 'creative', 'social', 'health']),
    );
    // A second call never clobbers an edited set.
    expect(seedStarterBuckets(s)).toEqual([]);
    expect(s.buckets).toHaveLength(6);
  });
});
