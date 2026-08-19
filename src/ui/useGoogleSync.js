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
import { planSync, markDirty, advanceState, emptyState, describePlan } from '../core/syncPlan.js';
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
export function useGoogleSync({ enabled, sched, mutate, version, showToast, now = () => Date.now() }) {
  const [calendarId, setCalendarId] = useState(loadCalendarId);
  const [status, setStatus] = useState('idle'); // idle | syncing | error | off
  const [lastError, setLastError] = useState(null);
  const stateRef = useRef(loadSyncState());
  const tokenRef = useRef(null);
  const runningRef = useRef(false);
  const timerRef = useRef(null);
  // The first render must not be read as "something changed".
  const seenVersion = useRef(version);

  const token = useCallback(async ({ force = false } = {}) => {
    if (tokenRef.current && !force) return tokenRef.current;
    tokenRef.current = await getAccessToken(readClientId());
    return tokenRef.current;
  }, []);

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
      const plan = planSync(sched.toJSON().tasks, remote.tasks, stateRef.current);

      const applied = await applyPlan(api, calendarId, plan, {
        commitmentIds: new Set((sched.commitments || []).map((c) => c.id)),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      if (plan.adopt.length || plan.deleteLocal.length) {
        mutate((s) => applyLocal(s, plan));
      }

      await pushLibrary(api, calendarId, sched.toJSON());

      stateRef.current = advanceState(stateRef.current, applied, t);
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
        showToast(`${remote.dropped.length} event(s) in the calendar could not be read`);
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

  // Pull once when the app opens signed in (GS-3: Google is truth).
  const opened = useRef(false);
  useEffect(() => {
    if (!enabled || !calendarId || opened.current) return;
    opened.current = true;
    runSync();
  }, [enabled, calendarId, runSync]);

  // GS-6: debounce. Every engine change restarts the clock, so a burst of
  // dragging writes once, when it stops.
  useEffect(() => {
    if (!enabled || !calendarId) return undefined;
    if (version === seenVersion.current) return undefined;
    seenVersion.current = version;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { runSync(); }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [version, enabled, calendarId, runSync]);

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
