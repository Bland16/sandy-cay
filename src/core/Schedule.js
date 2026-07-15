// Schedule.js — the orchestrator (SPEC §1.3). Holds tasks/zones/config/model,
// exposes the full public surface, and delegates to the focused engine modules.

import { Task } from './Task.js';
import { Zone } from './Zone.js';
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
import { overpackCheck } from './detectors.js';

const UPDATE_WHITELIST = [
  'title', 'details', 'tags', 'priority', 'deadline', 'pinned', 'type',
  'startTime', 'endTime', 'completion', 'satisfaction', 'recurrence', 'occurrenceData',
];

export class Schedule {
  constructor(init = {}) {
    this.config = makeConfig(init.config);
    this.tasks = (init.tasks || []).map((t) => (t instanceof Task ? t : Task.fromJSON(t)));
    this.zones = (init.zones || []).map((z) => (z instanceof Zone ? z : Zone.fromJSON(z)));
    this.learning = init.model instanceof LearningModule
      ? init.model
      : LearningModule.fromJSON(init.model, this.config);
    this._snapshots = {};
    this._changeCount = 0;
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
  addFixed(data) {
    const t = new Task({ ...data, type: 'fixed' });
    this.tasks.push(t);
    if (!data.startTime) this._place(t, { from: data.from });
    this._touch();
    return t;
  }

  addFlexible(data) {
    const t = new Task({ ...data, type: 'flexible' });
    this.tasks.push(t);
    // 7A defaults cascade: placed immediately via scored placement.
    if (!data.startTime) this._place(t, { from: data.from });
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

  whatToDo(now = new Date()) {
    return runWhatToDo(this, now);
  }

  // ---- engine ------------------------------------------------------------
  autoSchedule(opts = {}) {
    const res = runAutoSchedule(this, opts);
    const ws = opts.weekStart ? weekStartOf(opts.weekStart) : weekStartOf(opts.now || new Date());
    res.overpack = overpackCheck(this, ws, this.config);
    this._touch();
    return res;
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
      config: this.config,
      model: this.learning.toJSON(),
    };
  }

  static fromJSON(json) {
    return new Schedule({
      config: json.config,
      tasks: (json.tasks || []).map((t) => Task.fromJSON(t)),
      zones: (json.zones || []).map((z) => Zone.fromJSON(z)),
      model: json.model,
    });
  }
}
