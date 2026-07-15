// Zone.js — the Zone class (SPEC §1.2). Placement constraint: tasks whose tags
// intersect matchTags route only into the zone's per-day windows. When
// exclusive (default) those windows are subtracted from general placement for
// non-matching tasks.

import { slug } from './ids.js';
import { dayStart } from './time.js';

const asDate = (v) => (v == null ? null : v instanceof Date ? new Date(v.getTime()) : new Date(v));

export class Zone {
  constructor(data = {}) {
    this.label = data.label ?? 'Zone';
    this.id = data.id || slug(this.label) + '-zone';
    this.matchTags = Array.isArray(data.matchTags) ? [...data.matchTags] : [];
    this.windows = Array.isArray(data.windows) ? data.windows.map((w) => ({ ...w })) : [];
    this.exclusive = data.exclusive ?? true;
    this.color = data.color ?? '#A8DADC';
    // A zone can be temporary — a summer job's hours, a term's study block. Both
    // null (the default) means "always", so existing zones are unaffected.
    // Mirrors a recurrence period's effectiveFrom/effectiveUntil (§4.1).
    this.effectiveFrom = asDate(data.effectiveFrom);
    this.effectiveUntil = asDate(data.effectiveUntil);
  }

  /**
   * Is this zone in force on `date`? `effectiveUntil` is EXCLUSIVE at day
   * granularity: a zone ending on the 25th covers the 24th and stops.
   */
  activeOn(date) {
    const t = dayStart(date).getTime();
    if (this.effectiveFrom && t < dayStart(this.effectiveFrom).getTime()) return false;
    if (this.effectiveUntil && t >= dayStart(this.effectiveUntil).getTime()) return false;
    return true;
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
      effectiveFrom: this.effectiveFrom ? this.effectiveFrom.getTime() : null,
      effectiveUntil: this.effectiveUntil ? this.effectiveUntil.getTime() : null,
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
