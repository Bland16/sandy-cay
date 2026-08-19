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

import { toRRULE } from './ical.js';
import { reviveRecurrence } from './recurrenceSerde.js';

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
 *
 * ⚠️ `recurrence` IS DELIBERATELY NOT IN THIS SET, and it was, briefly, which
 * silently turned every repeating task into a one-off. Proven on the seed's
 * "Morning gym": pattern in, `null` out, no error anywhere. It is precisely the
 * failure `Task.js` warns about beside this very field — "a field present in
 * only one of the two is silently dropped (that is exactly how `freq` was lost)".
 *
 * The reason it cannot be native: RRULE is strictly POORER than this app's
 * recurrence. A pattern here is a list of periods with their own
 * effectiveFrom/Until, per-window freq, and exceptions that can move or add a
 * session. `toRRULE` is an export convenience and `.ics` import already reports
 * what it cannot read. Storage has to be lossless, so the payload holds the
 * truth. A caller may ALSO pass `rrule` to make the event visibly repeat in
 * Google — a display mirror, never the source. See GS-10.
 */
const NATIVE = new Set(['title', 'startTime', 'endTime']);

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

const WEEKDAY_CODE = { sun: 'SU', mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA' };
const CODE_BY_INDEX = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The RRULE, but ONLY when it would be both legal and truthful.
 *
 * ⚠️ TWO WAYS A DERIVED RRULE GOES WRONG, both found from a real calendar:
 *
 * 1. **Different times on different days.** An RRULE has exactly ONE time — the
 *    event's own start. A gym at Mon 16:15, Wed 19:00 and Sat 14:00 becomes
 *    `BYDAY=MO,WE,SA` anchored at 16:15, so Google shows Wednesday and Saturday
 *    at the WRONG TIME. A mirror that lies is worse than no mirror, because the
 *    app's own grid is right and the calendar quietly disagrees with it.
 *
 * 2. **The anchor is not one of the repeating days.** Google rejects an RRULE
 *    whose BYDAY excludes DTSTART — 400, the insert fails, and the event never
 *    appears AT ALL. That is how a repeating gym went completely missing.
 *
 * In both cases the pattern is still safe in the payload, so the app stays
 * correct; only Google's view is reduced to a single event. Returning null is a
 * deliberate downgrade, not a silent failure — `rruleSkipped` says which.
 */
export function safeRRULE(json) {
  const rec = json.recurrence;
  if (!rec) return { rule: null, reason: null };

  // ⚠️ REVIVED FIRST, and this is a bug fix, not tidiness. Everything in this
  // file works on the JSON form, where a date is epoch MILLISECONDS. `toRRULE`
  // works on the MODEL form and calls `lastRunDay(period.effectiveUntil)`,
  // which reaches straight for `.getTime()` — so every repeating task WITH AN
  // END DATE threw `date.getTime is not a function` and never reached Google.
  //
  // It hid because nothing bounded repeats: the seed's patterns run forever, so
  // 1014 green tests and every probe took the `effectiveUntil == null` branch.
  // A real term ends, so all eight of the user's courses failed at once while
  // the unbounded gym went up fine.
  const rule = untilForGoogle(toRRULE({ ...json, recurrence: reviveRecurrence(rec) }));
  if (!rule) return { rule: null, reason: null };

  const period = (rec.periods || []).find((p) => !p.effectiveUntil) || (rec.periods || [])[0];
  const windows = (period && period.windows) || [];

  // 1. One time, or no rule.
  const times = new Set(windows.map((w) => `${w.start}-${w.end}`));
  if (times.size > 1) return { rule: null, reason: 'windows-differ' };

  // 2. The anchor must be one of the days the rule fires on.
  const byday = /BYDAY=([^;]+)/.exec(rule);
  if (byday && json.startTime) {
    const anchor = CODE_BY_INDEX[new Date(json.startTime).getDay()];
    const days = byday[1].split(',').map((d) => d.replace(/^-?\d+/, ''));
    if (!days.includes(anchor)) return { rule: null, reason: 'anchor-not-in-rule' };
  }
  // Referenced so the map is not dead weight if the shape of `toRRULE` changes.
  void WEEKDAY_CODE;
  return { rule, reason: null };
}

/**
 * `.ics` and Google want DIFFERENT `UNTIL`s, and handing Google the `.ics` one
 * is wrong in two separate ways.
 *
 * `toRRULE` emits `UNTIL=20261211T000000` — floating local time, at MIDNIGHT of
 * the last day it runs. That is right for the `.ics` file, whose `DTSTART` is
 * floating too and whose reader that matters is this app's own `fromRRULE`.
 * For Google it is wrong twice:
 *
 * 1. **RFC 5545 §3.3.10** — when `DTSTART` carries a zone, and ours does
 *    (`{dateTime, timeZone}`), `UNTIL` MUST be UTC. A rule Google refuses is a
 *    400 on the insert and the event does not appear AT ALL — the same failure
 *    the BYDAY-anchor check was written for.
 * 2. **Midnight drops the last day.** `UNTIL` includes an occurrence that
 *    STARTS at or before it, so a 10:00 class on the last day starts after
 *    midnight of that day and is excluded. The final session of term would
 *    quietly be missing from the calendar.
 *
 * So: the end of the last day it runs, expressed in UTC.
 */
export function untilForGoogle(rule) {
  if (!rule) return rule;
  return String(rule).replace(/UNTIL=([0-9]{4})([0-9]{2})([0-9]{2})T[0-9]{6}Z?/, (_m, y, mo, d) => {
    const endOfDay = new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 0);
    const p = (n) => String(n).padStart(2, '0');
    return `UNTIL=${endOfDay.getUTCFullYear()}${p(endOfDay.getUTCMonth() + 1)}${p(endOfDay.getUTCDate())}`
      + `T${p(endOfDay.getUTCHours())}${p(endOfDay.getUTCMinutes())}${p(endOfDay.getUTCSeconds())}Z`;
  });
}

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Split a recurring task's windows into groups that share a TIME.
 *
 * A gym at Mon 16:15, Wed 19:00 and Sat 14:00 is three groups. Each becomes its
 * own Google event with its own RRULE, because an RRULE carries exactly one
 * time and one event therefore cannot say all three.
 *
 * Returns `[]` for anything that does not need splitting, so the ordinary path
 * is untouched — one task, one event, exactly as before.
 */
export function timeGroups(json) {
  const rec = json.recurrence;
  if (!rec) return [];
  const period = (rec.periods || []).find((p) => !p.effectiveUntil) || (rec.periods || [])[0];
  const windows = (period && period.windows) || [];
  if (windows.length < 2) return [];
  // ⚠️ WEEKLY ONLY. A split part is built around a set of WEEKDAYS, and a
  // monthly or yearly window has no `day` — it has a `monthDay` or an `nth`.
  // Splitting one produced two events both claiming `FREQ=WEEKLY` with no BYDAY
  // and both anchored at the same instant: a mirror that lies, which is the one
  // thing `safeRRULE` exists to refuse. Returning [] sends it down the ordinary
  // path, where it becomes ONE event and says `sc.norrule=windows-differ`.
  if (period.freq && period.freq !== 'weekly') return [];

  const byTime = new Map();
  for (const w of windows) {
    const key = `${w.start}-${w.end}`;
    if (!byTime.has(key)) byTime.set(key, { start: w.start, end: w.end, days: [] });
    byTime.get(key).days.push(w.day);
  }
  // One group means every window already shares a time — no split needed.
  return byTime.size < 2 ? [] : [...byTime.values()];
}

const hhmm = (s) => {
  const [h, m] = String(s || '00:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

/**
 * The first date on or after `from` that falls on one of `days`, at `time`.
 *
 * ⚠️ This is what stops Google refusing the event. It rejects an RRULE whose
 * BYDAY excludes DTSTART, so each split part must START on one of its own days
 * — the parent task's `startTime` belongs to whichever window came first and is
 * the wrong anchor for every other group.
 */
export function firstOccurrence(days, time, from) {
  const wanted = days.map((d) => DAY_INDEX[d]).filter((n) => n !== undefined).sort((a, b) => a - b);
  if (!wanted.length) return null;
  const { h, m } = hhmm(time);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  for (let i = 0; i < 7; i += 1) {
    if (wanted.includes(d.getDay()) && d.getTime() >= new Date(from).setHours(0, 0, 0, 0)) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return null;
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
// ⚠️ `rrule` has NO DEFAULT on purpose. It used to default to `null`, which
// made the `=== undefined` check below unreachable, so the derived rule never
// ran — the fix looked right and did nothing. Absent means "derive it"; an
// explicit `null` means "deliberately none".
export function encodeTask(task, { commitmentIds, timeZone = 'UTC', rrule } = {}) {
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

  // ⚠️ DERIVED BY DEFAULT, not opt-in — and that change IS the bug fix.
  //
  // This used to emit an RRULE only when a caller passed one, and no caller
  // ever did. The pattern still round-tripped perfectly (it lives in the
  // payload), so every test passed and the app was correct — but GOOGLE had no
  // rule to expand, so a repeating task showed up as a SINGLE event in the
  // calendar. Reported from a real browser, invisible to 992 tests.
  //
  // An option a caller must remember is an option a caller will forget. The
  // mirror is now derived from the task itself; pass `rrule: null` to suppress
  // it deliberately.
  const derived = rrule === undefined ? safeRRULE(json) : { rule: rrule, reason: null };
  if (derived.rule) {
    body.recurrence = Array.isArray(derived.rule)
      ? derived.rule
      : [String(derived.rule).startsWith('RRULE:') ? derived.rule : `RRULE:${derived.rule}`];
  } else if (derived.reason) {
    // Recorded on the event so the downgrade is inspectable rather than a
    // mystery — "why is my repeating gym one event in Google?" has an answer
    // sitting on the event itself.
    body.extendedProperties.private[`${NS}.norrule`] = derived.reason;
  }
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
  // ⚠️ THE TASK ID IS REPORTED EVEN WHEN THE READ FAILS, and it is load-bearing.
  // `sc.id` is its own property, so it survives a corrupt or truncated payload.
  // Without it the caller only knows "some event broke", and the planner then
  // sees the task as ABSENT from Google — which it reads as "deleted on the
  // other device" and propagates by deleting your local copy. The checksum that
  // detects the corruption would be the thing that destroys the data.
  const id = priv[`${NS}.id`];

  const v = Number(priv[`${NS}.v`]);
  if (!Number.isInteger(v) || v > ENCODING_VERSION) {
    // Written by a NEWER version than this build understands. Refusing beats
    // guessing: a partial read that silently drops the fields it did not know
    // about would then be written back, destroying them for the newer client.
    return { ok: false, id, error: `encoding version ${priv[`${NS}.v`]} is newer than ${ENCODING_VERSION}` };
  }
  const payload = unpackPayload(priv);
  if (!payload.ok) return { ok: false, id, error: payload.error };

  let rest;
  try {
    rest = JSON.parse(payload.value);
  } catch {
    return { ok: false, id, error: 'payload is not valid JSON' };
  }

  const task = {
    ...rest,
    // Restored explicitly: it is stripped on the way out (SKIP) because it is
    // constant, but a decoded task missing it does not match the local one, and
    // any difference makes the sync push it straight back.
    schemaVersion: ENCODING_VERSION,
    id: priv[`${NS}.id`],
    title: ev.summary ?? rest.title ?? 'Untitled',
  };
  // Times come from the EVENT, not the payload — they are not in the payload at
  // all (NATIVE), so a hand edit in Google Calendar is what lands here. That is
  // GS-4: your own hand outranks the scheduler (R-1).
  if (ev.start && ev.start.dateTime) task.startTime = new Date(ev.start.dateTime).getTime();
  if (ev.end && ev.end.dateTime) task.endTime = new Date(ev.end.dateTime).getTime();

  // ⚠️ EXCEPT on a split part, where the event's start is THIS GROUP'S first
  // occurrence and not the task's own start. Taking it from the event there
  // rewrote the task's time on every pull, and the next sync pushed the change
  // back — a repeating task never settling.
  if (priv[`${NS}.t0`] !== undefined) task.startTime = Number(priv[`${NS}.t0`]);
  if (priv[`${NS}.t1`] !== undefined) task.endTime = Number(priv[`${NS}.t1`]);

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

/**
 * A task → the event(s) that represent it in Google.
 *
 * ONE event for anything ordinary. SEVERAL when a repeating task keeps
 * different times on different days, because an RRULE carries exactly one time
 * — a gym at Mon 16:15, Wed 19:00 and Sat 14:00 needs three.
 *
 * ⚠️ EVERY PART CARRIES THE FULL PAYLOAD, not just the first. It costs ~500
 * bytes each and it means ANY surviving part can rebuild the whole task. If
 * only part 0 held it, losing that one event — a hand delete in Google, a
 * failed write — would strand the rest as unreadable fragments.
 *
 * Regrouping on the way back needs only `sc.id`, which is identical across the
 * parts; `sc.part` and `sc.parts` say which piece this is and how many there
 * should be, so a missing one is DETECTABLE rather than silently halving a
 * routine.
 */
export function encodeTaskParts(task, opts = {}) {
  const json = task.toJSON ? task.toJSON() : { ...task };
  const groups = timeGroups(json);
  if (groups.length === 0) return [encodeTask(task, opts)];

  const anchor = json.startTime ? new Date(json.startTime) : new Date();
  const rec = json.recurrence;
  const period = (rec.periods || []).find((p) => !p.effectiveUntil) || (rec.periods || [])[0];

  return groups.map((g, i) => {
    // Each part starts on one of ITS OWN days, which is what keeps Google from
    // rejecting the rule.
    const from = period && period.effectiveFrom ? new Date(period.effectiveFrom) : anchor;
    const start = firstOccurrence(g.days, g.start, from) || anchor;
    const end = new Date(start);
    const e = hhmm(g.end);
    end.setHours(e.h, e.m, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);

    // ⚠️ ONE DOOR FOR THE RULE. This used to hand-build
    // `FREQ=WEEKLY;BYDAY=…` right here, which meant the file had two rule
    // derivations and only one of them obeyed the rules. The hand-built one
    // DROPPED `UNTIL`, so a split class that ends in December repeated forever
    // in Google, and it hard-coded WEEKLY, so a monthly pattern came out as a
    // weekly one. Building this group's own period and putting it through
    // `safeRRULE` gets the bound, the interval, the anchor check and the
    // refuse-rather-than-lie downgrade for free — the same ones the single-event
    // path has always had.
    const groupWindows = (period.windows || []).filter((w) => `${w.start}-${w.end}` === `${g.start}-${g.end}`);
    const derived = safeRRULE({
      ...json,
      startTime: start.getTime(),
      recurrence: { ...rec, periods: [{ ...period, windows: groupWindows }] },
    });

    const body = encodeTask(
      { ...json, startTime: start.getTime(), endTime: end.getTime() },
      { ...opts, rrule: derived.rule },
    );
    const priv = body.extendedProperties.private;
    // `encodeTask` records the reason only when it derives the rule itself; here
    // it was handed one, so the downgrade is recorded on this side.
    if (!derived.rule && derived.reason) priv[`${NS}.norrule`] = derived.reason;
    priv[`${NS}.part`] = String(i);
    priv[`${NS}.parts`] = String(groups.length);
    // ⚠️ THE TASK'S OWN TIMES, carried because this part's start is NOT the
    // task's start — it is this group's first occurrence, which is a different
    // day and time for every part.
    //
    // Without these, decoding a part overwrote the task's startTime with the
    // part's anchor. The adopted task then differed from the local one, so the
    // next sync pushed it back, which changed the events, which looked like a
    // remote edit... a repeating task took five passes to settle instead of
    // one, and the app sat on "syncing" the whole time.
    //
    // The cost, stated: dragging ONE PART of a split task in Google Calendar no
    // longer moves the task. It cannot meaningfully — "part 2 of 3" has no
    // single time in the model, only a window that must be edited as a window.
    if (json.startTime != null) priv[`${NS}.t0`] = String(json.startTime);
    if (json.endTime != null) priv[`${NS}.t1`] = String(json.endTime);
    body.description = `${body.description} · part ${i + 1} of ${groups.length}`;
    return body;
  });
}
