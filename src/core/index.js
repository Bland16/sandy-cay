// index.js — public barrel for the Sandy Cay engine (Phase 1).

import { Task } from './Task.js';
import { Zone } from './Zone.js';
import { Schedule } from './Schedule.js';
import { defaultConfig } from './config.js';
import { weekStart as weekStartOf, addDays, atTime, dateKey } from './time.js';

export { Task } from './Task.js';
export { Zone } from './Zone.js';
export { Schedule } from './Schedule.js';
export { LearningModule } from './learning.js';
export { StorageAdapter, exportState, summarizeImport, pickBackend } from './storage.js';
export { defaultConfig, makeConfig } from './config.js';
export * as time from './time.js';
// Named time helpers for UI call sites (the `time` namespace stays available too).
export {
  weekStart, addDays, atTime, dateKey, dateFromKey, sameDay,
  formatHHMM, hhmmToMinutes, dayStart, addMinutes, minutesBetween,
} from './time.js';
export { chooseConflictStrategy, strategyCosts, resolveDropConflicts } from './conflicts.js';
export { rippleShift } from './ripple.js';
export { evacuateDay, blockRange } from './evacuate.js';
export { carryOver, letThemGo } from './carryOver.js';
export { autoSchedule, freeCapacityBefore } from './autoSchedule.js';
export { expandRecurrence, addException, splitPeriod, temporaryChange, endRecurrence } from './recurrence.js';
export { addProject, shrinkChunk, growChunk, deleteChunk, resizeChunk, finishProject, sliceChunks, redistribute } from './projects.js';
export { getWeekLoad, getTagBreakdown, snapshot, snapshotDiff } from './queries.js';
export { whatToDo } from './whatToDo.js';
export {
  driftCheck,
  starvationCheck,
  skipStreakCheck,
  pinnedRatioNote,
  overpackCheck,
  durationFitSuggestion,
} from './detectors.js';
export { score, normalizeWeights } from './scoring.js';
export { findBestSlot, placeTask } from './placement.js';
export { resetIds } from './ids.js';

/**
 * Seed a rich, deterministic Schedule that exercises every badge and rule on
 * first paint (SPEC §13): a mix of fixed/flexible, ≥2 pinned, ≥1 protected,
 * ≥1 recurring w/ exception, 1 project, 1 deadline task, + 1 study zone.
 */
export function seed(refDate = new Date()) {
  const ws = weekStartOf(refDate);
  const at = (offset, hhmm) => atTime(addDays(ws, offset), hhmm);
  const sched = new Schedule({ config: defaultConfig });

  // Study zone: Tue / Thu / Sat evenings (exclusive).
  sched.addZone({
    label: 'Study zone',
    matchTags: ['study'],
    windows: [
      { day: 'tue', start: '18:00', end: '21:00' },
      { day: 'thu', start: '18:00', end: '21:00' },
      { day: 'sat', start: '14:00', end: '18:00' },
    ],
    exclusive: true,
    color: '#A8DADC',
  });

  // 1) Recurring pinned gym (Mon/Wed/Fri 08:00–09:00) with a Wednesday skip.
  const gym = new Task({
    title: 'Morning gym',
    tags: ['sports'],
    type: 'fixed',
    pinned: true,
    startTime: at(0, '08:00'),
    endTime: at(0, '09:00'),
    recurrence: {
      periods: [
        {
          windows: [
            { day: 'mon', start: '08:00', end: '09:00' },
            { day: 'wed', start: '08:00', end: '09:00' },
            { day: 'fri', start: '08:00', end: '09:00' },
          ],
          interval: 1,
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ],
      anchorDate: ws,
      exceptions: [{ date: dateKey(addDays(ws, 2)), action: 'skip' }],
    },
  });
  sched.tasks.push(gym);

  // 2) Fixed team standup (Mon 09:00).
  sched.addFixed({ title: 'Team standup', tags: ['work'], startTime: at(0, '09:00'), endTime: at(0, '09:30') });

  // 3) Fixed lunch with a friend (Tue 12:00).
  sched.addFixed({ title: 'Lunch with Priya', tags: ['social'], startTime: at(1, '12:00'), endTime: at(1, '13:00') });

  // 4) Fixed dentist (Thu 14:00).
  sched.addFixed({ title: 'Dentist', tags: ['health'], startTime: at(3, '14:00'), endTime: at(3, '15:00') });

  // 5) Protected movie night (Fri evening, tag rest).
  sched.addFlexible({ title: 'Movie night', tags: ['rest'], startTime: at(4, '20:00'), endTime: at(4, '22:00') });

  // 6) Deadline study task (due Wed 08:00) → routes into the study zone (Tue).
  sched.addFlexible({
    title: 'Study for midterm',
    tags: ['study'],
    startTime: at(1, '18:00'),
    endTime: at(1, '19:30'),
    deadline: at(2, '08:00'),
    from: ws,
  });

  // 7) Second pinned task — weekly review (Fri 16:00).
  const review = sched.addFlexible({ title: 'Weekly review', tags: ['work'], startTime: at(4, '16:00'), endTime: at(4, '17:00') });
  review.pinned = true;

  // 8) Plain flexible task — auto-placed.
  sched.addFlexible({ title: 'Read novel', tags: ['leisure'], from: ws });

  // Project: thesis, 6h across the week in 1–2h chunks.
  sched.addProject({
    title: 'Thesis',
    tags: ['thesis'],
    chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: ws, until: addDays(ws, 5) } },
  });

  return sched;
}

export default { Task, Zone, Schedule, defaultConfig, seed };
