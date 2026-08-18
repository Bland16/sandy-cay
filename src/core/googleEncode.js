// googleEncode.js — a task ⇄ a Google Calendar event (design/GOOGLE-AS-STORAGE.md).
//
// P0 of that spec: PURE FUNCTIONS ONLY. No network, no DOM, no account. This is
// where a silent data-loss bug would live, so it is built and proven on its own
// before anything is allowed to talk to Google. `src/ui/google.js` does the
// talking; this file only decides what the bytes are. Same split `ical.js`
// already uses for `.ics`.
//
// ════════════════════════════════════════════════════════════════════════════
// THE THREE THINGS GOOGLE IMPOSES, AND WHAT EACH ONE COSTS
// ════════════════════════════════════════════════════════════════════════════
//
// 1. A value over 1024 bytes is SILENTLY TRUNCATED. Google's own word. Nothing
//    errors, nothing warns — the tail is simply gone. So payloads are cut into
//    CHUNK_BYTES pieces well under the limit, and the count and a checksum are
//    stored alongside. `decodeEvent` refuses a payload that does not match
//    rather than handing back a half-task. This project has been bitten by
//    exactly this shape before (`freq` dropped by both serialisers; a recurring
//    session losing its `load`) and both times the failure was invisible.
//
// 2. Event ids are base32hex — lowercase a–v and 0–9 only, 5–1024 chars. Task
//    ids look like `x-0001`: a hyphen, and `x` is outside a–v. So we NEVER mint
//    an event id. Google assigns it; the task id rides in `sc.id`, and
//    `events.list?privateExtendedProperty=sc.id=…` finds it again.
//
// 3. 32 kB and 300 properties per event, total. A task's app fields measure
//    ~531 bytes, so a task is nowhere near either ceiling. The LIBRARY (P1) is
//    the one that has to watch them.
//
// ════════════════════════════════════════════════════════════════════════════
// WHY `kind` IS STORED RATHER THAN DERIVED
// ════════════════════════════════════════════════════════════════════════════
//
// `parentId` is OVERLOADED. A project chunk's `parentId` is a Task (the parent
// carries `chunking`); a commitment sitting's `parentId` is a Commitment
// (`generate.js:343`). Nothing on the task itself says which collection the
// parent lives in — so a task cannot be classified from the task alone.
//
// It is resolved ONCE, here, against the schedule that still has both
// collections in front of it, and written down as `sc.kind`. Decoding then
// trusts what was written instead of re-deriving it from a library event that
// may not have loaded yet. That ordering dependency is the bug this avoids.

const NS = 'sc';
export const ENCODING_VERSION = 1;

/** Well under Google's 1024-byte ceiling, so the encoding has headroom. */
export const CHUNK_BYTES = 900;

export const KIND = {
  TASK: 'task',
  ROUTINE_STEP: 'routine-step',
  COMMITMENT_SITTING: 'commitment-sitting',
  PROJECT_CHUNK: 'project-chunk',
  PROJECT_PARENT: 'project-parent',
};

/**
 * Fields Google stores NATIVELY. They are written to real event fields and must
 * not also be duplicated into the payload — two homes for one value is how the
 * two copies drift.
 */
const NATIVE = new Set(['title', 'startTime', 'endTime', 'recurrence']);

/** Never round-tripped: derived, or meaningless on the far side. */
const SKIP = new Set(['schemaVersion']);

/**
 * FNV-1a, 32-bit, hex. Not security — a truncation detector. It has to be
 * dependency-free (core is plain JS) and identical on every device, which rules
 * out anything from the platform.
 */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // Multiply by the FNV prime (16777619) in 32-bit space without overflowing
    // JS's 53-bit integers.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Bytes, not characters — the Google limit is bytes and emoji are 4 of them. */
export function byteLength(str) {
  let n = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c < 0x10000) n += 3;
    else n += 4;
  }
  return n;
}

/**
 * Split a string into pieces each at most CHUNK_BYTES BYTES.
 *
 * ⚠️ Splits on code points, never on `.slice(n)`. A naive byte slice can cut a
 * multi-byte character in half, and the two halves reassemble into a different
 * string — silent corruption of exactly the kind the checksum exists to catch,
 * except it would happen on every save rather than rarely.
 */
export function chunkString(str, max = CHUNK_BYTES) {
  const parts = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of str) {
    const b = byteLength(ch);
    if (curBytes + b > max) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur !== '' || parts.length === 0) parts.push(cur);
  return parts;
}

/** `{ 'sc.json.0': '…', 'sc.json.n': '2', 'sc.json.sum': 'abcd1234' }` */
export function packPayload(str, prefix = `${NS}.json`) {
  const parts = chunkString(str);
  const out = { [`${prefix}.n`]: String(parts.length), [`${prefix}.sum`]: checksum(str) };
  parts.forEach((p, i) => { out[`${prefix}.${i}`] = p; });
  return out;
}

/**
 * Reassemble, and REFUSE anything that does not add up.
 *
 * Returns `{ ok, value, error }` rather than throwing: one corrupt event must
 * not take down a whole pull. The caller drops that event and reports it, the
 * way `importEvents(...).dropped` already does for unreadable `.ics` rules.
 */
export function unpackPayload(props, prefix = `${NS}.json`) {
  if (!props) return { ok: false, error: 'no properties' };
  const nRaw = props[`${prefix}.n`];
  if (nRaw === undefined) return { ok: false, error: 'no payload' };
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: `bad chunk count ${nRaw}` };
  let str = '';
  for (let i = 0; i < n; i += 1) {
    const part = props[`${prefix}.${i}`];
    // A MISSING chunk is what truncation-by-property-drop looks like.
    if (part === undefined) return { ok: false, error: `chunk ${i} of ${n} missing` };
    str += part;
  }
  const want = props[`${prefix}.sum`];
  const got = checksum(str);
  if (want && want !== got) {
    // The 1024-byte silent truncation, caught. Without this the task would
    // simply come back with some fields quietly gone.
    return { ok: false, error: `checksum ${got} does not match stored ${want}` };
  }
  return { ok: true, value: str };
}

/**
 * Which sort of thing this task is.
 *
 * `commitmentIds` is required to tell a sitting from a chunk — see the header.
 * Passing nothing is not an error, but everything with a `parentId` will then
 * look like a project chunk, so callers that have a schedule should pass it.
 */
export function kindOf(task, { commitmentIds } = {}) {
  if (task.routineId != null) return KIND.ROUTINE_STEP;
  if (task.chunking) return KIND.PROJECT_PARENT;
  if (task.parentId != null) {
    const isCommitment = commitmentIds
      && (commitmentIds.has ? commitmentIds.has(task.parentId) : commitmentIds.includes(task.parentId));
    return isCommitment ? KIND.COMMITMENT_SITTING : KIND.PROJECT_CHUNK;
  }
  return KIND.TASK;
}

/** The short readable line in the event's notes. WRITTEN, NEVER READ — see below. */
export function humanSummary(task, kind) {
  switch (kind) {
    case KIND.ROUTINE_STEP:
      return `Sandy Cay · routine step ${(task.stepIndex ?? 0) + 1}`;
    case KIND.COMMITMENT_SITTING:
      return 'Sandy Cay · a sitting toward a standing commitment';
    case KIND.PROJECT_CHUNK:
      return 'Sandy Cay · one sitting of a larger project';
    case KIND.PROJECT_PARENT:
      return 'Sandy Cay · project record (not a scheduled session)';
    default:
      return task.type === 'fixed' ? 'Sandy Cay · a fixed commitment' : 'Sandy Cay · a flexible task';
  }
}

/**
 * Task → a Google event body.
 *
 * `timeZone` is passed in rather than read from the platform, because core must
 * not touch globals and because a fixture that reads the machine's zone is the
 * flakiness sharp edge #8 forbids. It is stored EXPLICITLY: a Google event
 * carries `{dateTime, timeZone}` where `Task.startTime` is bare epoch-ms, which
 * is why round-tripping through Google makes the timezone bug (probe-b-tz.mjs)
 * less reachable rather than more.
 */
export function encodeTask(task, { commitmentIds, timeZone = 'UTC', rrule = null } = {}) {
  const json = task.toJSON ? task.toJSON() : { ...task };
  const kind = kindOf(json, { commitmentIds });

  const rest = {};
  for (const [k, v] of Object.entries(json)) {
    if (NATIVE.has(k) || SKIP.has(k)) continue;
    if (v === undefined) continue;
    rest[k] = v;
  }
  const payload = JSON.stringify(rest);

  const priv = {
    [`${NS}.v`]: String(ENCODING_VERSION),
    [`${NS}.id`]: String(json.id),
    [`${NS}.kind`]: kind,
    ...packPayload(payload),
  };
  // `sc.ref` and `sc.i` are lifted OUT of the payload as their own properties
  // purely so they are queryable: `privateExtendedProperty=sc.ref=<id>` finds a
  // routine's steps or a project's chunks without downloading every event.
  if (json.parentId != null) priv[`${NS}.ref`] = String(json.parentId);
  if (json.routineId != null) priv[`${NS}.ref`] = String(json.routineId);
  if (json.stepIndex != null) priv[`${NS}.i`] = String(json.stepIndex);

  const body = {
    summary: json.title,
    // ⚠️ The description is WRITTEN and NEVER READ. It exists so the event is
    // legible in Google Calendar on a phone. The moment the app parses it, a
    // user tidying their own notes silently edits their schedule.
    description: humanSummary(json, kind),
    extendedProperties: { private: priv },
  };
  if (json.startTime) body.start = { dateTime: new Date(json.startTime).toISOString(), timeZone };
  if (json.endTime) body.end = { dateTime: new Date(json.endTime).toISOString(), timeZone };
  if (rrule) body.recurrence = Array.isArray(rrule) ? rrule : [rrule];
  return body;
}

/**
 * A Google event → the task-shaped record, or a stated refusal.
 *
 * Returns `{ ok, task, kind, googleEventId, error }`. An event this app did not
 * write is `ok: false` with `notOurs: true` — a calendar can hold anything, and
 * a foreign event is not a corruption.
 */
export function decodeEvent(ev) {
  const priv = ev && ev.extendedProperties && ev.extendedProperties.private;
  if (!priv || priv[`${NS}.id`] === undefined) {
    return { ok: false, notOurs: true, error: 'not written by this app' };
  }
  const v = Number(priv[`${NS}.v`]);
  if (!Number.isInteger(v) || v > ENCODING_VERSION) {
    // Written by a NEWER version than this build understands. Refusing beats
    // guessing: a partial read that silently drops the fields it did not know
    // about would then be written back, destroying them for the newer client.
    return { ok: false, error: `encoding version ${priv[`${NS}.v`]} is newer than ${ENCODING_VERSION}` };
  }
  const payload = unpackPayload(priv);
  if (!payload.ok) return { ok: false, error: payload.error };

  let rest;
  try {
    rest = JSON.parse(payload.value);
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }

  const task = { ...rest, id: priv[`${NS}.id`], title: ev.summary ?? rest.title ?? 'Untitled' };
  // Times come from the EVENT, not the payload — they are not in the payload at
  // all (NATIVE), so a hand edit in Google Calendar is what lands here. That is
  // GS-4: your own hand outranks the scheduler (R-1).
  if (ev.start && ev.start.dateTime) task.startTime = new Date(ev.start.dateTime).getTime();
  if (ev.end && ev.end.dateTime) task.endTime = new Date(ev.end.dateTime).getTime();

  return {
    ok: true,
    task,
    kind: priv[`${NS}.kind`] || KIND.TASK,
    googleEventId: ev.id ?? null,
  };
}

/** The query that finds one task's event again, per Google's list filter. */
export function idQuery(taskId) {
  return `${NS}.id=${taskId}`;
}
