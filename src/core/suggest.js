// suggest.js — the library fallback for "what to do" (design/ACTIVITY-LIBRARY.md,
// Phase C). Ranks the user's OWN activities that fit the current opening, gently
// steered by how they've recently rated their time.
//
// Two boundaries are structural here, not conventions:
//   • Read-only. suggestActivities / steerBias never mutate and never touch the
//     model — cycling past a suggestion records NOTHING (P-1: it cannot infer
//     procrastination because it never watches what you skip).
//   • User-authored only. It reorders YOUR activities; it never invents any.
// placeActivity is the sole mutation and fires only on an explicit "Do it now".

import { addMinutes, dayStart, addDays, weekStart as weekStartOf, dateKey } from './time.js';
import { dayCapacityMin } from './placement.js';
import { openingLabel } from './whatToDo.js';
import { normalizeLoad, LOAD_AXES, loadForTask, reserveAt } from './energy.js';

function suggestCfg(config) {
  const s = (config && config.suggest) || {};
  return {
    window: s.window ?? 10,
    fitWeight: s.fitWeight ?? 1,
    loadBias: s.loadBias ?? 0.35,
    reserveBias: s.reserveBias ?? 0.2, // nudge away from deepening a bottomed-out axis
    varietyPenalty: s.varietyPenalty ?? 0.15,
    priorityPressureHigh: s.priorityPressureHigh ?? 0.15,
    restFlat: s.restFlat ?? 3,
    // ⚠️ THE COLD-START GATE COUNTS THE WHOLE POOL, NOT THE RESTORATIVE PART OF
    // IT. Ten recent ratings open the gate; if exactly ONE of them was
    // restorative and rated 3, "Rest's felt flat lately" follows from that
    // single rating — and it is the largest bias in this function when it
    // stacks. A claim about how rest has been landing needs rest to have been
    // rated more than once.
    restFlatMin: s.restFlatMin ?? 3,
    coldStart: (config && config.coldStartRatings) ?? 10,
    // ⚠️ ONE NUMBER FOR "LATELY", read from the same place the report reads it.
    // `recentDays` was 14 and `coldStart` is 10 — ten ratings inside a fortnight,
    // a bar a weekly rater cannot clear. It never bit, because the window opted
    // out of itself whenever it came up short (see `recentRated`). Bounding the
    // window without noticing that would have swapped "steers off February" for
    // "never steers at all", which is the quieter failure and no more honest.
    //
    // So the window is the shared `evidenceWindowDays`, not a second constant
    // beside it: two numbers meaning "lately" drift, and this file has a test
    // about exactly that kind of drift.
    recentDays: s.recentDays
      ?? ((config && config.detectors && config.detectors.evidenceWindowDays) ?? 56),
  };
}

// A thing's character IS its load vector (design/RECONCILIATION.md — no `role`).
const netLoad = (L) => L.mental + L.physical + L.social + L.creative;
// Restorative: it gives energy back overall, or is mentally restful (rest, and
// exercise/health, which is physically demanding but clears the head).
const isRestful = (L) => netLoad(L) < 0 || L.mental < 0;
function dominantAxis(L) {
  let ax = null; let m = 0;
  for (const a of LOAD_AXES) if (Math.abs(L[a]) > m) { m = Math.abs(L[a]); ax = a; }
  return m > 0 ? ax : null;
}
/** The load a task/activity carries. An activity belongs to one bucket; a task
 *  derives from ALL its tags' buckets (loadForTask), so both agree with the budget. */
function loadOf(schedule, item) {
  if (item && item.load) return normalizeLoad(item.load);
  if (item && item.bucketId != null) { // an activity → its single bucket
    const b = schedule.buckets.find((x) => x.id === item.bucketId);
    return b && b.load ? normalizeLoad(b.load) : normalizeLoad({});
  }
  return loadForTask(schedule, item); // a task → averaged across its tags' buckets
}

/** Recent rated tasks: at most `window` of them, drawn from the trailing
 *  `recentDays` and nowhere else. */
function recentRated(schedule, now, cfg) {
  // ⚠️ `ratedSamples()`, NOT `schedule.tasks`. A recurring session's rating lives
  // in the parent's `occurrenceData`, never in `schedule.tasks` — so this pool
  // silently excluded every routine the user has ever rated, and suggestion
  // tuning ran on one-offs alone. Same class of bug as the duration-fit detector
  // and `whatToDo`'s rest-boost; `ratedSamples()` is the one door that unifies
  // both stores.
  const rated = schedule.ratedSamples()
    .filter((t) => t.satisfaction && typeof t.satisfaction.overall === 'number')
    .sort((a, b) => b.startTime - a.startTime);
  // ⚠️ THE WINDOW OPTED OUT OF ITSELF WHEN IT WAS EMPTY. This took `within`
  // (the trailing `recentDays`) or `lastN` (the last `window` by recency),
  // WHICHEVER YIELDED MORE — so a user with nothing recent fell through to the
  // ten most recent ratings they had, whenever those were. Measured on a
  // schedule whose last rating was in April: steering on 9 September came back
  // `trained: true, energyBalance: -10`, tuned entirely by February. The window
  // never bounded staleness at all; it chose between "recent" and "old" and
  // preferred whichever set was bigger.
  //
  // `window` is a CAP on how many recent ratings to steer from, not a rescue
  // when there are none. Nothing recent now means nothing to steer from, which
  // is the honest answer and the one the cold-start gate is built to handle.
  const cutoff = addDays(dayStart(now), -cfg.recentDays).getTime();
  return rated
    .filter((t) => t.startTime.getTime() >= cutoff)
    .slice(0, cfg.window);
}

/** "Priority space" — normalised minutes of incomplete P4–P5 work due within the
 *  placement lookahead. High → important work looms; ~0 → genuinely free. */
export function priorityPressure(schedule, now = new Date()) {
  const config = schedule.config;
  const horizon = addDays(dayStart(now), config.maxPlacementLookahead);
  let looming = 0;
  for (const t of schedule.tasks) {
    if (t.completion !== null || t.recurrence || t.chunking) continue;
    if (t.priority < 4 || !t.deadline) continue;
    if (t.deadline.getTime() < now.getTime() || t.deadline.getTime() > horizon.getTime()) continue;
    looming += t.getDuration();
  }
  let capacity = 0;
  for (let d = dayStart(now); d.getTime() <= horizon.getTime(); d = addDays(d, 1)) capacity += dayCapacityMin(config, d);
  return capacity > 0 ? Math.max(0, Math.min(1, looming / capacity)) : 0;
}

/**
 * The steering context, plus `biasFor(load)` → { bias, reason } that scores any
 * activity's LOAD character (restorative vs demanding, and on which axis). Pure
 * and read-only. Cold start (< coldStartRatings recent ratings) → no bias.
 */
export function steerBias(schedule, now = new Date()) {
  const cfg = suggestCfg(schedule.config);
  const recent = recentRated(schedule, now, cfg);
  const none = {
    trained: false, energyBalance: 0, pressure: 0, restorativeFlat: false,
    biasFor: () => ({ bias: 0, reason: null }),
  };
  if (recent.length < cfg.coldStart) return none;

  let energyBalance = 0;
  const restorativeOveralls = []; // overalls of recent tasks that were restorative
  for (const t of recent) {
    energyBalance += t.satisfaction.energy || 0;
    if (netLoad(loadOf(schedule, t)) < 0) restorativeOveralls.push(t.satisfaction.overall);
  }
  const pressure = priorityPressure(schedule, now);
  const restAvg = restorativeOveralls.length
    ? restorativeOveralls.reduce((a, b) => a + b, 0) / restorativeOveralls.length
    : null;
  const restorativeFlat = restorativeOveralls.length >= cfg.restFlatMin
    && restAvg != null && restAvg <= cfg.restFlat;
  const b = cfg.loadBias;

  const biasFor = (load) => {
    const L = normalizeLoad(load);
    let bias = 0; let reason = null;
    // 1) Running down → something restful (restorative overall, or mentally restful).
    if (energyBalance < 0 && isRestful(L)) {
      bias += b; reason = "You've been running down — something restful?";
    }
    // 2) Restful time hasn't been landing → shift the lean toward creative work.
    if (restorativeFlat) {
      if (L.creative > 0) { bias += b; reason = "Rest's felt flat lately — a creative project?"; }
      else if (isRestful(L)) { bias -= b; }
    }
    // 3) Charged + important work looming → a mentally-demanding focused block.
    if (energyBalance > 0 && pressure > cfg.priorityPressureHigh && L.mental > 0) {
      bias += b; reason = 'Momentum and things due — a focused block?';
    }
    // 4) Charged + nothing pressing → something creative or social you enjoy.
    if (energyBalance > 0 && pressure <= cfg.priorityPressureHigh && (L.creative > 0 || L.social > 0)) {
      bias += b; reason = reason || 'Nothing pressing — time for something you enjoy?';
    }
    return { bias, reason };
  };
  return { trained: true, energyBalance, pressure, restorativeFlat, biasFor };
}

/**
 * The load character of the most recently finished thing — for the variety nudge.
 *
 * ⚠️ IT WALKED `schedule.tasks`, WHERE A MATERIALISED OCCURRENCE HAS NEVER LIVED
 * — the ninth instance of the bug `ratedSamples()` was created to stop, and the
 * one `design/TODO.md` E-5 had open. A recurring session is built fresh by
 * `getTasksForWeek` and thrown away, so the gym you finished an hour ago was
 * invisible here and the nudge compared you against whatever one-off happened to
 * be last.
 *
 * Measured on the real library, sweeping every hour 08:00–22:00 over 21 days
 * (315 hours): **91 hours (29%) had a recurring session as the true most-recent
 * finished item**, and in **30 of them (10%) the variety axis actually differed**
 * — `mental→social`, `creative→social`, `null→social`. Where it differed the
 * ranking moved hard: up to 45 of 46 candidates reordered, max rank delta 16,
 * because `varietyPenalty` is 0.15 against a fit score spanning ~1.0.
 *
 * A single-point check at the export's own timestamp shows NO difference — the
 * axes happen to agree there. This needed the sweep to see, which is why it sat
 * open: it is invisible to exactly the kind of test anyone would write for it.
 *
 * Two weeks, not one: at 09:00 on a Monday the last finished thing is usually in
 * the week behind you, and a one-week walk returns null for the whole morning.
 */
function lastFinishedLoad(schedule, now) {
  const pool = [
    ...schedule.getTasksForWeek(weekStartOf(now)),
    ...schedule.getTasksForWeek(addDays(weekStartOf(now), -7)),
  ];
  let last = null;
  for (const t of pool) {
    if (t.chunking) continue; // a bookkeeping parent is not a thing you finished
    if (t.completion === null || t.startTime.getTime() > now.getTime()) continue;
    if (!last || t.startTime > last.startTime) last = t;
  }
  return last ? loadOf(schedule, last) : null;
}

/**
 * Ranked library activities that fit `opts.opening`, gently steered by load
 * character. Read-only.
 * @returns [{ activity, load, duration, score, reasons: string[] }]
 */
export function suggestActivities(schedule, now = new Date(), opts = {}) {
  const cfg = suggestCfg(schedule.config);
  const opening = opts.opening;
  const limit = opts.limit ?? 5;
  // ⚠️ `tags` NARROWS THE POOL BEFORE THE LIMIT, and that order is the whole
  // point. `WhatToDoPanel` used to take the top `limit` and filter the survivors
  // afterwards, so picking a category showed you nothing unless one of its
  // activities happened to make an unfiltered top five. Measured on a real
  // library of 49: **7 of 9 categories and 23 of 31 tags returned an empty
  // panel** while 2–7 fitting activities sat in each. Filtering first returns at
  // least one pick for 9 of 9 and 31 of 31, at every opening tested.
  //
  // The user's rule, and it is the acceptance criterion: "if I click a category
  // at least one should show up."
  const filterTags = Array.isArray(opts.tags) && opts.tags.length ? opts.tags : null;
  if (!opening || opening.minutes <= 0) return [];
  const openMin = opening.minutes;

  const steer = steerBias(schedule, now);
  const lastLoad = lastFinishedLoad(schedule, now);
  const vAxis = lastLoad ? dominantAxis(lastLoad) : null;

  // Reserve-aware nudge: the axis you're most depleted on RIGHT NOW (today's battery
  // up to `now`). Favour activities that give it back, avoid ones that deepen it —
  // so the picker steers away from bottoming you out (design/RECONCILIATION.md).
  const reserve = reserveAt(schedule, now);
  let worst = null; let worstVal = 0;
  for (const a of LOAD_AXES) if (reserve[a] < worstVal) { worstVal = reserve[a]; worst = a; }

  // ── TODOS are in the pool (design/TODO-LIST.md §4.1, §8.3). ───────────────
  // A todo is an Activity, so it is scored by the same arithmetic. Two things
  // are different about it, and BOTH are rules about how the LIST is made up —
  // like "tasks first" — never terms in the score:
  //
  //   1. A todo due today or overdue goes ABOVE the library (the tier below).
  //      A due date is discrete in the user's own terms, and "due today" traces
  //      to something they typed. As a score bonus it would be exactly the
  //      predicate-inside-a-sum §3.1 forbids.
  //   2. One of the `limit` places is KEPT for the best-fitting todo (after the
  //      slice). Ranked as a plain activity a todo never made the five at all:
  //      0 of 70 openings against a real 49-activity library, median rank
  //      20–50, because the steering bias goes to restful buckets and ties
  //      break by label. "Offered when you have the energy" was "never offered".
  const todayKey = dateKey(now);
  const todosOnly = !!opts.todosOnly;
  const todos = schedule.todos || [];
  const pool = todosOnly ? todos : [...schedule.activities, ...todos];
  const ranked = pool
    .filter((a) => a.durationMin <= openMin) // fits the opening
    .filter((a) => !filterTags || (a.tags || []).some((t) => filterTags.includes(t)))
    .map((a) => {
      const load = loadOf(schedule, a);
      const duration = a.durationFor(openMin);
      const fitScore = a.durationMax > 0 ? Math.min(1, duration / a.durationMax) : 1;
      const { bias, reason } = steer.biasFor(load);
      const axis = dominantAxis(load);
      const variety = vAxis && axis === vAxis ? -cfg.varietyPenalty : 0;
      let reserveBias = 0; let reserveReason = null;
      if (worst) {
        if (load[worst] < 0) { reserveBias = cfg.reserveBias; reserveReason = `Your ${worst} reserve is low — something that gives it back?`; }
        else if (load[worst] > 0) { reserveBias = -cfg.reserveBias; }
      }
      const score = cfg.fitWeight * fitScore + bias + variety + reserveBias;
      const rs = [`fills your ${openingLabel(openMin)} opening`];
      if (bias > 0 && reason) rs.push(reason);
      else if (reserveBias > 0 && reserveReason) rs.push(reserveReason);
      const isTodo = !!a.isTodo;
      // 'today' | 'overdue' | null. Overdue STAYS lifted until done or deleted
      // (§8.5): neutral in wording, never dropped back down the list.
      // The date itself is the caller's to show (`deadline`), once — not also
      // folded into `reasons`, where it was printed a second time.
      const due = isTodo && a.isDueBy(todayKey) ? (a.deadline === todayKey ? 'today' : 'overdue') : null;
      return {
        activity: a, load, duration, score, reasons: rs, isTodo, due, deadline: isTodo ? a.deadline : null,
      };
    });
  // ⚠️ THE TIER, THEN THE SCORE — and before the limit, for the reason `tags`
  // narrows before it: lifted afterwards, a due todo ranked 40th has already
  // been sliced away. Among due todos, the longest-overdue comes first.
  ranked.sort((x, y) => (
    Number(!!y.due) - Number(!!x.due)
    || (x.due && y.due ? String(x.deadline).localeCompare(String(y.deadline)) : 0)
    || y.score - x.score
    || x.activity.label.localeCompare(y.activity.label)
  ));
  const top = ranked.slice(0, limit);
  // `limit > 1`: with a single place, keeping it for a todo would mean the best
  // activity is never the answer at all.
  if (!todosOnly && limit > 1 && !top.some((r) => r.isTodo)) {
    const best = ranked.find((r) => r.isTodo);
    if (best) {
      if (top.length >= limit) top[top.length - 1] = best;
      else top.push(best);
    }
  }
  return top;
}

/**
 * The todos that CANNOT be offered a "Do it now" at this moment — longer than
 * the opening, or there is no opening at all — so the panel can still show
 * that they exist (design/TODO-LIST.md §8.3 P-4).
 *
 * Without this they vanished: `suggestActivities` filters to what fits, and
 * with no opening it returns nothing, so the todos filter said "nothing is
 * waiting" over a list of four. Read-only. Due ones first, oldest first.
 *
 * @returns {{ todo: Todo, needsMin: number }[]}
 */
export function waitingTodos(schedule, now = new Date(), opts = {}) {
  const opening = opts.opening;
  const openMin = opening && opening.minutes > 0 ? opening.minutes : 0;
  const filterTags = Array.isArray(opts.tags) && opts.tags.length ? opts.tags : null;
  const todayKey = dateKey(now);
  return (schedule.todos || [])
    .filter((t) => t.durationMin > openMin)
    .filter((t) => !filterTags || (t.tags || []).some((x) => filterTags.includes(x)))
    .map((t) => ({ todo: t, needsMin: t.durationMin, due: t.isDueBy(todayKey) }))
    // Due first, then whatever has a date (soonest first), then the undated.
    .sort((x, y) => (
      Number(y.due) - Number(x.due)
      || Number(!!y.todo.deadline) - Number(!!x.todo.deadline)
      || String(x.todo.deadline || '').localeCompare(String(y.todo.deadline || ''))
      || x.todo.label.localeCompare(y.todo.label)
    ));
}

/**
 * Instantiate an activity into the opening at `start`, filling it
 * (clamp(opening, min, max)) — the "Do it now" commit. Goes in as an ordinary
 * flexible task via resolveDropConflicts, so displacement behaves as it would for
 * any hand-placed task. Mutates.
 *
 * ⚠️ A REFUSAL IS HONOURED, and it was not. `resolveDropConflicts` answers
 * `rejected` (a pinned, fixed, protected or finished task is in the way) or
 * `occurrenceMenu` (a repeating one is) — and this returned only
 * `{ task, displaced }`, so the new task stayed where it was, on top of the
 * thing that refused it, and the panel toasted success. Measured: "Walk" placed
 * 10:00 straight across a fixed 10:00 lecture. The same defect `doItNow` had for
 * tasks (D-15). Nothing has been displaced when either answer comes back (both
 * return before the eviction loop), so undoing it is removing the one task.
 *
 * @returns {{ task: Task|null, displaced: Task[], rejected?: boolean, reason?: string }}
 */
export function placeActivity(schedule, given, start, openingMin, opts = {}) {
  // ── A TODO is done by being placed, and leaves its list in this same call
  // (design/TODO-LIST.md §2, §9.2). ──────────────────────────────────────────
  //
  // ⚠️ LOOKED UP BY ID, not trusted as handed in. The panel holds the object it
  // rendered; by the time "Do it now" is pressed a second tap may already have
  // placed it, or a sync may have removed it (done on the other device) or
  // REPLACED the instance (`upsertTodoFromJSON`). A todo that is no longer in
  // the list is not done twice — that is the whole duplicate-task bug (M-3).
  const isTodo = !!(given && given.isTodo);
  const activity = isTodo ? (schedule.todos || []).find((t) => t.id === given.id) : given;
  if (isTodo && !activity) return { task: null, displaced: [], gone: true };

  const duration = activity.durationFor(openingMin);
  // Only carry an EXPLICIT activity override onto the task; otherwise leave load
  // null so the task derives its energy from its tags (loadForTask) — that way the
  // picker's prediction and the placed task can't disagree (design/RECONCILIATION.md).
  const task = schedule.addFlexible({
    title: activity.label,
    tags: [...activity.tags],
    priority: activity.priority ?? undefined,
    startTime: new Date(start),
    endTime: addMinutes(new Date(start), duration),
    placedBy: 'user',
    load: activity.load ?? null,
    // Back-link to the template this came from (EDITOR-REDESIGN §7.1). Read by
    // activityUsage for the "most used" sort. It records that you CHOSE this
    // activity — never that you skipped one (P-1, see the boundary note at the
    // top of this file).
    //
    // ⚠️ NOT for a todo. Its template is about to be deleted, nothing reads the
    // link, and a todo's id must not be mistaken for a library activity's.
    activityId: isTodo ? null : activity.id,
  });
  const res = schedule.resolveDropConflicts(task, opts.now ? { now: opts.now } : {});
  if (res && (res.rejected || res.occurrenceMenu)) {
    schedule.removeTask(task.id);
    const reason = res.reason
      || (res.occurrence ? `Conflicts with repeating: ${res.occurrence.title}` : `${activity.label} would not fit there`);
    return { task: null, displaced: [], rejected: true, reason };
  }
  // ⚠️ ONLY NOW, after the placement has actually stood. Removing it before the
  // refusal check would delete a todo for a task that was never placed.
  if (isTodo) schedule.removeTodo(activity.id);
  return { task, displaced: (res && res.displaced) || [] };
}
