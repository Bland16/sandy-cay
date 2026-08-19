// googleDayNotes.js — a day note is an ALL-DAY EVENT (GS-11).
//
// design/GOOGLE-AS-STORAGE.md §4.2 always said so; the build carried day notes
// in the library blob instead, "so that P1 loses nothing", and the divergence
// was parked in `googleLibrary.js` with a note saying what had to happen when
// it was undone. This is that change, and the two must land together:
//
//   ⚠️ `dayNotes` and `blockedDays` are REMOVED from `LIBRARY_KEYS` in the same
//   commit. Two homes for one collection is the drift this project keeps paying
//   for, and it would be an especially bad one here — the library copy would
//   quietly resurrect a note you deleted in Google.
//
// Why it is worth doing at all: a holiday is a fact about a day, and a calendar
// is where facts about days live. Carried in the library, Thanksgiving existed
// only inside Sandy Cay — invisible in Google on a phone, uneditable, and not
// even deletable from the place it looks like it lives.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IS NATIVE AND WHAT RIDES IN THE PAYLOAD
// ════════════════════════════════════════════════════════════════════════════
//
// Same split as a task (googleEncode.js §4.1), for the same reason. Google owns
// the fields it understands, so a hand edit to them LANDS — GS-4, your own hand
// outranks the scheduler:
//
//   label  ← summary            rename Thanksgiving in Google, it renames here
//   from   ← start.date         drag it to another day, it moves here
//   to     ← end.date MINUS ONE  extend it, it extends here
//
// Everything else — kind, tags, source, recurrence — has no native home and
// travels in `sc.json`, chunked and checksummed exactly as a task's does.
//
// ⚠️ `end.date` IS EXCLUSIVE and `DayNote.to` IS INCLUSIVE. A note covering only
// the 15th is `start 2026-08-15 / end 2026-08-16`. This is sharp edge #11 in its
// original form, and `ical.js#eventToDayNote` already converts the same way for
// `.ics` — subtract on the way in, add on the way out. Getting it wrong does not
// error; it silently lengthens or shortens every holiday by a day.

import {
  packPayload, unpackPayload, ENCODING_VERSION, NS,
} from './googleEncode.js';
import { toRRULE } from './ical.js';
import { reviveRecurrence } from './recurrenceSerde.js';
import { dateKey, dateFromKey, addDays } from './time.js';

/** `sc.kind` values that mean "this is not a task". */
export const KIND_DAYNOTE = 'daynote';
export const KIND_BLOCKED = 'blocked';

/** 'YYYY-MM-DD' → the next day, for the exclusive `end.date`. */
export function dayAfter(key) {
  return dateKey(addDays(dateFromKey(key), 1));
}

/** 'YYYY-MM-DD' → the previous day, undoing an exclusive `end.date`. */
export function dayBefore(key) {
  return dateKey(addDays(dateFromKey(key), -1));
}

/**
 * The repeat rule for an ALL-DAY event, which is not the one a task gets.
 *
 * ⚠️ RFC 5545 §3.3.10 again, the other way round: when `DTSTART` is a DATE,
 * `UNTIL` must be a DATE too. A task's rule carries `UNTIL=20261212T045959Z`
 * because its DTSTART is a date-time; handing that to an all-day event is
 * invalid, and an invalid rule is a 400 on the insert with the event never
 * appearing at all. So the time part is stripped rather than converted.
 *
 * `toRRULE` bounds at the last day it runs, which for a whole-day thing is
 * exactly right with no adjustment — there is no time of day to fall before.
 */
export function allDayRRULE(recurrenceJson) {
  if (!recurrenceJson) return null;
  const rule = toRRULE({ recurrence: reviveRecurrence(recurrenceJson) });
  if (!rule) return null;
  return rule.replace(/UNTIL=(\d{8})T\d{6}Z?/, 'UNTIL=$1');
}

/** A DayNote → an all-day Google event. */
export function encodeDayNote(note) {
  const json = note.toJSON ? note.toJSON() : { ...note };
  // The native three are stripped: carrying them twice invites the two copies
  // to disagree, and the event's own fields are the ones a hand edit changes.
  const rest = { ...json };
  delete rest.schemaVersion;
  delete rest.label;
  delete rest.from;
  delete rest.to;

  const body = {
    summary: json.label,
    // Written, never read — the same rule as a task's description. If the app
    // ever parsed it, tidying your own notes would edit your schedule.
    description: json.kind === 'holiday' ? 'Sandy Cay · a holiday' : 'Sandy Cay · a day note',
    start: { date: json.from },
    end: { date: dayAfter(json.to) },
    extendedProperties: {
      private: {
        [`${NS}.v`]: String(ENCODING_VERSION),
        [`${NS}.id`]: String(json.id),
        [`${NS}.kind`]: KIND_DAYNOTE,
        ...packPayload(JSON.stringify(rest)),
      },
    },
  };
  const rule = allDayRRULE(json.recurrence);
  if (rule) body.recurrence = [`RRULE:${rule}`];
  return body;
}

/**
 * A blocked day → a one-day all-day event.
 *
 * ⚠️ NO PAYLOAD AND NO CHECKSUM, deliberately. The entire datum is the date,
 * and the date lives in `start.date` — a native Google field, which cannot be
 * silently truncated the way an over-long extendedProperty can. A checksum
 * exists to catch that truncation; there is nothing here for it to protect, and
 * a check that cannot fail is just something else to keep in step.
 */
export function encodeBlockedDay(day) {
  return {
    summary: 'Blocked — nothing scheduled',
    description: 'Sandy Cay · this day is blocked, so nothing is placed into it',
    start: { date: day },
    end: { date: dayAfter(day) },
    transparency: 'transparent',
    extendedProperties: {
      private: {
        [`${NS}.v`]: String(ENCODING_VERSION),
        [`${NS}.id`]: `blocked-${day}`,
        [`${NS}.kind`]: KIND_BLOCKED,
      },
    },
  };
}

/** Is this one of ours, and is it a day note or a blocked day rather than a task? */
export function dayKindOf(ev) {
  const p = ev && ev.extendedProperties && ev.extendedProperties.private;
  const kind = p && p[`${NS}.kind`];
  return kind === KIND_DAYNOTE || kind === KIND_BLOCKED ? kind : null;
}

/**
 * An all-day event of ours → the day note (or blocked day) it stands for.
 *
 * Returns `{ ok, kind, note | day, id, error }`. Refuses rather than throws, and
 * REPORTS THE ID EVEN WHEN THE READ FAILS — for the same reason `decodeEvent`
 * does. Without the id the planner sees the note as absent from Google, reads
 * that as "deleted on the other device", and deletes the local copy: the check
 * that caught the corruption would be the thing that completed it.
 */
export function decodeDayEvent(ev) {
  const priv = (ev && ev.extendedProperties && ev.extendedProperties.private) || null;
  const kind = dayKindOf(ev);
  if (!kind) return { ok: false, notOurs: true, error: 'not a Sandy Cay day event' };
  const id = priv[`${NS}.id`];

  const start = ev.start && ev.start.date;
  if (!start) return { ok: false, id, kind, error: 'an all-day event with no start date' };

  if (kind === KIND_BLOCKED) return { ok: true, kind, id, day: start };

  const v = Number(priv[`${NS}.v`]);
  if (!Number.isInteger(v) || v > ENCODING_VERSION) {
    return { ok: false, id, kind, error: `encoding version ${priv[`${NS}.v`]} is newer than ${ENCODING_VERSION}` };
  }
  const payload = unpackPayload(priv);
  if (!payload.ok) return { ok: false, id, kind, error: payload.error };
  let rest;
  try {
    rest = JSON.parse(payload.value);
  } catch {
    return { ok: false, id, kind, error: 'payload is not valid JSON' };
  }

  // `end.date` is exclusive; a missing end means a single day.
  const to = ev.end && ev.end.date ? dayBefore(ev.end.date) : start;
  return {
    ok: true,
    kind,
    id,
    note: {
      ...rest,
      schemaVersion: ENCODING_VERSION,
      id,
      label: ev.summary ?? rest.label ?? 'Note',
      from: start,
      to: to < start ? start : to,
    },
  };
}
