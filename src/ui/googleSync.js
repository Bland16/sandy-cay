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

import { encodeTaskParts, decodeEvent } from '../core/googleEncode.js';
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
  // ⚠️ Keyed by TASK id, not event id. A repeating task whose windows keep
  // different times on different days is SEVERAL events (see
  // `encodeTaskParts`), and they must come back as ONE task or the app would
  // grow a duplicate for every part. They all share `sc.id`; each carries the
  // full payload, so any surviving part rebuilds the whole thing.
  const byTaskId = new Map();
  const dropped = [];
  for (const ev of events) {
    if (!isOurs(ev)) continue;
    const p = ev.extendedProperties.private;
    if (p['sc.kind'] === 'library') continue;      // handled below
    const r = decodeEvent(ev);
    if (r.ok) {
      const seen = byTaskId.get(r.task.id);
      const updated = Date.parse(ev.updated || 0) || 0;
      if (seen) {
        seen.googleEventIds.push(ev.id);
        // The NEWEST part decides whether the task counts as changed remotely —
        // editing any one of them is an edit to the task.
        if (updated > seen.updated) { seen.updated = updated; seen.task = r.task; }
      } else {
        byTaskId.set(r.task.id, {
          task: r.task,
          googleEventIds: [ev.id],
          updated,
          expectedParts: Number(p['sc.parts']) || 1,
        });
      }
    }
    // ⚠️ `taskId` matters more than the event id here. The planner must be told
    // WHICH TASK is unreadable, or it sees the task as absent from Google and
    // deletes the local copy — corruption turned into data loss by the very
    // check that caught it. See `planSync`'s `unreadable`.
    else dropped.push({ id: ev.id, taskId: r.id || null, summary: ev.summary, error: r.error });
  }
  const tasks = [...byTaskId.values()];
  // A task whose parts do not all show up. Reported rather than silently
  // treated as a smaller routine — half a gym week is not a gym week.
  const incomplete = tasks
    .filter((t) => t.googleEventIds.length < t.expectedParts)
    .map((t) => ({ id: t.task.id, title: t.task.title, found: t.googleEventIds.length, expected: t.expectedParts }));

  const lib = decodeLibrary(events);
  return {
    tasks,
    incomplete,
    library: lib.ok ? lib.library : null,
    libraryError: lib.ok || lib.empty ? null : lib.error,
    dropped,
    /** Task ids that exist in Google but could not be read. */
    unreadable: new Set(dropped.map((d) => d.taskId).filter(Boolean)),
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

  const bodiesFor = (task) => encodeTaskParts(task, { commitmentIds, timeZone });

  for (const task of plan.create) {
    try {
      // One task can be SEVERAL events — a repeating task with different times
      // on different days is one event per time.
      const bodies = bodiesFor(task);
      const ids = [];
      for (const body of bodies) {
        const ev = await api.insert(calendarId, body);
        if (ev && ev.id) ids.push(ev.id);
      }
      // ⚠️ ALL parts or none. A task recorded as synced with only some of its
      // events written would never be retried, and the calendar would keep a
      // permanently half-written routine.
      if (ids.length === bodies.length) synced.push({ task, eventId: ids[0], eventIds: ids });
      else failed.push({ id: task.id, op: 'create', error: `wrote ${ids.length} of ${bodies.length} parts` });
    } catch (err) {
      failed.push({ id: task.id, op: 'create', error: err?.message || String(err) });
    }
  }

  for (const { task, eventIds = [] } of plan.update) {
    try {
      const bodies = bodiesFor(task);
      if (bodies.length === eventIds.length) {
        // Same shape — PATCH in place, which preserves anything the user added
        // to the event in Google and keeps the ids stable.
        for (let i = 0; i < bodies.length; i += 1) {
          await api.patch(calendarId, eventIds[i], bodies[i]);
        }
        synced.push({ task, eventId: eventIds[0], eventIds });
      } else {
        // The number of times changed — a window was added or removed — so the
        // parts no longer line up. Replace the set. The old events go LAST, so
        // a failure part-way leaves duplicates (visible, fixable) rather than
        // nothing (silent loss).
        const ids = [];
        for (const body of bodies) {
          const ev = await api.insert(calendarId, body);
          if (ev && ev.id) ids.push(ev.id);
        }
        if (ids.length !== bodies.length) throw new Error(`wrote ${ids.length} of ${bodies.length} parts`);
        for (const old of eventIds) await api.remove(calendarId, old).catch(() => {});
        synced.push({ task, eventId: ids[0], eventIds: ids });
      }
    } catch (err) {
      failed.push({ id: task.id, op: 'update', error: err?.message || String(err) });
    }
  }

  for (const { id, eventIds = [] } of plan.deleteRemote) {
    try {
      for (const eventId of eventIds) await api.remove(calendarId, eventId);
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
