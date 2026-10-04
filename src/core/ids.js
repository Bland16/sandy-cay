// ids.js — deterministic-friendly id generation: slug(title) + short suffix.
// A module-level counter keeps suffixes unique within a session without needing
// randomness, which keeps the engine deterministic for tests.
//
// ⚠️ UNIQUE WITHIN A SESSION IS NOT UNIQUE ACROSS DEVICES. The counter restarts
// at every page load, so two devices mint `walk-0001` independently. For
// anything created often on more than one device and synced per item — todos —
// use `makeRandomId`, whose source is injectable so tests stay exact.

let counter = 0;

/** Reset the internal counter — used by tests that assert exact ids. */
export function resetIds() {
  counter = 0;
}

/** Lowercase, hyphenated, alnum-only slug of a title. */
export function slug(title) {
  return String(title || 'task')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task';
}

/** Deterministic 4-char base36 suffix from an incrementing counter. */
export function suffix() {
  counter += 1;
  return counter.toString(36).padStart(4, '0').slice(-4);
}

/** id = slug(title) + '-' + 4-char suffix. */
export function makeId(title) {
  return `${slug(title)}-${suffix()}`;
}

// ---- random ids (design/TODO-LIST.md §9.5) --------------------------------

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A number in [0, 1). `crypto` where there is one (sharp edge #7: guarded). */
function defaultRandom() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  }
  return Math.random();
}

let random = defaultRandom;

/** Swap the random source — tests that assert exact ids. Pass nothing to reset. */
export function setIdRandom(fn) {
  random = typeof fn === 'function' ? fn : defaultRandom;
}

/**
 * `len` base-36 characters, built ONE AT A TIME. The tempting one-liner,
 * `Math.random().toString(36).slice(2, 8)`, comes out short whenever the
 * fraction has few digits — and a short suffix is a likelier collision.
 */
export function randomSuffix(len = 6) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return out;
}

/** id = slug(title) + '-' + 6 random characters. Safe to mint on two devices. */
export function makeRandomId(title) {
  return `${slug(title)}-${randomSuffix(6)}`;
}
