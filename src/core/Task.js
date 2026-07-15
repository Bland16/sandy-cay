// Task.js — the Task class (SPEC §1.1). All date fields are Date instances with
// seconds zeroed. Every instance round-trips via toJSON()/fromJSON() at
// schemaVersion 1.

import { makeId } from './ids.js';
import {
  zeroSeconds,
  addMinutes,
  minutesBetween,
  daysBetween,
  dayStart,
  dateToJSON,
  dateFromJSON,
} from './time.js';

const DEFAULT_DURATION = 60;

function emptyHistory() {
  return { moveCount: 0, displacedCount: 0, rippleCount: 0, carriedCount: 0 };
}

export class Task {
  constructor(data = {}) {
    if (!data.title || String(data.title).trim() === '') {
      throw new Error('Task requires a title (the only required field).');
    }
    this.title = String(data.title);
    this.id = data.id || makeId(this.title);
    this.details = data.details ?? '';
    this.tags = Array.isArray(data.tags) ? [...data.tags] : [];
    this.type = data.type === 'fixed' ? 'fixed' : 'flexible';
    this.pinned = data.pinned ?? false;
    this.priority = clampPriority(data.priority ?? 3);

    // Time. startTime defaults to "now-ish" only when omitted; callers that care
    // about determinism always pass explicit dates.
    const start = data.startTime ? zeroSeconds(new Date(data.startTime)) : zeroSeconds(new Date());
    let end = data.endTime ? zeroSeconds(new Date(data.endTime)) : addMinutes(start, DEFAULT_DURATION);
    // Guard: end <= start → swap; equal → +defaultDuration (SPEC §1.1).
    if (end.getTime() < start.getTime()) {
      const tmp = start;
      this.startTime = end;
      this.endTime = tmp;
    } else if (end.getTime() === start.getTime()) {
      this.startTime = start;
      this.endTime = addMinutes(start, DEFAULT_DURATION);
    } else {
      this.startTime = start;
      this.endTime = end;
    }

    this.deadline = data.deadline ? zeroSeconds(new Date(data.deadline)) : null;
    this.placedBy = data.placedBy === 'user' ? 'user' : 'auto';
    this.schedulingWarning = data.schedulingWarning ?? false;
    // Non-color info flag for the "placed outside zone — due Wed" badge (SPEC
    // §2.2). Distinct from schedulingWarning (physics failure). null | string.
    this.schedulingInfo = data.schedulingInfo ?? null;
    this.missedDeadline = data.missedDeadline ?? false;
    this.completion = data.completion ?? null;
    this.satisfaction = data.satisfaction ? { ...data.satisfaction } : null;
    this.history = data.history ? { ...emptyHistory(), ...data.history } : emptyHistory();
    this.recurrence = data.recurrence ? reviveRecurrence(data.recurrence) : null;
    this.occurrenceData = data.occurrenceData ? { ...data.occurrenceData } : {};
    this.chunking = data.chunking ? reviveChunking(data.chunking) : null;
    this.parentId = data.parentId ?? null;
    // Virtual-occurrence marker: set on materialized recurrence occurrences.
    this.isOccurrence = data.isOccurrence ?? false;
    this.occurrenceDate = data.occurrenceDate ?? null; // 'YYYY-MM-DD'
  }

  // ---- geometry ----------------------------------------------------------
  getDuration() {
    if (!this.startTime || !this.endTime) return 0;
    return Math.max(0, minutesBetween(this.startTime, this.endTime));
  }

  getDayIndex(weekStartDate) {
    return daysBetween(weekStartDate, this.startTime);
  }

  overlaps(other) {
    return (
      this.startTime.getTime() < other.endTime.getTime() &&
      other.startTime.getTime() < this.endTime.getTime()
    );
  }

  // ---- mutation (drag / edit) -------------------------------------------
  /** Move so startTime = newStart, preserving duration. Marks placedBy:'user'
   *  and increments moveCount. What a drag calls. */
  moveTo(newStart, { markUser = true, countMove = true } = {}) {
    const dur = this.getDuration();
    this.startTime = zeroSeconds(new Date(newStart));
    this.endTime = addMinutes(this.startTime, dur);
    if (markUser) this.placedBy = 'user';
    if (countMove) this.history.moveCount += 1;
    return this;
  }

  /** Move to the same time-of-day on newDay (delegates to moveTo). */
  bump(newDay, opts = {}) {
    const target = new Date(newDay.getTime());
    target.setHours(this.startTime.getHours(), this.startTime.getMinutes(), 0, 0);
    return this.moveTo(target, opts);
  }

  /** Internal reposition used by the engine (autoSchedule / displacement /
   *  ripple): does NOT flip placedBy to 'user'. */
  placeAt(newStart, { countMove = false } = {}) {
    const dur = this.getDuration();
    this.startTime = zeroSeconds(new Date(newStart));
    this.endTime = addMinutes(this.startTime, dur);
    if (countMove) this.history.moveCount += 1;
    return this;
  }

  /** Resize by adjusting endTime (start anchored). */
  resizeTo(newEnd) {
    let end = zeroSeconds(new Date(newEnd));
    if (end.getTime() <= this.startTime.getTime()) {
      end = addMinutes(this.startTime, 15); // min duration 15 (OD-1)
    }
    this.endTime = end;
    return this;
  }

  hasProtectedTag(protectedTags) {
    return this.tags.some((t) => protectedTags.includes(t));
  }

  /** Immovable to the engine: pinned OR fixed OR protected-tag. */
  isAnchored(protectedTags = []) {
    return this.pinned || this.type === 'fixed' || this.hasProtectedTag(protectedTags);
  }

  // ---- copy semantics (7C) ----------------------------------------------
  /** clone(): SAME id. Internal only — drag ghosts, optimistic edits. Never
   *  enters tasks[]. */
  clone() {
    return new Task(this.toJSON());
  }

  /** duplicate(): NEW id; resets completion/satisfaction/history/placedBy;
   *  recurrence NOT copied. */
  duplicate() {
    const json = this.toJSON();
    delete json.id;
    json.completion = null;
    json.satisfaction = null;
    json.history = emptyHistory();
    json.placedBy = 'auto';
    json.recurrence = null;
    json.occurrenceData = {};
    json.schedulingWarning = false;
    json.schedulingInfo = null;
    json.missedDeadline = false;
    return new Task(json);
  }

  // ---- serialization -----------------------------------------------------
  toJSON() {
    return {
      schemaVersion: 1,
      id: this.id,
      title: this.title,
      details: this.details,
      tags: [...this.tags],
      type: this.type,
      pinned: this.pinned,
      priority: this.priority,
      startTime: dateToJSON(this.startTime),
      endTime: dateToJSON(this.endTime),
      deadline: dateToJSON(this.deadline),
      placedBy: this.placedBy,
      schedulingWarning: this.schedulingWarning,
      schedulingInfo: this.schedulingInfo,
      missedDeadline: this.missedDeadline,
      completion: this.completion,
      satisfaction: this.satisfaction ? { ...this.satisfaction } : null,
      history: { ...this.history },
      recurrence: recurrenceToJSON(this.recurrence),
      occurrenceData: { ...this.occurrenceData },
      chunking: chunkingToJSON(this.chunking),
      parentId: this.parentId,
      isOccurrence: this.isOccurrence,
      occurrenceDate: this.occurrenceDate,
    };
  }

  static fromJSON(json) {
    return new Task({
      ...json,
      startTime: dateFromJSON(json.startTime),
      endTime: dateFromJSON(json.endTime),
      deadline: dateFromJSON(json.deadline),
    });
  }
}

function clampPriority(p) {
  const n = Math.round(Number(p));
  if (Number.isNaN(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

// ---- recurrence (de)serialization ---------------------------------------
function reviveRecurrence(rec) {
  return {
    periods: (rec.periods || []).map((p) => ({
      windows: (p.windows || []).map((w) => ({ ...w })),
      interval: p.interval ?? 1,
      effectiveFrom: p.effectiveFrom ? dateFromJSON(p.effectiveFrom) : null,
      effectiveUntil: p.effectiveUntil ? dateFromJSON(p.effectiveUntil) : null,
    })),
    anchorDate: rec.anchorDate ? dateFromJSON(rec.anchorDate) : dayStart(new Date()),
    exceptions: (rec.exceptions || []).map((e) => ({ ...e })),
  };
}

function recurrenceToJSON(rec) {
  if (!rec) return null;
  return {
    periods: rec.periods.map((p) => ({
      windows: p.windows.map((w) => ({ ...w })),
      interval: p.interval,
      effectiveFrom: dateToJSON(p.effectiveFrom),
      effectiveUntil: dateToJSON(p.effectiveUntil),
    })),
    anchorDate: dateToJSON(rec.anchorDate),
    exceptions: rec.exceptions.map((e) => ({ ...e })),
  };
}

function reviveChunking(ch) {
  return {
    totalMinutes: ch.totalMinutes,
    minChunk: ch.minChunk,
    maxChunk: ch.maxChunk,
    range: {
      from: ch.range?.from ? dateFromJSON(ch.range.from) : null,
      until: ch.range?.until ? dateFromJSON(ch.range.until) : null,
    },
  };
}

function chunkingToJSON(ch) {
  if (!ch) return null;
  return {
    totalMinutes: ch.totalMinutes,
    minChunk: ch.minChunk,
    maxChunk: ch.maxChunk,
    range: { from: dateToJSON(ch.range?.from), until: dateToJSON(ch.range?.until) },
  };
}
