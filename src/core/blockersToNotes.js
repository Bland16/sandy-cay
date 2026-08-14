// blockersToNotes.js — turn whole-day blocker TASKS into day NOTES.
//
// Why this exists. A real schedule arrived with its holidays modelled as tasks:
// "No classes", `fixed`, 08:00–23:00, one per day, so Thanksgiving drew as THREE
// full-height cards standing where the day's actual contents should be. That is
// the failure DAY-NOTES.md §1 describes — an all-day fact wearing an
// appointment's clothes — and §2 answers it: a day note is not a Task, because a
// Task drags in placement, duration, energy load, completion, ratings and
// history, every one of which is meaningless for Thanksgiving.
//
// Detection is STRUCTURAL, never by title or tag. A blocker is a fixed task that
// covers its day's ENTIRE placement window (`dayWindowBounds`). Matching on
// "No classes", or on the `rest` tag `createBlocker` happens to use, would work
// for one generator's output and quietly miss the next one's.
//
// ⚠️ This CONVERTS, it does not copy: the tasks are removed. That is the point —
// the card is what was wrong — but it does mean a behaviour is dropped, exactly
// as D-6 warned. Today a full-window blocker leaves automatic placement no legal
// room; a day note has no effect on placement at all. Restoring "the scheduler
// stays out" is the `blockedDays` collection D-6 specifies, and it is its own
// piece of work. Nothing regresses for a schedule with no flexible work in it,
// which is the case this was written for, but do not mistake that for the
// behaviour having been preserved.

import { DayNote } from './DayNote.js';
import { dayWindowBounds } from './placement.js';
import { dateKey, addDays, dayStart } from './time.js';

/**
 * Is this task a whole-day blocker rather than an appointment inside the day?
 *
 * Covering the window is the whole test. A 09:00–18:00 class is an appointment;
 * something spanning every schedulable hour is a statement ABOUT the day, since
 * it leaves nowhere for the day to be used.
 */
export function isFullDayBlocker(schedule, task) {
  if (!task || task.recurrence || task.chunking) return false;
  if (task.type !== 'fixed') return false;
  if (!task.startTime || !task.endTime) return false;
  const b = dayWindowBounds(schedule.config, task.startTime);
  // The window must be spanned end to end, and the task must not run past the
  // day it claims — a two-day span is a different animal and stays a task.
  if (!sameCalendarDay(task.startTime, task.endTime)) return false;
  return task.startTime.getTime() <= b.start.getTime()
    && task.endTime.getTime() >= b.end.getTime();
}

function sameCalendarDay(a, b) {
  return dateKey(a) === dateKey(b);
}

/**
 * What converting WOULD do, without doing it — so a caller can state the counts
 * before asking (P-1: an action that cannot be previewed cannot be consented to).
 *
 * Consecutive days carrying the SAME label collapse into ONE multi-day note.
 * That is not tidying: three separate one-day "No classes" notes would draw as
 * three marks, and the whole point of §4's band is that Thanksgiving reads as
 * one run of three days.
 *
 * @returns {{ notes: Array<{label,from,to,kind,taskIds}>, taskIds: string[] }}
 */
export function planBlockerConversion(schedule) {
  const blockers = schedule.tasks
    .filter((t) => isFullDayBlocker(schedule, t))
    .sort((a, b) => a.startTime - b.startTime);

  const notes = [];
  for (const t of blockers) {
    const key = dateKey(t.startTime);
    const prev = notes[notes.length - 1];
    // Same label, and starts the day after the previous note ends → one run.
    if (prev && prev.label === t.title && dateKey(addDays(dayStart(prev.toDate), 1)) === key) {
      prev.to = key;
      prev.toDate = dayStart(t.startTime);
      prev.taskIds.push(t.id);
      continue;
    }
    notes.push({
      label: t.title,
      from: key,
      to: key,
      toDate: dayStart(t.startTime),
      // `kind` is colour and icon only, never behaviour. These came in as
      // blockers, so they are days off rather than annotations.
      kind: 'holiday',
      tags: [...(t.tags || [])],
      taskIds: [t.id],
    });
  }
  return {
    notes: notes.map(({ toDate, ...n }) => n), // eslint-disable-line no-unused-vars
    taskIds: blockers.map((t) => t.id),
  };
}

/**
 * Apply the plan: add the notes, remove the tasks.
 * @returns {{ notesAdded: number, tasksRemoved: number }}
 */
export function convertBlockersToDayNotes(schedule) {
  const plan = planBlockerConversion(schedule);
  if (plan.taskIds.length === 0) return { notesAdded: 0, tasksRemoved: 0 };

  for (const n of plan.notes) {
    schedule.addDayNote({
      label: n.label, from: n.from, to: n.to, kind: n.kind, tags: n.tags,
      source: 'converted from blockers',
    });
  }
  const gone = new Set(plan.taskIds);
  const before = schedule.tasks.length;
  schedule.tasks = schedule.tasks.filter((t) => !gone.has(t.id));
  return { notesAdded: plan.notes.length, tasksRemoved: before - schedule.tasks.length };
}

/** A DayNote for each planned note, without touching the schedule (for preview). */
export function previewNotes(schedule) {
  return planBlockerConversion(schedule).notes.map((n) => new DayNote(n));
}
