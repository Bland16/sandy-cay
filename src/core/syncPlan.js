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
export function planSync(local, remote, state = emptyState()) {
  const entries = state.entries || {};
  const lastSyncAt = state.lastSyncAt || 0;

  const localById = new Map(local.map((t) => [t.id, t]));
  const remoteById = new Map();
  for (const r of remote) {
    if (r && r.task && r.task.id != null) remoteById.set(r.task.id, r);
  }

  const plan = {
    create: [], update: [], deleteRemote: [], adopt: [], deleteLocal: [], conflicts: [], unchanged: [],
  };

  for (const [id, task] of localById) {
    const r = remoteById.get(id);
    const known = entries[id];

    if (!r) {
      // ⚠️ THE AMBIGUOUS CASE. Seen before means it was deleted on the other
      // device; never seen means it is new here.
      if (known) plan.deleteLocal.push(id);
      else plan.create.push(task);
      continue;
    }

    const localChanged = !known || taskHash(task) !== known.hash;
    const remoteChanged = (r.updated || 0) > lastSyncAt;

    if (!localChanged && !remoteChanged) { plan.unchanged.push(id); continue; }
    if (localChanged && !remoteChanged) { plan.update.push({ task, eventId: r.googleEventId }); continue; }
    if (!localChanged && remoteChanged) { plan.adopt.push(r.task); continue; }

    // Both moved. GS-7: the newer edit wins, and it is SAID rather than done
    // quietly — the loser is only recoverable if the user is told which task
    // and when.
    const localAt = (known && known.dirtyAt) || 0;
    const remoteAt = r.updated || 0;
    const winner = localAt >= remoteAt ? 'local' : 'remote';
    plan.conflicts.push({ id, title: task.title, winner, localAt, remoteAt });
    if (winner === 'local') plan.update.push({ task, eventId: r.googleEventId });
    else plan.adopt.push(r.task);
  }

  for (const [id, r] of remoteById) {
    if (localById.has(id)) continue;
    // Mirror of the ambiguity above, the other way round.
    if (entries[id]) plan.deleteRemote.push({ id, eventId: r.googleEventId });
    else plan.adopt.push(r.task);
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
