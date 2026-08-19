// syncPlan.js — decide what to send, fetch and delete. PURE; no network.
// design/GOOGLE-AS-STORAGE.md P3.
//
// Every decision that can DESTROY DATA lives here, in a function with no I/O,
// so it can be exhaustively tested without an account. The executor in
// `src/ui/googleSync.js` only carries out what this returns.
//
// ════════════════════════════════════════════════════════════════════════════
// THE PROBLEM THAT MAKES THIS MORE THAN A DIFF
// ════════════════════════════════════════════════════════════════════════════
//
// A task present locally but absent remotely is AMBIGUOUS. It is either:
//   - brand new here and never pushed        → CREATE it there
//   - or pushed before and deleted there     → DELETE it here
//
// The two are identical from a snapshot. Telling them apart needs a record of
// what was last synced, which is what `state.entries` is. Without it, a sync
// either resurrects everything you delete or deletes everything you add — and
// which of those you get is a coin toss on ordering.
//
// ════════════════════════════════════════════════════════════════════════════
// AND WHY "NEWEST WINS" NEEDED A WORKAROUND (GS-7)
// ════════════════════════════════════════════════════════════════════════════
//
// The decision was "newest edit wins". But `Task` HAS NO MODIFICATION TIME —
// `Schedule#_touch` bumps one schedule-wide counter and nothing records when a
// particular task changed. Adding `updatedAt` would mean stamping it in every
// mutator in Schedule, and missing one would be invisible.
//
// So the sync layer keeps its own: when it first notices a task's content no
// longer matches what was last pushed, it stamps `dirtyAt`. With the 5-second
// debounce that is within seconds of the real edit, which is far finer than the
// gap between two devices being used. It costs no model change and it cannot
// fall out of step with a mutator nobody remembered to update.

/**
 * FNV-1a over the task's serialisation. Detects "has this changed since we last
 * pushed it" without storing a second copy of every task.
 */
export function taskHash(taskJson) {
  const str = JSON.stringify(taskJson);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function emptyState() {
  return { lastSyncAt: 0, entries: {} };
}

/**
 * Note that a task's content has changed, stamping WHEN — the local half of
 * "newest wins". Called by the debounced writer before it plans.
 *
 * `now` is a parameter, never `Date.now()`: core must not read the wall clock
 * (sharp edge #8), and a fixture that does goes flaky on the day it runs.
 */
export function markDirty(state, localTasks, now) {
  const entries = { ...state.entries };
  for (const t of localTasks) {
    const e = entries[t.id];
    if (!e) continue;                     // never synced; CREATE will handle it
    const hash = taskHash(t);
    if (hash === e.hash) {
      // Back to what was pushed — an edit and an undo. No longer dirty.
      if (e.dirtyAt) entries[t.id] = { ...e, dirtyAt: 0 };
      continue;
    }
    // Stamp only the FIRST time it goes dirty, so an edit at 09:00 still reads
    // as 09:00 after five more keystrokes. Re-stamping would let a slow typist
    // beat a remote edit that genuinely came later.
    if (!e.dirtyAt) entries[t.id] = { ...e, dirtyAt: now };
  }
  return { ...state, entries };
}

/**
 * What to do, given both sides and what was last synced.
 *
 * @param local   task JSON, as `Schedule#toJSON().tasks`
 * @param remote  `[{ task, googleEventId, updated }]` — `updated` in epoch ms,
 *                from Google's own `updated` field on the event
 * @param state   `{ lastSyncAt, entries: { id: { hash, eventId, dirtyAt } } }`
 */
/**
 * The Google event ids for one task. A task is usually one event, but a
 * repeating task with different times on different days is one event PER TIME
 * (see `encodeTaskParts`), so this is always a list.
 */
function eventIdsOf(r) {
  if (Array.isArray(r.googleEventIds)) return r.googleEventIds;
  return r.googleEventId ? [r.googleEventId] : [];
}

export function planSync(local, remote, state = emptyState(), { unreadable } = {}) {
  const entries = state.entries || {};
  const lastSyncAt = state.lastSyncAt || 0;
  // ⚠️ Tasks whose remote event EXISTS but could not be decoded. They must be
  // left completely alone: they are not absent, they are unreadable, and the
  // two look identical from `remote` alone.
  //
  // Without this, corruption becomes DATA LOSS — the event fails its checksum,
  // so it is dropped from `remote`, so the task looks deleted-on-the-other-
  // device, so this deletes your local copy. The guard that detects the damage
  // would be the thing that finishes it.
  const blocked = unreadable instanceof Set ? unreadable : new Set(unreadable || []);

  const localById = new Map(local.map((t) => [t.id, t]));
  const remoteById = new Map();
  for (const r of remote) {
    if (r && r.task && r.task.id != null) remoteById.set(r.task.id, r);
  }

  const plan = {
    create: [], update: [], deleteRemote: [], adopt: [], deleteLocal: [], conflicts: [], unchanged: [], blocked: [],
    // ⚠️ One row per task saying WHAT was decided and WHY. This is not
    // decoration: every sync bug in this file's history was diagnosed by
    // working out which of localChanged/remoteChanged/known was wrong, and
    // until now that reasoning existed only inside this function and had to be
    // reconstructed from the outside each time. It is plain data, so the logger
    // stays dumb and this stays testable.
    decisions: [],
  };
  const decide = (id, title, decision, why = {}) => {
    plan.decisions.push({ id, title, decision, ...why });
  };

  for (const [id, task] of localById) {
    const r = remoteById.get(id);
    const known = entries[id];

    // Unreadable, not absent. Touch nothing until a human has looked.
    if (blocked.has(id)) {
      plan.blocked.push(id);
      decide(id, task.title, 'blocked', { reason: 'its event exists but could not be read' });
      continue;
    }

    if (!r) {
      // ⚠️ THE AMBIGUOUS CASE. Seen before means it was deleted on the other
      // device; never seen means it is new here.
      if (known) {
        plan.deleteLocal.push(id);
        decide(id, task.title, 'delete-local', { reason: 'synced before, now missing from the calendar' });
      } else {
        plan.create.push(task);
        decide(id, task.title, 'create', { reason: 'never synced' });
      }
      continue;
    }

    const localChanged = !known || taskHash(task) !== known.hash;
    const remoteChanged = (r.updated || 0) > lastSyncAt;

    if (!localChanged && !remoteChanged) {
      plan.unchanged.push(id);
      decide(id, task.title, 'unchanged', { localChanged, remoteChanged });
      continue;
    }
    // ⚠️ eventIdS. One task can be several Google events — a repeating task with
    // different times on different days is one event per time — so an update
    // has to know about all of them, not just the first one seen.
    if (localChanged && !remoteChanged) {
      plan.update.push({ task, eventIds: eventIdsOf(r) });
      decide(id, task.title, 'update', { localChanged, remoteChanged, eventIds: eventIdsOf(r) });
      continue;
    }
    if (!localChanged && remoteChanged) {
      plan.adopt.push(r.task);
      decide(id, task.title, 'adopt', { localChanged, remoteChanged, remoteAt: r.updated, lastSyncAt });
      continue;
    }

    // Both moved. GS-7: the newer edit wins, and it is SAID rather than done
    // quietly — the loser is only recoverable if the user is told which task
    // and when.
    const localAt = (known && known.dirtyAt) || 0;
    const remoteAt = r.updated || 0;
    const winner = localAt >= remoteAt ? 'local' : 'remote';
    plan.conflicts.push({ id, title: task.title, winner, localAt, remoteAt });
    decide(id, task.title, `conflict -> ${winner}`, { localAt, remoteAt });
    if (winner === 'local') plan.update.push({ task, eventIds: eventIdsOf(r) });
    else plan.adopt.push(r.task);
  }

  for (const [id, r] of remoteById) {
    if (localById.has(id)) continue;
    // Mirror of the ambiguity above, the other way round.
    if (entries[id]) {
      plan.deleteRemote.push({ id, eventIds: eventIdsOf(r) });
      decide(id, r.task.title, 'delete-remote', { reason: 'deleted here since the last sync' });
    } else {
      plan.adopt.push(r.task);
      decide(id, r.task.title, 'adopt', { reason: 'in the calendar but never seen here' });
    }
  }

  return plan;
}

/**
 * The state to store once a plan has actually been carried out.
 *
 * ⚠️ Takes what SUCCEEDED, not what was planned. A half-finished sync that
 * recorded the whole plan would believe it had pushed things it had not, and
 * the next run would see them as "unchanged" and never send them — silent,
 * permanent divergence. The executor passes only what the API confirmed.
 */
export function advanceState(state, applied, now) {
  const entries = { ...state.entries };
  for (const { task, eventId } of applied.synced || []) {
    // ⚠️ `eventId` here is DIAGNOSTIC ONLY — nothing reads it back, and it must
    // not be treated as authoritative. `planSync` always takes the id from the
    // freshly-pulled remote event (`r.googleEventId`), because that is the one
    // Google actually has; a stored copy could be stale after the event was
    // recreated or moved between calendars. Kept because it makes a broken
    // store readable by hand, and recorded here so nobody "fixes" a bug by
    // trusting it. Found by mutation: corrupting it changes no behaviour.
    entries[task.id] = { hash: taskHash(task), eventId: eventId || null, dirtyAt: 0 };
  }
  for (const id of applied.forgotten || []) delete entries[id];
  return { lastSyncAt: now, entries };
}

/**
 * Is this plan about to delete so much of your schedule that it is more likely
 * a bug than an intention?
 *
 * ⚠️ WRITTEN AFTER A RESTORE WAS SILENTLY UNDONE. Importing a footlocker while
 * signed in brought back task ids the sync remembered pushing; Google no longer
 * had those events, so every one read as "deleted on another device" and the
 * sync deleted the lot. The user watched their schedule empty itself.
 *
 * Deleting one or two tasks is ordinary — you removed them on your phone.
 * Deleting MOST OF THE SCHEDULE at once is not something a person does one task
 * at a time on another device, and it is exactly what several different bugs
 * all look like from here. So it stops and says so instead.
 *
 * Deliberately a floor AND a proportion: three of four tasks is alarming, three
 * of two hundred is a Tuesday.
 */
export const BULK_DELETE_FLOOR = 3;
export const BULK_DELETE_SHARE = 0.5;

export function isBulkDelete(plan, localCount) {
  const n = plan.deleteLocal.length;
  if (n < BULK_DELETE_FLOOR) return false;
  if (!localCount) return true;
  return n / localCount >= BULK_DELETE_SHARE;
}

/** A one-line summary for the toast. Says what happened, never just "synced". */
export function describePlan(plan) {
  const bits = [];
  if (plan.create.length) bits.push(`${plan.create.length} added`);
  if (plan.update.length) bits.push(`${plan.update.length} updated`);
  if (plan.adopt.length) bits.push(`${plan.adopt.length} pulled in`);
  if (plan.deleteRemote.length) bits.push(`${plan.deleteRemote.length} removed there`);
  if (plan.deleteLocal.length) bits.push(`${plan.deleteLocal.length} removed here`);
  return bits.length ? bits.join(' · ') : 'nothing to do';
}
