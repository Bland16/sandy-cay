// Bucket.js — an activity category *and* a tag group (design/ACTIVITY-LIBRARY.md).
// A bucket gives a set of tags a shared identity, a colour, and a signed load
// vector — its *character* (restorative vs demanding, and on which axis). There
// is no `role` enum: the load vector already says everything the enum did, and
// the steering + learning key off it. Mirrors Zone.js: a plain data class with a
// stable id, tag membership, and JSON round-trip.

import { slug } from './ids.js';
import { normalizeLoad } from './energy.js';

export class Bucket {
  constructor(data = {}) {
    this.label = data.label ?? 'Bucket';
    this.id = data.id || slug(this.label) + '-bucket';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];
    this.color = data.color ?? '#A8DADC';
    // Signed load vector (design/ENERGY-MODEL.md): + spends a reserve, − restores.
    // Default is NEUTRAL (0) and user-authored — never a fabricated per-role guess.
    this.load = normalizeLoad(data.load);
  }

  /** Does this bucket claim `tag`? */
  hasTag(tag) {
    return this.tags.includes(tag);
  }

  /** Does this bucket claim the task? (task.tags ∩ this.tags ≠ ∅) */
  matches(task) {
    const tags = task && task.tags ? task.tags : [];
    return tags.some((t) => this.tags.includes(t));
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      label: this.label,
      tags: [...this.tags],
      color: this.color,
      load: { ...this.load },
    };
  }

  static fromJSON(json) {
    return new Bucket(json);
  }
}
