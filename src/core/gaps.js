// gaps.js — the single gap-walking core (`_walkGaps`) behind findFreeSlots,
// autoSchedule, backfill and displacement (SPEC §1.3, 1C refactor). Pure.

import { addMinutes, minutesBetween, clamp } from './time.js';

/** Break padding for a day given its fill ratio (SPEC §2.4 step 4):
 *  30 default → 15 at fill ≥ medium(0.5) → 5 at fill ≥ minimum(0.7). */
export function breakMinForFill(fillRatio, config) {
  const { breaks, breakThresholds } = config;
  if (fillRatio >= breakThresholds.minimum) return breaks.minimum;
  if (fillRatio >= breakThresholds.medium) return breaks.medium;
  return breaks.default;
}

/** Merge & sort [{start,end}] Date intervals. */
export function mergeIntervals(intervals) {
  const sorted = [...intervals]
    .filter((iv) => iv && iv.start && iv.end)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
}

/**
 * Walk the free gaps inside a single [windowStart, windowEnd] range around the
 * `occupied` intervals, returning the earliest fitting slot per gap. Break
 * padding is applied only against neighbouring tasks, never against the window
 * edges.
 *
 * @returns Array<{ start: Date, end: Date }>
 */
export function walkGaps({ windowStart, windowEnd, occupied = [], durationMin, breakMin = 0 }) {
  const slots = [];
  if (minutesBetween(windowStart, windowEnd) < durationMin) return slots;
  const blocks = mergeIntervals(occupied).filter(
    (iv) => iv.end.getTime() > windowStart.getTime() && iv.start.getTime() < windowEnd.getTime(),
  );

  let cursor = windowStart;
  let leftIsTask = false;
  for (const block of blocks) {
    const gapStart = cursor;
    const gapEnd = block.start.getTime() < windowEnd.getTime() ? block.start : windowEnd;
    pushGap(slots, gapStart, gapEnd, leftIsTask, true, durationMin, breakMin);
    cursor = block.end.getTime() > cursor.getTime() ? block.end : cursor;
    leftIsTask = true;
    if (cursor.getTime() >= windowEnd.getTime()) break;
  }
  if (cursor.getTime() < windowEnd.getTime()) {
    pushGap(slots, cursor, windowEnd, leftIsTask, false, durationMin, breakMin);
  }
  return slots;
}

function pushGap(slots, gapStart, gapEnd, leftIsTask, rightIsTask, durationMin, breakMin) {
  if (gapEnd.getTime() <= gapStart.getTime()) return;
  const usableStart = leftIsTask ? addMinutes(gapStart, breakMin) : gapStart;
  const usableEnd = rightIsTask ? addMinutes(gapEnd, -breakMin) : gapEnd;
  if (minutesBetween(usableStart, usableEnd) >= durationMin) {
    slots.push({ start: usableStart, end: addMinutes(usableStart, durationMin) });
  }
}

/** Intersect an [HH:MM window] with a day's [start,end] Date bounds. */
export function clampWindowToTimeOfDay(dayWindowStart, dayWindowEnd, timeWindow) {
  if (!timeWindow) return { start: dayWindowStart, end: dayWindowEnd };
  const s = new Date(dayWindowStart.getTime());
  const [sh, sm] = timeWindow.start.split(':').map(Number);
  s.setHours(sh, sm, 0, 0);
  const e = new Date(dayWindowStart.getTime());
  const [eh, em] = timeWindow.end.split(':').map(Number);
  e.setHours(eh, em, 0, 0);
  return {
    start: new Date(Math.max(dayWindowStart.getTime(), s.getTime())),
    end: new Date(Math.min(dayWindowEnd.getTime(), e.getTime())),
  };
}

export { clamp };
