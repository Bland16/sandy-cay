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
  // ⚠️ DIVERGENCE FROM THE SPEC, PARKED HERE ON PURPOSE. GOOGLE-AS-STORAGE §4.2
  // says day notes and blocked days become ALL-DAY EVENTS, so Thanksgiving is
  // visible in Google Calendar like any other entry — which is a real part of
  // "the calendar stays useful". They are carried in the library for now so
  // that P1 loses nothing, and that is the only reason.
  //
  // When they move to events they MUST be deleted from this list in the SAME
  // change. Two homes for one collection is the drift this file exists to
  // prevent, and it would be a particularly bad one: the library copy would
  // quietly resurrect a note the user deleted in Google. See GS-11.
  'dayNotes',
  'blockedDays',
  'commitments',
  'routineInstances',
  'config',
  'model',
  'snapshots',
  'lastSeenWeek',
  'dismissed',
];

/** Serialised by Schedule but deliberately NOT in the library. */
const NOT_LIBRARY = new Set(['tasks', 'schemaVersion']);

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
