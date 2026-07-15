// evacuate.js — evacuateDay (SPEC §3.4) and blockRange (SPEC §3.5).

import { sameDay, dayStart, addDays } from './time.js';
import { dayWindowBounds, intervalsOf, placeTask } from './placement.js';
import { Task } from './Task.js';

/** Create a full-day protected blocker task for a date. */
export function createBlocker(schedule, date, label = 'Blocked') {
  const b = dayWindowBounds(schedule.config, date);
  const task = new Task({
    title: label,
    tags: ['rest'],
    type: 'fixed',
    startTime: b.start,
    endTime: b.end,
    placedBy: 'user',
  });
  return task;
}

/**
 * Clear a day: flexibles relocate forward-only via scoring; pinned/fixed/
 * protected are surfaced for a human decision.
 * @returns { relocated: Task[], needsReview: Task[], warned: Task[] }
 */
export function evacuateDay(schedule, date, { blockDay = false } = {}) {
  const protectedTags = schedule.config.protectedTags;
  const dayTasks = schedule.tasks.filter(
    (t) => !t.chunking && !t.recurrence && sameDay(t.startTime, date),
  );
  const movable = dayTasks.filter((t) => t.type === 'flexible' && !t.pinned && !t.hasProtectedTag(protectedTags));
  const needsReview = dayTasks.filter((t) => t.isAnchored(protectedTags));

  const relocated = [];
  const warned = [];
  const from = dayStart(addDays(date, 1)); // forward-only — you're sick now
  const to = addDays(from, schedule.config.maxPlacementLookahead);

  for (const t of movable) {
    const occupied = intervalsOf(
      schedule.tasks.filter((o) => o !== t && !o.chunking && !o.recurrence),
    );
    const res = placeTask(schedule, t, { from, to, occupied, origin: t.startTime });
    t.placedBy = 'auto';
    relocated.push(t);
    if (res.warning) warned.push(t);
  }

  if (blockDay) {
    const blocker = createBlocker(schedule, date, 'Out sick');
    schedule.tasks.push(blocker);
  }

  return { relocated, needsReview, warned };
}

/**
 * Block every day in [fromDate, toDate]: emit one per-day protected blocker and
 * evacuate existing flexibles forward.
 * @returns Task[] blockers created
 */
export function blockRange(schedule, fromDate, toDate, label = 'Blocked') {
  const blockers = [];
  let d = dayStart(fromDate);
  const last = dayStart(toDate);
  while (d.getTime() <= last.getTime()) {
    evacuateDay(schedule, d, { blockDay: false });
    const blocker = createBlocker(schedule, d, label);
    schedule.tasks.push(blocker);
    blockers.push(blocker);
    d = addDays(d, 1);
  }
  return blockers;
}
