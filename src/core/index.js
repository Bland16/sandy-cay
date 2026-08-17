// index.js — public barrel for the Sandy Cay engine (Phase 1).

import { Task } from './Task.js';
import { Zone } from './Zone.js';
import { Schedule } from './Schedule.js';
import { defaultConfig } from './config.js';
import { weekStart as weekStartOf, addDays, atTime, dateKey } from './time.js';

export { Task } from './Task.js';
export { Zone } from './Zone.js';
export { Bucket } from './Bucket.js';
export { Activity } from './Activity.js';
export { Schedule } from './Schedule.js';
export { LearningModule } from './learning.js';
export { StorageAdapter, exportState, summarizeImport, pickBackend } from './storage.js';
export { defaultConfig, makeConfig } from './config.js';
export * as time from './time.js';
// Named time helpers for UI call sites (the `time` namespace stays available too).
export {
  weekStart, addDays, atTime, dateKey, dateFromKey, sameDay,
  formatHHMM, hhmmToMinutes, dayStart, addMinutes, minutesBetween,
  isoWeek, isoWeekKey, lastRunDay, untilAfterLastRun, weekdayIndex, dayKeyOf,
} from './time.js';
export { chooseConflictStrategy, strategyCosts, resolveDropConflicts } from './conflicts.js';
export { rippleShift } from './ripple.js';
export { evacuateDay, blockRange } from './evacuate.js';
export { isFullDayBlocker, planBlockerConversion, convertBlockersToDayNotes } from './blockersToNotes.js';
export { carryOver, letThemGo } from './carryOver.js';
export { checkRollover, commitRollover, weekAfter, weekKeyOf } from './rollover.js';
export { autoSchedule, freeCapacityBefore } from './autoSchedule.js';
export { expandRecurrence, addException, splitPeriod, periodFor, temporaryChange, endRecurrence, dateOfOccurrence, occursOn } from './recurrence.js';
export { DayNote } from './DayNote.js';
export { Commitment } from './Commitment.js';
export { RoutineInstance } from './RoutineInstance.js';
export { instantiateRoutine, reflowRoutine, suggestRoutineStart } from './routines.js';
export { generateSittings, generateAll, chooseSittings, spreadDays, runwayEnd, gapsOnDay, openMinutesFor } from './generate.js';
export { previewWeek, layOutWeek, planWeek, owedThisWeek } from './commitmentWeek.js';
export { addProject, shrinkChunk, growChunk, deleteChunk, resizeChunk, finishProject, sliceChunks, redistribute } from './projects.js';
export {
  getWeekLoad, getTagBreakdown, snapshot, snapshotDiff,
  dayGaps, getBreakCompression, getSatisfactionMatrix,
} from './queries.js';
export { whatToDo, currentOpening, openingLabel } from './whatToDo.js';
export { suggestActivities, placeActivity, steerBias, priorityPressure } from './suggest.js';
export {
  activityUsage, activityPage, filterActivities, sortActivities, paginate, activityCfg,
  dedupeDrafts, dedupeBulk, parseActivityLine, parseBulkBlock, SORTS, SORT_LABELS,
} from './activityList.js';
export { energyBudget, energyCalibration, learnedCapacity, energyTrajectory, reserveAt, loadForTask, normalizeLoad, spendRestore, LOAD_AXES } from './energy.js';
export {
  toICS, parseICS, importEvents, eventToTask, deriveTags,
  toRRULE, fromRRULE, toICSDate, fromICSDate, eventToDayNote,
} from './ical.js';
export {
  driftCheck,
  starvationCheck,
  skipStreakCheck,
  pinnedRatioNote,
  overpackCheck,
  durationFitSuggestion,
} from './detectors.js';
export { score, normalizeWeights } from './scoring.js';
export { findBestSlot, placeTask, dayWindowBounds, intervalsOf } from './placement.js';
export { resetIds } from './ids.js';

// Starter buckets (design/ACTIVITY-LIBRARY.md): a proposed set the user edits.
//
// ⚠️ REVERSED 2026-08-11 — these now SHIP WITH LOAD VALUES. The original note
// read "load defaults to neutral (0) — the user authors each bucket's character
// on the wave control; we never fabricate it", and that was the wrong call for
// one concrete reason: **a bucket whose load is 0 does nothing at all.**
// `loadForTask` averages the buckets a task's tags touch, so an all-neutral
// starter set still computes to an all-zero vector — the battery, the
// deepest-dip signal, reserve-aware suggestions and the card tints stay inert.
// Seeding neutral buckets therefore never switched the feature on; it only
// created empty labels to fill in. A real user was found after weeks of use with
// sixteen tags, no buckets, and no sign the energy model existed.
//
// This does NOT breach P-2. What P-2 forbids inventing is CAPACITY — what you
// can handle — and that is still learned from your ratings and still returns
// null until calibrated. Load is the other half, what a thing COSTS, and a
// starting draft of it is a suggestion you edit, not a verdict about you.
//
// Load is a per-HOUR rate in [-2, 2]: + spends, − restores. Anchored so the
// costliest thing (Study, mental +2) exhausts a default mental day (capacity 8)
// in four hours, and Exercise (physical +2) a physical one (capacity 6) in
// three. Both are meant to be argued with — that is what the wave control is for.
//
// Exercise and Maintenance are deliberately SEPARATE, and opposite on the mental
// axis. A gym session and a hospital appointment would both be "health"; one
// costs the body and pays the head back, the other costs the head and pays
// nothing. Telling them apart is what a four-axis model is for. "Maintenance"
// rather than "health" is also the kinder word — an appointment is upkeep, not a
// verdict — and the kinder word is the one people actually use.
export const STARTER_BUCKETS = [
  // Demanding — these spend.
  { label: 'Study', color: '#5FB8B0', tags: ['study', 'classes', 'research'], load: { mental: 2, physical: 0, social: 0, creative: 0.5 } },
  { label: 'Work', color: '#2E8C99', tags: ['work', 'meeting'], load: { mental: 1.5, physical: 0, social: 1, creative: 0 } },
  { label: 'Making', color: '#C9A96E', tags: ['creative', 'project', 'music', 'art'], load: { mental: 1, physical: 0, social: 0, creative: 1.5 } },
  { label: 'Maintenance', color: '#8AA7C2', tags: ['appointment', 'admin', 'medical', 'health'], load: { mental: 1, physical: 0.5, social: 0, creative: 0 } },
  // Mixed — a cost on one axis, a return on another.
  { label: 'Exercise', color: '#7FBE8B', tags: ['gym', 'exercise', 'sports'], load: { mental: -1, physical: 2, social: 0, creative: 0 } },
  { label: 'Chores', color: '#D2C6A9', tags: ['chores', 'errand', 'home'], load: { mental: -0.5, physical: 1, social: 0, creative: 0 } },
  { label: 'Food', color: '#E8B94D', tags: ['cooking', 'food'], load: { mental: -0.5, physical: 0.5, social: 0, creative: 0.5 } },
  { label: 'People', color: '#E2685F', tags: ['social', 'family', 'friends'], load: { mental: -1, physical: 0, social: 1, creative: 0 } },
  { label: 'Culture', color: '#A9CDD1', tags: ['reading', 'film', 'culture'], load: { mental: -0.5, physical: 0, social: 0, creative: 1 } },
  // Restorative — these pay back.
  { label: 'Rest', color: '#F1E9D8', tags: ['rest', 'break', 'recovery', 'leisure', 'nap'], load: { mental: -1.5, physical: -1, social: 0, creative: -0.5 } },
];

/**
 * Seed the starter buckets onto a schedule. Idempotent: a no-op the moment any
 * bucket exists, so it never clobbers an edited set. Returns the buckets it added
 * (empty if it did nothing). The *trigger* (first run vs a Cabana action) is a
 * Phase-B decision; this is just the data + the guard.
 */
export function seedStarterBuckets(schedule) {
  if (!schedule || (schedule.buckets && schedule.buckets.length > 0)) return [];
  return STARTER_BUCKETS.map((b) => schedule.addBucket(b));
}

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
  //
  // `now: ws` is load-bearing, not decoration. `redistribute` floors its search
  // at "now" so a project already underway does not lay chunks into hours that
  // have gone — which means that without this, the seed's layout depended on the
  // WALL CLOCK, and the fixture drifted with the time of day it was built at.
  // Sharp edge #8: the engine must never read the clock in a test.
  sched.addProject({
    now: ws,
    title: 'Thesis',
    tags: ['thesis'],
    chunking: { totalMinutes: 360, minChunk: 60, maxChunk: 120, range: { from: ws, until: addDays(ws, 5) } },
  });

  return sched;
}

export default { Task, Zone, Schedule, defaultConfig, seed };
