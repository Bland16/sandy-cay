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
import { planSync, markDirty, advanceState, emptyState, describePlan, taskHash } from '../core/syncPlan.js';
import { libraryFrom } from '../core/googleLibrary.js';
import { makeApi, pull, applyPlan, pushLibrary, inspectCalendar } from './googleSync.js';
import { getAccessToken, readClientId } from './google.js';

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
  const stateRef = useRef(loadSyncState());
  const runningRef = useRef(false);
  const timerRef = useRef(null);
  // The first render must not be read as "something changed".
  const seenVersion = useRef(version);

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

      const t = now();
      stateRef.current = markDirty(stateRef.current, sched.toJSON().tasks, t);
      // `unreadable` is not optional bookkeeping: without it a corrupt event
      // reads as an absent one and this deletes the local task. See planSync.
      const plan = planSync(sched.toJSON().tasks, remote.tasks, stateRef.current, {
        unreadable: remote.unreadable,
      });

      const applied = await applyPlan(api, calendarId, plan, {
        commitmentIds: new Set((sched.commitments || []).map((c) => c.id)),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

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
    // A fresh calendar means nothing has been synced to it yet.
    stateRef.current = emptyState();
    saveSyncState(stateRef.current);
    return check;
  }, [token]);

  const forget = useCallback(() => {
    saveCalendarId(null);
    setCalendarId(null);
    stateRef.current = emptyState();
    saveSyncState(stateRef.current);
  }, []);

  return {
    calendarId, status, lastError, syncNow: runSync, chooseCalendar, forget,
  };
}
