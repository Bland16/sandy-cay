// Schedule.js — the orchestrator (SPEC §1.3). Holds tasks/zones/config/model,
// exposes the full public surface, and delegates to the focused engine modules.

import { Task } from './Task.js';
import { Zone } from './Zone.js';
import { Bucket } from './Bucket.js';
import { Activity } from './Activity.js';
import { makeId } from './ids.js';
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
import { energyBudget as runEnergyBudget, energyCalibration as runEnergyCalibration } from './energy.js';
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
    this.learning = init.model instanceof LearningModule
      ? init.model
      : LearningModule.fromJSON(init.model, this.config);
    this._snapshots = init.snapshots ? { ...init.snapshots } : {};
    // Week-rollover bookkeeping (R-7): the dateKey of the last week the user was
    // seen in, or null on a first-ever run. Persisted, because a rollover the
    // app can't remember is a rollover it fires again on every reload.
    this._lastSeenWeek = init.lastSeenWeek || null;
    this._dismissed = init.dismissed ? { ...init.dismissed } : {};
    this._changeCount = 0;
    // A save from an older model feature-layout can't be scored against the new
    // vector — retrain from the rated tasks now (weights are disposable; the
    // ratings persist). One-time, until it's re-saved with the current layout.
    if (this.learning.needsRetrain) this.retrain();
  }

  // ---- weight / model helpers used by placement -------------------------
  _weights() {
    const w = { ...this.config.weights };
    if (this.learning.sampleCount < this.config.coldStartRatings) w.preference = 0;
    return normalizeWeights(w);
  }

  _modelScore(task, slot) {
    if (this.learning.sampleCount < this.config.coldStartRatings) return 0;
    return this.learning.modelScore(task, slot);
  }

  _expand(task, ws) {
    return expandRecurrence(task, ws);
  }

  /** Occupied intervals for placement, excluding a given task. */
  _occupiedExcluding(task, ws) {
    const reals = intervalsOf(
      this.tasks.filter((t) => t !== task && t.id !== (task && task.id) && !t.chunking && !t.recurrence),
    );
    const occs = this.tasks
      .filter((t) => t.recurrence)
      .flatMap((t) => intervalsOf(expandRecurrence(t, ws)));
    return reals.concat(occs);
  }

  _place(task, opts = {}) {
    const from = opts.from || new Date();
    const ws = weekStartOf(from);
    const occupied = opts.occupied || this._occupiedExcluding(task, ws);
    return placeTask(this, task, { ...opts, from, occupied });
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
    this._touch();
    return t;
  }

  addZone(data) {
    const z = new Zone(data);
    this._uniqueInColl(z, this.zones);
    this.zones.push(z);
    this._touch();
    return z;
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

  /** The bucket that claims this task (first tag match), or null. */
  bucketForTask(task) {
    const tags = task && task.tags ? task.tags : [];
    return this.buckets.find((b) => tags.some((t) => b.tags.includes(t))) || null;
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
    const rated = this.tasks.filter((t) => t.satisfaction && typeof t.satisfaction.overall === 'number');
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
      config: this.config,
      model: this.learning.toJSON(),
      // The planned baseline has to survive a reload or the Wrap report can
      // only ever diff a week against itself. Already JSON-safe (epoch ms).
      snapshots: this._snapshots,
      lastSeenWeek: this._lastSeenWeek,
      dismissed: this._dismissed,
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
      model: json.model,
      // Absent on every save written before this shipped — an old file loads as
      // a schedule with no baselines, which is exactly right. schemaVersion
      // stays 1: this is an additive key, not a migration.
      snapshots: json.snapshots,
      lastSeenWeek: json.lastSeenWeek,
      dismissed: json.dismissed,
    });
  }
}
