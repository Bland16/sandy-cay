// googleLibrary.js — the part of a schedule that is NOT an appointment
// (design/GOOGLE-AS-STORAGE.md P1). Pure functions; no network, no DOM.
//
// Buckets, activities, zones, config, the trained model, commitments and the
// routine PROGRAMS are not events. Nothing about "49 activity templates" is a
// thing that happens at a time, so none of it has an event to ride on. It goes
// into ONE hidden all-day event, chunked across extendedProperties — which is
// what makes this whole design possible with no new OAuth scope, since
// `calendar.events` is already held.
//
// ════════════════════════════════════════════════════════════════════════════
// THE BUDGET, AND WHY IT IS COUNTED RATHER THAN ASSUMED
// ════════════════════════════════════════════════════════════════════════════
//
// Google allows 32 kB per event, KEYS AND VALUES COMBINED, and 300 properties.
// A term-scale library measured ~12.4 kB, so one event holds it today — but the
// learning model trains and `occurrenceData` accumulates all term, so "it fits"
// is a statement with a shelf life.
//
// So this splits across AS MANY events as it needs from the very first commit.
// Discovering the ceiling later would mean a migration; discovering it at 2am
// in November, when the save starts silently failing, would be worse. The cap
// is deliberately under Google's, because a key travels with every value and
// the count has to include it.

import { chunkString, checksum, byteLength, CHUNK_BYTES } from './googleEncode.js';
import { Schedule } from './Schedule.js';

const NS = 'sc';
export const LIBRARY_VERSION = 1;

/** Google's hard limits, written out so the headroom below is checkable. */
export const GOOGLE_BYTES_PER_EVENT = 32768;
export const GOOGLE_PROPS_PER_EVENT = 300;

/**
 * Our own ceilings, with room to spare. The gap is not timidity: `sc.json.NNN`
 * keys, the bookkeeping properties, and Google's own accounting all live inside
 * the same 32 kB, and going over does not error — it truncates.
 */
export const MAX_BYTES_PER_EVENT = 28000;
export const MAX_PROPS_PER_EVENT = 250;

/**
 * What lives in the library. Everything a `Schedule` serialises EXCEPT `tasks`,
 * which are events in their own right (googleEncode.js).
 *
 * ⚠️ Adding a collection to `Schedule#toJSON` and forgetting it here loses it on
 * every sync, silently. `missingFromLibrary()` exists so a test can catch that
 * rather than a user noticing their buckets are gone in March.
 */
export const LIBRARY_KEYS = [
  'zones',
  'buckets',
  'activities',
  'retiredTags',
  // ⚠️ `dayNotes` and `blockedDays` WERE HERE and are deliberately gone (GS-11,
  // 2026-08-19). They are all-day events now — `core/googleDayNotes.js` — which
  // is what §4.2 always specified, and they were removed in the SAME change that
  // gave them an event to live on, exactly as the note that stood here demanded.
  //
  // DO NOT PUT THEM BACK. Two homes for one collection is the drift this file
  // exists to prevent, and this would be a particularly bad one: the library
  // copy would quietly resurrect a note deleted in Google, every sync, forever.
  'commitments',
  'routineInstances',
  'config',
  'model',
  'snapshots',
  'lastSeenWeek',
  'dismissed',
];

/**
 * The JSON name → the field a live `Schedule` keeps it under.
 *
 * ⚠️ Deliberately RIGHT HERE, touching `LIBRARY_KEYS`, because most of these
 * are the same word and four are not: `model` lives on `learning`, and
 * `snapshots` / `lastSeenWeek` / `dismissed` are underscored. Schedule.js
 * already carries this collection list three times (constructor, `toJSON`,
 * `fromJSON`) and its own comments count the halves that have to move together;
 * a fourth copy kept somewhere else is how one of them gets forgotten. A test
 * asserts every `LIBRARY_KEYS` entry has a mapping, so adding a collection and
 * forgetting this fails loudly instead of silently dropping it on adoption.
 */
export const LIBRARY_FIELD = {
  // ⚠️ `dayNotes` and `blockedDays` are NOT in LIBRARY_KEYS — they are all-day
  // events now (GS-11) — but they keep their mapping here, because a FOOTLOCKER
  // restore still has to put them back. A file is not a calendar; see
  // RESTORABLE_KEYS.
  dayNotes: 'dayNotes',
  blockedDays: 'blockedDays',
  zones: 'zones',
  buckets: 'buckets',
  activities: 'activities',
  retiredTags: 'retiredTags',
  commitments: 'commitments',
  routineInstances: 'routineInstances',
  config: 'config',
  model: 'learning',
  snapshots: '_snapshots',
  lastSeenWeek: '_lastSeenWeek',
  dismissed: '_dismissed',
};

/**
 * What a FOOTLOCKER RESTORE puts back — which is MORE than the Google library
 * carries, and the difference silently cost two collections.
 *
 * ⚠️ `LIBRARY_KEYS` answers "what rides in the hidden calendar event". GS-11
 * removed day notes and blocked days from it, correctly: they are all-day
 * events now, and a second copy in the blob would resurrect a note deleted in
 * Google.
 *
 * But `applyLibrary` iterates that list and has a SECOND caller — the Cabana's
 * "Restore setup only" — where "they are events now" means nothing, because a
 * footlocker file is a FILE, not a calendar. Removing the keys quietly stopped
 * that button restoring holidays and blocked days. Two questions, two lists;
 * answering both from one list is what broke it.
 */
export const RESTORABLE_KEYS = [...LIBRARY_KEYS, 'dayNotes', 'blockedDays'];

/**
 * Serialised by Schedule and deliberately NOT in the library — because each of
 * these has a home of its own, not because it is unimportant.
 *
 * ⚠️ `missingFromLibrary` answers "does this collection have a home at all",
 * which is the question worth asking, so anything moved OUT of `LIBRARY_KEYS`
 * has to be moved IN here or the guard starts reporting a fault that is not one.
 * A collection in neither list is genuinely homeless and is lost on every sync.
 */
const NOT_LIBRARY = new Set([
  'tasks',          // one event each (googleEncode.js)
  'schemaVersion',  // constant
  'dayNotes',       // all-day events (googleDayNotes.js) — GS-11
  'blockedDays',    // all-day events (googleDayNotes.js) — GS-11
]);

/**
 * Which keys a schedule writes that the library would drop on the floor.
 *
 * This is the guard against the commonest way a store loses data: someone adds
 * a collection to the model and nothing anywhere says the sync does not carry
 * it. `useEngine#replace` dropped `snapshots` exactly this way once already.
 */
export function missingFromLibrary(scheduleJson) {
  const known = new Set([...LIBRARY_KEYS, ...NOT_LIBRARY]);
  return Object.keys(scheduleJson || {}).filter((k) => !known.has(k));
}

/** Pull just the library half out of a full schedule serialisation. */
export function libraryFrom(scheduleJson) {
  const out = {};
  for (const k of LIBRARY_KEYS) {
    if (scheduleJson[k] !== undefined) out[k] = scheduleJson[k];
  }
  return out;
}

/**
 * The library → one or more hidden all-day events.
 *
 * `dayKey` parks them somewhere no real week will ever show. It is a PARAMETER
 * rather than a constant read from the clock, because core must not read the
 * wall clock (sharp edge #8) and a fixture that does is a flaky test waiting.
 */
export function encodeLibrary(scheduleJson, { dayKey = '1970-01-01' } = {}) {
  const lib = libraryFrom(scheduleJson);
  const json = JSON.stringify(lib);
  const chunks = chunkString(json, CHUNK_BYTES);
  const sum = checksum(json);

  // Pack chunks into events, respecting BOTH ceilings. Chunks keep a GLOBAL
  // index, so reassembly never depends on which event a piece arrived in — and
  // therefore never depends on the order Google hands the events back.
  const events = [];
  let cur = null;
  let curBytes = 0;
  let curProps = 0;
  const startEvent = () => {
    cur = {};
    curBytes = 0;
    curProps = 0;
    events.push(cur);
  };
  startEvent();
  chunks.forEach((c, i) => {
    const key = `${NS}.json.${i}`;
    const cost = byteLength(key) + byteLength(c);
    if (cur !== null && curProps > 0 && (curBytes + cost > MAX_BYTES_PER_EVENT || curProps + 1 > MAX_PROPS_PER_EVENT)) {
      startEvent();
    }
    cur[key] = c;
    curBytes += cost;
    curProps += 1;
  });

  return events.map((props, part) => ({
    summary: 'Sandy Cay — data (do not delete)',
    // ⚠️ Written for a human who finds this in their calendar and wonders what
    // it is. Never read back; see googleEncode.js on the same rule.
    description:
      'This all-day entry holds the Sandy Cay library: buckets, activities, '
      + 'zones, settings and what the app has learned. It is not an appointment. '
      + 'Deleting it loses that data.',
    start: { date: dayKey },
    end: { date: dayKey },
    transparency: 'transparent',   // never counts as busy
    extendedProperties: {
      private: {
        [`${NS}.v`]: String(LIBRARY_VERSION),
        [`${NS}.kind`]: 'library',
        [`${NS}.lib.part`]: String(part),
        [`${NS}.lib.parts`]: String(events.length),
        [`${NS}.lib.total`]: String(chunks.length),
        [`${NS}.lib.sum`]: sum,
        ...props,
      },
    },
  }));
}

/**
 * The events → the library, or a stated refusal.
 *
 * Order-independent: chunks carry a global index, so events may arrive in any
 * order Google feels like. Returns `{ ok, library, error }` — never throws, so
 * one damaged event cannot take down a whole load.
 */
export function decodeLibrary(events) {
  const parts = (events || []).filter((ev) => {
    const p = ev && ev.extendedProperties && ev.extendedProperties.private;
    return p && p[`${NS}.kind`] === 'library';
  });
  if (parts.length === 0) return { ok: false, empty: true, error: 'no library event found' };

  const first = parts[0].extendedProperties.private;
  const v = Number(first[`${NS}.v`]);
  if (!Number.isInteger(v) || v > LIBRARY_VERSION) {
    // Same refusal as a task: a partial read would drop what this build does
    // not understand, and writing that back destroys it for the newer client.
    return { ok: false, error: `library version ${first[`${NS}.v`]} is newer than ${LIBRARY_VERSION}` };
  }

  const expectedParts = Number(first[`${NS}.lib.parts`]);
  if (Number.isInteger(expectedParts) && parts.length !== expectedParts) {
    // A whole event went missing — deleted by hand, or never written.
    return { ok: false, error: `expected ${expectedParts} library event(s), found ${parts.length}` };
  }

  const total = Number(first[`${NS}.lib.total`]);
  if (!Number.isInteger(total) || total < 1) {
    return { ok: false, error: `bad chunk total ${first[`${NS}.lib.total`]}` };
  }

  const byIndex = new Map();
  for (const ev of parts) {
    for (const [k, val] of Object.entries(ev.extendedProperties.private)) {
      if (!k.startsWith(`${NS}.json.`)) continue;
      const i = Number(k.slice(`${NS}.json.`.length));
      if (Number.isInteger(i)) byIndex.set(i, val);
    }
  }

  let json = '';
  for (let i = 0; i < total; i += 1) {
    if (!byIndex.has(i)) return { ok: false, error: `library chunk ${i} of ${total} missing` };
    json += byIndex.get(i);
  }

  const want = first[`${NS}.lib.sum`];
  const got = checksum(json);
  if (want && want !== got) {
    // The 1024-byte silent truncation, caught for the library too.
    return { ok: false, error: `library checksum ${got} does not match stored ${want}` };
  }

  try {
    return { ok: true, library: JSON.parse(json) };
  } catch {
    return { ok: false, error: 'library payload is not valid JSON' };
  }
}

/** What the library costs right now, for a caller that wants to warn early. */
export function libraryFootprint(scheduleJson) {
  const events = encodeLibrary(scheduleJson);
  let bytes = 0;
  let props = 0;
  for (const ev of events) {
    for (const [k, v] of Object.entries(ev.extendedProperties.private)) {
      bytes += byteLength(k) + byteLength(v);
      props += 1;
    }
  }
  return { events: events.length, bytes, props };
}

/**
 * What differs between two libraries, per collection.
 *
 * ⚠️ THIS IS A GATE, NOT A REPORT. GS-8: a device whose library does not match
 * the store's is not allowed to write anything until a human resolves it, so
 * "are these the same" has to be answered honestly and cheaply, without a
 * network call and without a clock.
 *
 * Compared by serialisation rather than by counts. Two buckets lists of the
 * same length are not the same list, and "11 here, 11 there" is exactly the
 * shape of a phone that seeded its own starter set over the top of yours.
 * Counts are reported ALONGSIDE, because "config differs" is unactionable while
 * "buckets: 11 here, 4 there" tells you which side is the stale one.
 */
export function diffLibrary(here = {}, there = {}) {
  const sizeOf = (v) => {
    if (v == null) return 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'object') return Object.keys(v).length;
    return 1;
  };
  const rows = LIBRARY_KEYS.map((key) => ({
    key,
    same: JSON.stringify(here[key] ?? null) === JSON.stringify(there[key] ?? null),
    here: sizeOf(here[key]),
    there: sizeOf(there[key]),
  }));
  return { same: rows.every((r) => r.same), rows, differing: rows.filter((r) => !r.same) };
}

/**
 * Take a library into a live schedule, replacing what it covers.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. `pull` has always decoded the library and handed
 * it back as `remote.library`, and NOTHING READ IT — the write side shipped and
 * the read side did not. A second device therefore got its tasks and none of
 * its buckets, zones, activities, commitments or routines, then pushed its own
 * fresh starter set over the top and took the real one out of the store.
 * `design/probes/probe-google-second-device.mjs` drives exactly that.
 *
 * ⚠️ TASKS ARE NOT TOUCHED. They are events in their own right and reconcile
 * per-task through `planSync`; rebuilding them from a blob would undo that
 * work. `libraryFrom` filters to LIBRARY_KEYS on the way in, so a payload that
 * somehow carried `tasks` cannot reach through here.
 *
 * Revival goes through `Schedule.fromJSON` rather than by hand, so a bucket
 * arrives as a `Bucket` and the model as a `LearningModule` — the same path a
 * reload takes. Anything the library does not carry is left exactly as it was.
 */
export function applyLibrary(sched, library, { keys = LIBRARY_KEYS } = {}) {
  if (!library) return { applied: [] };
  const incoming = {};
  for (const k of keys) if (library[k] !== undefined) incoming[k] = library[k];
  const next = Schedule.fromJSON({ ...sched.toJSON(), ...incoming });
  const applied = [];
  for (const key of keys) {
    if (incoming[key] === undefined) continue;
    const field = LIBRARY_FIELD[key];
    if (!field) continue;
    sched[field] = next[field];
    applied.push(key);
  }
  return { applied };
}
