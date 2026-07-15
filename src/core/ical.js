// ical.js — iCalendar (RFC 5545) import/export, and the task↔event mapping that
// the Google Calendar push/pull reuses. Pure JS, no DOM, no network (§12).
//
// Recurrence is the one thing that maps cleanly both ways:
//   our periods  → RRULE FREQ=WEEKLY;INTERVAL=n;BYDAY=MO,WE,FR
//   'skip'       → EXDATE
//   'move'/'add' → a second VEVENT carrying RECURRENCE-ID (an override)
//
// Everything else does not survive the round trip, and we don't pretend it does:
// a calendar event has a summary, a description, times and a colour. It has no
// pinned, type, priority, deadline, tags, chunking or satisfaction. On export we
// stash those in X-SANDYCAY-* properties (which Google drops, but Apple/Outlook
// and our own re-import keep). On import, anything without them lands as a
// `fixed` task — an event with a time is, by definition, an anchor.

import { Task } from './Task.js';
import { addMinutes } from './time.js';

const DAY_TO_BYDAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };
const BYDAY_TO_DAY = Object.fromEntries(Object.entries(DAY_TO_BYDAY).map(([k, v]) => [v, k]));

const pad = (n) => String(n).padStart(2, '0');

/** Local floating time — no Z. The user's 09:00 is 09:00 wherever they open it. */
export function toICSDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

/** Parse both floating (20260713T090000) and UTC (…Z) forms. */
export function fromICSDate(s) {
  const m = String(s).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', , z] = m;
  if (z) {
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, 0, 0));
    return new Date(utc.getTime()); // local Date at the same instant
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, 0, 0);
}

/** RFC 5545 wants CRLF and long lines folded at 75 octets. */
function fold(line) {
  if (line.length <= 75) return line;
  const out = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    out.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) out.push(` ${rest}`);
  return out.join('\r\n');
}

const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const unescapeText = (s) => String(s ?? '').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

/** A task's active recurrence period → an RRULE, or null. */
export function toRRULE(task) {
  if (!task.recurrence) return null;
  const period = (task.recurrence.periods || []).find((p) => !p.effectiveUntil) || (task.recurrence.periods || [])[0];
  if (!period || !(period.windows || []).length) return null;
  const days = period.windows.map((w) => DAY_TO_BYDAY[w.day]).filter(Boolean);
  if (!days.length) return null;
  const parts = ['FREQ=WEEKLY'];
  const interval = period.interval ?? 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  parts.push(`BYDAY=${[...new Set(days)].join(',')}`);
  if (period.effectiveUntil) parts.push(`UNTIL=${toICSDate(period.effectiveUntil)}`);
  return parts.join(';');
}

/** RRULE → the windows/interval half of a recurrence (times come from DTSTART). */
export function fromRRULE(rrule, start, end) {
  if (!rrule) return null;
  const kv = {};
  for (const p of String(rrule).split(';')) {
    const [k, v] = p.split('=');
    if (k) kv[k.toUpperCase()] = v;
  }
  if ((kv.FREQ || '').toUpperCase() !== 'WEEKLY') return null; // only weekly maps to our model
  const startHHMM = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endHHMM = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const byday = (kv.BYDAY || '').split(',').map((d) => BYDAY_TO_DAY[d.trim().toUpperCase()]).filter(Boolean);
  const days = byday.length ? byday : [Object.values(BYDAY_TO_DAY)[(start.getDay() + 6) % 7]];
  return {
    periods: [{
      windows: days.map((day) => ({ day, start: startHHMM, end: endHHMM })),
      interval: kv.INTERVAL ? Number(kv.INTERVAL) : 1,
      effectiveFrom: null,
      effectiveUntil: kv.UNTIL ? fromICSDate(kv.UNTIL) : null,
    }],
    anchorDate: new Date(start.getTime()),
    exceptions: [],
  };
}

/**
 * Sandy Cay tasks → an iCalendar document.
 * @param {Task[]} tasks — expand recurrence NO further than the parents; a
 *   recurring parent exports as one VEVENT + RRULE, not N copies.
 */
export function toICS(tasks, { calName = 'Sandy Cay', now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sandy Cay//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];
  const stamp = toICSDate(now);

  for (const t of tasks) {
    if (t.isOccurrence) continue; // the parent carries the pattern
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${t.id}@sandy-cay`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toICSDate(t.startTime)}`);
    lines.push(`DTEND:${toICSDate(t.endTime)}`);
    lines.push(fold(`SUMMARY:${escapeText(t.title)}`));
    if (t.details) lines.push(fold(`DESCRIPTION:${escapeText(t.details)}`));
    if (t.tags && t.tags.length) lines.push(fold(`CATEGORIES:${t.tags.map(escapeText).join(',')}`));

    const rrule = toRRULE(t);
    if (rrule) {
      lines.push(`RRULE:${rrule}`);
      const skips = (t.recurrence.exceptions || []).filter((e) => e.action === 'skip');
      // A moved session is also an EXDATE at its old slot + an override VEVENT.
      const moved = (t.recurrence.exceptions || []).filter((e) => e.action === 'move' || e.action === 'add');
      const exdates = [...skips, ...moved.filter((e) => e.action === 'move')]
        .map((e) => toICSDate(atLocal(e.date, hhmmOf(t, e.date))))
        .filter(Boolean);
      if (exdates.length) lines.push(fold(`EXDATE:${exdates.join(',')}`));
    }

    // Ours, and only ours: Google drops X- props, our own re-import keeps them.
    lines.push(`X-SANDYCAY-TYPE:${t.type}`);
    if (t.pinned) lines.push('X-SANDYCAY-PINNED:TRUE');
    if (t.priority != null) lines.push(`X-SANDYCAY-PRIORITY:${t.priority}`);
    if (t.deadline) lines.push(`X-SANDYCAY-DEADLINE:${toICSDate(t.deadline)}`);
    lines.push('END:VEVENT');

    // Overrides: a relocated or extra session becomes its own VEVENT.
    for (const ex of (t.recurrence && t.recurrence.exceptions) || []) {
      if (ex.action !== 'move' && ex.action !== 'add') continue;
      if (!ex.start || !ex.end) continue;
      const hostKey = ex.toDate || ex.date;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${t.id}@sandy-cay`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`RECURRENCE-ID:${toICSDate(atLocal(ex.date, hhmmOf(t, ex.date)))}`);
      lines.push(`DTSTART:${toICSDate(atLocal(hostKey, ex.start))}`);
      lines.push(`DTEND:${toICSDate(atLocal(hostKey, ex.end))}`);
      lines.push(fold(`SUMMARY:${escapeText(t.title)}`));
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** 'YYYY-MM-DD' + 'HH:MM' → local Date. */
function atLocal(dateKeyStr, hhmm = '00:00') {
  const [y, m, d] = String(dateKeyStr).split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0);
}

/** The pattern's start time on a given date — for an EXDATE/RECURRENCE-ID. */
function hhmmOf(task, dateKeyStr) {
  const period = (task.recurrence.periods || [])[0];
  if (!period) return '00:00';
  const d = atLocal(dateKeyStr);
  const dayKey = Object.keys(DAY_TO_BYDAY)[(d.getDay() + 6) % 7];
  const w = (period.windows || []).find((x) => x.day === dayKey) || (period.windows || [])[0];
  return w ? w.start : '00:00';
}

/** Unfold continuation lines, then split into key/params/value. */
function parseLines(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  return unfolded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * iCalendar → plain event records (not Tasks — mapping is a separate step so a
 * caller can filter first).
 * @returns {{uid,summary,description,categories:string[],start,end,rrule,recurrenceId,x:{}}[]}
 */
export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of parseLines(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { categories: [], x: {} }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(';')[0].toUpperCase();
    switch (key) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescapeText(value); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'CATEGORIES': cur.categories = value.split(',').map((s) => unescapeText(s).trim()).filter(Boolean); break;
      case 'DTSTART': cur.start = fromICSDate(value); break;
      case 'DTEND': cur.end = fromICSDate(value); break;
      case 'RRULE': cur.rrule = value; break;
      case 'RECURRENCE-ID': cur.recurrenceId = fromICSDate(value); break;
      default:
        if (key.startsWith('X-SANDYCAY-')) cur.x[key.replace('X-SANDYCAY-', '').toLowerCase()] = value;
    }
  }
  return events.filter((e) => e.start);
}

/**
 * Tag rules for importing someone else's calendar. A calendar event has no
 * tags, so a tag has to come from somewhere real:
 *   - `#hashtag` in the summary/description (stripped from the title)
 *   - CATEGORIES (real .ics files have it; Google doesn't emit it)
 *   - a caller-supplied tag for the whole source (e.g. "this is my Work calendar")
 * @returns {{tags:string[], title:string}}
 */
export function deriveTags(event, { sourceTags = [] } = {}) {
  const found = new Set(sourceTags);
  for (const c of event.categories || []) found.add(c.toLowerCase());
  const text = `${event.summary || ''} ${event.description || ''}`;
  for (const m of text.matchAll(/#([\p{L}\p{N}_-]+)/gu)) found.add(m[1].toLowerCase());
  const title = String(event.summary || 'Untitled').replace(/#[\p{L}\p{N}_-]+/gu, '').replace(/\s{2,}/g, ' ').trim();
  return { tags: [...found], title: title || 'Untitled' };
}

/**
 * Event record → Task. Anything the calendar couldn't carry gets an honest
 * default: an event with a fixed time is a `fixed` anchor.
 */
export function eventToTask(event, { sourceTags = [] } = {}) {
  const { tags, title } = deriveTags(event, { sourceTags });
  const start = event.start;
  const end = event.end && event.end > start ? event.end : addMinutes(start, 60);
  const x = event.x || {};
  const t = new Task({
    title,
    details: event.description || '',
    tags,
    type: x.type === 'flexible' ? 'flexible' : 'fixed',
    pinned: String(x.pinned || '').toUpperCase() === 'TRUE',
    priority: x.priority ? Number(x.priority) : 3,
    startTime: start,
    endTime: end,
    deadline: x.deadline ? fromICSDate(x.deadline) : null,
    placedBy: 'user', // it came from a real calendar; don't let re-optimize wander it
  });
  const rec = fromRRULE(event.rrule, start, end);
  if (rec) t.recurrence = rec;
  return t;
}

/**
 * Filter + map a parsed calendar into Tasks.
 * @param {object} opts.tagFilter — only keep events carrying one of these tags
 *   ([] / null = keep everything).
 */
export function importEvents(events, { sourceTags = [], tagFilter = null, from = null, to = null } = {}) {
  const wanted = (tagFilter || []).map((s) => s.toLowerCase()).filter(Boolean);
  const out = [];
  for (const e of events) {
    if (e.recurrenceId) continue; // overrides ride with their parent; skip for now
    if (from && e.start < from) continue;
    if (to && e.start >= to) continue;
    const { tags } = deriveTags(e, { sourceTags });
    if (wanted.length && !tags.some((t) => wanted.includes(t))) continue;
    out.push(eventToTask(e, { sourceTags }));
  }
  return out;
}
