// ids.js — deterministic-friendly id generation: slug(title) + short suffix.
// A module-level counter keeps suffixes unique within a session without needing
// randomness, which keeps the engine deterministic for tests. An optional seeded
// PRNG is available where a stable-yet-varied suffix is wanted.

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
