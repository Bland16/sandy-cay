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
    //
    // ⚠️ THIS SPAN IS THE TRUTH, AND MUST STAY THE TRUTH. It used to be floored
    // at a QUARTER HOUR (`s + 0.25`), which made one number answer two unrelated
    // questions: how tall to draw the card, and whether it overlaps its
    // neighbours. Both answers were wrong for short work. A 2-minute routine
    // touchpoint could never read as shorter than 15 minutes however far you
    // zoomed, and two touchpoints five minutes apart were computed as
    // OVERLAPPING — drawn in half-width side-by-side lanes for an overlap that
    // does not exist, which is a routine's normal case rather than an edge one.
    //
    // The drawn MINIMUM is now `layoutDay`'s `floorPx`, where it belongs and
    // where zoom can shrink it. The guard that survives here is only against a
    // DEGENERATE span — zero or negative, which is a broken card, not a short
    // one. One minute, not fifteen.
    const e = Math.max(s + 1 / 60, rawEnd > s ? rawEnd : s + task.getDuration() / 60);

    if (startsHere) {
      const crosses = e > endOfDay + 1e-6;
      out.push({ task, s, e: crosses ? endOfDay : e, continued: false, continues: crosses });
    } else if (endsHere) {
      // The tail: from the anchor to the real end, at the top of this column.
      // Same rule as the head above: the true end, guarded only against a
      // degenerate span. The drawn minimum is `floorPx`'s job.
      out.push({ task, s: startHour, e: Math.max(startHour + 1 / 60, rawEnd), continued: true, continues: false });
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
export function layoutDay(segments, startHour, pxh, floorPx = 26) {
  // ⚠️ LANES ARE ASSIGNED ON DRAWN PIXELS, NOT ON NOMINAL MINUTES, and that is
  // load-bearing. `floorPx` keeps a 2-minute touchpoint visible by drawing it
  // taller than it really is, so two short cards that do NOT overlap in time can
  // still overlap on screen — 2-minute cards five minutes apart are 26px tall
  // and 2.8px apart at rest. Colouring the interval graph on time would put them
  // in one lane and they would sit on top of each other, breaking this module's
  // one hard requirement.
  //
  // Measuring the boxes actually drawn answers both questions with one rule, and
  // it is zoom-aware for free: zoom in far enough that the floor stops inflating
  // them and they separate and stack on their own. The old code got this right
  // by accident, via a 15-minute minimum SPAN in `columnItems` — which also made
  // every short card lie about its length. See that function's note.
  const items = [...segments]
    .map((seg) => {
      const top = (seg.s - startHour) * pxh;
      // `floorPx` SHRINKS as you zoom in — see `zoom.js#floorPxFor`. It defaults
      // to 26 so callers with no opinion about zoom behave exactly as before.
      const height = Math.max(floorPx, (seg.e - seg.s) * pxh);
      return { ...seg, top, height, bottom: top + height };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const laneEnds = []; // running bottom edge (px) per lane
  const placed = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.top + 1e-6);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.bottom); } else { laneEnds[lane] = it.bottom; }
    return { ...it, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  // Second pass: cluster width = number of lanes actually overlapping this item.
  return placed.map((p) => {
    const overlapping = placed.filter((q) => q.top < p.bottom && p.top < q.bottom);
    const cluster = Math.max(...overlapping.map((q) => q.lane)) + 1;
    const lanes = Math.min(laneCount, Math.max(cluster, p.lane + 1));
    const { top, height } = p;
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
