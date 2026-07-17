// Bucket.js — an activity category *and* a tag group (design/ACTIVITY-LIBRARY.md).
// A bucket gives a set of tags a shared identity and a `role` that the "what to
// do" steering and the learning model reason about. Mirrors Zone.js's shape:
// a plain data class with a stable id, tag membership, and JSON round-trip.

import { slug } from './ids.js';

// One readable enum per bucket (not a two-axis dial), mapping 1:1 onto the six
// starter buckets. Steering and the role×position learning features key off it.
export const BUCKET_ROLES = ['rest', 'creative', 'work', 'social', 'health', 'neutral'];

export class Bucket {
  constructor(data = {}) {
    this.label = data.label ?? 'Bucket';
    this.id = data.id || slug(this.label) + '-bucket';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];
    this.role = BUCKET_ROLES.includes(data.role) ? data.role : 'neutral';
    this.color = data.color ?? '#A8DADC';
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
      role: this.role,
      color: this.color,
    };
  }

  static fromJSON(json) {
    return new Bucket(json);
  }
}
