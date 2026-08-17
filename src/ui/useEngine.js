// useEngine.js — binds the pure-JS engine to React. The Schedule instance is the
// single source of truth, held in a ref; UI reads via getTasksForWeek/etc. Every
// mutation goes through `mutate(fn)`, which runs `fn(sched)`, bumps a version to
// re-render, and debounce-saves through StorageAdapter (SPEC §9).

import { useRef, useState, useCallback, useEffect } from 'react';
import { Schedule, StorageAdapter, defaultConfig, seedStarterBuckets } from '../core/index.js';

export const STORAGE_KEY = 'sandy-cay:schedule:v1';

/**
 * A real, empty week — no tasks. The app is for your schedule, not a showroom:
 * `seed()` is a test fixture and nothing demo-shaped ships to a user.
 *
 * It DOES start with a tag vocabulary (`starterBuckets`), because without any
 * buckets the whole energy model is inert — every task's load computes to zero,
 * so the battery, the deepest-dip signal, reserve-aware suggestions and the card
 * tints silently do nothing. That is not an empty app, it is a switched-off one,
 * and it is the state a real user was found in after weeks of use. Buckets are
 * vocabulary, not content: no tasks, no times, nothing to clear out, and every
 * value editable in the Cabana.
 */
const emptySchedule = () => {
  const s = new Schedule({ config: defaultConfig });
  // Idempotent by construction — a no-op the moment any bucket exists, so it can
  // never clobber an edited set. The Cabana keeps its manual button; this just
  // stops a brand-new schedule starting with the energy model switched off.
  seedStarterBuckets(s);
  return s;
};
const SAVE_DEBOUNCE_MS = 1500;

export function useEngine() {
  const storageRef = useRef(null);
  const schedRef = useRef(null);
  const timerRef = useRef(null);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState('idle'); // idle | dirty | saved

  // One-time init: hydrate from storage, else seed a rich deterministic week.
  if (!schedRef.current) {
    const storage = new StorageAdapter();
    storageRef.current = storage;
    let sched = null;
    try {
      const saved = storage.load(STORAGE_KEY);
      if (saved && saved.schemaVersion === 1) sched = Schedule.fromJSON(saved);
    } catch {
      sched = null;
    }
    schedRef.current = sched || emptySchedule();
  }

  /** Wipe everything and start over — the only way out of demo data that's
   *  already persisted, and an honest "I want my own week" button. */
  const reset = useCallback(() => {
    storageRef.current.remove(STORAGE_KEY);
    schedRef.current = emptySchedule();
    setVersion((v) => v + 1);
    setSaveState('idle');
  }, []);

  const flush = useCallback(() => {
    // save() reports rather than throws; a failure demotes the adapter to memory,
    // so re-reading its status on this render turns the dot amber instead of
    // leaving it green over a schedule that isn't being written anywhere.
    const ok = storageRef.current.save(STORAGE_KEY, schedRef.current.toJSON());
    setSaveState(ok ? 'saved' : 'unsaved');
  }, []);

  const mutate = useCallback((fn) => {
    const result = fn(schedRef.current);
    setVersion((v) => v + 1);
    setSaveState('dirty');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    return result;
  }, [flush]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return {
    sched: schedRef.current,
    version,
    mutate,
    reset,
    flush,
    storage: storageRef.current,
    persistence: storageRef.current.status, // 'persistent' | 'session'
    saveState,
    replace: useCallback((json) => {
      mutate((s) => {
        const next = Schedule.fromJSON(json);
        s.tasks = next.tasks;
        s.zones = next.zones;
        s.config = next.config;
        s.learning = next.learning;
        // The activity library rides along with an import (design/ACTIVITY-LIBRARY.md):
        // dropping it here is the exact silent-loss trap sharp edge #15 warns about.
        s.buckets = next.buckets;
        s.activities = next.activities;
        s.retiredTags = next.retiredTags;
        // The imported week's planned baselines and rollover mark come too —
        // an import that dropped them would silently cost the Wrap report its
        // planned-vs-actual and re-fire a rollover the export had already seen.
        s._snapshots = next._snapshots;
        s._lastSeenWeek = next._lastSeenWeek;
        // _dismissed is additive persisted state too (sharp edge #15) and was
        // being dropped here — a restored footlocker re-raised detector cards the
        // user had already answered. Copy it with the rest.
        s._dismissed = next._dismissed;
        // ⚠️ THIRD time this trap has been sprung (snapshots, then _dismissed,
        // now these). Day notes and blocked days are written by toJSON and read
        // by fromJSON, so they survive a SAVE perfectly — and were dropped here,
        // which meant importing a footlocker silently erased every holiday and
        // every day you had taken off, with no error and no empty state to
        // notice. Anything added to the Schedule constructor must be added HERE
        // in the same commit; a field that only round-trips through storage is
        // half-wired, and this function is the half that gets forgotten.
        s.dayNotes = next.dayNotes;
        s.blockedDays = next.blockedDays;
        // Standing commitments, added in the SAME commit as the constructor and
        // toJSON halves — which is the whole rule sharp edge #15 exists to
        // state. Dropping them here would restore a footlocker with the
        // generated sittings still on the grid and nothing left that owes them,
        // so the week would look planned and be unre-plannable.
        s.commitments = next.commitments;
      });
    }, [mutate]),
  };
}
