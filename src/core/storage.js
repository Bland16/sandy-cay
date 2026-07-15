// storage.js — StorageAdapter (SPEC §9, OD-10) with an env-detected backend
// priority chain: window.storage → guarded localStorage → in-memory. The
// environment is injectable so tests never touch real browser globals; when no
// env is passed it feature-detects globalThis via guarded typeof checks (never a
// bare reference that would throw in node).

function makeMemoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

/** Resolve the runtime environment without ever dereferencing an undefined
 *  global. */
function resolveEnv(env) {
  if (env) return env;
  const out = {};
  if (typeof globalThis !== 'undefined') {
    if (typeof globalThis.window !== 'undefined') out.window = globalThis.window;
    if (typeof globalThis.localStorage !== 'undefined') out.localStorage = globalThis.localStorage;
  }
  return out;
}

function isUsable(store) {
  return store && typeof store.setItem === 'function' && typeof store.getItem === 'function';
}

/** Choose a backend, trying each layer and falling through on failure. */
export function pickBackend(env) {
  const e = resolveEnv(env);

  // 1) window.storage — artifact persistence API.
  if (e.window && isUsable(e.window.storage)) {
    return { backend: e.window.storage, layer: 'window.storage', status: 'persistent' };
  }

  // 2) localStorage — guarded; only outside the artifact sandbox.
  const ls = e.localStorage || (e.window ? e.window.localStorage : undefined);
  if (isUsable(ls)) {
    try {
      const probe = '__sandycay_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return { backend: ls, layer: 'localStorage', status: 'persistent' };
    } catch {
      /* fall through to memory */
    }
  }

  // 3) in-memory — always works; persistence indicator shows 'session'.
  return { backend: makeMemoryBackend(), layer: 'memory', status: 'session' };
}

export class StorageAdapter {
  constructor(env) {
    const picked = pickBackend(env);
    this.backend = picked.backend;
    this.layer = picked.layer;
    this.status = picked.status; // 'persistent' (green) | 'session' (amber)
  }

  /**
   * @returns {boolean} true if it actually persisted.
   *
   * The startup probe passing does not mean every later write succeeds: the
   * quota fills, private mode bites, permission gets revoked. A throw here used
   * to escape into a debounced timer while `status` still said 'persistent' —
   * the app claimed durability it no longer had. Demote instead of lying: keep
   * working in memory and let the status dot go amber (§9).
   */
  save(key, obj) {
    try {
      this.backend.setItem(key, JSON.stringify(obj));
      return true;
    } catch (err) {
      this.lastError = err;
      if (this.layer !== 'memory') {
        this.backend = makeMemoryBackend();
        this.layer = 'memory';
        this.status = 'session';
        try {
          this.backend.setItem(key, JSON.stringify(obj));
        } catch {
          /* memory cannot fail */
        }
      }
      return false;
    }
  }

  /** Corrupt or unreadable state → null (start fresh) rather than throwing. */
  load(key) {
    try {
      const raw = this.backend.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      this.lastError = err;
      return null;
    }
  }

  remove(key) {
    if (typeof this.backend.removeItem === 'function') this.backend.removeItem(key);
  }
}

/** Export a schedule to a versioned, plain-JSON footlocker blob (§9). */
export function exportState(schedule, dateForName = new Date()) {
  const y = dateForName.getFullYear();
  const m = String(dateForName.getMonth() + 1).padStart(2, '0');
  const d = String(dateForName.getDate()).padStart(2, '0');
  return {
    filename: `schedule-${y}-${m}-${d}.json`,
    data: { schemaVersion: 1, exportedAt: dateForName.getTime(), ...schedule.toJSON() },
  };
}

/** Validate + dry-run summarize an import blob (§9). Does not commit. */
export function summarizeImport(blob) {
  if (!blob || blob.schemaVersion !== 1) {
    return { valid: false, reason: 'Unsupported or missing schemaVersion (expected 1).' };
  }
  return {
    valid: true,
    taskCount: (blob.tasks || []).length,
    zoneCount: (blob.zones || []).length,
    ratings: blob.model ? blob.model.sampleCount || 0 : 0,
  };
}
