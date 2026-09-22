// Tagged export (design/TAGGED-EXPORT.md) — the Cabana's one-shot calendar tool
// can send one tag to one calendar.
//
// ⚠️ THE TAG BOX WAS ALREADY ON SCREEN AND ALREADY IGNORED BY EXPORT. Only the
// import paths read it, so typing a tag and pressing Export sent everything,
// silently, with nothing saying the box had been irrelevant. That is what
// prompted the request.
//
// This file pins the shared matcher and the filtered-clear predicate. The
// predicate is the interesting half: a filtered push must clear only what it is
// replacing, or exporting `study` on Monday and `gym` to the same calendar on
// Tuesday would make Tuesday silently delete Monday.

import { describe, it, expect } from 'vitest';
import { matchesTagFilter, parseTagFilter } from '../src/core/index.js';

describe('parseTagFilter — the Cabana box', () => {
  it('splits, trims and drops the empties', () => {
    expect(parseTagFilter(' study , gym ,, ')).toEqual(['study', 'gym']);
  });

  it('an empty box is not a filter', () => {
    for (const v of ['', '   ', ',,', null, undefined]) expect(parseTagFilter(v)).toEqual([]);
  });
});

describe('matchesTagFilter — one rule for both directions', () => {
  const task = (tags) => ({ tags });

  it('no filter keeps everything, including untagged work', () => {
    expect(matchesTagFilter(task(['study']), [])).toBe(true);
    expect(matchesTagFilter(task([]), [])).toBe(true);
    expect(matchesTagFilter(task([]), null)).toBe(true);
  });

  it('matches on ANY of the named tags, as the import side always has', () => {
    expect(matchesTagFilter(task(['gym', 'health']), ['study', 'gym'])).toBe(true);
    expect(matchesTagFilter(task(['admin']), ['study', 'gym'])).toBe(false);
  });

  it('is case-insensitive in both the task and the filter', () => {
    expect(matchesTagFilter(task(['Study']), ['study'])).toBe(true);
    expect(matchesTagFilter(task(['study']), ['STUDY'])).toBe(true);
  });

  it('an untagged task is excluded once a filter is on', () => {
    // The point of the filter: "only these" must not quietly mean "these plus
    // everything that never said".
    expect(matchesTagFilter(task([]), ['study'])).toBe(false);
    expect(matchesTagFilter({}, ['study'])).toBe(false);
  });
});

// The predicate `pushToGoogle` hands to `clearRange`. Reproduced here rather
// than imported because it is defined inside the component; if it moves, this
// test should move with it.
function clearPredicate(tags, isAppWritten) {
  if (!tags.length) return isAppWritten;
  return (ev) => {
    if (!isAppWritten(ev)) return false;
    const p = (ev.extendedProperties && ev.extendedProperties.private) || {};
    if (p.tags === undefined) return false;
    return matchesTagFilter({ tags: String(p.tags).split(',') }, tags);
  };
}
const appWritten = (ev) => {
  const p = ev && ev.extendedProperties && ev.extendedProperties.private;
  return !!p && (p['sc.id'] !== undefined || p['sc.kind'] !== undefined || p.sandycayId !== undefined);
};
const ev = (priv) => ({ extendedProperties: { private: priv } });

describe('the filtered clear — what a re-push is allowed to delete', () => {
  it('deletes our matching events', () => {
    const p = clearPredicate(['study'], appWritten);
    expect(p(ev({ sandycayId: '1', tags: 'study,reading' }))).toBe(true);
  });

  it('LEAVES our events carrying a different tag — this is the whole feature', () => {
    // Push `study` Monday, `gym` Tuesday, same calendar. A full clear would make
    // Tuesday delete Monday's work.
    const p = clearPredicate(['gym'], appWritten);
    expect(p(ev({ sandycayId: '1', tags: 'study' }))).toBe(false);
  });

  it('⚠️ LEAVES an app event with NO recorded tags — absence is not evidence', () => {
    // Events pushed before tags were recorded carry no `tags` property. Deleting
    // them would be inferring "it has no tags" from "it never said", which is
    // the inference `skipStreakCheck` explicitly refuses to make. The honest
    // cost is one possible generation of duplicates, reported as "left N alone".
    const p = clearPredicate(['study'], appWritten);
    expect(p(ev({ sandycayId: '1' }))).toBe(false);
  });

  it('never touches an event the app did not write, filtered or not', () => {
    for (const tags of [[], ['study']]) {
      const p = clearPredicate(tags, appWritten);
      expect(p({ summary: 'Someone else’s dentist' })).toBe(false);
      expect(p(ev({ somethingElse: 'x' }))).toBe(false);
    }
  });

  it('with no filter it is exactly the old behaviour — every app event goes', () => {
    const p = clearPredicate([], appWritten);
    expect(p(ev({ sandycayId: '1' }))).toBe(true);
    expect(p(ev({ sandycayId: '1', tags: 'anything' }))).toBe(true);
    expect(p({ summary: 'not ours' })).toBe(false);
  });
});
