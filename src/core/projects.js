// projects.js — chunked projects + work conservation (SPEC §3.7, 5B, OD-14).
// The parent Task (chunking set) is a bookkeeping record, not a grid object;
// children (parentId) are ordinary placed tasks. Conservation is implemented by
// re-slicing the auto-placed remainder so Σ(children) is always conserved unless
// there is genuinely no capacity (→ parent.schedulingWarning).

import { Task } from './Task.js';
import { addMinutes } from './time.js';
import { intervalsOf, placeTask, recurrenceIntervals } from './placement.js';

/** Slice `total` minutes into chunks each within [min, max], as even as
 *  possible. */
export function sliceChunks(total, minChunk, maxChunk) {
  if (total <= 0) return [];
  if (total <= maxChunk) return [total];
  const n = Math.max(1, Math.ceil(total / maxChunk));
  const base = Math.floor(total / n);
  let rem = total - base * n;
  const sizes = [];
  for (let i = 0; i < n; i += 1) {
    let size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    sizes.push(size);
  }
  // Guard the min floor: fold any sub-min tail into the previous chunk.
  for (let i = sizes.length - 1; i > 0; i -= 1) {
    if (sizes[i] < minChunk) {
      sizes[i - 1] += sizes[i];
      sizes.splice(i, 1);
    }
  }
  return sizes;
}

function removeById(schedule, id) {
  const i = schedule.tasks.findIndex((t) => t.id === id);
  if (i >= 0) schedule.tasks.splice(i, 1);
}

/**
 * Create a project: materializes children sized in [minChunk, maxChunk], placed
 * by the scored pipeline across the range (range.until enters slack math).
 * @returns { parent: Task, children: Task[] }
 */
export function addProject(schedule, data) {
  const chunking = {
    totalMinutes: data.chunking.totalMinutes,
    minChunk: data.chunking.minChunk,
    maxChunk: data.chunking.maxChunk,
    range: { from: data.chunking.range.from, until: data.chunking.range.until },
  };
  const parent = new Task({
    title: data.title,
    details: data.details ?? '',
    tags: data.tags ?? [],
    type: 'flexible',
    startTime: chunking.range.from,
    endTime: addMinutes(chunking.range.from, 0),
    chunking,
  });
  schedule.tasks.push(parent);
  const children = materialize(schedule, parent, { now: data.now });
  return { parent, children };
}

/** (Re)build the auto-placed children so the total is conserved. Completed and
 *  user-placed children are preserved; only auto children flex. */
export function redistribute(schedule, parent, opts = {}) {
  const children = schedule.tasks.filter((t) => t.parentId === parent.id);
  const preserved = children.filter((t) => t.completion !== null || t.placedBy === 'user');
  const auto = children.filter((t) => t.completion === null && t.placedBy !== 'user');
  const usedByPreserved = preserved.reduce((s, t) => s + t.getDuration(), 0);
  let remaining = parent.chunking.totalMinutes - usedByPreserved;

  for (const c of auto) removeById(schedule, c.id);
  parent.schedulingWarning = false;
  if (remaining <= 0) return [];

  const { minChunk, maxChunk, range } = parent.chunking;
  // ⚠️ Floor the search at NOW, not at the project's start date. `placeTask`'s
  // past-placement guard is relative to the `from` it is given, and this passed
  // `range.from` — so a project whose range began on Monday laid chunks on
  // Monday and Tuesday when it was already Wednesday. Work scheduled into time
  // that has gone is worse than unscheduled: it reads as done-and-missed.
  //
  // Same shape as `autoSchedule` (`opts.now || new Date()`, floor only when now
  // falls INSIDE the range) so the two agree — a project starting next month
  // still lays out from its own start, and one already underway starts here.
  const now = opts.now || new Date();
  const from = (now.getTime() > range.from.getTime() && now.getTime() < range.until.getTime())
    ? now
    : range.from;
  const sizes = sliceChunks(remaining, minChunk, maxChunk);
  const created = [];
  let occupied = intervalsOf(schedule.tasks.filter((t) => !t.chunking && !t.recurrence))
    .concat(recurrenceIntervals(schedule, from, range.until)); // occurrences are anchors (§4.4)
  for (const size of sizes) {
    const child = new Task({
      title: parent.title,
      tags: [...parent.tags],
      type: 'flexible',
      parentId: parent.id,
      startTime: from,
      endTime: addMinutes(from, size),
      deadline: range.until,
    });
    const res = placeTask(schedule, child, { from, to: range.until, occupied });
    child.placedBy = 'auto';
    schedule.tasks.push(child);
    occupied.push({ start: child.startTime, end: child.endTime, task: child });
    created.push(child);
    if (res.warning) parent.schedulingWarning = true;
  }
  return created;
}

function materialize(schedule, parent, opts) {
  return redistribute(schedule, parent, opts);
}

/** Resize a chunk to `newDurationMin` (a user action → placedBy 'user'), then
 *  run conservation so the freed/added minutes flow through siblings. */
export function resizeChunk(schedule, childId, newDurationMin) {
  const child = schedule.tasks.find((t) => t.id === childId);
  if (!child) return null;
  const parent = schedule.tasks.find((t) => t.id === child.parentId);
  // ⚠️ DELIBERATELY NOT clamped to `chunking.maxChunk` (HANDOFF item 3, decided
  // 2026-08-15). `resizeChunk` sets `placedBy = 'user'` two lines down — it IS
  // the hand, and R-1 says a manual action keeps its autonomy: automatic
  // re-optimizing carries the guarantees, a drag does not have to.
  //
  // `maxChunk` is what you told the SLICER, so it binds `sliceChunks` and
  // `redistribute`; it is not a cage around your own mouse. Deciding you will
  // sit for three hours this once is a thing a person is allowed to do, and the
  // conservation rule still holds — the siblings shrink to pay for it.
  //
  // This was clamped for about ten minutes, and `tests/projects.test.js`
  // ("grow chunk → siblings shrink/dissolve") caught it: that test asserts a
  // 120-max chunk growing to 180, so the behaviour was already intended and
  // written down. Only the 15-minute floor applies here (OD-1's, the same one
  // the resize borders enforce).
  child.resizeTo(addMinutes(child.startTime, Math.max(15, newDurationMin)));
  child.placedBy = 'user';
  if (parent) redistribute(schedule, parent);
  return parent;
}

export function shrinkChunk(schedule, childId, deltaMin) {
  const child = schedule.tasks.find((t) => t.id === childId);
  if (!child) return null;
  return resizeChunk(schedule, childId, child.getDuration() - deltaMin);
}

export function growChunk(schedule, childId, deltaMin) {
  const child = schedule.tasks.find((t) => t.id === childId);
  if (!child) return null;
  return resizeChunk(schedule, childId, child.getDuration() + deltaMin);
}

/** Delete a chunk: 'remove' shrinks the project total; 'redistribute' conserves
 *  the work by re-flowing it into siblings (OD-14). */
export function deleteChunk(schedule, childId, mode = 'redistribute') {
  const child = schedule.tasks.find((t) => t.id === childId);
  if (!child) return null;
  const parent = schedule.tasks.find((t) => t.id === child.parentId);
  const dur = child.getDuration();
  removeById(schedule, childId);
  if (parent) {
    if (mode === 'remove') parent.chunking.totalMinutes = Math.max(0, parent.chunking.totalMinutes - dur);
    redistribute(schedule, parent);
  }
  return parent;
}

/** "Finish project here": remaining incomplete chunks vanish; parent records
 *  completion 'done' with actual-vs-planned minutes kept. */
export function finishProject(schedule, parentId) {
  const parent = schedule.tasks.find((t) => t.id === parentId);
  if (!parent) return null;
  const children = schedule.tasks.filter((t) => t.parentId === parentId);
  const done = children.filter((t) => t.completion === 'done' || t.completion === 'partial');
  const actual = done.reduce((s, t) => s + t.getDuration(), 0);
  for (const c of children) {
    if (c.completion === null) removeById(schedule, c.id);
  }
  parent.completion = 'done';
  parent.chunking.actualMinutes = actual;
  parent.chunking.plannedMinutes = parent.chunking.totalMinutes;
  return { parent, actual, planned: parent.chunking.totalMinutes };
}
