// googleSync.js — carrying out what `syncPlan` decided (P3).
//
// The reasoning lives in `src/core/syncPlan.js`, with no I/O, so it can be
// tested exhaustively. This file is only the hands: it talks to Google and
// reports back exactly what the API confirmed.
//
// ⚠️ THE OBLIGATION HANDED OVER BY THE PLANNER, and it is the one that matters:
// `advanceState` records what it is GIVEN. If this file ever reports the PLAN
// instead of the CONFIRMED results, a failed write is marked as pushed and
// never retried — the task exists here, not there, and the next sync sees it as
// "unchanged" forever. Silent, permanent divergence. So every write is caught
// individually and only a success is added to `synced`.
//
// The API is INJECTED rather than imported, so the whole of this can be driven
// by a fake Google in tests. Nothing here needs an account to prove.

import { encodeTask, decodeEvent } from '../core/googleEncode.js';
import { encodeLibrary, decodeLibrary } from '../core/googleLibrary.js';
import {
  listAllEvents, insertEvent, patchEvent, deleteEvent,
} from './google.js';

/** The real Google, bound to a token. Tests pass their own shape instead. */
export function makeApi(token) {
  return {
    listAll: (calendarId) => listAllEvents(token, calendarId),
    insert: (calendarId, body) => insertEvent(token, calendarId, body),
    patch: (calendarId, eventId, body) => patchEvent(token, calendarId, eventId, body),
    remove: (calendarId, eventId) => deleteEvent(token, calendarId, eventId),
  };
}

const isOurs = (ev) => {
  const p = ev && ev.extendedProperties && ev.extendedProperties.private;
  return !!p && (p['sc.id'] !== undefined || p['sc.kind'] === 'library');
};

/**
 * GS-5: is this calendar safe to use as a store?
 *
 * The decision was "you pick one, and the app refuses one it did not write to".
 * The reason is blunt: writing 37 tasks into `Class Schedule` would be a
 * disaster, and a mis-click in a dropdown is all it would take. An empty
 * calendar is fine; one that already holds Sandy Cay events is fine (it is
 * ours); one holding anything else is refused, and the refusal SAYS what it
 * found so the user can tell which calendar they actually picked.
 */
export async function inspectCalendar(api, calendarId) {
  const events = await api.listAll(calendarId);
  const ours = events.filter(isOurs);
  const foreign = events.filter((e) => !isOurs(e));
  return {
    total: events.length,
    ours: ours.length,
    foreign: foreign.length,
    safe: foreign.length === 0,
    // Named, not just counted — "3 events that are not ours" is unactionable.
    foreignSample: foreign.slice(0, 5).map((e) => e.summary || '(untitled)'),
  };
}

/**
 * Read the whole store back.
 *
 * A foreign event is skipped, not an error — a calendar may hold anything. An
 * event of OURS that will not decode IS reported, because that is corruption
 * and staying quiet about it is how it becomes permanent.
 */
export async function pull(api, calendarId) {
  const events = await api.listAll(calendarId);
  const tasks = [];
  const dropped = [];
  for (const ev of events) {
    if (!isOurs(ev)) continue;
    const p = ev.extendedProperties.private;
    if (p['sc.kind'] === 'library') continue;      // handled below
    const r = decodeEvent(ev);
    if (r.ok) tasks.push({ task: r.task, googleEventId: ev.id, updated: Date.parse(ev.updated || 0) || 0 });
    else dropped.push({ id: ev.id, summary: ev.summary, error: r.error });
  }
  const lib = decodeLibrary(events);
  return {
    tasks,
    library: lib.ok ? lib.library : null,
    libraryError: lib.ok || lib.empty ? null : lib.error,
    dropped,
  };
}

/**
 * Carry out a plan's REMOTE half.
 *
 * `plan.adopt` and `plan.deleteLocal` are local operations and are deliberately
 * not touched here — the caller applies those to the schedule. This file only
 * writes to Google.
 *
 * @returns `{ synced, forgotten, failed }` — `synced` and `forgotten` are what
 *          Google CONFIRMED, and are what `advanceState` may be given.
 */
export async function applyPlan(api, calendarId, plan, { commitmentIds, timeZone } = {}) {
  const synced = [];
  const forgotten = [];
  const failed = [];

  for (const task of plan.create) {
    try {
      const ev = await api.insert(calendarId, encodeTask(task, { commitmentIds, timeZone }));
      // ⚠️ Only on a confirmed id. Without one there is nothing to update next
      // time, and recording it would strand the task as un-updatable.
      if (ev && ev.id) synced.push({ task, eventId: ev.id });
      else failed.push({ id: task.id, op: 'create', error: 'Google returned no event id' });
    } catch (err) {
      failed.push({ id: task.id, op: 'create', error: err?.message || String(err) });
    }
  }

  for (const { task, eventId } of plan.update) {
    try {
      await api.patch(calendarId, eventId, encodeTask(task, { commitmentIds, timeZone }));
      synced.push({ task, eventId });
    } catch (err) {
      failed.push({ id: task.id, op: 'update', error: err?.message || String(err) });
    }
  }

  for (const { id, eventId } of plan.deleteRemote) {
    try {
      await api.remove(calendarId, eventId);
      forgotten.push(id);
    } catch (err) {
      failed.push({ id, op: 'delete', error: err?.message || String(err) });
    }
  }

  return { synced, forgotten, failed };
}

/**
 * Write the library, replacing whatever is there.
 *
 * Replace rather than diff: the library is one blob, it is small, and it is
 * written far less often than tasks. The DELETE comes after the successful
 * writes on purpose — losing power between the two must leave a duplicate
 * library, which `decodeLibrary` rejects loudly, rather than none at all, which
 * would look like a first run and silently start over.
 */
export async function pushLibrary(api, calendarId, scheduleJson, { dayKey } = {}) {
  const existing = (await api.listAll(calendarId)).filter((e) => {
    const p = e.extendedProperties && e.extendedProperties.private;
    return p && p['sc.kind'] === 'library';
  });

  const bodies = encodeLibrary(scheduleJson, dayKey ? { dayKey } : {});
  const written = [];
  for (const body of bodies) {
    const ev = await api.insert(calendarId, body);
    written.push(ev && ev.id);
  }

  for (const old of existing) {
    await api.remove(calendarId, old.id).catch(() => {});
  }
  return { events: written.length, replaced: existing.length };
}
