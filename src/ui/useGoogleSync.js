// useGoogleSync — the app's end of the sync (design/GOOGLE-AS-STORAGE.md P3).
//
// The decisions live in `core/syncPlan.js` and the Google talk in
// `googleSync.js`. This is the glue: when to run, what to tell the user, and
// how to apply the LOCAL half of a plan to the live schedule.
//
// ════════════════════════════════════════════════════════════════════════════
// THE RULES IT ENFORCES, AND WHY EACH ONE IS HERE
// ════════════════════════════════════════════════════════════════════════════
//
// GS-6  debounced ~5s after the last change. Writing per keystroke would burn
//       Google's quota on a single afternoon of dragging cards about.
// GS-7  newest edit wins, and the toast NAMES what was replaced — a silent
//       overwrite is the surprise P-1 exists to prevent.
// GS-5  nothing is written until a calendar has been chosen AND verified to
//       hold nothing this app did not write.
// GS-9  an expired token is retried silently ONCE, then said out loud. The
//       token lasts about an hour, so a long afternoon will hit this.
//
// ⚠️ AND THE ONE THAT IS NOT NEGOTIABLE: a guest never reaches this file. The
// entry screen promises "nothing leaves this device", and that promise is only
// as good as the caller — App gates on session === 'google'.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  planSync, markDirty, advanceState, emptyState, describePlan, taskHash, isBulkDelete,
  outsideEdits,
} from '../core/syncPlan.js';
import { libraryFrom, diffLibrary, applyLibrary } from '../core/googleLibrary.js';
import { Schedule, defaultConfig, seedStarterBuckets, dateFromKey } from '../core/index.js';
import {
  makeApi, pull, applyPlan, pushLibrary, inspectCalendar, encodeNoteParts, encodeBlockedParts,
} from './googleSync.js';
import { getAccessToken, readClientId } from './google.js';
import {
  logPull, logPlan, logApplied, logStopped, logOutside,
} from './syncLog.js';

/**
 * The library a brand-new install produces — starter buckets, default config,
 * nothing else. A device whose library still hashes to this has contributed
 * NOTHING, so adopting the store's library over the top of it cannot lose
 * anything, and that is the whole test for "fresh" (GS-8).
 *
 * Computed once, lazily. It reads no clock: verified stable across calls, which
 * matters because a moving value here would make every device look modified and
 * freeze the sync permanently.
 */
let pristineHash = null;
export function freshLibraryHash() {
  if (pristineHash === null) {
    const s = new Schedule({ config: defaultConfig });
    seedStarterBuckets(s);
    pristineHash = taskHash(libraryFrom(s.toJSON()));
  }
  return pristineHash;
}

export const SYNC_STATE_KEY = 'sandycay.sync.state';
export const SYNC_CALENDAR_KEY = 'sandycay.sync.calendar';
export const DEBOUNCE_MS = 5000;

const read = (key, fallback) => {
  try {
    const raw = globalThis.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const write = (key, value) => {
  try { globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch { /* session only */ }
};

export const loadSyncState = () => {
  const s = read(SYNC_STATE_KEY, null);
  return s && typeof s === 'object' && s.entries ? s : emptyState();
};
export const saveSyncState = (s) => write(SYNC_STATE_KEY, s);
export const loadCalendarId = () => read(SYNC_CALENDAR_KEY, null);
export const saveCalendarId = (id) => write(SYNC_CALENDAR_KEY, id);

/**
 * Apply the local half of a plan to the live schedule.
 *
 * `adopt` uses `upsertTaskFromJSON`, NOT `updateTask` — the whitelist would
 * strip load, routineId, parentId, chunking and history on the way in. See the
 * note on that method.
 */
export function applyLocal(sched, plan) {
  let adopted = 0;
  let removed = 0;
  for (const task of plan.adopt) { sched.upsertTaskFromJSON(task); adopted += 1; }
  for (const id of plan.deleteLocal) { if (sched.removeTask(id)) removed += 1; }
  return { adopted, removed };
}

/** GS-11. The same, for day notes — through the STORE's door, not the form's. */
export function applyLocalNotes(sched, plan) {
  let adopted = 0;
  let removed = 0;
  for (const note of plan.adopt) { sched.upsertDayNoteFromJSON(note); adopted += 1; }
  for (const id of plan.deleteLocal) { if (sched.removeDayNote(id)) removed += 1; }
  return { adopted, removed };
}

/**
 * GS-11. And for blocked days, which are bare date strings rather than objects.
 *
 * `blockDay` / `unblockDay` are the only doors — `blockedDays` is kept sorted
 * and deduped by them, and writing the array directly would quietly break the
 * `includes` lookups that `isDayBlocked` and placement depend on.
 */
export function applyLocalBlocked(sched, plan) {
  let adopted = 0;
  let removed = 0;
  // ⚠️ `blockDay`/`unblockDay` take a DATE; the store speaks in 'YYYY-MM-DD'.
  // `dateFromKey` is the conversion, and it is the one sharp edge #4 exists for
  // — `new Date('2026-12-24')` is UTC midnight and lands on the 23rd for anyone
  // west of Greenwich, which would block the wrong day.
  for (const b of plan.adopt) { if (sched.blockDay(dateFromKey(b.day))) adopted += 1; }
  for (const id of plan.deleteLocal) {
    const day = String(id).replace(/^blocked-/, '');
    if (sched.unblockDay(dateFromKey(day))) removed += 1;
  }
  return { adopted, removed };
}

/**
 * id → human name, for the note on each event.
 *
 * Routines, commitments and project parents are the three things a task can
 * belong to, and they are addressed by `routineId` or `parentId` — which is
 * overloaded, so all three go in one map and the id decides.
 */
export function groupNamesFor(sched) {
  const names = new Map();
  for (const r of sched.routineInstances || []) names.set(r.id, r.label);
  for (const c of sched.commitments || []) names.set(c.id, c.title);
  for (const t of sched.tasks || []) if (t.chunking) names.set(t.id, t.title);
  return names;
}

/** A blocked day as the planner sees it: something with an id and a hash. */
export const blockedRecord = (day) => ({ id: `blocked-${day}`, day });

/**
 * @param enabled   only true for a signed-in session — a guest must never sync
 * @param sched     the live Schedule
 * @param mutate    App's mutate(fn) — applies a change and re-reads
 * @param version   bumps on every engine change; this is the "something moved"
 *                  signal that starts the debounce
 * @param showToast say what happened
 */
/**
 * ⚠️ HOISTED, not a default parameter. `now = () => Date.now()` in the argument
 * list builds a NEW function on every render, which changes `runSync`'s
 * identity, which re-runs the debounce effect, whose cleanup then cancels the
 * pending timer — so the sync never fired. Nothing errored; it simply never
 * saved. Found by a test that re-renders; every other sync test called the
 * planner directly and passed regardless.
 */
const wallClock = () => Date.now();

export function useGoogleSync({ enabled, sched, mutate, version, showToast, now = wallClock }) {
  const [calendarId, setCalendarId] = useState(loadCalendarId);
  const [status, setStatus] = useState('idle'); // idle | syncing | error | off
  const [lastError, setLastError] = useState(null);
  // GS-8. null = the two libraries agree, or the calendar has none yet.
  const [libraryState, setLibraryState] = useState(null);
  const stateRef = useRef(loadSyncState());
  const runningRef = useRef(false);
  const timerRef = useRef(null);
  // The first render must not be read as "something changed".
  const seenVersion = useRef(version);
  // ═══════════════════════════════════════════════════════════════════════
  // ASKED ONCE PER SESSION. This is the loop fix.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // The library question — adopt, agree, or freeze — was re-decided on EVERY
  // pass. Adopting calls `mutate`, which bumps `version`, which schedules
  // another sync, which asks again. Whenever the answer does not come back
  // identical the second time — an `applyLibrary` round trip that is not
  // byte-for-byte what the blob held, a config gaining a default on the way
  // through — the app either adopts forever at five-second intervals or lands
  // in a freeze it can never leave, having just done the adopting itself.
  //
  // It is a question about THIS SESSION, so it is answered once, at the start,
  // and thereafter this device's schedule is the source of truth. A ref, not
  // state: flipping it must not itself cause a render, and it must not persist
  // — a new session genuinely should ask again.
  //
  // ⚠️ A FREEZE DOES NOT SETTLE IT. That is the whole GS-8 protection: an
  // unresolved conflict has to keep refusing until a human answers it, or the
  // "asked once" rule would quietly wave through the stale device the gate
  // exists to stop. Only agreement, adoption, or one of the two Cabana buttons
  // counts as an answer.
  const librarySettled = useRef(false);
  // ═══════════════════════════════════════════════════════════════════════
  // WHAT THE CALENDAR LOOKED LIKE WHEN THIS SESSION STARTED.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // `{ eventId: updatedMs }`, seeded from the FIRST pull and kept current for
  // every event we write ourselves. It answers the question `lastSyncAt` never
  // could: has this event moved because a human moved it, or because WE did?
  //
  // Google stamps `updated` on our own writes, so a single global timestamp
  // reads our echo as a remote edit — which is exactly how a sync came to take
  // five passes to settle. Per event, with our own writes folded back in, an
  // `updated` newer than what we last knew is a hand edit and nothing else.
  //
  // Per session, like `librarySettled`: it is a record of what we have SEEN, and
  // a new session has seen nothing.
  const baseline = useRef(null);

  // ⚠️ ONE cache, in google.js, shared with sign-in and the calendar picker.
  // A second copy here would go stale independently and would defeat the whole
  // point — the picker needs the token obtained by the sign-in CLICK, because
  // its own request happens in an effect where a popup is blocked. `force` is
  // the 401 path: the held token was rejected, so ask again for real.
  const token = useCallback(
    ({ force = false } = {}) => getAccessToken(readClientId(), { force }),
    [],
  );

  /**
   * One full pass: pull, plan, apply both halves, record ONLY what Google
   * confirmed. `advanceState` is given the executor's results and never the
   * plan — see the note in syncPlan.js.
   */
  const runSync = useCallback(async () => {
    if (!enabled || !calendarId || runningRef.current) return null;
    runningRef.current = true;
    setStatus('syncing');
    setLastError(null);
    try {
      let api = makeApi(await token());
      let remote;
      try {
        remote = await pull(api, calendarId);
      } catch (err) {
        // GS-9: the token lasts about an hour, so a long afternoon WILL hit
        // this. Retry once, silently, before bothering anyone.
        if (!/expired|401/i.test(err?.message || '')) throw err;
        api = makeApi(await token({ force: true }));
        remote = await pull(api, calendarId);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // GS-8 — THE LIBRARY GATE. Nothing above this writes; everything below it
      // does, so the decision belongs exactly here.
      // ═══════════════════════════════════════════════════════════════════════
      //
      // FRESH  → adopt the calendar's library and carry on. A device that has
      //          contributed nothing cannot lose anything by taking the store's
      //          copy, and this is the phone-signs-in case.
      // AGREE  → carry on.
      // DIFFER → FREEZE THE WHOLE SYNC. Read-only until a human resolves it.
      //
      // ⚠️ WHY THE FREEZE COVERS TASKS TOO, and not just the library. The
      // obvious reading is that only `pushLibrary` can destroy the library, so
      // only it needs locking. That is wrong, and the reason is `dirtyAt`.
      //
      // A device that has been asleep for a week wakes with stale tasks AND a
      // stale sync record. For every task edited elsewhere since, `planSync`
      // sees localChanged (its hash differs from its own old entry) AND
      // remoteChanged (`updated` is past its old `lastSyncAt`) — a conflict,
      // settled by `dirtyAt` against Google's `updated`. But `dirtyAt` is
      // stamped when this device NOTICES the difference, which is now, not when
      // the edit happened. So the stale copy wins every conflict, and it wins
      // precisely BECAUSE it woke up last. Newest-noticed is not newest-edited
      // and nothing in the model can tell them apart.
      //
      // Two libraries disagreeing is the sharpest available signal that this
      // device is out of step, so it stops everything until that is settled.
      const localLibrary = libraryFrom(sched.toJSON());
      if (remote.library && !librarySettled.current) {
        const diff = diffLibrary(localLibrary, remote.library);
        if (diff.same) {
          librarySettled.current = true;
          setLibraryState(null);
        } else if (taskHash(localLibrary) === freshLibraryHash()) {
          librarySettled.current = true;
          mutate((s) => applyLibrary(s, remote.library));
          // Re-read rather than hashing what arrived: `applyLibrary` revives
          // through `Schedule.fromJSON`, so the schedule is the authority on
          // what it now holds. Hashing the incoming blob instead would leave
          // this device one round-trip out of step with itself.
          stateRef.current = { ...stateRef.current, libHash: taskHash(libraryFrom(sched.toJSON())) };
          setLibraryState(null);
          showToast('Brought your buckets, zones and settings down from the calendar');
        } else {
          const names = diff.differing.map((r) => r.key).join(', ');
          const msg = `Sync paused: this device and the calendar disagree about your setup (${names}). `
            + 'Nothing has been changed on either side. Open the Cabana and choose which one is right.';
          setLibraryState({ conflict: true, rows: diff.differing });
          setStatus('error');
          setLastError(msg);
          logStopped(msg);
          showToast('Sync paused — this device and the calendar disagree about your setup');
          return null;
        }
      }

      // Seed on the first pull of the session, before anything is decided or
      // written — this is the "before" picture and it has to be taken first.
      if (baseline.current === null) {
        baseline.current = {};
        for (const r of remote.tasks || []) {
          for (const eventId of r.googleEventIds || []) baseline.current[eventId] = r.updated || 0;
        }
      }
      const changedOutside = outsideEdits(baseline.current, remote.tasks);

      const t = now();
      const localTasks = sched.toJSON().tasks;
      logPull(remote, localTasks.length);
      if (changedOutside.size) logOutside(changedOutside, remote.tasks);
      stateRef.current = markDirty(stateRef.current, localTasks, t);
      // `unreadable` is not optional bookkeeping: without it a corrupt event
      // reads as an absent one and this deletes the local task. See planSync.
      const plan = planSync(localTasks, remote.tasks, stateRef.current, {
        unreadable: remote.unreadable,
        changedOutside,
      });

      logPlan(plan);

      // ⚠️ STOP BEFORE EMPTYING THE SCHEDULE. A sync that would delete most of
      // your tasks at once is far likelier to be a bug than an intention — it
      // is what a stale sync record, a re-made calendar and a half-finished
      // restore all look like from here, and one of those really did wipe a
      // restored schedule. Nothing is written or deleted on this pass; the
      // record is left untouched so the next pass can still do the right thing
      // once the cause is dealt with.
      // ⚠️ PLANNED BEFORE ANYTHING IS WRITTEN, all three of them. GS-11 routed
      // day notes and blocked days through this same planner but planned them
      // AFTER the tasks had already been written — so a guard that trips on
      // notes could not honour "nothing is written or deleted on this pass",
      // because by then something had been. Deciding everything first is what
      // makes the guard mean what it says.
      // ⚠️ MARKED DIRTY LIKE A TASK. GS-7 is "newest edit wins", and the only
      // clock either side has is the sync's own `dirtyAt`. `markDirty` was run
      // over tasks and nothing else, so a day note's entry never carried one —
      // and a conflict resolves on `(known && known.dirtyAt) || 0`, which meant
      // 0, which meant REMOTE WON EVERY TIME. Rename a holiday here and
      // anywhere else and yours lost silently, however recent it was.
      const localNotes = sched.dayNotes.map((n) => n.toJSON());
      const noteState = markDirty(
        { lastSyncAt: stateRef.current.lastSyncAt || 0, entries: stateRef.current.noteEntries || {} },
        localNotes,
        t,
      );
      // Blocked days need no such stamp: the record is `{ id: 'blocked-<day>',
      // day }`, so its hash is a pure function of its id and it cannot go dirty
      // in place. A day is blocked or it is not — there is no edit to lose.
      const blockedState = { lastSyncAt: stateRef.current.lastSyncAt || 0, entries: stateRef.current.blockedEntries || {} };
      // ⚠️ `unreadable` GOES TO ALL THREE. It was passed only to the tasks, so a
      // corrupt day-note event was dropped from `remote.notes`, which made the
      // note look ABSENT, which reads as "deleted on the other device" — and
      // the note was deleted locally. The check that catches the corruption
      // completing the data loss, which is the precise failure this argument
      // exists to prevent for tasks.
      const notePlan = planSync(localNotes, remote.notes || [], noteState, {
        unreadable: remote.unreadable,
      });
      const blockedPlan = planSync(sched.blockedDays.map(blockedRecord), remote.blockedDays || [], blockedState, {
        unreadable: remote.unreadable,
      });

      logPlan(notePlan);
      logPlan(blockedPlan);

      // ⚠️ STOP BEFORE EMPTYING THE SCHEDULE — AND THAT MEANS ALL OF IT. A sync
      // about to delete most of anything at once is far likelier to be a bug
      // than an intention: it is what a stale sync record, a re-made calendar
      // and a half-finished restore all look like from here, and one of those
      // really did wipe a restored schedule.
      //
      // The guard covered TASKS ONLY until 2026-08-25. Day notes and blocked
      // days went through the same planner with none of it, so an emptied
      // calendar took every holiday and every blocked day with it, silently.
      // Proven by `design/probes/probe-bulk-delete-gap.mjs`.
      const bulk = [
        ['tasks', plan, localTasks.length],
        ['day notes', notePlan, sched.dayNotes.length],
        ['blocked days', blockedPlan, sched.blockedDays.length],
      ].find(([, p, n]) => isBulkDelete(p, n));

      if (bulk) {
        const [what, p, n] = bulk;
        setStatus('error');
        const msg = `Sync stopped: it was about to remove ${p.deleteLocal.length} of your `
          + `${n} ${what} because they are missing from the calendar. `
          + 'Nothing was changed. If you just restored a backup, use "Use a different calendar" '
          + 'in the Cabana to start the calendar fresh.';
        setLastError(msg);
        logStopped(msg);
        showToast(`Sync stopped — it would have deleted most of your ${what}`);
        return plan;
      }

      const applied = await applyPlan(api, calendarId, plan, {
        commitmentIds: new Set((sched.commitments || []).map((c) => c.id)),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // What each task BELONGS to, by name, for the event's note. Without
        // this the note falls back to a raw id — still searchable, but a
        // person reading their calendar should see “Laundry”, not `laundry-1-run`.
        groupNames: groupNamesFor(sched),
      });

      logApplied(applied);
      // Fold our own writes back into the baseline, or the very next pass reads
      // them as somebody else's edits — the loop this whole mechanism exists to
      // end.
      Object.assign(baseline.current, applied.wrote || {});

      // ═══════════════════════════════════════════════════════════════════════
      // GS-11 — day notes and blocked days, which are all-day EVENTS now.
      // ═══════════════════════════════════════════════════════════════════════
      //
      // Through the SAME planner as tasks, on their own slice of the sync
      // record. Every guard in `planSync` matters just as much here — a note
      // present locally and absent remotely is the same ambiguity (never pushed,
      // or deleted on your phone?) and answering it wrong either resurrects
      // holidays you deleted or deletes ones you just added.
      //
      // ⚠️ SEPARATE ENTRY MAPS. Notes, blocked days and tasks share an id space
      // only by luck, and one map would let a task and a note with the same id
      // overwrite each other's hash — silently, and only for whoever happened to
      // collide.
      const noteApplied = await applyPlan(api, calendarId, notePlan, { encode: encodeNoteParts });
      const blockedApplied = await applyPlan(api, calendarId, blockedPlan, { encode: encodeBlockedParts });

      logApplied(noteApplied);
      logApplied(blockedApplied);

      if (notePlan.adopt.length || notePlan.deleteLocal.length) mutate((s) => applyLocalNotes(s, notePlan));
      if (blockedPlan.adopt.length || blockedPlan.deleteLocal.length) mutate((s) => applyLocalBlocked(s, blockedPlan));

      if (plan.adopt.length || plan.deleteLocal.length) {
        mutate((s) => applyLocal(s, plan));
      }

      // ⚠️ Only when it actually CHANGED. `pushLibrary` deletes and recreates
      // its events, so doing it every pass meant a delete plus an insert every
      // five seconds of editing — pure quota burn for a blob that changes when
      // you add a bucket, not when you drag a card. It also churned the library
      // event's id constantly, which makes a store harder to inspect by hand.
      const json = sched.toJSON();
      const libNow = taskHash(libraryFrom(json));
      if (libNow !== stateRef.current.libHash) {
        await pushLibrary(api, calendarId, json);
        stateRef.current = { ...stateRef.current, libHash: libNow };
      }

      // ⚠️ AFTER the writes, not before. `t` above is when we started, and
      // Google stamps `updated` on everything we just wrote — so recording `t`
      // as the sync point meant the NEXT pass saw OUR OWN WRITES as a remote
      // edit and adopted them, which called mutate, which bumped the version,
      // which scheduled another sync. Every sync bought a second one, and the
      // app sat on "syncing" for two or three debounce cycles instead of one.
      stateRef.current = advanceState(stateRef.current, applied, now());
      // The two all-day collections keep their own entry maps, advanced by the
      // same rule: what Google CONFIRMED, never what was planned.
      stateRef.current.noteEntries = advanceState(noteState, noteApplied, now()).entries;
      stateRef.current.blockedEntries = advanceState(blockedState, blockedApplied, now()).entries;
      stateRef.current.libHash = libNow;
      saveSyncState(stateRef.current);
      setStatus('idle');

      // ⚠️ A conflict is SAID. The losing version is only recoverable if the
      // user is told which task and which side won.
      for (const c of plan.conflicts) {
        showToast(`"${c.title}" changed in both places — kept the ${c.winner === 'local' ? 'version here' : 'version from Google'}`);
      }
      if (applied.failed.length) {
        showToast(`${applied.failed.length} didn't save — will retry`);
      }
      if (remote.dropped.length) {
        // Said plainly, including that nothing was touched — a user who sees
        // "could not be read" and no further word would reasonably assume the
        // worst had already happened.
        showToast(`${remote.dropped.length} event(s) could not be read — those tasks were left untouched`);
      }
      const summary = describePlan(plan);
      if (summary !== 'nothing to do') showToast(`Synced · ${summary}`);
      return plan;
    } catch (err) {
      setStatus('error');
      setLastError(err?.message || String(err));
      showToast(err?.message || 'Sync failed');
      return null;
    } finally {
      runningRef.current = false;
    }
  }, [enabled, calendarId, sched, mutate, showToast, token, now]);

  // ⚠️ The effects below must NOT depend on `runSync`'s identity. It is a
  // useCallback over several values, so it changes whenever any of them does —
  // and an effect that schedules a timer, keyed on a callback, cancels its own
  // pending work on the next unrelated re-render. A ref holding the latest
  // function gives the effects a stable dependency list and always calls the
  // current implementation.
  const runRef = useRef(runSync);
  runRef.current = runSync;

  // Pull once when the app opens signed in (GS-3: Google is truth).
  const opened = useRef(false);
  useEffect(() => {
    if (!enabled || !calendarId || opened.current) return;
    opened.current = true;
    runRef.current();
  }, [enabled, calendarId]);

  // GS-6: debounce. Every engine change restarts the clock, so a burst of
  // dragging writes once, when it stops.
  //
  // ⚠️ NO CLEANUP THAT CLEARS THE TIMER. The pending sync must survive every
  // re-render between the change and the deadline — a toast, a hover, a panel
  // opening. It is cancelled in exactly one place: the top of this effect, when
  // a NEWER change restarts the clock. Unmount is handled separately below.
  useEffect(() => {
    if (!enabled || !calendarId) return;
    if (version === seenVersion.current) return;
    seenVersion.current = version;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { runRef.current(); }, DEBOUNCE_MS);
  }, [version, enabled, calendarId]);

  // Unmount only — a pending write is abandoned when the app goes away, not
  // when it merely redraws.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  /** GS-5. Refuses a calendar holding anything this app did not write. */
  const chooseCalendar = useCallback(async (id) => {
    const api = makeApi(await token());
    const check = await inspectCalendar(api, id);
    if (!check.safe) {
      const names = check.foreignSample.join(', ');
      throw new Error(
        `That calendar already has ${check.foreign} event(s) that Sandy Cay did not write`
        + `${names ? ` (${names})` : ''}. Pick an empty calendar, or make one for this.`,
      );
    }
    saveCalendarId(id);
    setCalendarId(id);
    // A DIFFERENT calendar is a different question, so it must be asked again.
    // Carrying "settled" across would let a device adopt from one calendar and
    // then never look at the next one it was pointed at.
    librarySettled.current = false;
    // A fresh calendar means nothing has been synced to it yet.
    stateRef.current = emptyState();
    saveSyncState(stateRef.current);
    return check;
  }, [token]);

  /**
   * Forget what was last synced, but keep the calendar.
   *
   * ⚠️ A FOOTLOCKER RESTORE MUST CALL THIS, and not calling it destroyed the
   * restore. The sync record says "these task ids were pushed to Google". After
   * a restore brings those ids back while Google no longer has the events —
   * a re-made calendar, events cleared by hand — the planner reads
   * present-here-plus-absent-there-plus-synced-before as "deleted on another
   * device" and deletes every restored task. Which is exactly what a restore
   * was trying to undo.
   *
   * Clearing the record makes the restored tasks NEW, so they are pushed up
   * instead of deleted. A restore is an assertion about what is true now, and
   * the history of what used to be synced is not evidence against it.
   */
  const resetState = useCallback(() => {
    stateRef.current = emptyState();
    saveSyncState(stateRef.current);
  }, []);

  /**
   * GS-8, resolved the local way: THIS device is right. Replace the calendar's
   * library with ours and let the sync go again.
   *
   * Deliberately a button and never automatic. The whole reason the sync is
   * frozen is that no honest rule can tell which side is newer — the library
   * has no modification time, and the sync's own `dirtyAt` records when a
   * difference was NOTICED, which a stale device does last and would therefore
   * win with. A person looking at both lists can tell; the code cannot.
   */
  const pushLibraryNow = useCallback(async () => {
    const api = makeApi(await token());
    const json = sched.toJSON();
    const r = await pushLibrary(api, calendarId, json);
    stateRef.current = { ...stateRef.current, libHash: taskHash(libraryFrom(json)) };
    saveSyncState(stateRef.current);
    // Answered. Stop asking for the rest of this session.
    librarySettled.current = true;
    setLibraryState(null);
    setStatus('idle');
    setLastError(null);
    return r;
  }, [token, sched, calendarId]);

  /** GS-8, resolved the other way: the CALENDAR is right. Take its library. */
  const deriveLibraryFromCalendar = useCallback(async () => {
    const api = makeApi(await token());
    const remote = await pull(api, calendarId);
    if (!remote.library) throw new Error('That calendar has no Sandy Cay setup stored in it yet.');
    const r = mutate((s) => applyLibrary(s, remote.library));
    stateRef.current = { ...stateRef.current, libHash: taskHash(libraryFrom(sched.toJSON())) };
    saveSyncState(stateRef.current);
    librarySettled.current = true;
    setLibraryState(null);
    setStatus('idle');
    setLastError(null);
    return r;
  }, [token, sched, mutate, calendarId]);

  const forget = useCallback(() => {
    saveCalendarId(null);
    setCalendarId(null);
    librarySettled.current = false;
    stateRef.current = emptyState();
    saveSyncState(stateRef.current);
  }, []);

  return {
    calendarId,
    status,
    lastError,
    syncNow: runSync,
    chooseCalendar,
    forget,
    resetState,
    // GS-8: null unless this device and the calendar disagree about the setup.
    libraryState,
    pushLibraryNow,
    deriveLibraryFromCalendar,
  };
}
