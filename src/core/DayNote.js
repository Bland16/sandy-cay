// DayNote.js — a fact about a DAY, not an appointment inside it
// (design/DAY-NOTES.md). Holidays, spring break, birthdays, "Mum visiting".
//
// Deliberately NOT a Task. A Task drags in placement, duration, energy load,
// completion, satisfaction, ratings and history — every one of which is
// meaningless for Thanksgiving. Modelling it as one would mean teaching a dozen
// call sites to skip it, and each is a place to forget. (The project has been
// here: `role` was a redundant second description of a bucket's character and
// was eventually ripped out.)
//
// It consumes NO time and has NO effect on placement. A holiday does not decide
// for you that you aren't working. "Block this day" is one click away and runs
// the existing `blockRange`, so the FACT and the DECISION stay separate.

import { slug } from './ids.js';
import { dateKey, dateFromKey } from './time.js';
import { reviveRecurrence, recurrenceToJSON } from './recurrenceSerde.js';
import { occursOn } from './recurrence.js';

/** 'YYYY-MM-DD' or a Date → 'YYYY-MM-DD'. */
function asKey(v, fallback) {
  if (!v) return fallback;
  if (v instanceof Date) return dateKey(v);
  return String(v);
}

export class DayNote {
  constructor(data = {}) {
    this.label = data.label ?? 'Note';
    this.id = data.id || slug(this.label) + '-note';

    // Dates are held as 'YYYY-MM-DD' STRINGS, not Date objects. A day note has
    // no time of day, and a string cannot be misread as UTC midnight — sharp
    // edge #4 in a form that simply cannot occur. ISO strings also compare
    // chronologically, so range checks are string comparisons.
    const today = dateKey(new Date());
    this.from = asKey(data.from, today);
    // INCLUSIVE — the last day it covers. "Spring break 9–13 Mar" covers the
    // 13th. The engine's interiors are half-open (sharp edge #11) and the edges
    // convert: .ics DTEND is exclusive, so import subtracts a day and export
    // adds one back, exactly where untilAfterLastRun/lastRunDay already do this.
    this.to = asKey(data.to, this.from);
    if (this.to < this.from) { const t = this.from; this.from = this.to; this.to = t; }

    // Colour and icon only. A note NEVER tints the day — that is reserved for a
    // day being BLOCKED, which is a real scheduling state and therefore the
    // "physics, never moral bookkeeping" P-1 allows colour for.
    this.kind = data.kind === 'holiday' ? 'holiday' : 'note';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];
    this.source = data.source ?? null;

    // A repeating note (a birthday) reuses the SAME period shape tasks use —
    // `{ freq:'yearly', windows:[{ month, monthDay }] }` is already exactly
    // "every 3 September". A second, notes-only repeat vocabulary would be the
    // design debt this project keeps paying down, and reuse means the skip rules
    // come free: 29 February appears only in leap years, with no new code.
    this.recurrence = data.recurrence ? reviveRecurrence(data.recurrence) : null;
  }

  /** Does this note cover a given date? */
  coversDate(date) {
    if (this.recurrence) return occursOn(this.recurrence, date);
    const k = dateKey(date);
    return k >= this.from && k <= this.to; // ISO strings sort chronologically
  }

  /** How many days it spans (1 for a single day). Ranges are inclusive. */
  get dayCount() {
    if (this.recurrence) return 1;
    return Math.round((dateFromKey(this.to) - dateFromKey(this.from)) / 86400000) + 1;
  }

  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      label: this.label,
      from: this.from,
      to: this.to,
      kind: this.kind,
      tags: [...this.tags],
      source: this.source,
      recurrence: recurrenceToJSON(this.recurrence),
    };
  }

  static fromJSON(json) {
    return new DayNote(json || {});
  }
}
