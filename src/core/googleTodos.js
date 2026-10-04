// googleTodos.js — a todo is ONE ALL-DAY EVENT (design/TODO-LIST.md §9.3).
//
// Not a row in the library blob. A todo is added and finished one at a time,
// and a blob copied whole cannot merge that: with both devices open, a finished
// todo came back from the other one (§8.1 S-3). Day notes left the library for
// the same reason (GS-11), and this follows `googleDayNotes.js` on purpose.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IS NATIVE AND WHAT RIDES IN THE PAYLOAD
// ════════════════════════════════════════════════════════════════════════════
//
//   label     ← summary      rename it in Google, it renames here (GS-4)
//   deadline  ← start.date   drag it to another day, its deadline moves
//
// Everything else (tags, the duration range) travels in `sc.json`, chunked and
// checksummed as a task's is. The two native fields are STRIPPED from the
// payload: carried twice, the copies can disagree, and the event's own fields
// are the ones a hand edit changes.
//
// ⚠️ AN UNDATED TODO SITS ON 1970-01-01 — the date the library already uses to
// stay out of sight. It is a sentinel, never a deadline: decoding turns it back
// into `null`, and a todo dragged there in Google loses its deadline. A dated
// one shows on its due day (T-1), `transparent`, so it never marks you busy.
//
// ⚠️ `sc.v` IS "2" HERE, AND ONLY HERE. An OLDER bundle does not know
// `sc.kind = 'todo'`: it routes on `sc.id`, hands the event to the TASK decoder,
// which ignores `sc.kind` and accepts any `v <= 1` — so it adopted every todo as
// a task and then wrote it back as a timed task, destroying it for both devices
// (probed, §9.11 A-1). At v2 the same old code refuses it as "newer", reports
// it unreadable, and `planSync` leaves it alone. Tasks stay at v1: bumping the
// shared version would make an old bundle refuse every TASK instead.

import { packPayload, unpackPayload, NS } from './googleEncode.js';
import { dayAfter } from './googleDayNotes.js';
import { Todo, UNDATED, asDeadline } from './Todo.js';

export const KIND_TODO = 'todo';
/** The todo encoding's own version — see the note above. */
export const TODO_ENCODING_VERSION = 2;

/** A Todo → an all-day Google event. */
export function encodeTodo(todo) {
  const json = todo.toJSON ? todo.toJSON() : new Todo(todo).toJSON();
  const rest = { ...json };
  delete rest.schemaVersion;
  delete rest.label;
  delete rest.deadline;

  const day = json.deadline || UNDATED;
  return {
    summary: json.label,
    // Written, never read — the same rule as a task's description.
    description: json.deadline
      ? 'Sandy Cay · a todo, due this day'
      : 'Sandy Cay · a todo with no due date (kept here, out of the way)',
    start: { date: day },
    end: { date: dayAfter(day) },
    transparency: 'transparent',
    extendedProperties: {
      private: {
        [`${NS}.v`]: String(TODO_ENCODING_VERSION),
        [`${NS}.id`]: String(json.id),
        [`${NS}.kind`]: KIND_TODO,
        ...packPayload(JSON.stringify(rest)),
      },
    },
  };
}

/** Is this one of our todo events? */
export function isTodoEvent(ev) {
  const p = ev && ev.extendedProperties && ev.extendedProperties.private;
  return !!p && p[`${NS}.kind`] === KIND_TODO;
}

/**
 * A todo event → the todo it stands for, as EXACTLY `Todo#toJSON` would write
 * it. That exactness is not tidiness: the sync compares a hash of the local
 * JSON with a hash of this, and any difference in shape — a missing `null`, a
 * key in another order — reads as an edit on every pass and never settles.
 * So it is rebuilt THROUGH the class rather than assembled by hand.
 *
 * Returns `{ ok, id, todo, error }`. Refuses rather than throws, and REPORTS THE
 * ID EVEN WHEN THE READ FAILS, for `decodeDayEvent`'s reason: without it the
 * planner sees the todo as absent, reads that as "done on the other device",
 * and deletes the local copy — the check that caught the corruption finishing it.
 */
export function decodeTodoEvent(ev) {
  if (!isTodoEvent(ev)) return { ok: false, notOurs: true, error: 'not a Sandy Cay todo event' };
  const priv = ev.extendedProperties.private;
  const id = priv[`${NS}.id`];
  // ⚠️ No id is not "a new todo". `Todo` would mint a random one, and a
  // DIFFERENT one on every pull — adopted, then deleted, then adopted again.
  if (id == null || id === '') return { ok: false, id: null, error: 'a todo event with no id' };

  // ⚠️ ONE INSTANCE OF A TODO SOMEBODY MADE REPEAT IN GOOGLE. It shares the
  // master's `sc.id`, so read as a todo it would overwrite the real one with
  // whichever instance came last. A todo does not repeat; the instance is
  // skipped and the master still stands for it.
  if (ev.recurringEventId) return { ok: false, skip: true, id, error: 'an instance of a repeating event' };

  const v = Number(priv[`${NS}.v`]);
  if (!Number.isInteger(v) || v > TODO_ENCODING_VERSION) {
    return { ok: false, id, error: `todo encoding version ${priv[`${NS}.v`]} is newer than ${TODO_ENCODING_VERSION}` };
  }
  const payload = unpackPayload(priv);
  if (!payload.ok) return { ok: false, id, error: payload.error };
  let rest;
  try {
    rest = JSON.parse(payload.value);
  } catch {
    return { ok: false, id, error: 'payload is not valid JSON' };
  }

  // All-day is what we write; if it was given a time in Google, its DAY is
  // still the deadline (the leading date of an RFC 3339 stamp is the local one).
  const start = ev.start && (ev.start.date || String(ev.start.dateTime || '').slice(0, 10));
  if (!start) return { ok: false, id, error: 'a todo event with no start date' };

  const todo = new Todo({
    ...rest,
    id,
    label: ev.summary ?? rest.label ?? 'Todo',
    deadline: asDeadline(start), // 1970-01-01 → null
  });
  return { ok: true, id, todo: todo.toJSON() };
}
