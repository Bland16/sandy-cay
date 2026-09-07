// design/CALENDAR-IMPORT.md §2.4 / §2.5 — the two Cabana doors must not corrupt
// the store calendar, in either direction.
//
// Every test here is a bug that was reachable in two clicks before this file.
import { describe, it, expect } from 'vitest';
import { importEvents, isStoreEvent, eventToTask } from '../src/core/ical.js';
import { NS, encodeTask } from '../src/core/googleEncode.js';
import { isAppWrittenEvent, clearRange, normalizeGoogleEvent } from '../src/ui/google.js';
import { Task } from '../src/core/Task.js';

const D = (d, h) => new Date(2026, 8, d, h, 0, 0, 0);

/** A store event as `normalizeGoogleEvent` would hand it to the importer. */
function storeEventFor(task) {
  const body = encodeTask(task, { timeZone: 'UTC' });
  return normalizeGoogleEvent({
    id: 'evt1',
    summary: body.summary,
    description: body.description,
    start: body.start,
    end: body.end,
    extendedProperties: body.extendedProperties,
  });
}

describe('the import door refuses the app\'s own store events (§2.4)', () => {
  // ⚠️ THE GUARD IS SPELLED `sc.` IN TWO FILES. `googleEncode.js` cannot be
  // imported by `ical.js` — it imports `toRRULE` FROM ical, so that would close a
  // cycle — so the namespace is repeated there. This is what stops the copy from
  // drifting: rename `NS` and this fails.
  it('the namespace ical.js guards on still matches googleEncode.NS', () => {
    expect(isStoreEvent({ x: { [`${NS}.id`]: 'anything' } })).toBe(true);
    expect(isStoreEvent({ x: { [`${NS}.kind`]: 'library' } })).toBe(true);
  });

  it('a routine touchpoint pulled from the store is refused, not flattened', () => {
    const step = new Task({
      title: 'load', tags: ['home'], type: 'fixed', priority: 4,
      startTime: D(7, 19), endTime: D(7, 20),
      routineId: 'laundry-run', stepIndex: 0, activityId: 'laundry-act',
    });
    const ev = storeEventFor(step);

    // What it WOULD have become: every app field gone, priority reset, and a
    // duplicate of a task the app already has.
    // `null`, not undefined — `Task` defaults them (Task.js:107-108). Asserted
    // exactly rather than as "falsy", because `stepIndex: 0` is falsy too and a
    // loose assertion here would pass on a correctly preserved first step.
    const mangled = eventToTask(ev);
    expect(mangled.routineId).toBe(null);
    expect(mangled.stepIndex).toBe(null);
    expect(mangled.activityId).toBe(null);
    expect(mangled.priority).toBe(3);

    // What actually happens now.
    const out = importEvents([ev]);
    expect(out).toHaveLength(0);
    expect(out.refused).toEqual(['load']);
  });

  it('a commitment sitting from the store is refused too', () => {
    const sitting = new Task({
      title: 'Maths', tags: ['study'], type: 'flexible',
      startTime: D(8, 10), endTime: D(8, 12), parentId: 'maths-commit',
    });
    const out = importEvents([storeEventFor(sitting)]);
    expect(out).toHaveLength(0);
    expect(out.refused).toEqual(['Maths']);
  });

  it('a store event too corrupt to decode is STILL refused', () => {
    // The payload is gone but `sc.id` survives, which is exactly the case
    // `decodeEvent` is built around. Mangling it into a task would be worse than
    // dropping it, so the guard must not depend on the payload parsing.
    const ev = { summary: 'broken', start: D(9, 9), end: D(9, 10), x: { [`${NS}.id`]: 'gym-1' } };
    const out = importEvents([ev]);
    expect(out).toHaveLength(0);
    expect(out.refused).toEqual(['broken']);
  });

  it('an ordinary foreign event still imports', () => {
    const ev = { uid: 'g1', summary: 'Lecture #class', start: D(9, 9), end: D(9, 10), x: {} };
    const out = importEvents([ev]);
    expect(out).toHaveLength(1);
    expect(out.refused).toEqual([]);
  });

  // ⚠️ The `.ics` round-trip uses X-SANDYCAY-*, which `parseICS` lowercases into
  // the same `x.type` / `x.pinned` vocabulary `eventToTask` reads. That is a
  // DELIBERATE re-import path and the store guard must not touch it — only the
  // `sc.*` namespace means "this is the save file".
  it('does not refuse an exported .ics coming back in', () => {
    const ev = {
      uid: 'ics1', summary: 'Gym', start: D(9, 7), end: D(9, 8),
      x: { type: 'flexible', pinned: 'TRUE', priority: '5' },
    };
    const out = importEvents([ev]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('flexible');
    expect(out[0].pinned).toBe(true);
    expect(out[0].priority).toBe(5);
    expect(out.refused).toEqual([]);
  });
});

describe('clearRange never deletes what it did not write (§2.5)', () => {
  const ours = { id: 'a', extendedProperties: { private: { 'sc.id': 'task-1' } } };
  const oursOldEncoding = { id: 'b', extendedProperties: { private: { sandycayId: 'task-2' } } };
  const library = { id: 'c', extendedProperties: { private: { 'sc.kind': 'library' } } };
  const theirs = { id: 'd', summary: 'Dentist', extendedProperties: { private: {} } };
  const bare = { id: 'e', summary: 'Lunch' };

  it('recognises BOTH encodings as ours', () => {
    expect(isAppWrittenEvent(ours)).toBe(true);
    // ⚠️ Load-bearing. Events in the flat shape are already in real calendars;
    // a predicate that only knew `sc.id` would refuse to clean them up, so every
    // re-push would stack a new copy on an undeletable old one.
    expect(isAppWrittenEvent(oursOldEncoding)).toBe(true);
    expect(isAppWrittenEvent(library)).toBe(true);
    expect(isAppWrittenEvent(theirs)).toBe(false);
    expect(isAppWrittenEvent(bare)).toBe(false);
  });

  it('deletes only ours, and reports what it left', async () => {
    const seen = [];
    const events = [ours, oursOldEncoding, library, theirs, bare];
    // `clearRange` reaches Google through module-level helpers, so drive it the
    // way the app does and assert on the DELETEs it issues.
    const fakeFetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        seen.push(decodeURIComponent(url.split('/events/')[1]));
        return {};
      }
      return { items: events };
    };
    const restore = globalThis.fetch;
    globalThis.fetch = async (url, opts) => ({
      ok: true, status: 200, json: async () => fakeFetch(String(url), opts), text: async () => '',
    });
    try {
      const r = await clearRange('tok', 'cal', D(7, 0), D(14, 0), isAppWrittenEvent);
      expect(r.removed).toBe(3);
      expect(r.kept).toBe(2);
      expect(seen.sort()).toEqual(['a', 'b', 'c']);
    } finally {
      globalThis.fetch = restore;
    }
  });

  it('refuses to run without a predicate at all', async () => {
    // The safe default and the dangerous one look identical at a call site, so
    // there is no default. Forgetting it is an error, not a wipe.
    await expect(clearRange('tok', 'cal', D(7, 0), D(14, 0))).rejects.toThrow(/predicate/);
  });
});
