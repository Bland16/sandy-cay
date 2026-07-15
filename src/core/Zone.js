// Zone.js — the Zone class (SPEC §1.2). Placement constraint: tasks whose tags
// intersect matchTags route only into the zone's per-day windows. When
// exclusive (default) those windows are subtracted from general placement for
// non-matching tasks.

import { slug } from './ids.js';

export class Zone {
  constructor(data = {}) {
    this.label = data.label ?? 'Zone';
    this.id = data.id || slug(this.label) + '-zone';
    this.matchTags = Array.isArray(data.matchTags) ? [...data.matchTags] : [];
    this.windows = Array.isArray(data.windows) ? data.windows.map((w) => ({ ...w })) : [];
    this.exclusive = data.exclusive ?? true;
    this.color = data.color ?? '#A8DADC';
  }

  /** Windows on a given day key ('mon'…'sun'); a day may have several. */
  windowsForDay(day) {
    return this.windows.filter((w) => w.day === day);
  }

  /** Does [start,end] (HH:MM strings) fit inside one of this zone's windows on
   *  `day`? */
  containsRange(day, start, end) {
    const s = toMin(start);
    const e = toMin(end);
    return this.windowsForDay(day).some((w) => toMin(w.start) <= s && e <= toMin(w.end));
  }

  /** Does this zone claim the task? (tags ∩ matchTags ≠ ∅) */
  matches(task) {
    return task.tags.some((t) => this.matchTags.includes(t));
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      label: this.label,
      matchTags: [...this.matchTags],
      windows: this.windows.map((w) => ({ ...w })),
      exclusive: this.exclusive,
      color: this.color,
    };
  }

  static fromJSON(json) {
    return new Zone(json);
  }
}

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}
