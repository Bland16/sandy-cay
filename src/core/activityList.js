// activityList.js — making a long Activity Library navigable (EDITOR-REDESIGN §7.1).
//
// The drill-in editor fixed the "wall" for five activities; it does nothing for a
// hundred, and one bucket can hold that many alone. This is the pure pipeline
// behind the filter box, the sort control and the pager — kept out of the
// component so the ordering rules are testable without a DOM.
//
// P-1 BOUNDARY (structural, not a convention). `activityUsage` counts
// INSTANTIATIONS: times you chose an activity and it became a task. It must
// never be extended to count dismissals, cycled-past suggestions, or deletions.
// suggest.js states the same rule for the picker: "cycling past a suggestion
// records NOTHING — it cannot infer procrastination because it never watches
// what you skip." A convenience sort is not a licence to start watching.

import { addDays, dayStart } from './time.js';

export const SORTS = ['az', 'za', 'used'];
export const SORT_LABELS = { az: 'A–Z', za: 'Z–A', used: 'most used' };

function activityCfg(config) {
  const a = (config && config.activities) || {};
  return {
    pageSize: a.pageSize ?? 8,
    frequencyDays: a.frequencyDays ?? 90,
  };
}

/** How often each activity was instantiated in the trailing window.
 *  → { [activityId]: count }. Tasks with no activityId are ordinary tasks and
 *  are ignored. Counting a task that was later skipped is deliberate: you chose
 *  it, and the skip is not recorded as a judgement (P-1). */
export function activityUsage(schedule, { now = new Date(), days } = {}) {
  const cfg = activityCfg(schedule && schedule.config);
  const window = Number.isFinite(days) ? days : cfg.frequencyDays;
  const cutoff = addDays(dayStart(now), -window).getTime();
  const out = {};
  for (const t of (schedule && schedule.tasks) || []) {
    if (!t.activityId) continue;
    if (!t.startTime || t.startTime.getTime() < cutoff) continue;
    out[t.activityId] = (out[t.activityId] || 0) + 1;
  }
  return out;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Substring match on the label, case-insensitive. An empty query matches all. */
export function filterActivities(activities, query) {
  const q = norm(query);
  if (!q) return [...activities];
  return activities.filter((a) => norm(a.label).includes(q));
}

/** A–Z / Z–A / most-used. `used` ALWAYS tiebreaks on A–Z: on a fresh install
 *  every count is 0, and without the tiebreak the "most used" list would be in
 *  arbitrary insertion order — stable-looking but meaningless. */
export function sortActivities(activities, sort = 'az', usage = {}) {
  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' });
  const out = [...activities];
  if (sort === 'za') return out.sort((a, b) => byLabel(b, a));
  if (sort === 'used') {
    return out.sort((a, b) => ((usage[b.id] || 0) - (usage[a.id] || 0)) || byLabel(a, b));
  }
  return out.sort(byLabel);
}

/** Slice into a page. Pages are 1-based. `page` is clamped into range, so a
 *  filter that shrinks the list can never strand the caller on an empty page —
 *  though the UI should still reset to page 1 on a filter change so the user
 *  doesn't silently jump pages. */
export function paginate(items, page = 1, pageSize = 8) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pageCount,
    total: items.length,
  };
}

/** filter → sort → paginate, in that order. Doing it in any other order lets
 *  page 2 show rows that don't match the filter. */
export function activityPage(activities, {
  query = '', sort = 'az', page = 1, usage = {}, pageSize = 8,
} = {}) {
  const matched = filterActivities(activities, query);
  const sorted = sortActivities(matched, sort, usage);
  return { ...paginate(sorted, page, pageSize), filtered: norm(query).length > 0 };
}

export { activityCfg };
