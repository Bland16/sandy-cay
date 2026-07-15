import { describe, it, expect } from 'vitest';
import { StorageAdapter, exportState, summarizeImport, pickBackend, seed } from '../src/core/index.js';

function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

describe('§9 StorageAdapter fallback chain', () => {
  it('uses window.storage when present', () => {
    const env = { window: { storage: fakeStore() } };
    const a = new StorageAdapter(env);
    expect(a.layer).toBe('window.storage');
    expect(a.status).toBe('persistent');
  });

  it('falls back to localStorage when window.storage absent', () => {
    const env = { localStorage: fakeStore() };
    const a = new StorageAdapter(env);
    expect(a.layer).toBe('localStorage');
    expect(a.status).toBe('persistent');
  });

  it('falls back to in-memory (session) when neither is present', () => {
    const a = new StorageAdapter({});
    expect(a.layer).toBe('memory');
    expect(a.status).toBe('session');
  });

  it('window.storage takes priority over localStorage', () => {
    const picked = pickBackend({ window: { storage: fakeStore() }, localStorage: fakeStore() });
    expect(picked.layer).toBe('window.storage');
  });

  it('save/load round-trips through the chosen backend', () => {
    const a = new StorageAdapter({});
    a.save('k', { hello: 'world', n: 3 });
    expect(a.load('k')).toEqual({ hello: 'world', n: 3 });
  });

  it('does not throw in a bare node environment (guarded detection)', () => {
    expect(() => new StorageAdapter()).not.toThrow();
  });
});

describe('§9 storage never lies about durability', () => {
  /** localStorage that accepts the startup probe, then fills up. */
  function quotaAfterProbe() {
    const m = new Map();
    let probed = false;
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      removeItem: (k) => m.delete(k),
      setItem: (k, v) => {
        if (!probed) { probed = true; m.set(k, v); return; } // the probe passes
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      },
    };
  }

  it('a write that fails after the probe demotes to session, and says so', () => {
    const a = new StorageAdapter({ localStorage: quotaAfterProbe() });
    expect(a.status).toBe('persistent'); // the probe passed
    expect(a.layer).toBe('localStorage');

    const ok = a.save('k', { hello: 'world' });

    expect(ok).toBe(false); // reports rather than throwing into a timer
    expect(a.status).toBe('session'); // the dot must go amber
    expect(a.layer).toBe('memory');
    // …and the app keeps working: the state is still readable in memory.
    expect(a.load('k')).toEqual({ hello: 'world' });
  });

  it('corrupt stored state loads as null instead of throwing', () => {
    const backing = new Map([['k', '{not json']]);
    const a = new StorageAdapter({
      localStorage: {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, v),
        removeItem: (k) => backing.delete(k),
      },
    });
    expect(a.load('k')).toBeNull();
  });
});

describe('§9 export / import', () => {
  it('exports a versioned footlocker blob', () => {
    const s = seed(new Date(2026, 6, 13));
    const { filename, data } = exportState(s, new Date(2026, 6, 13));
    expect(filename).toBe('schedule-2026-07-13.json');
    expect(data.schemaVersion).toBe(1);
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it('summarizeImport validates schemaVersion and dry-runs a summary', () => {
    const s = seed(new Date(2026, 6, 13));
    const { data } = exportState(s);
    const summary = summarizeImport(data);
    expect(summary.valid).toBe(true);
    expect(summary.taskCount).toBe(data.tasks.length);
    expect(summarizeImport({ schemaVersion: 99 }).valid).toBe(false);
  });
});
