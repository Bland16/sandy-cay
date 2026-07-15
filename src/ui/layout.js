// layout.js — assign overlapping tasks to side-by-side lanes so cards never
// stack on top of each other (hard requirement: no element overlaps). Greedy
// interval-graph colouring per day.
import { gridHour } from './format.js';

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
  for (const { task, style } of laid) {
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

export function layoutDay(tasks, startHour, pxh) {
  const items = [...tasks].sort(
    (a, b) => a.startTime - b.startTime || b.endTime - a.endTime,
  );
  const laneEnds = []; // running end (decimal hour) per lane
  const placed = items.map((task) => {
    const s = gridHour(task.startTime);
    // A task ending at/after the 5am anchor (e.g. 23:00–01:00) must not wrap to
    // a tiny negative height — measure its end from its own start.
    const rawEnd = gridHour(task.endTime);
    const e = Math.max(s + 0.25, rawEnd > s ? rawEnd : s + task.getDuration() / 60);
    let lane = laneEnds.findIndex((end) => end <= s + 1e-6);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else { laneEnds[lane] = e; }
    return { task, s, e, lane };
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
