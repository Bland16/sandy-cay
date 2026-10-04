// Todo.js — a one-shot Activity (design/TODO-LIST.md §9.1).
//
// "It is kinda just a different kind of activity, pretty similar." A todo IS an
// Activity — label, tags, an elastic duration range — that exists until it is
// done and then is gone. So it extends Activity rather than restating it: a
// third description of one idea is the debt this project keeps paying.
//
// What makes it a todo is WHERE IT LIVES, not a flag. `schedule.todos` holds
// these and `schedule.activities` never does, so nothing that reads the library
// (the Buckets card, "most used", add-what's-missing, the library sync) has to
// learn to skip them — and no existing activity serialises one byte differently,
// which is what would have frozen every device's sync on deploy (§8.2 M-1).
//
// It is NOT ticked off. Doing it is `placeActivity`, which turns it into a task
// and removes it in the same call; the task carries the completion from there.

import { Activity } from './Activity.js';
import { makeRandomId } from './ids.js';
import { dateKey, dateFromKey } from './time.js';

/** The date an UNDATED todo's Google event sits on, out of sight — the one the
 *  library already uses. Never a real deadline. */
export const UNDATED = '1970-01-01';

const DEFAULT_MIN = 15;
const DEFAULT_MAX = 30; // D-2: the motivating examples are small ("email the registrar")

/**
 * A deadline is a real 'YYYY-MM-DD' or it is nothing.
 *
 * Held as a STRING for the reason a day note's dates are: a day has no time of
 * day, and `new Date('2026-10-03')` is UTC midnight — the 2nd for anyone west of
 * Greenwich (sharp edge #4). So it is never parsed that way; `dateFromKey`
 * builds a LOCAL date and the round trip through `dateKey` rejects the 31st of
 * a 30-day month.
 */
export function asDeadline(v) {
  if (v == null || v === '') return null;
  const key = v instanceof Date ? dateKey(v) : String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key === UNDATED) return null;
  const d = dateFromKey(key);
  return d instanceof Date && !Number.isNaN(d.getTime()) && dateKey(d) === key ? key : null;
}

export class Todo extends Activity {
  constructor(data = {}) {
    const label = data.label ?? 'Todo';
    super({
      ...data,
      label,
      // ⚠️ RANDOM, not `slug(label) + '-act'`. Every "New todo" would share that
      // id, a deleted one's id would be reused by the next (§8.2 M-2), and two
      // devices would mint the same one independently (§9.5).
      id: data.id || makeRandomId(label),
      durationMin: Number.isFinite(data.durationMin) ? data.durationMin : DEFAULT_MIN,
      // Passed explicitly: left to the base, an absent max becomes 60.
      durationMax: Number.isFinite(data.durationMax) ? data.durationMax : DEFAULT_MAX,
      // A todo has no bucket, no dial and no priority: its energy comes from
      // its own tags, the way a task's does (P-5, and "energy from tags").
      bucketId: null,
      load: null,
      priority: null,
      // ...and it is never a routine (M-4). A one-shot chain would be listed by
      // the Routines card and could be run twice.
      steps: null,
      travelMin: 0,
    });
    this.deadline = asDeadline(data.deadline);
  }

  get isTodo() {
    return true;
  }

  /** Is it due on or before `today` ('YYYY-MM-DD' or a Date)? Undated: never. */
  isDueBy(today) {
    if (!this.deadline) return false;
    const key = today instanceof Date ? dateKey(today) : String(today);
    return this.deadline <= key; // ISO keys compare chronologically
  }

  toJSON() {
    return { ...super.toJSON(), deadline: this.deadline };
  }
}
