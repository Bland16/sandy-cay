// queries.js — pure read models: getWeekLoad (§5D, 6I), getTagBreakdown (§6F),
// snapshot + diff (§6J), getSatisfactionMatrix + getBreakCompression (§7.1).

import { DAY_KEYS, addDays, sameDay, dateKey, minutesBetween } from './time.js';
import { dayWindowBounds, dayCapacityMin } from './placement.js';
import { TIME_BUCKETS, timeBucket } from './learning.js';

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

/**
 * Minute gaps between consecutive tasks on one day, in order. The single
 * definition of "a break" — `overpackCheck` (§7.3) and `getBreakCompression`
 * (§7.1) both walk it, so the grid's physics notice and the report's stats can
 * never disagree about how squeezed a day was.
 *
 * Only gaps BETWEEN tasks count: the run-up to the first task and the tail
 * after the last are the day's edges, not breaks you were given. Overlapping
 * tasks clamp to 0 rather than going negative.
 */
export function dayGaps(schedule, date, weekStartDate = date) {
  const dayTasks = schedule
    .getTasksForWeek(weekStartDate)
    .filter((t) => sameDay(t.startTime, date))
    .sort((a, b) => a.startTime - b.startTime);
  const gaps = [];
  for (let i = 1; i < dayTasks.length; i += 1) {
    gaps.push(Math.max(0, minutesBetween(dayTasks[i - 1].endTime, dayTasks[i].startTime)));
  }
  return gaps;
}

/**
 * Break compression (§7.1 stats): how squeezed each day was, measured against
 * the config's own break tiers. Observation only — a compressed week is a fact
 * about physics, not a failing (P-1).
 *
 * A day with fewer than two tasks has no gaps, so `avgBreak` is null, NOT 0 —
 * "you took no breaks" would be a lie about a day with one task on it. Callers
 * render null as "—".
 */
export function getBreakCompression(schedule, weekStartDate) {
  const { breaks } = schedule.config;
  const perDay = [];
  let weekGapSum = 0;
  let weekGapCount = 0;
  let tightGaps = 0; // gaps at or below the hard floor

  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStartDate, i);
    const gaps = dayGaps(schedule, date, weekStartDate);
    const sum = gaps.reduce((a, b) => a + b, 0);
    weekGapSum += sum;
    weekGapCount += gaps.length;
    tightGaps += gaps.filter((g) => g <= breaks.minimum).length;
    perDay.push({
      day: DAY_KEYS[i],
      date: dateKey(date),
      gapCount: gaps.length,
      avgBreak: gaps.length > 0 ? sum / gaps.length : null,
      minBreak: gaps.length > 0 ? Math.min(...gaps) : null,
      totalBreakMin: sum,
    });
  }

  return {
    perDay,
    gapCount: weekGapCount,
    avgBreak: weekGapCount > 0 ? weekGapSum / weekGapCount : null,
    tightGaps,
    tiers: { ...breaks },
  };
}

/**
 * Satisfaction by tag × time-of-day (§7.1 stats). Reuses the learning module's
 * buckets (`timeBucket`) rather than inventing a second bucketing — the report
 * must describe the week in the same terms the model reasons about it, or an
 * insight ("study rates highest before noon") won't match the chart beside it.
 *
 * Multi-tag tasks count toward EACH tag, matching getTagBreakdown (§6F).
 * Unrated cells carry `avg: null`, never 0 — an unrated slot is unknown, not bad.
 */
export function getSatisfactionMatrix(schedule, weekStartDate) {
  const map = new Map(); // tag → { cells: [{sum,count}], sum, count }
  const blank = () => ({
    cells: TIME_BUCKETS.map(() => ({ sum: 0, count: 0 })),
    sum: 0,
    count: 0,
  });

  for (const t of schedule.getTasksForWeek(weekStartDate)) {
    if (!t.satisfaction || typeof t.satisfaction.overall !== 'number') continue;
    const b = timeBucket(t.startTime.getHours());
    for (const tag of t.tags) {
      if (!map.has(tag)) map.set(tag, blank());
      const row = map.get(tag);
      row.cells[b].sum += t.satisfaction.overall;
      row.cells[b].count += 1;
      row.sum += t.satisfaction.overall;
      row.count += 1;
    }
  }

  const rows = [...map.entries()]
    .map(([tag, r]) => ({
      tag,
      count: r.count,
      avg: r.count > 0 ? r.sum / r.count : null,
      cells: r.cells.map((c, i) => ({
        bucket: TIME_BUCKETS[i],
        count: c.count,
        avg: c.count > 0 ? c.sum / c.count : null,
      })),
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { buckets: [...TIME_BUCKETS], rows, ratedCount: rows.reduce((n, r) => n + r.count, 0) };
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
