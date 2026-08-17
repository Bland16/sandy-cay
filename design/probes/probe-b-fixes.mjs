// probe-b-fixes.mjs — proposed diffs, applied to a COPY of src/ in a temp dir
// and executed. src/ itself is never touched. Every patch asserts that its
// anchor string was found, so a stale diff fails loudly instead of silently
// proving nothing. Fixed dates only (sharp edge #8).
//
// Run: node design/probes/probe-b-fixes.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(os.tmpdir(), 'probe-b-fixed');
const line = (s = '') => console.log(s);

// ---------------------------------------------------------------- copy src/
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'src'), path.join(OUT, 'src'), { recursive: true });

const patches = [];
function patch(rel, anchor, replacement, label) {
  const p = path.join(OUT, rel);
  // Normalise CRLF so multi-line anchors match regardless of checkout style.
  const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(anchor)) throw new Error(`PATCH ANCHOR NOT FOUND (${label}) in ${rel}`);
  fs.writeFileSync(p, src.replace(anchor, replacement));
  patches.push(label);
}

// ============================== FIX 1 — placement.js findBestSlot occupied ===
patch(
  'src/core/placement.js',
  `    const dayOccupied = occupied.filter((iv) => iv.end > dayWindowBounds(config, d).start && iv.start < dayWindowBounds(config, d).end);`,
  `    // Sliced by the CALENDAR DAY, not by \`config.windows\`. Since SPEC §2.1's
    // amendment a zone defines the window for its own tags and is no longer
    // clipped to the day window — so an hour that is inside a zone but outside
    // \`config.windows\` was filtered out here and then walked as if free, and
    // placement landed straight on top of an existing task. Stock config is
    // enough to hit it: Sunday opens at 10:00, so any Sunday-morning zone does.
    // \`walkGaps\` re-filters per window, so a wider slice is safe.
    const dayFrom = dayStart(d);
    const dayTo = addDays(dayFrom, 1);
    const dayOccupied = occupied.filter((iv) => iv.end > dayFrom && iv.start < dayTo);`,
  'FIX1 placement.js findBestSlot dayOccupied',
);

// ============================== FIX 2 — Schedule.js _occupiedExcluding ======
patch(
  'src/core/Schedule.js',
  `  /** Occupied intervals for placement, excluding a given task. */
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
  }`,
  `  /**
   * Occupied intervals for placement, excluding a given task.
   *
   * ⚠️ The range is the SEARCH range, not one week. \`findBestSlot\` runs
   * \`from … from + config.maxPlacementLookahead\` (3 days), which crosses the
   * Sunday/Monday seam — so expanding recurrence for \`weekStart(from)\` alone
   * left the placer blind to next Monday's lecture and it scheduled straight
   * through it. Sharp edge #3, and \`recurrenceIntervals\` is the helper that
   * edge names; every other occupied-set builder in the engine already uses it.
   */
  _occupiedExcluding(task, from, to) {
    const reals = intervalsOf(
      this.tasks.filter((t) => t !== task && t.id !== (task && task.id) && !t.chunking && !t.recurrence),
    );
    return reals.concat(recurrenceIntervals(this, from, to));
  }

  _place(task, opts = {}) {
    const from = opts.from || new Date();
    // The same upper bound \`findBestSlot\` will use, so the occupied set covers
    // every day the search can reach.
    const to = opts.to ? new Date(opts.to) : addDays(from, this.config.maxPlacementLookahead);
    const occupied = opts.occupied || this._occupiedExcluding(task, from, to);
    return placeTask(this, task, { ...opts, from, occupied });
  }`,
  'FIX2 Schedule.js _occupiedExcluding',
);
patch(
  'src/core/Schedule.js',
  `  intervalsOf,
  placeTask,
} from './placement.js';`,
  `  intervalsOf,
  placeTask,
  recurrenceIntervals,
} from './placement.js';`,
  'FIX2 Schedule.js import recurrenceIntervals',
);

// ============================== FIX 3 — conflicts.js displacement ===========
patch(
  'src/core/conflicts.js',
  `    // Rebuilt EVERY pass, deliberately. intervalsOf snapshots the Date objects,
    // and placeTask assigns fresh ones when it re-places a task — so a snapshot
    // taken before this loop still describes the slot the previous evictee just
    // vacated, and every later evictee is placed blind on top of it. evacuate.js
    // and carryOver.js already recompute inside their loops; this must too.
    const others = intervalsOf(
      schedule.tasks.filter((t) => t !== droppedTask && !t.chunking && !t.recurrence),
    ).concat(
      schedule.tasks.filter((t) => t.recurrence).flatMap((t) => intervalsOf(expandRecurrence(t, ws))),
    );
    // occupied = everyone except the evicted target, including the dropped task.
    const occupied = others
      .filter((iv) => iv.task !== target && iv.task.id !== target.id)
      .concat([{ start: droppedTask.startTime, end: droppedTask.endTime, task: droppedTask }]);
    let from = opts.from ? new Date(opts.from) : dayStart(target.startTime);
    if (from.getTime() < now.getTime()) from = new Date(now.getTime());
    const to = opts.to ? new Date(opts.to) : addDays(from, schedule.config.maxPlacementLookahead);`,
  `    // The SEARCH RANGE first, because the occupied set has to span it. This
    // used to expand recurrence for \`ws\` alone while the search ran three days
    // from the target's own day — so displacing a Saturday task walked straight
    // through Monday's recurring lecture (sharp edge #3).
    let from = opts.from ? new Date(opts.from) : dayStart(target.startTime);
    if (from.getTime() < now.getTime()) from = new Date(now.getTime());
    const to = opts.to ? new Date(opts.to) : addDays(from, schedule.config.maxPlacementLookahead);
    // Rebuilt EVERY pass, deliberately. intervalsOf snapshots the Date objects,
    // and placeTask assigns fresh ones when it re-places a task — so a snapshot
    // taken before this loop still describes the slot the previous evictee just
    // vacated, and every later evictee is placed blind on top of it. evacuate.js
    // and carryOver.js already recompute inside their loops; this must too.
    const others = intervalsOf(
      schedule.tasks.filter((t) => t !== droppedTask && !t.chunking && !t.recurrence),
    ).concat(recurrenceIntervals(schedule, from, to));
    // occupied = everyone except the evicted target, including the dropped task.
    const occupied = others
      .filter((iv) => iv.task !== target && iv.task.id !== target.id)
      .concat([{ start: droppedTask.startTime, end: droppedTask.endTime, task: droppedTask }]);`,
  'FIX3 conflicts.js displacement occupied',
);
patch(
  'src/core/conflicts.js',
  `import { placeTask, intervalsOf } from './placement.js';`,
  `import { placeTask, intervalsOf, recurrenceIntervals } from './placement.js';`,
  'FIX3 conflicts.js import recurrenceIntervals',
);

// ============================== FIX 8 — park never on a blocked day =========
patch(
  'src/core/placement.js',
  `    const from = searchOpts.from ? new Date(searchOpts.from) : new Date();
    const windows = computeWindows(schedule, task, from, { ignoreZone: true });
    const wStart = windows[0] ? windows[0].start : dayWindowBounds(config, from).start;`,
  `    const from = searchOpts.from ? new Date(searchOpts.from) : new Date();
    // A BLOCKED day has no windows, and the old fallback reached past
    // \`computeWindows\` to \`dayWindowBounds\` — parking an automatically-placed
    // task on a day the user had told the scheduler to stay out of (D-6). Walk
    // to the first day that has a window. The park is a last resort to keep the
    // task VISIBLE; it is not a way into a day you closed.
    let parkDay = dayStart(from);
    let windows = computeWindows(schedule, task, parkDay, { ignoreZone: true });
    for (let i = 0; windows.length === 0 && isDayBlocked(schedule, parkDay) && i < 14; i += 1) {
      parkDay = addDays(parkDay, 1);
      windows = computeWindows(schedule, task, parkDay, { ignoreZone: true });
    }
    const wStart = windows[0] ? windows[0].start : dayWindowBounds(config, parkDay).start;`,
  'FIX8 placement.js park skips blocked days',
);
patch(
  'src/core/placement.js',
  `    best = { slot: { start, end: addMinutes(start, task.getDuration() || config.defaultDuration) }, score: 0, day: dayStart(from) };`,
  `    best = { slot: { start, end: addMinutes(start, task.getDuration() || config.defaultDuration) }, score: 0, day: dayStart(parkDay) };`,
  'FIX8 placement.js park day',
);

// ============================== FIX 5 — zone window ordering ================
// Core-side half only (the editor half is a .jsx diff, given in the report):
// a non-positive window can never yield a reversed interval.
patch(
  'src/core/placement.js',
  `function zoneIntervalsOnDay(zone, date) {
  const key = dayKeyOf(date);
  return zone.windowsForDay(key).map((w) => ({ start: atTime(dayStart(date), w.start), end: atTime(dayStart(date), w.end) }));
}`,
  `function zoneIntervalsOnDay(zone, date) {
  const key = dayKeyOf(date);
  return zone.windowsForDay(key)
    .map((w) => ({ start: atTime(dayStart(date), w.start), end: atTime(dayStart(date), w.end) }))
    // A window whose end is not after its start (a 22:00→02:00 night zone typed
    // into two unordered <input type="time">s) produced a REVERSED interval:
    // nothing could fit it, so the task relaxed out of its own zone wearing an
    // "outside zone" badge, and the exclusive reservation silently evaporated
    // for everyone else too. Dropping it here does not fix the user's typo —
    // ZonesEditor has to stop creating one — but it keeps a reversed interval
    // out of subtractIntervals, which otherwise returns OVERLAPPING windows.
    .filter((iv) => iv.end.getTime() > iv.start.getTime());
}`,
  'FIX5 placement.js drop non-positive zone windows',
);

// ============================== FIX 4 — deadline edge conversion ===========
// Design A: convert at the UI edge, exactly as ZonesEditor and Commitment do.
// The engine's meaning ("must end BEFORE this instant") is untouched, so
// generate.js:308 (`deadline: commitment.until`, already the exclusive bound)
// needs no change at all — that is the argument for A over "make the engine
// treat midnight as end-of-day".
patch(
  'src/ui/components/panels/AddTaskPanel.jsx',
  `      deadline: deadline ? dateFromKey(deadline) : null,`,
  `      // The picker names the LAST DAY you may work on it; the engine's
      // deadline is a half-open "must end before" instant. Convert at the edge,
      // exactly as the zone editor and Commitment#engineInputForWeek do (sharp
      // edge #11). Without this, "due 20 Aug" barred the 20th outright and the
      // task had to be finished by the 19th.
      deadline: deadline ? untilAfterLastRun(dateFromKey(deadline)) : null,`,
  'FIX4 AddTaskPanel store',
);
patch(
  'src/ui/components/panels/AddTaskPanel.jsx',
  `  addDays, addMinutes, atTime, dateFromKey, dateKey, formatHHMM,`,
  `  addDays, addMinutes, atTime, dateFromKey, dateKey, formatHHMM, untilAfterLastRun,`,
  'FIX4 AddTaskPanel import',
);
patch(
  'src/ui/components/panels/TaskPanel.jsx',
  `value={editable.deadline ? dateKey(editable.deadline) : ''} onChange={(e) => upd({ deadline: e.target.value ? dateFromKey(e.target.value) : null })}`,
  `value={editable.deadline ? dateKey(lastRunDay(editable.deadline)) : ''} onChange={(e) => upd({ deadline: e.target.value ? untilAfterLastRun(dateFromKey(e.target.value)) : null })}`,
  'FIX4 TaskPanel input',
);
patch(
  'src/ui/components/panels/TaskPanel.jsx',
  `  untilAfterLastRun,`,
  `  untilAfterLastRun, lastRunDay,`,
  'FIX4 TaskPanel import',
);
patch(
  'src/ui/components/panels/AddProjectPanel.jsx',
  `import { addDays, sliceChunks, dateKey, dateFromKey } from '../../../core/index.js';`,
  `import { addDays, sliceChunks, dateKey, dateFromKey, untilAfterLastRun } from '../../../core/index.js';`,
  'FIX4 AddProjectPanel import',
);
patch(
  'src/ui/components/panels/AddProjectPanel.jsx',
  `range: { from: dateFromKey(from), until: dateFromKey(until) },`,
  `range: { from: dateFromKey(from), until: untilAfterLastRun(dateFromKey(until)) },`,
  'FIX4 AddProjectPanel range.until',
);
patch(
  'src/ui/components/TaskCard.jsx',
  `function shortDay(d) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}`,
  `function shortDay(d) {
  // A deadline is stored as the half-open "must end before" instant, so the day
  // to SHOW is the last one you may work on (sharp edge #11). Reading the raw
  // Date printed the day after — "due Fri" for a Thursday deadline.
  const last = new Date(d.getTime() - 1);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][last.getDay()];
}`,
  'FIX4 TaskCard due-day chip',
);

line(`patched ${patches.length}:`);
for (const p of patches) line(`  ${p}`);
line('');

// ---------------------------------------------------------------- harness
const impOld = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const impNew = async (rel) => import(pathToFileURL(path.join(OUT, rel)).href);

const T = await impOld('src/core/time.js');
const { dateFromKey, dateKey, formatHHMM } = T;
const fmt = (d) => `${dateKey(d)} ${formatHHMM(d)}`;
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

async function both(rel, fn) {
  const a = await impOld(rel);
  const b = await impNew(rel);
  line('  BEFORE: ' + (await fn(a)));
  line('  AFTER : ' + (await fn(b)));
}

// ---------------------------------------------------------------- FIX 1
line('=== FIX 1 — zone hours outside config.windows (stock config, Sunday) ===');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Gym', matchTags: ['gym'], exclusive: true, windows: [{ day: 'sun', start: '08:00', end: '10:00' }] });
  const e = s.addFixed({ title: 'Long run', tags: ['gym'], startTime: at('2026-08-23', '08:00'), durationMin: 60 });
  const t = s.addFlexible({ title: 'Stretch', tags: ['gym'], durationMin: 45, from: at('2026-08-23', '07:00'), to: at('2026-08-23', '23:00') });
  return `Stretch ${fmt(t.startTime)}-${fmt(t.endTime)} | overlaps Long run (08:00-09:00)? ${t.overlaps(e) ? 'YES — DOUBLE BOOKED' : 'no'}`;
});
line('');
line('  regression check — a zone fully inside the day window is unchanged:');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Study', matchTags: ['study'], exclusive: true, windows: [{ day: 'mon', start: '18:00', end: '22:00' }] });
  s.addFixed({ title: 'Seminar', tags: ['study'], startTime: at('2026-08-17', '18:00'), durationMin: 60 });
  const t = s.addFlexible({ title: 'Reading', tags: ['study'], durationMin: 60, from: at('2026-08-17', '08:00'), to: at('2026-08-17', '23:00') });
  return `Reading ${fmt(t.startTime)}`;
});

// ---------------------------------------------------------------- FIX 2
line('');
line('=== FIX 2 — 3-day lookahead crossing Sun -> Mon (recurring lecture) ===');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addFixed({
    title: 'Lecture', tags: ['class'], startTime: at('2026-08-10', '09:00'), durationMin: 120,
    recurrence: { anchorDate: at('2026-08-10', '09:00'), periods: [{ freq: 'weekly', windows: [{ day: 'mon', start: '09:00', end: '11:00' }] }] },
  });
  s.addFixed({ title: 'Sat busy', startTime: at('2026-08-22', '08:00'), durationMin: 15 * 60 });
  s.addFixed({ title: 'Sun busy', startTime: at('2026-08-23', '10:00'), durationMin: 13 * 60 });
  const t = s.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 120, from: at('2026-08-22', '08:00') });
  const lecture = s.getTasksForWeek(dateFromKey('2026-08-24')).find((x) => x.title === 'Lecture' && dateKey(x.startTime) === '2026-08-24');
  return `Essay ${fmt(t.startTime)}-${fmt(t.endTime)} | overlaps Mon 24th Lecture? ${lecture && t.overlaps(lecture) ? 'YES — DOUBLE BOOKED' : 'no'}`;
});

// ---------------------------------------------------------------- FIX 3
line('');
line('=== FIX 3 — displacement crossing Sun -> Mon ===');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addFixed({
    title: 'Lecture', tags: ['class'], startTime: at('2026-08-10', '09:00'), durationMin: 120,
    recurrence: { anchorDate: at('2026-08-10', '09:00'), periods: [{ freq: 'weekly', windows: [{ day: 'mon', start: '09:00', end: '11:00' }] }] },
  });
  const victim = s.addFlexible({ title: 'Victim', tags: ['study'], startTime: at('2026-08-22', '08:00'), durationMin: 120 });
  s.addFixed({ title: 'Sat rest', startTime: at('2026-08-22', '10:00'), durationMin: 13 * 60 });
  s.addFixed({ title: 'Sun rest', startTime: at('2026-08-23', '10:00'), durationMin: 13 * 60 });
  const dropped = s.addFixed({ title: 'Dropped', pinned: true, startTime: at('2026-08-22', '08:00'), durationMin: 120 });
  s.resolveDropConflicts(dropped, { now: at('2026-08-22', '07:00') });
  const lecture = s.getTasksForWeek(dateFromKey('2026-08-24')).find((x) => x.title === 'Lecture' && dateKey(x.startTime) === '2026-08-24');
  return `Victim ${fmt(victim.startTime)}-${fmt(victim.endTime)} | overlaps Mon 24th Lecture? ${lecture && victim.overlaps(lecture) ? 'YES — DOUBLE BOOKED' : 'no'}`;
});

// ---------------------------------------------------------------- FIX 8
line('');
line('=== FIX 8 — last-resort park landing on a blocked day ===');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.blockDay(dateFromKey('2026-08-17'));
  const t = s.addFlexible({ title: 'Overdue', durationMin: 60, deadline: at('2026-08-16', '12:00'), from: at('2026-08-17', '09:00') });
  return `parked ${fmt(t.startTime)} | on a blocked day? ${s.isDayBlocked(t.startTime) ? 'YES' : 'no'}`;
});
line('  regression check — an unblocked day still parks at `from`:');
await both('src/core/Schedule.js', ({ Schedule }) => {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  const t = s.addFlexible({ title: 'Overdue', durationMin: 60, deadline: at('2026-08-16', '12:00'), from: at('2026-08-17', '15:00') });
  return `parked ${fmt(t.startTime)}`;
});

// ---------------------------------------------------------------- FIX 5
line('');
line('=== FIX 5 — reversed zone window 22:00 -> 02:00 (core half only) ===');
await both('src/core/placement.js', async (P) => {
  const { Schedule } = await (P.__isNew ? impNew : impOld)('src/core/Schedule.js');
  return '';
});
for (const [label, imp] of [['BEFORE', impOld], ['AFTER ', impNew]]) {
  const { Schedule } = await imp('src/core/Schedule.js');
  const P = await imp('src/core/placement.js');
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Study', matchTags: ['study'], exclusive: true, windows: [{ day: 'mon', start: '22:00', end: '02:00' }] });
  const w = P.computeWindows(s, { tags: ['study'], deadline: null }, dateFromKey('2026-08-17'));
  const other = P.computeWindows(s, { tags: ['admin'], deadline: null }, dateFromKey('2026-08-17'));
  line(`  ${label}: matching=${w.map((x) => `${formatHHMM(x.start)}-${formatHHMM(x.end)}`).join('|') || '(none)'}`
     + `  non-matching=${other.map((x) => `${formatHHMM(x.start)}-${formatHHMM(x.end)}`).join('|') || '(none)'}`);
}
line('  (both are inert — the CORE patch only stops a reversed interval leaking');
line('   into subtractIntervals. The user-visible fix is the ZonesEditor diff.)');

// ---------------------------------------------------------------- FIX 4
line('');
line('=== FIX 4 — "due 20 Aug" must leave the 20th usable ===');
{
  const P0 = await impOld('src/core/placement.js');
  const { Schedule: S0 } = await impOld('src/core/Schedule.js');
  const T0 = await impOld('src/core/time.js');
  // The UI edge, before and after, expressed as the two expressions themselves.
  const typed = '2026-08-20';
  const storedBefore = T0.dateFromKey(typed);
  const storedAfter = T0.untilAfterLastRun(T0.dateFromKey(typed));
  line(`  user types "${typed}"`);
  line(`    BEFORE stored ${fmt(storedBefore)}   shown back as ${dateKey(storedBefore)}`);
  line(`    AFTER  stored ${fmt(storedAfter)}   shown back as ${dateKey(T0.lastRunDay(storedAfter))}`);
  for (const [label, dl] of [['BEFORE', storedBefore], ['AFTER ', storedAfter]]) {
    const s = new S0({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
    const w = P0.computeWindows(s, { tags: [], deadline: dl }, dateFromKey('2026-08-20'));
    const s2 = new S0({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
    for (const k of ['2026-08-17', '2026-08-18', '2026-08-19']) s2.addFixed({ title: `busy ${k}`, startTime: at(k, '08:00'), durationMin: 15 * 60 });
    const t = s2.addFlexible({ title: 'Essay', durationMin: 120, deadline: dl, from: at('2026-08-17', '08:00'), to: at('2026-08-21', '23:00') });
    line(`    ${label}: windows on the 20th = ${w.map((x) => `${formatHHMM(x.start)}-${formatHHMM(x.end)}`).join('|') || '(none)'}`
      + `  | with 17-19 full the task lands ${fmt(t.startTime)} warn=${t.schedulingWarning}`);
  }
  line('  (the engine is UNCHANGED; only what the edge stores moves. generate.js');
  line('   already stores the exclusive bound, so commitment sittings need no edit.)');
}

// ---------------------------------------------------------- FIX 5 (editor half)
line('');
line('=== FIX 5 (editor half) — ZonesEditor#orderWindow, run as a pure function ===');
{
  const shift = (hhmm, mins) => {
    const [h, m] = hhmm.split(':').map(Number);
    const t = Math.max(0, Math.min(24 * 60 - 1, h * 60 + m + mins));
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const orderWindow = (w, delta) => {
    const next = { ...w, ...delta };
    if (next.end > next.start) return next; // 'HH:MM' sorts as time
    if (delta.start !== undefined) {
      next.end = shift(next.start, 15);
      if (next.end <= next.start) next.start = shift(next.end, -15); // pinned at 23:59
    } else {
      next.start = shift(next.end, -15);
      if (next.end <= next.start) next.end = shift(next.start, 15); // pinned at 00:00
    }
    return next;
  };
  const cases = [
    [{ day: 'mon', start: '20:00', end: '23:00' }, { end: '02:00' }, 'END dragged back past START (the 22:00->02:00 case)'],
    [{ day: 'mon', start: '20:00', end: '23:00' }, { start: '23:30' }, 'START pushed past END'],
    [{ day: 'mon', start: '20:00', end: '23:00' }, { end: '20:00' }, 'made equal (degenerate)'],
    [{ day: 'mon', start: '20:00', end: '23:00' }, { end: '21:00' }, 'ordinary edit — must pass through untouched'],
    [{ day: 'mon', start: '06:00', end: '08:00' }, { start: '05:00' }, 'ordinary edit before the day window — untouched'],
    [{ day: 'mon', start: '00:15', end: '04:00' }, { end: '00:00' }, 'clamped at midnight'],
  ];
  for (const [w, delta, label] of cases) {
    const r = orderWindow(w, delta);
    line(`  ${label}`);
    line(`      ${w.start}-${w.end}  + ${JSON.stringify(delta)}  ->  ${r.start}-${r.end}   positive? ${r.end > r.start}`);
  }
}
