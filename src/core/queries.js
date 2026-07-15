// queries.js — pure read models: getWeekLoad (§5D, 6I), getTagBreakdown (§6F),
// snapshot + diff (§6J).

import { DAY_KEYS, addDays, sameDay, dateKey } from './time.js';
import { dayWindowBounds, dayCapacityMin } from './placement.js';

export function getWeekLoad(schedule, weekStartDate) {
  const config = schedule.config;
  const weekTasks = schedule.getTasksForWeek(weekStartDate);
  const perDay = [];
  let scheduledMin = 0;
  let capacityMin = 0;
  let pinnedMin = 0;
  let warnings = 0;

  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStartDate, i);
    const b = dayWindowBounds(config, date);
    const dayTasks = weekTasks.filter((t) => sameDay(t.startTime, date));
    let dayScheduled = 0;
    for (const t of dayTasks) {
      // Count minutes overlapping the day window.
      const s = Math.max(t.startTime.getTime(), b.start.getTime());
      const e = Math.min(t.endTime.getTime(), b.end.getTime());
      const mins = e > s ? Math.round((e - s) / 60000) : 0;
      dayScheduled += mins;
      if (t.pinned) pinnedMin += mins;
      if (t.schedulingWarning) warnings += 1;
    }
    const cap = dayCapacityMin(config, date);
    scheduledMin += dayScheduled;
    capacityMin += cap;
    perDay.push({
      day: DAY_KEYS[i],
      date: dateKey(date),
      scheduledMin: dayScheduled,
      capacityMin: cap,
      fillRatio: cap > 0 ? dayScheduled / cap : 0,
    });
  }

  return {
    scheduledMin,
    capacityMin,
    fillRatio: capacityMin > 0 ? scheduledMin / capacityMin : 0,
    perDay,
    warnings,
    pinnedRatio: scheduledMin > 0 ? pinnedMin / scheduledMin : 0,
  };
}

export function getTagBreakdown(schedule, weekStartDate) {
  const weekTasks = schedule.getTasksForWeek(weekStartDate);
  const map = new Map(); // tag → { scheduledMin, completedMin, shells:[], }
  for (const t of weekTasks) {
    const dur = t.getDuration();
    const done = t.completion === 'done' || t.completion === 'partial';
    for (const tag of t.tags) {
      if (!map.has(tag)) map.set(tag, { tag, scheduledMin: 0, completedMin: 0, shellSum: 0, shellCount: 0 });
      const row = map.get(tag);
      row.scheduledMin += dur; // multi-tag tasks count toward EACH tag (§6F)
      if (done) row.completedMin += dur;
      if (t.satisfaction && typeof t.satisfaction.overall === 'number') {
        row.shellSum += t.satisfaction.overall;
        row.shellCount += 1;
      }
    }
  }
  return [...map.values()]
    .map((r) => ({
      tag: r.tag,
      scheduledMin: r.scheduledMin,
      completedMin: r.completedMin,
      avgShells: r.shellCount > 0 ? r.shellSum / r.shellCount : null,
    }))
    .sort((a, b) => b.scheduledMin - a.scheduledMin || a.tag.localeCompare(b.tag));
}

/** Lightweight placement record for a week: taskId → { start, end }. */
export function snapshot(schedule, weekStartDate) {
  const rec = {};
  for (const t of schedule.getTasksForWeek(weekStartDate)) {
    rec[t.id] = { start: t.startTime.getTime(), end: t.endTime.getTime() };
  }
  return rec;
}

/** Diff two snapshots → { moved:[{id, deltaMin}], added, removed, intactCount }. */
export function snapshotDiff(before, after) {
  const moved = [];
  const removed = [];
  let intactCount = 0;
  for (const id of Object.keys(before)) {
    if (!(id in after)) {
      removed.push(id);
      continue;
    }
    const deltaMin = Math.round((after[id].start - before[id].start) / 60000);
    if (deltaMin !== 0) moved.push({ id, deltaMin });
    else intactCount += 1;
  }
  const added = Object.keys(after).filter((id) => !(id in before));
  return { moved, added, removed, intactCount };
}
