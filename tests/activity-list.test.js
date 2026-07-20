// Filter / sort / paginate for a long Activity Library (EDITOR-REDESIGN §7.1).
import { describe, it, expect } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import {
  activityUsage, activityPage, filterActivities, sortActivities, paginate,
  dedupeDrafts, dedupeBulk, parseBulkBlock,
} from '../src/core/activityList.js';

const D = (d, h = 9) => new Date(2026, 6, d, h, 0, 0, 0);
const NOW = D(20, 12); // Mon 2026-07-20
const act = (label, id = label.toLowerCase()) => ({ id, label });

describe('§7.1 — filtering', () => {
  const list = [act('Read a novel'), act('Nap'), act('Read the news'), act('Run')];

  it('matches a case-insensitive substring of the label', () => {
    expect(filterActivities(list, 'read').map((a) => a.label)).toEqual(['Read a novel', 'Read the news']);
    expect(filterActivities(list, 'READ').length).toBe(2);
    expect(filterActivities(list, 'ovel').map((a) => a.label)).toEqual(['Read a novel']);
  });

  it('an empty or whitespace query matches everything, and does not alias to "no results"', () => {
    expect(filterActivities(list, '').length).toBe(4);
    expect(filterActivities(list, '   ').length).toBe(4);
  });

  it('no match yields an empty list, not the unfiltered one', () => {
    expect(filterActivities(list, 'zzz')).toEqual([]);
  });
});

describe('§7.1 — sorting', () => {
  const list = [act('banana'), act('Apple'), act('cherry')];

  it('A–Z is case-insensitive, so capitalisation does not shuffle the list', () => {
    expect(sortActivities(list, 'az').map((a) => a.label)).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('Z–A is the exact reverse', () => {
    expect(sortActivities(list, 'za').map((a) => a.label)).toEqual(['cherry', 'banana', 'Apple']);
  });

  it('most-used ranks by count, descending', () => {
    const usage = { apple: 1, banana: 9, cherry: 4 };
    expect(sortActivities(list, 'used', usage).map((a) => a.label)).toEqual(['banana', 'cherry', 'Apple']);
  });

  it('most-used tiebreaks A–Z — so a fresh install (all zero) is alphabetical, not arbitrary', () => {
    // The cold-start trap: with no history every count is 0, and without the
    // tiebreak this degenerates to insertion order, which looks stable but means
    // nothing to the user.
    expect(sortActivities(list, 'used', {}).map((a) => a.label)).toEqual(['Apple', 'banana', 'cherry']);
    expect(sortActivities(list, 'used', { apple: 3, banana: 3, cherry: 3 }).map((a) => a.label))
      .toEqual(['Apple', 'banana', 'cherry']);
  });

  it('does not mutate the input array', () => {
    const original = [...list];
    sortActivities(list, 'za');
    expect(list).toEqual(original);
  });
});

describe('§7.1 — pagination', () => {
  const list = Array.from({ length: 20 }, (_, i) => act(`A${String(i).padStart(2, '0')}`, `a${i}`));

  it('slices to the page size and reports the page count', () => {
    const p = paginate(list, 1, 8);
    expect(p.items.length).toBe(8);
    expect(p.pageCount).toBe(3);
    expect(p.total).toBe(20);
  });

  it('the last page holds the remainder', () => {
    expect(paginate(list, 3, 8).items.length).toBe(4);
  });

  it('an out-of-range page clamps rather than returning nothing', () => {
    expect(paginate(list, 99, 8).page).toBe(3);
    expect(paginate(list, 0, 8).page).toBe(1);
    expect(paginate(list, -5, 8).items.length).toBe(8);
  });

  it('an empty list is one page, not zero — the pager never reads "1 of 0"', () => {
    const p = paginate([], 1, 8);
    expect(p.pageCount).toBe(1);
    expect(p.items).toEqual([]);
  });
});

describe('§7.1 — the pipeline runs filter → sort → paginate', () => {
  const list = [
    act('Read a novel', 'r1'), act('Nap', 'n'), act('Read the news', 'r2'),
    act('Run', 'ru'), act('Rest', 're'),
  ];

  it('page 2 never shows a row the filter excluded (the classic ordering bug)', () => {
    // If pagination ran before filtering, page 2 of the unfiltered list would be
    // sliced and THEN filtered, leaking non-matching rows or blanking the page.
    const p = activityPage(list, { query: 'r', sort: 'az', page: 2, pageSize: 2 });
    expect(p.total).toBe(4); // Read a novel, Read the news, Rest, Run — not Nap
    expect(p.items.every((a) => a.label.toLowerCase().includes('r'))).toBe(true);
  });

  it('reports whether a filter is active, so the empty state can differ', () => {
    expect(activityPage(list, { query: 'zzz' }).filtered).toBe(true);
    expect(activityPage(list, { query: 'zzz' }).total).toBe(0);
    expect(activityPage(list, { query: '' }).filtered).toBe(false);
  });

  it('a filter that shrinks the list clamps the page instead of stranding on an empty one', () => {
    const p = activityPage(list, { query: 'nap', page: 4, pageSize: 2 });
    expect(p.page).toBe(1);
    expect(p.items.map((a) => a.label)).toEqual(['Nap']);
  });
});

describe('§7.1 — activityUsage counts instantiations in the trailing window', () => {
  const build = () => {
    resetIds();
    const s = new Schedule({});
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    return s;
  };

  it('counts tasks by activityId, ignoring ordinary tasks', () => {
    const s = build();
    s.addFixed({ title: 'Read', startTime: D(18), endTime: D(18, 10), activityId: 'read' });
    s.addFixed({ title: 'Read', startTime: D(19), endTime: D(19, 10), activityId: 'read' });
    s.addFixed({ title: 'Nap', startTime: D(19, 14), endTime: D(19, 15), activityId: 'nap' });
    s.addFixed({ title: 'Dentist', startTime: D(19, 16), endTime: D(19, 17) }); // no activityId

    const u = activityUsage(s, { now: NOW });
    expect(u.read).toBe(2);
    expect(u.nap).toBe(1);
    expect(Object.keys(u).length).toBe(2); // the dentist is not an activity
  });

  it('excludes instantiations older than the window', () => {
    const s = build();
    s.addFixed({ title: 'Read', startTime: new Date(2025, 0, 5, 9), endTime: new Date(2025, 0, 5, 10), activityId: 'read' });
    s.addFixed({ title: 'Read', startTime: D(19), endTime: D(19, 10), activityId: 'read' });

    expect(activityUsage(s, { now: NOW }).read).toBe(1); // the 2025 one is out
    expect(activityUsage(s, { now: NOW, days: 100000 }).read).toBe(2); // widen and it returns
  });

  it('a fresh schedule yields an empty map rather than throwing', () => {
    expect(activityUsage(build(), { now: NOW })).toEqual({});
    expect(activityUsage(null, { now: NOW })).toEqual({});
  });
});

describe('§7.1 — the back-link survives a save/load round trip', () => {
  it('placing an activity stamps activityId, and it persists through JSON', () => {
    resetIds();
    const s = new Schedule({});
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    const a = s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });

    const t = s.addFixed({ title: 'Read', startTime: D(19), endTime: D(19, 10), activityId: a.id });
    expect(t.activityId).toBe(a.id);

    // Without toJSON/fromJSON carrying it, usage would silently reset to zero on
    // every reload and "most used" would never accumulate.
    const round = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    const loaded = round.tasks.find((x) => x.title === 'Read');
    expect(loaded.activityId).toBe(a.id);
    expect(activityUsage(round, { now: NOW })[a.id]).toBe(1);
  });
});

describe('§7.1 — bulk paste never lands the same activity twice', () => {
  const draft = (label) => ({ label, durationMin: 15, durationMax: 30 });

  it('a repeated line in one paste yields one activity', () => {
    const { fresh, duplicates } = dedupeDrafts([draft('meditate'), draft('meditate')], []);
    expect(fresh.map((d) => d.label)).toEqual(['meditate']);
    expect(duplicates).toHaveLength(1);
  });

  it('identity is the label, not label+duration — a differing range is still a duplicate', () => {
    // Two "meditate" rows in one bucket are a mistake whether or not their
    // ranges agree; the second is unreachable noise in the list.
    const a = { label: 'meditate', durationMin: 15, durationMax: 30 };
    const b = { label: 'meditate', durationMin: 20, durationMax: 45 };
    const { fresh } = dedupeDrafts([a, b], []);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].durationMax).toBe(30); // first occurrence wins
  });

  it('matching is case- and whitespace-insensitive', () => {
    const { fresh } = dedupeDrafts([draft('Meditate'), draft('  meditate  '), draft('MEDITATE')], []);
    expect(fresh).toHaveLength(1);
  });

  it('skips what the bucket already holds, so pasting the same block twice is idempotent', () => {
    const existing = [{ label: 'meditate' }, { label: 'nap' }];
    const { fresh, duplicates } = dedupeDrafts([draft('meditate'), draft('nap'), draft('stretch')], existing);
    expect(fresh.map((d) => d.label)).toEqual(['stretch']);
    expect(duplicates.map((d) => d.label)).toEqual(['meditate', 'nap']);
  });

  it('reports the dropped rows rather than swallowing them', () => {
    const { duplicates } = dedupeDrafts([draft('a'), draft('a'), draft('b'), draft('b')], []);
    expect(duplicates.map((d) => d.label)).toEqual(['a', 'b']); // the UI names these
  });

  it('a blank label is dropped, not added as an empty row', () => {
    const { fresh } = dedupeDrafts([draft('  '), draft('real')], []);
    expect(fresh.map((d) => d.label)).toEqual(['real']);
  });
});

describe('§7.1 — a paste can span buckets via "# Bucket" headings', () => {
  const buckets = [{ id: 'rest', label: 'Rest', tags: ['rest'] }, { id: 'cre', label: 'Creative', tags: ['art'] }];

  it('routes each run of lines to the bucket named above it', () => {
    const { drafts } = parseBulkBlock(
      '# Rest\nnap | 20-45\nread a book\n\n# Creative\nwrite poetry | 15-60',
      { buckets },
    );
    expect(drafts.map((d) => [d.label, d.bucketId])).toEqual([
      ['nap', 'rest'], ['read a book', 'rest'], ['write poetry', 'cre'],
    ]);
  });

  it('inherits the heading bucket\'s tags when a row omits them', () => {
    const { drafts } = parseBulkBlock('# Creative\nwrite poetry', { buckets });
    expect(drafts[0].tags).toEqual(['art']); // not Rest's, and not empty
  });

  it('an explicit tag column still wins over the bucket default', () => {
    const { drafts } = parseBulkBlock('# Creative\nwrite poetry | 15-60 | poetry, slow', { buckets });
    expect(drafts[0].tags).toEqual(['poetry', 'slow']);
  });

  it('heading matching is case- and whitespace-insensitive', () => {
    const { drafts, unknownBuckets } = parseBulkBlock('#   rEsT  \nnap', { buckets });
    expect(unknownBuckets).toEqual([]);
    expect(drafts[0].bucketId).toBe('rest');
  });

  it('rows before the first heading go to the bucket you are standing in', () => {
    const { drafts, unassigned } = parseBulkBlock('nap | 20-45\n# Creative\nwrite poetry', {
      buckets, defaultBucket: buckets[0],
    });
    expect(unassigned).toEqual([]);
    expect(drafts.map((d) => d.bucketId)).toEqual(['rest', 'cre']);
  });

  it('with no bucket to default to, those rows are REPORTED, not silently dropped', () => {
    const { drafts, unassigned } = parseBulkBlock('nap | 20-45\n# Creative\nwrite poetry', { buckets });
    expect(unassigned.map((d) => d.label)).toEqual(['nap']);
    expect(drafts.map((d) => d.label)).toEqual(['write poetry']);
  });

  it('an unknown heading is named, and its rows are skipped rather than guessed at', () => {
    // Creating a bucket from what might be a typo is worse than saying so.
    const { drafts, unknownBuckets } = parseBulkBlock('# Maintenence\nvacuum\n# Rest\nnap', { buckets });
    expect(unknownBuckets).toEqual(['Maintenence']);
    expect(drafts.map((d) => d.label)).toEqual(['nap']);
  });

  it('dedupes per bucket — the same label in two buckets is legitimate', () => {
    const { drafts } = parseBulkBlock('# Rest\nread\n# Creative\nread', { buckets });
    const { fresh, duplicates } = dedupeBulk(drafts, { rest: [], cre: [] });
    expect(fresh).toHaveLength(2); // "read" survives in BOTH
    expect(duplicates).toHaveLength(0);
  });

  it('still dedupes within one bucket across a multi-bucket paste', () => {
    const { drafts } = parseBulkBlock('# Rest\nread\nread\n# Creative\nread', { buckets });
    const { fresh, duplicates } = dedupeBulk(drafts, { rest: [], cre: [] });
    expect(fresh.map((d) => [d.label, d.bucketId])).toEqual([['read', 'rest'], ['read', 'cre']]);
    expect(duplicates).toHaveLength(1);
  });

  it('a duration-less two-field row is not mistaken for a bucket column', () => {
    // The reason headings exist: "Creative | write poetry" and "write poetry |
    // 15-60" are both two fields, so an inline bucket column could not be told
    // apart from a duration. Here the first field is always the label.
    const { drafts } = parseBulkBlock('# Rest\nCreative | 30-60', { buckets });
    expect(drafts[0].label).toBe('Creative');
    expect(drafts[0].durationMin).toBe(30);
  });
});
