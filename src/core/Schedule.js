// Schedule.js — the orchestrator (SPEC §1.3). Holds tasks/zones/config/model,
// exposes the full public surface, and delegates to the focused engine modules.

import { Task } from './Task.js';
import { Zone } from './Zone.js';
import { Bucket } from './Bucket.js';
import { Activity } from './Activity.js';
import { DayNote } from './DayNote.js';
import { Commitment } from './Commitment.js';
import { RoutineInstance } from './RoutineInstance.js';
import { makeId } from './ids.js';
import { blendColors } from './color.js';
import { makeConfig } from './config.js';
import { normalizeWeights } from './scoring.js';
import { LearningModule } from './learning.js';
import {
  weekStart as weekStartOf,
  addDays,
  dayStart,
  sameDay,
  dateKey,
  clamp,
} from './time.js';
import {
  dayWindowBounds,
  dayCapacityMin,
  intervalsOf,
  placeTask,
  recurrenceIntervals,
} from './placement.js';
import { walkGaps, breakMinForFill, clampWindowToTimeOfDay } from './gaps.js';
import { expandRecurrence } from './recurrence.js';
import { autoSchedule as runAutoSchedule } from './autoSchedule.js';
import { resolveDropConflicts as runResolveDrop, chooseConflictStrategy as runChoose } from './conflicts.js';
import { rippleShift as runRipple } from './ripple.js';
import { evacuateDay as runEvacuate, blockRange as runBlockRange } from './evacuate.js';
import { carryOver as runCarryOver } from './carryOver.js';
import { addProject as runAddProject } from './projects.js';
import { getWeekLoad as runWeekLoad, getTagBreakdown as runTagBreakdown, snapshot as runSnapshot } from './queries.js';
import { whatToDo as runWhatToDo } from './whatToDo.js';
import { suggestActivities as runSuggest, placeActivity as runPlaceActivity } from './suggest.js';
import { energyBudget as runEnergyBudget, energyCalibration as runEnergyCalibration, reserveAt } from './energy.js';
import { planSittingSplit as runPlanSittingSplit, splitSitting as runSplitSitting } from './generate.js';
import { overpackCheck } from './detectors.js';

const UPDATE_WHITELIST = [
  'title', 'details', 'tags', 'priority', 'deadline', 'pinned', 'type',
  'startTime', 'endTime', 'completion', 'satisfaction', 'recurrence', 'occurrenceData',
];

export class Schedule {
  constructor(init = {}) {
    this.config = makeConfig(init.config);
    this.tasks = (init.tasks || []).map((t) => (t instanceof Task ? t : Task.fromJSON(t)));
    // The id counter (ids.js) resets every page load, so a task created after a
    // reload can be handed the same slug+suffix as one already saved with the same
    // title — e.g. two "Work on website" tasks colliding on `work-on-website-0001`.
    // A shared id makes `tasks.find(id===…)` return the WRONG task, so resizing the
    // second silently edited the first. Repair any collision already in the save.
    this._dedupeTaskIds();
    this.zones = (init.zones || []).map((z) => (z instanceof Zone ? z : Zone.fromJSON(z)));
    // Activity library (design/ACTIVITY-LIBRARY.md): buckets (categories + tag
    // groups), the activities inside them, and the set of retired tags. All
    // additive — absent on every save written before this shipped, which loads
    // clean; schemaVersion stays 1.
    this.buckets = (init.buckets || []).map((b) => (b instanceof Bucket ? b : Bucket.fromJSON(b)));
    this.activities = (init.activities || []).map((a) => (a instanceof Activity ? a : Activity.fromJSON(a)));
    // Same collision guard tasks get: slug(label) alone collides (two "New bucket"s
    // → one id), so repair any duplicate zone/bucket/activity id from an old save.
    this._dedupeIds(this.zones);
    this._dedupeIds(this.buckets);
    this._dedupeIds(this.activities);
    this.retiredTags = Array.isArray(init.retiredTags) ? [...init.retiredTags] : [];
    // Facts about days — holidays, breaks, birthdays. Additive: absent on
    // every save written before this and loads as empty, schemaVersion stays 1
    // (sharp edge #15). They consume no time and do not affect placement.
    this.dayNotes = (init.dayNotes || []).map((n) => (n instanceof DayNote ? n : DayNote.fromJSON(n)));
    this._dedupeIds(this.dayNotes);
    // Days the SCHEDULER stays out of (design/DAY-NOTES.md D-6). Held as
    // 'YYYY-MM-DD' strings for the same reason a day note is: a day has no time
    // of day, and a string cannot be misread as UTC midnight (sharp edge #4 in
    // a form that cannot occur). Additive, so old saves load empty and
    // schemaVersion stays 1 (#15).
    //
    // ⚠️ Blocked means "automatic placement stays out", NOT "you may not go
    // here". A hand drop still lands and What-To-Do still answers, because
    // opening the picker IS asking. That is R-1 applied honestly: a rule you
    // set yourself is the clearest case of one you are entitled to overrule.
    this.blockedDays = [...new Set((init.blockedDays || []).map(String))].sort();
    // Standing commitments — "2h of maths a week, all term"
    // (design/WEEKLY-PLANNING.md §2/§4). Additive, so old saves load empty and
    // schemaVersion stays 1 (sharp edge #15). ⚠️ That edge has now been sprung
    // THREE times, so: this is written by `toJSON`, read by `fromJSON`, AND
    // copied by `useEngine#replace` — all in this commit, not a later one.
    //
    // They hold no placement of their own. The sittings a commitment generates
    // are ordinary tasks carrying `parentId`, which is what keeps this a
    // GENERATOR rather than a new kind of thing on the week.
    this.commitments = (init.commitments || []).map((c) => (c instanceof Commitment ? c : Commitment.fromJSON(c)));
    this._dedupeIds(this.commitments);
    // Routine RUNS (design/ROUTINES.md R-A) — the frozen program for each run
    // of a routine, plus that run's one-time adjustments. The PLACEMENT is not
    // here: touchpoints carry `routineId`/`stepIndex` and are the only truth
    // about where anything is. See RoutineInstance.js for why it is a split.
    //
    // Additive, so old saves load empty and schemaVersion stays 1 (sharp edge
    // #15). ⚠️ That edge has been sprung THREE times, so this lands with ALL
    // FIVE halves in one commit: constructor, toJSON, fromJSON,
    // useEngine#replace, and summarizeImport + the Cabana's confirm.
    this.routineInstances = (init.routineInstances || [])
      .map((r) => (r instanceof RoutineInstance ? r : RoutineInstance.fromJSON(r)));
    this._dedupeIds(this.routineInstances);
    this.learning = init.model instanceof LearningModule
      ? init.model
      : LearningModule.fromJSON(init.model, this.config);
    this._snapshots = init.snapshots ? { ...init.snapshots } : {};
    // Week-rollover bookkeeping (R-7): the dateKey of the last week the user was
    // seen in, or null on a first-ever run. Persisted, because a rollover the
    // app can't remember is a rollover it fires again on every reload.
    this._lastSeenWeek = init.lastSeenWeek || null;
    this._dismissed = init.dismissed ? { ...init.dismissed } : {};
    // ⚠️ "I finished this early" — WEEKLY-PLANNING D-13. A map of
    // `${commitmentId}|${weekKey}` → true, meaning THIS commitment's amount for
    // THAT week is settled, whatever the sittings on the grid add up to.
    //
    // A STORED FLAG, and `Commitment.js` explicitly refuses to store one
    // (`lastFilled`: "a stored flag disagrees with reality the moment you delete
    // a sitting by hand"). That rule is answered, not ignored: `lastFilled` was
    // a CACHE OF SOMETHING DERIVABLE, and its failure was disagreeing with a
    // grid that already held the answer. This is a STATEMENT THE GRID CANNOT
    // MAKE — you may have done the work in a block that was never a generated
    // sitting, or away from the app entirely. There is nothing to derive it
    // from and nothing for it to contradict.
    this._commitmentDone = init.commitmentDone ? { ...init.commitmentDone } : {};
    this._changeCount = 0;
    // A save from an older model feature-layout can't be scored against the new
    // vector — retrain from the rated tasks now (weights are disposable; the
    // ratings persist). One-time, until it's re-saved with the current layout.
    if (this.learning.needsRetrain) this.retrain();
  }

  // ---- weight / model helpers used by placement -------------------------
  /**
   * ⚠️ TWO GATES, AND THEY ASK DIFFERENT QUESTIONS.
   *
   * `coldStartRatings` asks how much the user has typed. `learning.skill` asks
   * whether the fit actually beats predicting their average on ratings it did
   * not see — measured by grouped cross-validation inside `train`.
   *
   * The second one exists because the first cannot see the case that matters.
   * Measured (probe-learn-baselines.mjs), a user with NO real preference gets a
   * model with held-out MAE 0.0431 against 0.0260 for no model at all: it fits
   * noise, passes every count-based gate, and then steers their week with it.
   * An additive fit on interacting preferences (study good early, gym good
   * late) loses to a constant the same way. Neither is visible from a headcount.
   *
   * `skill` is null when there is too little to split honestly — that is "not
   * assessed", not "no skill", and it is treated as passing so a small honest
   * dataset is not punished for being small. Only a measured failure gates.
   */
  _modelIsTrustworthy() {
    if (this.learning.sampleCount < this.config.coldStartRatings) return false;
    return !(typeof this.learning.skill === 'number' && this.learning.skill <= 0);
  }

  _weights() {
    const w = { ...this.config.weights };
    if (!this._modelIsTrustworthy()) w.preference = 0;
    return normalizeWeights(w);
  }

  _modelScore(task, slot) {
    if (!this._modelIsTrustworthy()) return 0;
    return this.learning.modelScore(task, slot);
  }

  _expand(task, ws) {
    return expandRecurrence(task, ws);
  }

  /**
   * Occupied intervals for placement, excluding a given task.
   *
   * ⚠️ THE RANGE IS THE SEARCH RANGE, not one week. `findBestSlot` runs
   * `from … from + config.maxPlacementLookahead` (3 days), which crosses the
   * Sunday/Monday seam — so expanding recurrence for `weekStart(from)` alone
   * left the placer blind to next Monday's lecture and it scheduled straight
   * through it. Measured: a task added on a Saturday landed 08:00–10:00 on the
   * Monday, on top of a recurring 09:00 lecture, silently.
   *
   * Sharp edge #3, and `recurrenceIntervals` is the helper that edge names —
   * every other occupied-set builder in the engine already uses it. The new set
   * is a strict superset of the old (`recurrenceIntervals` starts at
   * `weekStart(from)`), so nothing can be lost.
   */
  _occupiedExcluding(task, from, to) {
    const reals = intervalsOf(
      this.tasks.filter((t) => t !== task && t.id !== (task && task.id) && !t.chunking && !t.recurrence),
    );
    return reals.concat(recurrenceIntervals(this, from, to));
  }

  /**
   * ⚠️ A CALLER'S RANGE IS A CEILING, NEVER A FLOOR BELOW THE ENGINE'S OWN
   * HORIZON.
   *
   * `AddTaskPanel` bounds a new flexible task to "the viewed week" —
   * `from … addDays(weekStart, 6)` — which is a sensible default on a Monday
   * and a DEGENERATE one at the end of the week. Added on the Sunday, that
   * range is `now … today`: a couple of hours, on the one day the person has
   * already lived. Nothing fits, so `placeTask` walks its whole ladder, fails
   * every rung, and reaches the last-resort park — which stacks the task at
   * `from`, on top of whatever is already sitting there, without moving it.
   *
   * Measured on the reported case (Sunday 30 Aug, a full day, deadline the
   * following Thursday): placed 21:30–22:30 across TWO existing tasks, neither
   * of them moved. The deadline was four days away and Monday was empty; the
   * search never looked past midnight because `to` said not to.
   *
   * The floor is `maxPlacementLookahead`, and deliberately not something new:
   * it is the horizon `findBestSlot` ALREADY defaults to when a caller names no
   * range at all, and the same constant `proximity` is normalised by, so it is
   * this engine's own word for "the near future". A caller asking for LESS than
   * that is asking for less than the default, which no caller means.
   *
   * It cannot run away, either — `placeTask` still clips the search to
   * `task.deadline`, so a deadline earlier than the floor still wins and a
   * distant one buys no more than three days.
   */
  _place(task, opts = {}) {
    const from = opts.from || new Date();
    const horizon = addDays(from, this.config.maxPlacementLookahead);
    // The same upper bound `findBestSlot` will use, so the occupied set covers
    // every day the search can actually reach.
    let to = opts.to ? new Date(opts.to) : horizon;
    if (to.getTime() < horizon.getTime()) to = horizon;
    const occupied = opts.occupied || this._occupiedExcluding(task, from, to);
    // `to` is passed explicitly — it now differs from `opts.to`, so spreading
    // `opts` after it would put the narrow range back.
    return placeTask(this, task, { ...opts, from, to, occupied });
  }

  // ---- CRUD --------------------------------------------------------------
  /** Guarantee `task.id` is unique among the current tasks (regenerate on clash).
   *  Call before pushing a freshly-created task — the id counter resets per load,
   *  so a new id can collide with one restored from storage. */
  _uniqueId(task) {
    while (this.tasks.some((x) => x !== task && x.id === task.id)) task.id = makeId(task.title);
    return task;
  }

  /** Repair any duplicate task ids already present (e.g. from a save written
   *  before the collision was fixed) by reissuing the later duplicate a fresh id. */
  _dedupeTaskIds() {
    const seen = new Set();
    for (const t of this.tasks) {
      if (seen.has(t.id)) while (seen.has(t.id) || this.tasks.some((x) => x !== t && x.id === t.id)) t.id = makeId(t.title);
      seen.add(t.id);
    }
  }

  /** The task collision guard, generalized to any {id,label} collection (Bucket/
   *  Activity/Zone). On add, keep a new item's id unique; on load, repair dupes.
   *  Fixes the two-new-buckets bug (design/RECONCILIATION.md, unique ids). */
  _uniqueInColl(item, coll) {
    while (coll.some((x) => x !== item && x.id === item.id)) item.id = makeId(item.label);
    return item;
  }

  _dedupeIds(coll) {
    const seen = new Set();
    for (const it of coll) {
      if (seen.has(it.id)) while (seen.has(it.id) || coll.some((x) => x !== it && x.id === it.id)) it.id = makeId(it.label);
      seen.add(it.id);
    }
  }

  addFixed(data) {
    const t = new Task({ ...data, type: 'fixed' });
    this._uniqueId(t);
    this.tasks.push(t);
    if (!data.startTime) this._place(t, { from: data.from, to: data.to });
    this._touch();
    return t;
  }

  addFlexible(data) {
    const t = new Task({ ...data, type: 'flexible' });
    this._uniqueId(t);
    this.tasks.push(t);
    // 7A defaults cascade: placed immediately via scored placement. `to` bounds
    // the search when the caller has a week in mind; without it the search runs
    // from..from+maxPlacementLookahead and can leak into the next week.
    if (!data.startTime) this._place(t, { from: data.from, to: data.to });
    this._touch();
    return t;
  }

  addProject(data) {
    const res = runAddProject(this, data);
    this._touch();
    return res;
  }

  addTask(data) {
    return data.type === 'fixed' ? this.addFixed(data) : this.addFlexible(data);
  }

  removeTask(id) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const [removed] = this.tasks.splice(i, 1);
    this._touch();
    return removed;
  }

  /**
   * Put a task back exactly as it was serialised — a RESTORE, not an edit.
   *
   * ⚠️ DELIBERATELY BYPASSES `UPDATE_WHITELIST`, and that is the whole point.
   * The whitelist exists to stop the UI writing fields a user is not editing:
   * `load`, `activityId`, `routineId`, `stepIndex`, `parentId`, `chunking`,
   * `history`, `energyAt`, `placedBy` are all absent from it, and `updateTask`
   * drops them silently. That is correct for a form and catastrophic for a
   * sync: adopting a task from Google through `updateTask` would quietly strip
   * it of everything the whitelist omits, every single time.
   *
   * So this is the door a store uses, and only a store. It takes a full
   * serialised task and replaces the instance wholesale, the per-task
   * equivalent of the footlocker import.
   */
  upsertTaskFromJSON(json) {
    const next = Task.fromJSON(json);
    const i = this.tasks.findIndex((t) => t.id === next.id);
    if (i >= 0) this.tasks[i] = next;
    else this.tasks.push(next);
    this._touch();
    return next;
  }

  /**
   * The same door for a day note (GS-11). A note arriving from Google replaces
   * the local instance wholesale rather than going through `updateDayNote`.
   *
   * `updateDayNote` happens to rebuild from `toJSON` and so would not drop
   * fields today — but it is a FORM's door, and the task side learned what
   * happens when a store borrows one: `updateTask`'s whitelist silently stripped
   * ten fields off every adopted task. A store gets its own door so a later
   * whitelist on the form cannot quietly break the sync.
   */
  upsertDayNoteFromJSON(json) {
    const next = DayNote.fromJSON(json);
    const i = this.dayNotes.findIndex((n) => n.id === next.id);
    if (i >= 0) this.dayNotes[i] = next;
    else this.dayNotes.push(next);
    this._touch();
    return next;
  }

  updateTask(id, changes) {
    const t = this.tasks.find((task) => task.id === id);
    if (!t) return null;
    let timeChanged = false;
    for (const key of Object.keys(changes)) {
      if (!UPDATE_WHITELIST.includes(key)) continue;
      if (key === 'startTime' || key === 'endTime') timeChanged = true;
      t[key] = changes[key];
    }
    if (timeChanged) t.placedBy = 'user';
    this._snapshotEnergy(t, changes);
    this._touch();
    return t;
  }

  /**
   * Record the energy reserve a task was begun under, at the moment it is first
   * rated. This is the substrate the learning model needs to answer "did I rate
   * this badly because I was already drained?" — a question it cannot ask today,
   * because `featureVector` has no energy terms and no history to give them.
   *
   * It MUST be captured at rating time and never recomputed. Deriving it later
   * from the current schedule would train the model on a day that never
   * happened, since tasks have since been added, moved and deleted.
   *
   * Taken one millisecond BEFORE the task starts, so it is the state you
   * arrived in rather than the state the task itself left you in — otherwise
   * cause and effect are conflated and the feature learns nothing.
   *
   * Written once. A later re-rating keeps the original snapshot, because the
   * reserve you were under has not changed just because your opinion has.
   */
  _snapshotEnergy(task, changes) {
    if (!changes || changes.satisfaction === undefined) return;
    if (!task.startTime) return;
    // Each field is written ONCE, on first rating. A later re-rating keeps the
    // original snapshot: the day you were under has not changed just because
    // your opinion has.
    if (!task.energyAt) task.energyAt = reserveAt(this, new Date(task.startTime.getTime() - 1));
    if (task.dayFillAtCompletion === null) task.dayFillAtCompletion = this._dayFillAt(task.startTime);
  }

  /** How full a day was, 0–1. Snapshotted at rating time, never derived later. */
  _dayFillAt(date) {
    const cap = dayCapacityMin(this.config, date) || 1;
    const mins = this.getTasksForDay(date)
      .filter((t) => !t.chunking)
      .reduce((n, t) => n + t.getDuration(), 0);
    return Math.min(1, mins / cap);
  }

  /**
   * Rate (or complete) one session of a recurring task. THE door for occurrence
   * lived data — see design/RATINGS-AND-LEARNING.md.
   *
   * It exists because the UI was hand-writing `parent.occurrenceData` in two
   * places, which meant `_snapshotEnergy` never fired for a session and the
   * rating context was never captured. Going through a method also means there
   * is one place to change when the shape grows again.
   */
  rateOccurrence(occurrence, patch = {}) {
    const parent = this.tasks.find((t) => t.id === (occurrence && occurrence.parentId));
    if (!parent || !occurrence.occurrenceDate) return null;
    const key = occurrence.occurrenceDate;
    const prev = parent.occurrenceData[key] || {};
    const entry = { ...prev, ...patch };
    if (patch.satisfaction !== undefined) {
      entry.satisfaction = { ...(prev.satisfaction || {}), ...patch.satisfaction };
    }
    // Stamp the context once, on first rating — the same rule and the same
    // reason as `_snapshotEnergy`. `at`/`endAt` are what make the session
    // reconstructable as a training sample AFTER the pattern has moved on.
    if (entry.satisfaction && !entry.at && occurrence.startTime) {
      entry.at = new Date(occurrence.startTime);
      entry.endAt = new Date(occurrence.endTime);
      entry.energyAt = reserveAt(this, new Date(occurrence.startTime.getTime() - 1));
      entry.dayFill = this._dayFillAt(occurrence.startTime);
    }
    parent.occurrenceData = { ...parent.occurrenceData, [key]: entry };
    this._touch();
    return entry;
  }

  /**
   * Every rated thing the model may learn from, from BOTH stores — ordinary
   * tasks and recurring sessions. The single door: `retrain` and
   * `energyCalibration` call this and nothing else.
   *
   * This bug is why it exists. Both consumers walked `this.tasks`, where a
   * materialized occurrence has never lived — `getTasksForWeek` builds them
   * fresh and throws them away — so twelve rated gym sessions trained NOTHING
   * and `sampleCount` stayed at 0. Two readers, one of them forgotten.
   *
   * A session with no stamped `at` is a rating from before that fix and is
   * skipped deliberately: reconstructing its time from today's pattern would be
   * a guess presented as data (design/RATINGS-AND-LEARNING.md §6).
   */
  ratedSamples() {
    const out = [];
    for (const t of this.tasks) {
      if (t.chunking) continue;
      if (t.satisfaction) out.push(t);
      for (const key of Object.keys(t.occurrenceData || {})) {
        const od = t.occurrenceData[key];
        if (!od || !od.satisfaction || !od.at) continue;
        const start = new Date(od.at);
        out.push(new Task({
          id: `${t.id}@${key}`,
          title: t.title,
          tags: [...t.tags],
          type: 'fixed',
          priority: t.priority,
          startTime: start,
          endTime: od.endAt ? new Date(od.endAt) : start,
          placedBy: 'auto',
          completion: od.completion ?? null,
          satisfaction: od.satisfaction,
          history: od.history ?? undefined,
          energyAt: od.energyAt ?? null,
          dayFillAtCompletion: od.dayFill ?? null,
          isOccurrence: true,
          occurrenceDate: key,
          parentId: t.id,
        }));
      }
    }
    return out;
  }

  addZone(data) {
    const z = new Zone(data);
    this._uniqueInColl(z, this.zones);
    this.zones.push(z);
    this._touch();
    return z;
  }

  addDayNote(data) {
    const n = new DayNote(data);
    this._uniqueInColl(n, this.dayNotes);
    this.dayNotes.push(n);
    this._touch();
    return n;
  }

  removeDayNote(id) {
    const i = this.dayNotes.findIndex((n) => n.id === id);
    if (i < 0) return null;
    const [gone] = this.dayNotes.splice(i, 1);
    this._touch();
    return gone;
  }

  updateDayNote(id, changes) {
    const n = this.dayNotes.find((x) => x.id === id);
    if (!n) return null;
    Object.assign(n, new DayNote({ ...n.toJSON(), ...changes, id: n.id }));
    this._touch();
    return n;
  }

  /** Every note covering a date — the day header's whole question. */
  notesForDate(date) {
    return this.dayNotes.filter((n) => n.coversDate(date));
  }

  // ---- standing commitments (design/WEEKLY-PLANNING.md §2/§4) -------------
  addCommitment(data) {
    const c = new Commitment(data);
    this._uniqueInColl(c, this.commitments);
    this.commitments.push(c);
    this._touch();
    return c;
  }

  updateCommitment(id, changes) {
    const c = this.commitments.find((x) => x.id === id);
    if (!c) return null;
    // Rebuilt through the constructor rather than `Object.assign`ed, so every
    // clamp (min ≤ max, hours that are not a number) applies to an EDIT and not
    // only to a creation. `updateDayNote` does the same, and the reason is the
    // field-by-field rebuild trap in reverse: a partial patch that skips
    // validation is how a maxSitting below its minSitting gets stored and then
    // generates nothing, silently.
    //
    // ⚠️ EXCEPT THE DATE SWAP, which must NOT apply to an edit. The constructor
    // swaps a backwards range, which is right for data ARRIVING backwards — but
    // on an edit it silently rewrites the field you just typed into. Reported
    // 2026-08-16, reproduced by design/probes/probe-date-edit-bug.mjs:
    //
    //     stored          from 2026-08-16  until 2026-08-29
    //     typed START =        2026-08-31
    //     stored          from 2026-08-29  until 2026-08-31   ← your date, in
    //                                                           the other field
    //
    // The user's real consequence: the term never started on the 31st, `from`
    // stayed near today, so the CURRENT week still overlapped the term and
    // "Lay out this week" scheduled a sitting at 22:21 that evening. The engine
    // was right; the model had thrown the typed value away.
    //
    // So an edit MOVES THE OTHER END instead. The field you touched is the one
    // you meant; the one you did not touch is free to give way.
    const next = { ...c.toJSON(), ...changes };
    if (changes.from !== undefined && changes.until === undefined && next.from > next.until) {
      next.until = next.from;
    } else if (changes.until !== undefined && changes.from === undefined && next.until < next.from) {
      next.from = next.until;
    }
    Object.assign(c, new Commitment({ ...next, id: c.id }));
    this._touch();
    return c;
  }

  // ---- D-13: "this week is done" ------------------------------------------
  //
  // ⚠️ THE MARK IS STORED, NOT ITS SIDE EFFECT. A "done" implemented by deleting
  // the remaining sittings and nothing else looks identical the moment you press
  // it and then quietly comes apart: the next `previewWeek` computes
  // `placedMin < owedMin`, calls the week `owes` again, and a top-up puts the
  // work straight back. The spec says to write it this way round.

  /** Key for one commitment's one week. */
  _doneKey(commitmentId, ws) {
    return `${commitmentId}|${dateKey(weekStartOf(ws))}`;
  }

  /** Has this commitment's week been settled by hand? */
  isCommitmentWeekDone(commitmentId, ws) {
    return this._commitmentDone[this._doneKey(commitmentId, ws)] === true;
  }

  /**
   * "I finished ESF 2 early — this week is done."
   *
   * Removes the sittings that have NOT happened yet and leaves the ones that
   * have (D-16). That split is `Task#isResolved()`, already the engine's word
   * for "a record, not a plan": `done`/`partial`/`skipped` stay, because the app
   * does not rewrite what happened; anything unresolved is a plan for work you
   * have just said is finished, so it goes.
   *
   * @returns {{ removed: Task[], kept: Task[] }}
   */
  markCommitmentWeekDone(commitmentId, ws) {
    this._commitmentDone[this._doneKey(commitmentId, ws)] = true;
    const mine = this.sittingsFor(commitmentId, ws);
    const removed = [];
    const kept = [];
    for (const t of mine) {
      if (t.isResolved()) kept.push(t);
      else { this.removeTask(t.id); removed.push(t); }
    }
    this._touch();
    return { removed, kept };
  }

  /**
   * Undo it. The week goes back to owing whatever the arithmetic says — which is
   * NOT necessarily what it owed before, because the unstarted sittings were
   * removed and are not resurrected. That is honest: un-marking says "I was
   * wrong, I am not finished", not "put my old plan back". Lay it out again to
   * get blocks, exactly as D-14's remove leaves you.
   */
  unmarkCommitmentWeekDone(commitmentId, ws) {
    delete this._commitmentDone[this._doneKey(commitmentId, ws)];
    this._touch();
    return true;
  }

  /**
   * D-14 — "remove this week's blocks". Clears the PLACEMENT, not the debt.
   *
   * Shares its whole mechanism with the mark above and differs in one thing: it
   * stores nothing. Removing unresolved sittings lowers `placedMin`, so D-11's
   * arithmetic raises `remainingMin` by exactly the same amount and the week
   * owes again with no code of its own. Resolved sittings stay for the same
   * reason they do there — you cannot delete work you actually did.
   */
  clearCommitmentWeek(commitmentId, ws) {
    const mine = this.sittingsFor(commitmentId, ws);
    const removed = [];
    const kept = [];
    for (const t of mine) {
      if (t.isResolved()) kept.push(t);
      else { this.removeTask(t.id); removed.push(t); }
    }
    this._touch();
    return { removed, kept };
  }

  removeCommitment(id) {
    const i = this.commitments.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const [gone] = this.commitments.splice(i, 1);
    this._touch();
    return gone;
  }

  /**
   * The sittings already laid out for a commitment — derived, never stored.
   *
   * "Has this week been laid out?" is answered by LOOKING, the same call the
   * "every weekday" dropdown makes rather than keeping a flag: a stored
   * `lastFilled` would be free to disagree with the tasks actually on the grid
   * the moment one is deleted by hand.
   *
   * ⚠️ `ws` is load-bearing once generation is weekly. Without it, a commitment
   * that has EVER been laid out looks laid out for every week, so week two
   * would never generate; and an automatic trigger checking the un-weeked
   * version would re-lay week one on every app open. Pass the week.
   *
   * Selection is by CALENDAR day, which is deliberate and needs sharp edge #5
   * addressed rather than ignored. The grid draws a 5am-anchored day, so a task
   * starting 00:00–04:59 belongs to the PREVIOUS column — and a surface that
   * selects by calendar week while placing by grid day is exactly the bug that
   * made a Monday 04:15 task render nowhere at all.
   *
   * It cannot bite here, because a GENERATED sitting can never start before
   * 05:00: `generateSittings` places only inside `computeWindows`, and the
   * earliest window `config` allows is 08:00 (10:00 on Sunday). Calendar day
   * and grid day therefore agree for every task this function selects, and
   * matching the generator's own calendar-day arithmetic is what keeps the
   * "this week owes" count and the generator from disagreeing.
   *
   * ⚠️ The assumption is `config.windows`, so if a window is ever allowed to
   * open before 05:00 this needs revisiting — along with anything that displays
   * these counts beside the grid.
   */
  sittingsFor(commitmentId, ws = null) {
    const mine = this.tasks.filter((t) => t.parentId === commitmentId && !t.chunking);
    if (!ws) return mine;
    const start = weekStartOf(ws);
    const first = dateKey(start);
    const last = dateKey(addDays(start, 6));
    // ISO keys sort chronologically, so this is a string comparison and cannot
    // be knocked out by a DST hour the way a millisecond range can.
    return mine.filter((t) => t.startTime && dateKey(t.startTime) >= first && dateKey(t.startTime) <= last);
  }

  // ---- routine runs (design/ROUTINES.md R-A) -----------------------------
  addRoutineInstance(data) {
    const r = data instanceof RoutineInstance ? data : new RoutineInstance(data);
    this._uniqueInColl(r, this.routineInstances);
    this.routineInstances.push(r);
    this._touch();
    return r;
  }

  /**
   * Remove a run AND its touchpoints — a routine is deleted as a group
   * (ROUTINES R-B), because half a laundry is not a thing you meant to keep.
   */
  removeRoutineInstance(id) {
    const i = this.routineInstances.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const [gone] = this.routineInstances.splice(i, 1);
    this.tasks = this.tasks.filter((t) => t.routineId !== id);
    this._touch();
    return gone;
  }

  /**
   * The touchpoints of a run, in chain order — DERIVED, never stored.
   *
   * Sorted by `stepIndex` rather than by time on purpose: the chain's ORDER is
   * the program's, and a touchpoint dragged out of sequence by hand should read
   * as "step 3, moved", not silently renumber itself. R-1 — your hand may put
   * it anywhere; it does not stop being the step it is.
   */
  touchpointsFor(routineId) {
    return this.tasks
      .filter((t) => t.routineId === routineId && !t.chunking)
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
  }

  /**
   * Is automatic placement barred from this day? (D-6.)
   *
   * The ONE predicate — engine and UI both ask it, so the tint on the grid and
   * the hole in the windows can never disagree. `zoneBands` is the cautionary
   * tale: it was reimplemented per surface and painted zones into weeks the
   * scheduler correctly saw as free (sharp edge #14).
   */
  isDayBlocked(date) {
    return this.blockedDays.includes(dateKey(date));
  }

  blockDay(date) {
    const k = dateKey(date);
    if (this.blockedDays.includes(k)) return false;
    this.blockedDays.push(k);
    this.blockedDays.sort();
    this._touch();
    return true;
  }

  unblockDay(date) {
    const k = dateKey(date);
    const i = this.blockedDays.indexOf(k);
    if (i < 0) return false;
    this.blockedDays.splice(i, 1);
    this._touch();
    return true;
  }

  removeZone(id) {
    const i = this.zones.findIndex((z) => z.id === id);
    if (i < 0) return null;
    const [removed] = this.zones.splice(i, 1);
    this._touch();
    return removed;
  }

  updateZone(id, changes) {
    const z = this.zones.find((zone) => zone.id === id);
    if (!z) return null;
    Object.assign(z, changes);
    this._touch();
    return z;
  }

  // ---- activity library (buckets / activities / retired tags) ------------
  addBucket(data) {
    const b = new Bucket(data);
    this._uniqueInColl(b, this.buckets);
    this.buckets.push(b);
    this._touch();
    return b;
  }

  removeBucket(id) {
    const i = this.buckets.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const [removed] = this.buckets.splice(i, 1);
    // Orphan its activities rather than delete them — a mis-click on a bucket
    // shouldn't silently destroy the activities the user authored inside it. The
    // Cabana surfaces orphans (bucketId === null) for reassignment.
    for (const a of this.activities) if (a.bucketId === id) a.bucketId = null;
    this._touch();
    return removed;
  }

  updateBucket(id, changes) {
    const b = this.buckets.find((x) => x.id === id);
    if (!b) return null;
    Object.assign(b, changes);
    this._touch();
    return b;
  }

  addActivity(data) {
    const a = new Activity(data);
    this._uniqueInColl(a, this.activities);
    this.activities.push(a);
    this._touch();
    return a;
  }

  removeActivity(id) {
    const i = this.activities.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const [removed] = this.activities.splice(i, 1);
    this._touch();
    return removed;
  }

  updateActivity(id, changes) {
    const a = this.activities.find((x) => x.id === id);
    if (!a) return null;
    Object.assign(a, changes);
    this._touch();
    return a;
  }

  /** Retire a tag: it disappears from *new*-task pickers, chips and the library,
   *  but stays on historical tasks and in insights (design: hide-from-new). */
  retireTag(tag) {
    if (tag && !this.retiredTags.includes(tag)) {
      this.retiredTags.push(tag);
      this._touch();
    }
    return this.retiredTags;
  }

  unretireTag(tag) {
    const i = this.retiredTags.indexOf(tag);
    if (i >= 0) {
      this.retiredTags.splice(i, 1);
      this._touch();
    }
    return this.retiredTags;
  }

  isTagRetired(tag) {
    return this.retiredTags.includes(tag);
  }

  /** EVERY bucket this task's tags touch, in bucket order.
   *  This is the same rule `energy.js#loadForTask` uses, so a task's colour and
   *  its energy are derived from the same set of buckets. (They used to
   *  disagree: bucketForTask took only the first match.) */
  bucketsForTask(task) {
    const tags = (task && task.tags) || [];
    return this.buckets.filter((b) => tags.some((t) => b.tags.includes(t)));
  }

  /** The single bucket that best claims this task, or null. Most tags matched
   *  wins; ties fall to bucket order, so it is stable across renders. Used when
   *  one colour is needed and a blend would be meaningless. */
  dominantBucketForTask(task) {
    const tags = (task && task.tags) || [];
    let best = null; let bestN = 0;
    for (const b of this.buckets) {
      const n = tags.filter((t) => b.tags.includes(t)).length;
      if (n > bestN) { best = b; bestN = n; }
    }
    return best;
  }

  /** The bucket that claims this task (first tag match), or null. */
  bucketForTask(task) {
    const tags = task && task.tags ? task.tags : [];
    return this.buckets.find((b) => tags.some((t) => b.tags.includes(t))) || null;
  }

  /** The tint for a task's card: a perceptual blend of its buckets' colours,
   *  falling back to the dominant bucket when the hues disagree too much for a
   *  blend to mean anything (see color.js). Returns null when no bucket matches.
   *  @returns { hex, buckets, blended } | null */
  tintForTask(task) {
    const matched = this.bucketsForTask(task);
    if (matched.length === 0) return null;
    const res = blendColors(matched.map((b) => b.color));
    if (res.hex && res.blended) return { hex: res.hex, buckets: matched, blended: true };
    const dom = this.dominantBucketForTask(task) || matched[0];
    return { hex: dom.color, buckets: matched, blended: false };
  }

  // ---- queries -----------------------------------------------------------
  getTasksForWeek(weekStartDate) {
    const ws = weekStartOf(weekStartDate);
    const out = [];
    for (const t of this.tasks) {
      if (t.chunking) continue; // bookkeeping parent, not a grid object
      if (t.recurrence) {
        out.push(...expandRecurrence(t, ws));
      } else {
        const idx = t.getDayIndex(ws);
        if (idx >= 0 && idx <= 6) out.push(t);
      }
    }
    return out.sort((a, b) => a.startTime - b.startTime);
  }

  getTasksForDay(date) {
    return this.getTasksForWeek(weekStartOf(date)).filter((t) => sameDay(t.startTime, date));
  }

  findFreeSlots({ from, to, durationMin, window = null, respectBreaks = true } = {}) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : addDays(start, 7);
    const dur = durationMin || this.config.defaultDuration;
    const slots = [];
    for (let d = dayStart(start); d.getTime() <= dayStart(end).getTime(); d = addDays(d, 1)) {
      const b = dayWindowBounds(this.config, d);
      const { start: winStart, end: winEnd } = clampWindowToTimeOfDay(b.start, b.end, window);
      if (winEnd.getTime() <= winStart.getTime()) continue;
      let lowerBound = winStart;
      if (sameDay(d, start) && start.getTime() > lowerBound.getTime()) lowerBound = start;
      const dayTasks = this.getTasksForDay(d);
      const occupied = intervalsOf(dayTasks);
      const cap = dayCapacityMin(this.config, d) || 1;
      const occMin = dayTasks.reduce((s, t) => s + t.getDuration(), 0);
      const breakMin = respectBreaks ? breakMinForFill(clamp(occMin / cap, 0, 1), this.config) : 0;
      const cands = walkGaps({ windowStart: lowerBound, windowEnd: winEnd, occupied, durationMin: dur, breakMin });
      slots.push(...cands);
    }
    return slots;
  }

  findFreeSlot(query) {
    return this.findFreeSlots(query)[0] ?? null;
  }

  getWeekLoad(weekStartDate) {
    return runWeekLoad(this, weekStartOf(weekStartDate));
  }

  getTagBreakdown(weekStartDate) {
    return runTagBreakdown(this, weekStartOf(weekStartDate));
  }

  whatToDo(now = new Date(), options = {}) {
    return runWhatToDo(this, now, options);
  }

  /** Library-activity fallback for "what to do" (Phase C). Read-only. */
  suggestActivities(now = new Date(), opts = {}) {
    return runSuggest(this, now, opts);
  }

  /** "Do it now" for a library activity: instantiate it into the opening. */
  placeActivity(activity, start, openingMin) {
    return runPlaceActivity(this, activity, start, openingMin);
  }

  /** Would "Do it now" split this sitting to fit the opening? (D-15.) Writes
   *  nothing — this is the question the panel asks before it acts. */
  planSittingSplit(task, opening) {
    return runPlanSittingSplit(this, task, opening);
  }

  /** Split it: the task becomes the piece you are starting, a sibling holds the
   *  rest. Returns null when it is not a splittable case. */
  splitSitting(task, opening) {
    const res = runSplitSitting(this, task, opening);
    if (res) this._touch();
    return res;
  }

  /** Deterministic energy budget for a day (design/ENERGY-MODEL.md, L-1). */
  energyBudget(date = new Date()) {
    return runEnergyBudget(this, date);
  }

  /** Whether the energy budget is calibrated yet (design/RECONCILIATION.md P-2). */
  energyCalibration() {
    return runEnergyCalibration(this);
  }

  // ---- engine ------------------------------------------------------------
  autoSchedule(opts = {}) {
    const res = runAutoSchedule(this, opts);
    const ws = opts.weekStart ? weekStartOf(opts.weekStart) : weekStartOf(opts.now || new Date());
    res.overpack = overpackCheck(this, ws, this.config);
    // §6J — capture "planned" at a week's FIRST autoSchedule, after the run, so
    // the baseline is the plan the engine actually made. Later runs (an explicit
    // Re-optimize on Thursday) must not overwrite it: the whole point of the
    // report's planned-vs-actual is that it remembers the original intent.
    const key = dateKey(ws);
    if (!this._snapshots[key]) this.snapshot(ws);
    this._touch();
    return res;
  }

  /** The stored "planned" baseline for a week, or null if none was captured
   *  (weeks that predate the snapshot wiring, or a week never auto-scheduled).
   *  The report omits planned-vs-actual entirely rather than inventing zeros. */
  plannedSnapshot(weekStartDate) {
    return this._snapshots[dateKey(weekStartOf(weekStartDate))] || null;
  }

  resolveDropConflicts(dropped, opts = {}) {
    const res = runResolveDrop(this, dropped, opts);
    this._touch();
    return res;
  }

  chooseConflictStrategy(cause, deltaMin, dayState) {
    return runChoose(cause, deltaMin, dayState, this.config);
  }

  rippleShift(pivot, deltaMin) {
    const res = runRipple(this, pivot, deltaMin);
    this._touch();
    return res;
  }

  evacuateDay(date, opts = {}) {
    const res = runEvacuate(this, date, opts);
    this._touch();
    return res;
  }

  blockRange(from, to, label = 'Blocked') {
    const res = runBlockRange(this, from, to, label);
    this._touch();
    return res;
  }

  carryOver(fromWeek, toWeek, opts = {}) {
    const res = runCarryOver(this, weekStartOf(fromWeek), weekStartOf(toWeek), opts);
    this._touch();
    return res;
  }

  snapshot(weekStartDate) {
    const ws = weekStartOf(weekStartDate);
    const rec = runSnapshot(this, ws);
    this._snapshots[dateKey(ws)] = rec;
    return rec;
  }

  // ---- week rollover (R-7) -----------------------------------------------
  /** dateKey of the last week the user was seen in, or null on a first run. */
  get lastSeenWeek() {
    return this._lastSeenWeek;
  }

  /** Record that the user has been present in the week containing `date`. */
  markWeekSeen(date) {
    const key = dateKey(weekStartOf(date));
    if (this._lastSeenWeek === key) return this._lastSeenWeek;
    this._lastSeenWeek = key;
    this._touch();
    return this._lastSeenWeek;
  }

  // ---- report suggestions (§7.2) -----------------------------------------
  /**
   * Suggestions the user has answered, by id. Persisted, because P-1 turns on
   * this: a "Let it go" that only hid the card would raise the identical
   * observation next Monday, and an app that asks the same question every week
   * until you say yes is nagging with extra steps.
   */
  get dismissedSuggestions() {
    return this._dismissed;
  }

  isSuggestionDismissed(id) {
    return Object.prototype.hasOwnProperty.call(this._dismissed, id);
  }

  /** Record that a suggestion was answered (either way) in a given week. */
  dismissSuggestion(id, atDate = null) {
    this._dismissed[id] = atDate ? dateKey(weekStartOf(atDate)) : true;
    this._touch();
    return this._dismissed[id];
  }

  // ---- learning ----------------------------------------------------------
  retrain(opts = {}) {
    // `Number.isFinite`, not `typeof === 'number'` — see learning.js#train.
    const rated = this.ratedSamples().filter((t) => Number.isFinite(t.satisfaction.overall));
    this.learning.train(rated, opts);
    this._touch();
    return this.learning.sampleCount;
  }

  // ---- persistence bookkeeping ------------------------------------------
  _touch() {
    this._changeCount += 1;
  }

  get changeCount() {
    return this._changeCount;
  }

  // ---- serialization -----------------------------------------------------
  toJSON() {
    return {
      schemaVersion: 1,
      tasks: this.tasks.map((t) => t.toJSON()),
      zones: this.zones.map((z) => z.toJSON()),
      buckets: this.buckets.map((b) => b.toJSON()),
      activities: this.activities.map((a) => a.toJSON()),
      retiredTags: [...this.retiredTags],
      dayNotes: this.dayNotes.map((n) => n.toJSON()),
      blockedDays: [...this.blockedDays],
      commitments: this.commitments.map((c) => c.toJSON()),
      routineInstances: this.routineInstances.map((r) => r.toJSON()),
      config: this.config,
      model: this.learning.toJSON(),
      // The planned baseline has to survive a reload or the Wrap report can
      // only ever diff a week against itself. Already JSON-safe (epoch ms).
      snapshots: this._snapshots,
      lastSeenWeek: this._lastSeenWeek,
      dismissed: this._dismissed,
      commitmentDone: this._commitmentDone,
    };
  }

  static fromJSON(json) {
    return new Schedule({
      config: json.config,
      tasks: (json.tasks || []).map((t) => Task.fromJSON(t)),
      zones: (json.zones || []).map((z) => Zone.fromJSON(z)),
      // Additive (design/ACTIVITY-LIBRARY.md): absent on old saves → empty, which
      // is exactly right. schemaVersion stays 1.
      buckets: (json.buckets || []).map((b) => Bucket.fromJSON(b)),
      activities: (json.activities || []).map((a) => Activity.fromJSON(a)),
      retiredTags: json.retiredTags,
      dayNotes: json.dayNotes,
      blockedDays: json.blockedDays,
      commitments: json.commitments,
      routineInstances: json.routineInstances,
      model: json.model,
      // Absent on every save written before this shipped — an old file loads as
      // a schedule with no baselines, which is exactly right. schemaVersion
      // stays 1: this is an additive key, not a migration.
      snapshots: json.snapshots,
      lastSeenWeek: json.lastSeenWeek,
      dismissed: json.dismissed,
      commitmentDone: json.commitmentDone,
    });
  }
}
