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

/** Drop duplicate drafts before a bulk add.
 *
 *  Identity is the trimmed, case-insensitive LABEL — not label+duration. Two
 *  activities both called "meditate" in one bucket are a mistake whether or not
 *  their ranges agree, and the second one is unreachable noise in the list.
 *
 *  Dedupes on both axes: within the paste itself (first occurrence wins, so the
 *  durations you wrote first are the ones kept) and against what the bucket
 *  already holds (so pasting the same block twice is idempotent rather than
 *  doubling everything).
 *
 *  @param drafts   [{ label, ... }] parsed rows, in paste order
 *  @param existing [{ label }] activities already in the target bucket
 *  @returns { fresh, duplicates } — duplicates are the DROPPED rows, so the UI
 *           can say what it skipped instead of silently swallowing them.
 */
export function dedupeDrafts(drafts, existing = []) {
  const seen = new Set(existing.map((a) => norm(a.label)));
  const fresh = [];
  const duplicates = [];
  for (const d of drafts) {
    const key = norm(d.label);
    if (!key) continue; // a blank line is not an activity
    if (seen.has(key)) { duplicates.push(d); continue; }
    seen.add(key);
    fresh.push(d);
  }
  return { fresh, duplicates };
}

// ---- bulk paste ----------------------------------------------------------
const MIN_DURATION = 15; // grid minimum (OD-1) — mirrors Activity.js
const clampMin = (v) => { const n = Number(v); return Math.max(MIN_DURATION, Math.round(Number.isFinite(n) ? n : MIN_DURATION)); };

/** One pasted row: "Name | min-max | tag, tag". Only the name is required.
 *  Omitted tags inherit the bucket's — which is what you want now that a task's
 *  energy derives from its tags. */
export function parseActivityLine(line, bucket) {
  const [namePart, durPart, tagPart] = String(line).split('|').map((s) => (s || '').trim());
  let durationMin = MIN_DURATION; let durationMax = 60;
  if (durPart) {
    const range = durPart.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (range) { durationMin = clampMin(range[1]); durationMax = Math.max(durationMin, clampMin(range[2])); }
    else if (/^\d+$/.test(durPart)) { durationMin = clampMin(durPart); durationMax = durationMin; }
  }
  const tags = tagPart
    ? tagPart.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : (bucket ? [...bucket.tags] : []);
  return { label: namePart || 'Activity', bucketId: bucket ? bucket.id : null, tags, durationMin, durationMax };
}

/** A "# Bucket name" line retargets everything after it. */
const headerOf = (line) => {
  const m = String(line).match(/^#+\s*(.+?)\s*$/);
  return m ? m[1] : null;
};

/**
 * Parse a whole paste, which may span several buckets.
 *
 * A leading inline column was the obvious design and is ambiguous: "Creative |
 * write poetry" and "write poetry | 15-60" are both two fields, so a bucket name
 * and a duration-less activity are indistinguishable. Headers avoid the guess
 * entirely, and they match the shape people already write lists in.
 *
 * Rows before any header go to `defaultBucket` (the bucket you're standing in);
 * with no default they are reported as unassigned rather than silently dropped.
 * A header naming no known bucket is reported too — creating buckets from what
 * might be a typo is worse than saying so.
 *
 * @returns { drafts, unknownBuckets, unassigned }
 */
export function parseBulkBlock(text, { buckets = [], defaultBucket = null } = {}) {
  const byName = new Map(buckets.map((b) => [norm(b.label), b]));
  let current = defaultBucket;
  let sawHeader = false;
  const drafts = [];
  const unknownBuckets = [];
  const unassigned = [];

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const header = headerOf(line);
    if (header !== null) {
      sawHeader = true;
      const found = byName.get(norm(header));
      current = found || null;
      if (!found && !unknownBuckets.includes(header)) unknownBuckets.push(header);
      continue;
    }
    if (!current) { unassigned.push(parseActivityLine(line, null)); continue; }
    drafts.push(parseActivityLine(line, current));
  }
  return { drafts, unknownBuckets, unassigned, sawHeader };
}

/** Dedupe a multi-bucket paste, one bucket at a time — the same label in two
 *  different buckets is legitimate, so identity is scoped to the bucket. */
export function dedupeBulk(drafts, existingByBucket = {}) {
  const groups = new Map();
  for (const d of drafts) {
    const key = d.bucketId ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const fresh = [];
  const duplicates = [];
  for (const [bucketId, rows] of groups) {
    const res = dedupeDrafts(rows, existingByBucket[bucketId] || []);
    fresh.push(...res.fresh);
    duplicates.push(...res.duplicates);
  }
  return { fresh, duplicates };
}

export { activityCfg };
