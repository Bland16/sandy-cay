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

  it('constructs with a stable id, tags, a colour, and neutral load (no role)', () => {
    const b = new Bucket({ label: 'Rest', tags: ['rest', 'nap'] });
    expect(b.id).toBe('rest-bucket');
    expect(b.tags).toEqual(['rest', 'nap']);
    expect(b.load).toEqual({ mental: 0, physical: 0, social: 0, creative: 0 });
    expect(b.role).toBeUndefined(); // the role enum is gone (reconciliation)
  });

  it('matches a task by tag intersection', () => {
    const b = new Bucket({ label: 'Work', tags: ['work', 'study'] });
    expect(b.matches({ tags: ['study'] })).toBe(true);
    expect(b.matches({ tags: ['rest'] })).toBe(false);
    expect(b.matches({})).toBe(false);
  });

  it('round-trips through JSON', () => {
    const b = new Bucket({ label: 'Creative', tags: ['art'], color: '#123456', load: { creative: 2 } });
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
    const b = s.addBucket({ label: 'Rest', tags: ['rest'] });
    expect(s.buckets).toHaveLength(1);
    s.updateBucket(b.id, { label: 'Downtime' });
    expect(s.buckets[0].label).toBe('Downtime');

    const a = s.addActivity({ label: 'Read', bucketId: b.id, tags: ['leisure'], durationMin: 15, durationMax: 90 });
    expect(s.activities).toHaveLength(1);
    s.updateActivity(a.id, { durationMax: 120 });
    expect(s.activities[0].durationMax).toBe(120);

    expect(s.removeActivity(a.id)).toBe(a);
    expect(s.activities).toHaveLength(0);
    expect(s.removeActivity('nope')).toBeNull();
  });

  it('gives each added bucket/activity a unique id even with the same label (two-in-a-row bug)', () => {
    const s = fresh();
    const b1 = s.addBucket({ label: 'New bucket', tags: [] });
    const b2 = s.addBucket({ label: 'New bucket', tags: [] });
    expect(b1.id).not.toBe(b2.id); // ids don't collide
    s.updateBucket(b1.id, { label: 'First' });
    expect(s.buckets.find((x) => x.id === b2.id).label).toBe('New bucket'); // editing one leaves the other

    const a1 = s.addActivity({ label: 'New activity' });
    const a2 = s.addActivity({ label: 'New activity' });
    expect(a1.id).not.toBe(a2.id);
  });

  it('repairs duplicate ids already present in a save (load-time dedupe)', () => {
    // Two buckets sharing an id, as a pre-fix save could contain.
    const s = Schedule.fromJSON({
      schemaVersion: 1, tasks: [], zones: [], config: defaultConfig,
      buckets: [
        { id: 'dup-bucket', label: 'A', tags: [] },
        { id: 'dup-bucket', label: 'B', tags: [] },
      ],
    });
    expect(s.buckets[0].id).not.toBe(s.buckets[1].id);
  });

  it('removing a bucket orphans its activities rather than deleting them', () => {
    const s = fresh();
    const b = s.addBucket({ label: 'Home', tags: ['chores'] });
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

  it('resolves a task to its bucket by tag (first match, else null)', () => {
    const s = fresh();
    const work = s.addBucket({ label: 'Work', tags: ['work', 'study'] });
    expect(s.bucketForTask(new Task({ title: 'Essay', tags: ['study'] }))).toBe(work);
    expect(s.bucketForTask(new Task({ title: 'Walk', tags: ['outdoors'] }))).toBeNull();
  });
});

describe('Schedule — persistence', () => {
  beforeEach(() => resetIds());

  it('round-trips buckets, activities and retired tags', () => {
    const s = fresh();
    const b = s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2 } });
    s.addActivity({ label: 'Read', bucketId: b.id, tags: ['leisure'], durationMin: 15, durationMax: 90 });
    s.retireTag('oldtag');

    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.buckets).toHaveLength(1);
    expect(back.buckets[0].load).toEqual({ mental: -2, physical: 0, social: 0, creative: 0 });
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
    s.addBucket({ label: 'Rest', tags: ['rest'] });
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
    expect(s.buckets.map((b) => b.label)).toEqual(
      expect.arrayContaining(['Rest', 'Work / School', 'Creative', 'Social', 'Health']),
    );
    // A second call never clobbers an edited set.
    expect(seedStarterBuckets(s)).toEqual([]);
    expect(s.buckets).toHaveLength(6);
  });
});
