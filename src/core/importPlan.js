// importPlan.js — what a calendar import should DO to the schedule it lands on.
//
// design/CALENDAR-IMPORT.md §4 Tier 2. The sibling of `syncPlan.js`, and
// deliberately the same shape: a pure function over two lists plus a record of
// what was decided, so the hard cases are testable without a network, a clock or
// a component.
//
// ════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS AT ALL
// ════════════════════════════════════════════════════════════════════════════
//
// Both import doors ended in `for (const t of tasks) s.tasks.push(t)`. Blind
// append: import the same week twice and everything exists twice; import over a
// planned week and the calendar's events land on top of what was already there,
// as `fixed` anchors that overlap it. That was the reported bug.
//
// It could not be fixed where it stood, because `eventToTask` threw away the
// event's UID (§2.2) and a re-import therefore minted a fresh task id every time.
// `Task.source` records it now, and this file is what that record is FOR.
//
// ════════════════════════════════════════════════════════════════════════════
// THE RULES, AND WHICH ONE IS THE SAFETY STORY
// ════════════════════════════════════════════════════════════════════════════
//
//   local                             | in this pull | ->
//   ----------------------------------|--------------|------------
//   source == null (you made it)      | —            | UNTOUCHED
//   uid matches, this calendar        | present      | update
//   uid from THIS calendar, in range  | absent       | remove
//   uid from ANOTHER calendar         | —            | untouched
//   —                                 | new uid      | create
//
// ⚠️ ROW ONE IS THE WHOLE SAFETY STORY. The user asked for "if I click the
// calendar then it should be only the calendar tasks" — a wipe. That is only
// survivable because the wipe is scoped to THIS CALENDAR'S OWN PRIOR IMPORTS:
// it cannot reach a task you typed, a routine touchpoint, a commitment sitting
// or a chunk parent, because none of those carry a `source` at all. There is no
// exception list to maintain and nothing to forget — those things are not in
// this planner's address space.

/** Every uid this pull saw, so "absent" can mean absent rather than filtered. */
function uidSet(list) {
  const s = new Set();
  for (const u of list || []) if (u != null) s.add(String(u));
  return s;
}

/**
 * ⚠️ LIVED DATA IS NOT THE CALENDAR'S TO HAVE AN OPINION ABOUT.
 *
 * CI-1 says Google wins, and for what a calendar actually knows — the title, the
 * times, the pattern — it does, outright, with no merge and no timestamp
 * comparison. But `satisfaction`, `completion`, `history`, `occurrenceData`,
 * `energyAt` and `dayFillAtCompletion` are things that happened to YOU. A
 * calendar event has never heard of them, so "the incoming version wins" would
 * mean every re-import silently erased how a class actually went, and with it
 * every training sample the model had for it.
 *
 * Reading CI-1 literally here would make the import door a slow eraser of the
 * app's whole point. So: the calendar wins about the appointment; the schedule
 * keeps what it lived.
 *
 * ⚠️ THE LOCAL `id` IS KEPT TOO, and not for tidiness. A sitting's `parentId`, a
 * touchpoint's `routineId`, a chunk's parent link and the sync's own record all
 * address a task by id. Taking the incoming task's freshly minted one would cut
 * every one of those on each re-import.
 */
const LIVED = [
  'satisfaction', 'completion', 'history', 'occurrenceData',
  'energyAt', 'dayFillAtCompletion',
];

export function mergeImported(localJson, incomingJson) {
  const out = { ...incomingJson, id: localJson.id };
  for (const k of LIVED) {
    if (localJson[k] !== undefined) out[k] = localJson[k];
  }
  // Provenance is re-stamped from the incoming task: same uid by construction,
  // but `importedAt` moves forward so "when did this last come down" is true.
  out.source = incomingJson.source || localJson.source || null;
  return out;
}

/**
 * Plan one import against the schedule it is landing on.
 *
 * @param localTasks    `schedule.tasks` as JSON (never materialised occurrences)
 * @param incoming      tasks built from the events that PASSED the tag filter
 * @param opts.calendarId  which calendar this pull came from
 * @param opts.seenUids    ⚠️ every uid FETCHED in range, BEFORE the tag filter
 * @param opts.from/to     the fetched window; removal is scoped to it (CI-6)
 *
 * ⚠️ `seenUids` IS SEPARATE FROM `incoming` ON PURPOSE (CI-5). If removal were
 * computed from the filtered list, then typing `study` into "only tags" would
 * mean "delete everything that isn't study" — a footgun with no upside. The
 * filter decides what is IMPORTED; the full fetched set decides what SURVIVES.
 */
export function planImport(localTasks, incoming, {
  calendarId = null, seenUids = null, from = null, to = null,
} = {}) {
  const seen = uidSet(seenUids != null ? seenUids : (incoming || []).map((t) => t.source && t.source.uid));
  const plan = {
    create: [], update: [], remove: [], untouched: [], decisions: [],
  };
  const decide = (title, decision, why = {}) => {
    plan.decisions.push({ title, decision, ...why });
  };

  // Local tasks previously imported from THIS calendar, by uid.
  const mineByUid = new Map();
  for (const t of localTasks || []) {
    if (!t.source || !t.source.uid) continue;
    // ⚠️ A null `calendarId` on either side is NOT a wildcard. An older import
    // that predates provenance-with-a-calendar, or an `.ics` file (which has no
    // calendar), must not be adopted by whichever Google calendar is pulled next
    // and then deleted by it.
    if ((t.source.calendarId ?? null) !== (calendarId ?? null)) continue;
    mineByUid.set(String(t.source.uid), t);
  }

  const matched = new Set();
  for (const inc of incoming || []) {
    const uid = inc.source && inc.source.uid ? String(inc.source.uid) : null;
    if (!uid) {
      // No identity to reconcile on — the honest fallback is to add it, which is
      // what the old code did for everything.
      plan.create.push(inc);
      decide(inc.title, 'create', { reason: 'event carried no uid' });
      continue;
    }
    const local = mineByUid.get(uid);
    if (!local) {
      plan.create.push(inc);
      decide(inc.title, 'create', { uid, reason: 'not seen from this calendar before' });
      continue;
    }
    matched.add(uid);
    plan.update.push({ id: local.id, task: mergeImported(local, inc), uid });
    decide(inc.title, 'update', { uid, reason: 'already imported from this calendar' });
  }

  const inRange = (t) => {
    if (!from || !to) return true;
    const at = t.startTime ? new Date(t.startTime).getTime() : null;
    if (at == null) return false;
    return at >= new Date(from).getTime() && at < new Date(to).getTime();
  };

  for (const [uid, local] of mineByUid) {
    if (matched.has(uid)) continue;
    if (seen.has(uid)) {
      // Fetched, but filtered out by "only tags". Not absent — leave it alone.
      plan.untouched.push(local.id);
      decide(local.title, 'untouched', { uid, reason: 'in the calendar but filtered out by the tag filter' });
      continue;
    }
    if (!inRange(local)) {
      // ⚠️ Outside the fetched window, so this pull has NO EVIDENCE about it
      // (CI-6). A recurring class imported in week 1 sits at week 1's start
      // forever; a week-5 pull must not read its own narrow window as proof the
      // class was cancelled.
      plan.untouched.push(local.id);
      decide(local.title, 'untouched', { uid, reason: 'starts outside the window this pull covered' });
      continue;
    }
    plan.remove.push({ id: local.id, title: local.title, uid });
    decide(local.title, 'remove', { uid, reason: 'gone from the calendar' });
  }

  return plan;
}

/**
 * Carry out a plan against a live schedule.
 *
 * ⚠️ EVERYTHING GOES THROUGH `upsertTaskFromJSON`, never `updateTask` and never
 * `tasks.push`. `updateTask` filters through `UPDATE_WHITELIST`, which omits
 * `load`, `activityId`, `routineId`, `parentId`, `chunking`, `history`,
 * `energyAt` and `placedBy` — correct for a form, catastrophic for a restore.
 * And a raw `push` is what both doors did before this file existed: it skips
 * `_uniqueInColl`, so a re-import could hand two tasks the same id and make
 * `tasks.find(id === …)` return the wrong one.
 *
 * @param skipRemovals ids the user vetoed in the review list — kept rather than
 *   removed. Everything else in `plan.remove` goes.
 */
export function applyImport(schedule, plan, { skipRemovals = [] } = {}) {
  const vetoed = new Set(skipRemovals);
  let created = 0;
  let updated = 0;
  let removed = 0;
  for (const task of plan.create) {
    schedule.upsertTaskFromJSON(task.toJSON ? task.toJSON() : task);
    created += 1;
  }
  for (const u of plan.update) {
    schedule.upsertTaskFromJSON(u.task);
    updated += 1;
  }
  for (const r of plan.remove) {
    if (vetoed.has(r.id)) continue;
    if (schedule.removeTask(r.id)) removed += 1;
  }
  return { created, updated, removed, kept: vetoed.size };
}

/** One line for a toast — the same job `describePlan` does for a sync. */
export function describeImport(plan) {
  const bits = [];
  if (plan.create.length) bits.push(`${plan.create.length} added`);
  if (plan.update.length) bits.push(`${plan.update.length} updated`);
  if (plan.remove.length) bits.push(`${plan.remove.length} removed`);
  return bits.length ? bits.join(' · ') : 'nothing changed';
}
