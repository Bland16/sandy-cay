// useEngine.js — binds the pure-JS engine to React. The Schedule instance is the
// single source of truth, held in a ref; UI reads via getTasksForWeek/etc. Every
// mutation goes through `mutate(fn)`, which runs `fn(sched)`, bumps a version to
// re-render, and debounce-saves through StorageAdapter (SPEC §9).

import { useRef, useState, useCallback, useEffect } from 'react';
import { Schedule, StorageAdapter, defaultConfig } from '../core/index.js';

export const STORAGE_KEY = 'sandy-cay:schedule:v1';

/** A real, empty week. The app is for your schedule, not a showroom — seed()
 *  still exists as a test fixture, but nothing demo-shaped ships to a user. */
const emptySchedule = () => new Schedule({ config: defaultConfig });
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
        // The imported week's planned baselines and rollover mark come too —
        // an import that dropped them would silently cost the Wrap report its
        // planned-vs-actual and re-fire a rollover the export had already seen.
        s._snapshots = next._snapshots;
        s._lastSeenWeek = next._lastSeenWeek;
      });
    }, [mutate]),
  };
}
