// The library event — design/GOOGLE-AS-STORAGE.md P1.
//
// Everything a schedule holds that is NOT an appointment, packed into hidden
// all-day events. `design/probes/probe-google-library.mjs` prints the real
// byte costs; this locks the behaviour.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig, seed } from '../src/core/index.js';
import { byteLength, CHUNK_BYTES } from '../src/core/googleEncode.js';
import {
  encodeLibrary, decodeLibrary, libraryFrom, libraryFootprint, missingFromLibrary, diffLibrary,
  LIBRARY_KEYS, LIBRARY_VERSION,
  GOOGLE_BYTES_PER_EVENT, GOOGLE_PROPS_PER_EVENT, MAX_BYTES_PER_EVENT, MAX_PROPS_PER_EVENT,
} from '../src/core/googleLibrary.js';

const termScale = () => {
  const s = new Schedule({ config: defaultConfig });
  for (let i = 0; i < 11; i += 1) {
    s.addBucket({ label: `Bucket ${i}`, tags: [`tag${i}`], load: { physical: 1, mental: -1, social: 0, emotional: 1 } });
  }
  for (let i = 0; i < 49; i += 1) {
    s.addActivity({ label: `Activity ${i}`, tags: [`tag${i % 11}`], durationMin: 45 });
  }
  for (let i = 0; i < 21; i += 1) {
    s.addDayNote({ date: `2026-09-${String(1 + i).padStart(2, '0')}`, label: `Day note ${i}` });
  }
  // Tasks matter here even though the library must NOT carry them: without at
  // least one, the "does not carry tasks" test asserts nothing.
  const base = new Date(2026, 7, 31, 9, 0, 0, 0);
  for (let i = 0; i < 8; i += 1) {
    const st = new Date(base.getTime() + i * 43200000);
    s.addFixed({ title: `Scheduled thing ${i}`, startTime: st, endTime: new Date(st.getTime() + 3600000) });
  }

  // ⚠️ AND SO DOES EVERY OTHER COLLECTION, FOR EXACTLY THE SAME REASON.
  //
  // The note above spotted this for `tasks` and stopped there. "Carries every
  // library key through a round trip" loops LIBRARY_KEYS and deep-compares —
  // but a key this fixture leaves EMPTY compares `[]` against `[]` and passes
  // no matter what the codec does with it. Audited 2026-08-31, prompted by
  // "double check commitments are properly stored with Calendar": SEVEN of the
  // eleven keys were vacuous —
  //
  //     zones · retiredTags · commitments · routineInstances
  //     snapshots · lastSeenWeek · dismissed
  //
  // Only buckets, activities, config and model were carrying the test. That is
  // the same shape as the bug the file's own header warns about, one level up:
  // the guard existed, was green, and was not looking.
  //
  // Every one is added through its real door (`addZone`, `addCommitment`, …)
  // rather than by poking the field, so the fixture cannot drift from what the
  // app actually stores.
  s.addZone({
    label: 'Study block',
    matchTags: ['study'],
    windows: [{ day: 'tue', start: '18:00', end: '22:00' }, { day: 'thu', start: '18:00', end: '22:00' }],
    exclusive: true,
  });
  s.addZone({ label: 'Mornings', matchTags: ['gym'], windows: [{ day: 'mon', start: '06:00', end: '08:00' }], exclusive: false });
  s.retireTag('tag3');
  s.addCommitment({
    title: 'Maths problem sets',
    tags: ['study', 'maths'],
    amountMinPerWeek: 240,
    from: '2026-08-31',
    until: '2026-12-11',
    dueDay: 'thu',
    minSitting: 45,
    maxSitting: 150,
    maxPerDay: 2,
    priority: 5,
  });
  s.addCommitment({ title: 'Gym', tags: ['gym'], amountMinPerWeek: 180, from: '2026-08-31', until: '2026-12-11' });
  s.addRoutineInstance({
    label: 'Laundry',
    startTime: new Date(2026, 8, 1, 10, 0, 0, 0),
    travelMin: 10,
    steps: [
      { kind: 'active', label: 'Load the washer', durationMin: 10 },
      { kind: 'wait', label: 'Wash', durationMin: 45, maxWaitMin: 60 },
      { kind: 'active', label: 'Move to the dryer', durationMin: 5 },
    ],
  });
  // D-13's per-week mark, exercised rather than left empty — the whole point of
  // this fixture since 7 of 11 keys were found comparing [] against [].
  s.markCommitmentWeekDone(s.commitments[1].id, new Date(2026, 7, 31));
  s.snapshot(new Date(2026, 7, 31));
  s.markWeekSeen(new Date(2026, 7, 31));
  s.dismissSuggestion('overpack-notice', new Date(2026, 7, 31));
  return s;
};

const propsOf = (ev) => ev.extendedProperties.private;
const costOf = (ev) => Object.entries(propsOf(ev))
  .reduce((n, [k, v]) => n + byteLength(k) + byteLength(v), 0);

describe('nothing falls through the gap', () => {
  it('accounts for every key a Schedule serialises', () => {
    // ⚠️ THE GUARD THAT MATTERS MOST HERE. Adding a collection to
    // Schedule#toJSON and not wiring it into the library loses it on every
    // sync, silently — `useEngine#replace` dropped `snapshots` exactly this way
    // once already. This test fails the moment the model grows a new key.
    expect(missingFromLibrary(termScale().toJSON())).toEqual([]);
    expect(missingFromLibrary(seed().toJSON())).toEqual([]);
  });

  it('carries every library key through a round trip', () => {
    const json = termScale().toJSON();
    const back = decodeLibrary(encodeLibrary(json));
    expect(back.ok).toBe(true);
    for (const k of LIBRARY_KEYS) {
      expect(back.library[k]).toEqual(libraryFrom(json)[k]);
    }
    expect(back.library).toEqual(libraryFrom(json));
  });

  it('does NOT carry tasks — those are events in their own right', () => {
    const json = termScale().toJSON();
    expect(json.tasks.length).toBeGreaterThan(0);
    expect(libraryFrom(json).tasks).toBeUndefined();
  });

  it('round-trips the seed, model and all', () => {
    const json = seed().toJSON();
    const back = decodeLibrary(encodeLibrary(json));
    expect(back.ok).toBe(true);
    expect(back.library).toEqual(libraryFrom(json));
  });
});

describe('a calendar written before a key existed is not a disagreement', () => {
  // Reported 2026-09-02: "the calendar keeps disagreeing with itself over
  // commitments done (each say 0)."
  //
  // `diffLibrary` compared `JSON.stringify(v ?? null)`, so a key the remote
  // library does not carry ("null") never equalled an empty one here ("{}").
  // The row printed `0 here, 0 there` and the GS-8 gate — correctly treating any
  // library disagreement as "this device is out of step" — PAUSED THE WHOLE
  // SYNC. Adding `commitmentDone` in 237c71c made every existing calendar the
  // old side, so it fired for everyone at once.
  //
  // ⚠️ The bug was latent in EVERY key, not just the new one. A library gains
  // keys over time and a device has to be able to talk to a calendar written
  // before one existed, so this asserts the property for all of them.
  it('treats absent and empty as the same answer, for every key', () => {
    const lib = libraryFrom(new Schedule({ config: defaultConfig }).toJSON());
    for (const key of LIBRARY_KEYS) {
      const older = { ...lib };
      delete older[key];
      const row = diffLibrary(lib, older).rows.find((r) => r.key === key);
      // Only meaningful where this side is genuinely empty; a populated key
      // SHOULD differ from an absent one, which the next test covers.
      if (row.here === 0) {
        expect(`${key}: ${row.same}`).toBe(`${key}: true`);
      }
    }
  });

  it('does not pause the sync over a key neither side has data in', () => {
    const s = new Schedule({ config: defaultConfig });
    const lib = libraryFrom(s.toJSON());
    const beforeD13 = { ...lib };
    delete beforeD13.commitmentDone;
    expect(diffLibrary(lib, beforeD13).same).toBe(true);
    expect(diffLibrary(lib, beforeD13).differing).toEqual([]);
  });

  it('still reports a REAL difference — the guard must not be blunted', () => {
    // The half that must not be "fixed" as well: an empty side against a
    // populated one is exactly the stale-device signal GS-8 exists to catch.
    const s = new Schedule({ config: defaultConfig });
    s.addCommitment({ title: 'ENGR', amountMinPerWeek: 120, from: '2026-09-07', until: '2026-12-11' });
    s.markCommitmentWeekDone(s.commitments[0].id, new Date(2026, 8, 7));
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 1 } });
    const lib = libraryFrom(s.toJSON());

    const older = { ...lib };
    delete older.commitmentDone;
    const d = diffLibrary(lib, older);
    expect(d.same).toBe(false);
    expect(d.differing.map((r) => r.key)).toContain('commitmentDone');

    // …and an emptied-out buckets list is still a disagreement too.
    const wiped = { ...lib, buckets: [] };
    expect(diffLibrary(lib, wiped).same).toBe(false);
  });
});

describe('the budget', () => {
  it('fits a term-scale library in one event, with the cost stated', () => {
    const foot = libraryFootprint(termScale().toJSON());
    expect(foot.events).toBe(1);
    // Measured, not estimated: ~16 KB, about half of one event. The spec's
    // original 12.4 KB came from raw key sizes and did not count property keys
    // or the JSON wrapper. Asserted loosely so it reports drift without being
    // brittle about a byte or two.
    expect(foot.bytes).toBeGreaterThan(10 * 1024);
    expect(foot.bytes).toBeLessThan(GOOGLE_BYTES_PER_EVENT);
  });

  it('never exceeds GOOGLE\'s per-event ceilings, however big it gets', () => {
    // Google's numbers, hardcoded deliberately — asserting against our own
    // MAX_* constants would be circular, which is the trap that got the task
    // chunk test earlier in this session.
    const fat = new Schedule({ config: defaultConfig });
    for (let i = 0; i < 900; i += 1) {
      fat.addActivity({ label: `Activity with a deliberately long label number ${i}`, tags: [`tag${i % 30}`, `second-${i % 7}`], durationMin: 45 });
    }
    const events = encodeLibrary(fat.toJSON());
    expect(events.length).toBeGreaterThan(1);
    for (const ev of events) {
      expect(costOf(ev)).toBeLessThanOrEqual(GOOGLE_BYTES_PER_EVENT);
      expect(Object.keys(propsOf(ev)).length).toBeLessThanOrEqual(GOOGLE_PROPS_PER_EVENT);
    }
  });

  it('is bounded by BYTES, not by property count, at this chunk size', () => {
    // ⚠️ Written because mutation found the property cap to be unreachable:
    // raising MAX_PROPS_PER_EVENT to 100000 changed nothing, because a 28000-byte
    // event can only hold ~31 chunks of 900 bytes, nowhere near 250 properties.
    //
    // That is fine, but it should be a KNOWN fact rather than an accidental one.
    // The property cap is defence in depth for a future where CHUNK_BYTES
    // shrinks; this pins which limit actually does the work today, so if that
    // ever flips, someone finds out here instead of at a truncated save.
    const maxChunksByBytes = Math.ceil(MAX_BYTES_PER_EVENT / CHUNK_BYTES);
    expect(maxChunksByBytes).toBeLessThan(MAX_PROPS_PER_EVENT);

    // And whichever binds, the result must stay under GOOGLE's real ceilings —
    // that is the property being protected, and it is asserted above too.
    expect(MAX_BYTES_PER_EVENT).toBeLessThan(GOOGLE_BYTES_PER_EVENT);
    expect(MAX_PROPS_PER_EVENT).toBeLessThan(GOOGLE_PROPS_PER_EVENT);
  });

  it('reassembles across many events, in ANY order', () => {
    // Google returns events in whatever order it likes, so chunks carry a
    // global index and reassembly must not depend on arrival order.
    const fat = new Schedule({ config: defaultConfig });
    for (let i = 0; i < 900; i += 1) {
      fat.addActivity({ label: `Activity with a deliberately long label number ${i}`, tags: [`tag${i % 30}`], durationMin: 45 });
    }
    const json = fat.toJSON();
    const events = encodeLibrary(json);
    expect(events.length).toBeGreaterThan(1);
    expect(decodeLibrary(events).library).toEqual(libraryFrom(json));
    expect(decodeLibrary([...events].reverse()).library).toEqual(libraryFrom(json));
  });
});

describe('what it refuses', () => {
  const events = () => encodeLibrary(termScale().toJSON());
  const clone = (x) => JSON.parse(JSON.stringify(x));

  it('detects truncation', () => {
    const evs = clone(events());
    const key = Object.keys(propsOf(evs[0])).find((k) => k.startsWith('sc.json.'));
    propsOf(evs[0])[key] = propsOf(evs[0])[key].slice(0, 50);
    const r = decodeLibrary(evs);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum/);
  });

  it('detects a missing chunk', () => {
    const evs = clone(events());
    delete propsOf(evs[0])['sc.json.0'];
    const r = decodeLibrary(evs);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing/);
  });

  it('detects a whole event having been deleted', () => {
    const fat = new Schedule({ config: defaultConfig });
    for (let i = 0; i < 900; i += 1) fat.addActivity({ label: `A long activity label ${i}`, durationMin: 45 });
    const evs = encodeLibrary(fat.toJSON());
    expect(evs.length).toBeGreaterThan(1);
    const r = decodeLibrary(evs.slice(0, -1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected \d+ library event/);
  });

  it('refuses a library written by a NEWER version', () => {
    const evs = clone(events());
    propsOf(evs[0])['sc.v'] = String(LIBRARY_VERSION + 1);
    expect(decodeLibrary(evs).ok).toBe(false);
  });

  it('says "empty" for a calendar that simply has no library', () => {
    const r = decodeLibrary([{ summary: 'Dentist' }, { summary: 'Lunch' }]);
    expect(r.ok).toBe(false);
    expect(r.empty).toBe(true);
  });

  it('never throws, so one bad event cannot fail a whole load', () => {
    expect(() => decodeLibrary(null)).not.toThrow();
    expect(() => decodeLibrary([null, undefined, {}])).not.toThrow();
  });
});

describe('the event a human might stumble on', () => {
  it('is an all-day, transparent, clearly-labelled entry in the far past', () => {
    const [ev] = encodeLibrary(termScale().toJSON());
    expect(ev.start.date).toBe('1970-01-01');
    expect(ev.transparency).toBe('transparent'); // never reads as busy
    expect(ev.summary).toMatch(/do not delete/i);
    expect(ev.description).toMatch(/Deleting it loses/i);
  });

  it('takes its parking date as a parameter, never from the clock', () => {
    // Sharp edge #8: nothing in core may read the wall clock, or fixtures go
    // flaky depending on the day they run.
    const [ev] = encodeLibrary(termScale().toJSON(), { dayKey: '1990-06-01' });
    expect(ev.start.date).toBe('1990-06-01');
  });
});
