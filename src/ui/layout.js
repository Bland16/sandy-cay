// layout.js — assign overlapping tasks to side-by-side lanes so cards never
// stack on top of each other (hard requirement: no element overlaps). Greedy
// interval-graph colouring per day.
import { gridHour, gridDayOf } from './format.js';
import { sameDay } from '../core/index.js';

/**
 * What a task occupies in ONE grid-day column, as 0, 1 or 2 segments.
 *
 * The grid day is 5am-anchored, so a session can genuinely belong to two of
 * them: 04:15–06:15 starts in the small hours of one column and ends after the
 * anchor in the next. Drawing only the first part clipped the time away;
 * drawing the whole box hung the card out of the bottom of the column.
 *
 * So it is CUT, not shortened — the tail is drawn at the top of the following
 * column. Both pieces are the SAME task: same id, same object, one thing that
 * happens to cross a line the grid drew. Only the box is in two places.
 *
 * A 23:00–01:00 session is NOT split: 01:00 is before the anchor, so both ends
 * belong to the same grid day and it stays one box, exactly as it always did.
 *
 * @returns {Array<{task, s, e, continued, continues}>} in grid hours
 */
export function columnItems(tasks, date, startHour) {
  const endOfDay = startHour + 24;
  const out = [];
  for (const task of tasks) {
    const startsHere = sameDay(gridDayOf(task.startTime), date);
    const endsHere = sameDay(gridDayOf(task.endTime), date);
    const s = gridHour(task.startTime);
    const rawEnd = gridHour(task.endTime);
    // A task ending at/after the 5am anchor (e.g. 23:00–01:00) must not wrap to
    // a tiny negative height — measure its end from its own start.
    const e = Math.max(s + 0.25, rawEnd > s ? rawEnd : s + task.getDuration() / 60);

    if (startsHere) {
      const crosses = e > endOfDay + 1e-6;
      out.push({ task, s, e: crosses ? endOfDay : e, continued: false, continues: crosses });
    } else if (endsHere) {
      // The tail: from the anchor to the real end, at the top of this column.
      out.push({ task, s: startHour, e: Math.max(startHour + 0.25, rawEnd), continued: true, continues: false });
    }
  }
  return out;
}

/**
 * The crosshatched remainder of a task finished early (SPEC §3.9 / 3D).
 *
 * Marking `done` before the end truncates the block through the engine — the
 * freed minutes are genuinely free, which is what makes the 3C offer mean
 * anything. This draws where the block *used to* reach, so the time doesn't
 * just silently vanish off the grid.
 *
 * `truncations` is session state (taskId → the original end Date), deliberately
 * not persisted: it's a visual echo of something that just happened, not a fact
 * about the schedule. The engine stays the source of truth for the span.
 *
 * Takes `laid` rather than raw tasks so the band inherits the card's own lane —
 * a remainder must never spill across a neighbour sharing the column.
 */
export function layoutRemainders(laid, truncations, startHour, pxh) {
  if (!truncations) return [];
  const out = [];
  for (const { task, style, continued } of laid) {
    if (continued) continue; // a tail has no end of its own to echo
    const until = truncations[task.id];
    if (!until) continue;
    const s = gridHour(task.endTime);
    const spanH = (until.getTime() - task.endTime.getTime()) / 3600000;
    if (spanH <= 0) continue;
    out.push({
      key: task.id,
      title: task.title,
      style: {
        left: style.left,
        width: style.width,
        top: `${(s - startHour) * pxh}px`,
        height: `${spanH * pxh}px`,
      },
    });
  }
  return out;
}

/**
 * Lay out one column's SEGMENTS (from `columnItems`) into lanes.
 *
 * Takes segments rather than tasks because a task can occupy two columns and
 * the span it occupies HERE is not derivable from the task alone.
 */
export function layoutDay(segments, startHour, pxh) {
  const items = [...segments].sort(
    (a, b) => a.s - b.s || b.e - a.e,
  );
  const laneEnds = []; // running end (decimal hour) per lane
  const placed = items.map((seg) => {
    const { task, s, e } = seg;
    let lane = laneEnds.findIndex((end) => end <= s + 1e-6);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else { laneEnds[lane] = e; }
    return { ...seg, task, s, e, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  // Second pass: cluster width = number of lanes actually overlapping this item.
  return placed.map((p) => {
    const overlapping = placed.filter((q) => q.s < p.e && p.s < q.e);
    const cluster = Math.max(...overlapping.map((q) => q.lane)) + 1;
    const lanes = Math.min(laneCount, Math.max(cluster, p.lane + 1));
    const top = (p.s - startHour) * pxh;
    const height = Math.max(26, (p.e - p.s) * pxh);
    const widthPct = 100 / lanes;
    return {
      task: p.task,
      // Distinct per SEGMENT, so React does not reconcile the two halves of one
      // task into a single node.
      key: p.continued ? `${p.task.id}#cont` : p.task.id,
      continued: !!p.continued,
      continues: !!p.continues,
      style: {
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${p.lane * widthPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
      },
      compact: height < 44,
    };
  });
}
