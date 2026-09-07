// design/CALENDAR-IMPORT.md §2.1 / §2.2 / §4 Tier 2 — an import reconciles
// instead of appending, and the wipe it is allowed to do cannot reach anything
// the user made by hand.
import { describe, it, expect } from 'vitest';
import { planImport, mergeImported, applyImport, describeImport } from '../src/core/importPlan.js';
import { importEvents, eventToTask, parseICS } from '../src/core/ical.js';
import { normalizeGoogleEvent } from '../src/ui/google.js';
import { Task } from '../src/core/Task.js';
import { Schedule } from '../src/core/Schedule.js';

const CAL = 'class-schedule@group.calendar.google.com';
const FROM = new Date(2026, 8, 7, 0, 0, 0, 0);
const TO = new Date(2026, 8, 14, 0, 0, 0, 0);
const D = (d, h) => new Date(2026, 8, d, h, 0, 0, 0);

const imported = (uid, title, at, extra = {}) => new Task({
  title, type: 'fixed', startTime: at, endTime: D(at.getDate(), at.getHours() + 1),
  source: { uid, calendarId: CAL, importedAt: 1 }, ...extra,
}).toJSON();

const handMade = (title, at) => new Task({
  title, type: 'flexible', startTime: at, endTime: D(at.getDate(), at.getHours() + 1),
}).toJSON();

describe('Task.source', () => {
  it('is omitted from toJSON when null, so no existing hash moves', () => {
    // ⚠️ The whole deploy story. A key present as `source: null` on every task
    // would change every task's FNV hash, and the first sync would read the
    // entire term as locally modified and re-push it.
    const plain = new Task({ title: 'Read', startTime: D(7, 9), endTime: D(7, 10) });
    expect('source' in plain.toJSON()).toBe(false);
    expect(plain.source).toBe(null);
  });

  it('survives a JSON round trip when set', () => {
    const t = Task.fromJSON(imported('u1', 'Lecture', D(7, 13)));
    expect(t.source).toEqual({ uid: 'u1', calendarId: CAL, importedAt: 1 });
    expect(Task.fromJSON(t.toJSON()).source.uid).toBe('u1');
  });

  it('ignores a source with no uid — there is nothing to reconcile on', () => {
    expect(new Task({ title: 'x', source: { calendarId: CAL } }).source).toBe(null);
  });
});

describe('planImport', () => {
  it('re-importing the same week updates instead of duplicating', () => {
    const local = [imported('u1', 'Lecture', D(7, 13))];
    const incoming = [imported('u1', 'Lecture', D(7, 13))];
    const plan = planImport(local, incoming, { calendarId: CAL, seenUids: ['u1'], from: FROM, to: TO });
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
    expect(plan.remove).toHaveLength(0);
  });

  it('NEVER touches a task you made by hand', () => {
    // The safety story. A wipe is only survivable because it cannot reach these.
    const local = [handMade('Write essay', D(8, 10)), handMade('Gym', D(9, 7))];
    const plan = planImport(local, [], { calendarId: CAL, seenUids: [], from: FROM, to: TO });
    expect(plan.remove).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.untouched).toHaveLength(0); // not even considered
  });

  it('removes an import from THIS calendar that is gone from the calendar', () => {
    const local = [imported('u1', 'Cancelled class', D(8, 13))];
    const plan = planImport(local, [], { calendarId: CAL, seenUids: [], from: FROM, to: TO });
    expect(plan.remove.map((r) => r.title)).toEqual(['Cancelled class']);
  });

  it('leaves another calendar\'s imports alone', () => {
    const other = new Task({
      title: 'Standup', type: 'fixed', startTime: D(8, 9), endTime: D(8, 10),
      source: { uid: 'w1', calendarId: 'work@example.com', importedAt: 1 },
    }).toJSON();
    const plan = planImport([other], [], { calendarId: CAL, seenUids: [], from: FROM, to: TO });
    expect(plan.remove).toHaveLength(0);
  });

  it('does not treat a null calendarId as a wildcard', () => {
    // An .ics import has no calendar. It must not be adopted — and then deleted
    // — by whichever Google calendar happens to be pulled next.
    const fromFile = new Task({
      title: 'From a file', type: 'fixed', startTime: D(8, 15), endTime: D(8, 16),
      source: { uid: 'f1', calendarId: null, importedAt: 1 },
    }).toJSON();
    const plan = planImport([fromFile], [], { calendarId: CAL, seenUids: [], from: FROM, to: TO });
    expect(plan.remove).toHaveLength(0);
  });

  // ⚠️ CI-5. If removal were computed from the FILTERED list, "only tags: study"
  // would mean "delete everything that isn't study".
  it('does not remove something merely filtered out by the tag filter', () => {
    const local = [imported('u1', 'Lecture', D(7, 13))];
    const plan = planImport(local, [], { calendarId: CAL, seenUids: ['u1'], from: FROM, to: TO });
    expect(plan.remove).toHaveLength(0);
    expect(plan.untouched).toEqual([local[0].id]);
  });

  // ⚠️ CI-6. A narrow window is not evidence about what sits outside it.
  it('does not remove an import that starts outside the fetched window', () => {
    const local = [imported('u1', 'Term-long class', new Date(2026, 7, 31, 13, 0, 0, 0))];
    const plan = planImport(local, [], { calendarId: CAL, seenUids: [], from: FROM, to: TO });
    expect(plan.remove).toHaveLength(0);
  });

  it('creates something genuinely new', () => {
    const plan = planImport([], [imported('u9', 'New seminar', D(10, 11))], {
      calendarId: CAL, seenUids: ['u9'], from: FROM, to: TO,
    });
    expect(plan.create).toHaveLength(1);
    expect(describeImport(plan)).toBe('1 added');
  });

  it('records why, for every decision', () => {
    const plan = planImport(
      [imported('u1', 'Kept', D(7, 13)), imported('u2', 'Gone', D(8, 13))],
      [imported('u1', 'Kept', D(7, 14))],
      { calendarId: CAL, seenUids: ['u1'], from: FROM, to: TO },
    );
    expect(plan.decisions.map((d) => d.decision).sort()).toEqual(['remove', 'update']);
    expect(plan.decisions.every((d) => typeof d.reason === 'string')).toBe(true);
  });
});

describe('mergeImported — the calendar wins about the appointment, not about your life', () => {
  it('takes title and times from the calendar', () => {
    const local = imported('u1', 'Old name', D(7, 13));
    const inc = imported('u1', 'New name', D(7, 15));
    const merged = mergeImported(local, inc);
    expect(merged.title).toBe('New name');
    expect(merged.startTime).toEqual(inc.startTime);
  });

  it('KEEPS lived data the calendar has never heard of', () => {
    // Reading "Google wins always" literally here would make every re-import a
    // silent eraser of how the class actually went — and of the training samples
    // that came with it.
    const local = imported('u1', 'Lecture', D(7, 13), {
      completion: 'done',
      satisfaction: { overall: 4, durationFit: 1 },
    });
    local.occurrenceData = { '2026-09-07': { satisfaction: { overall: 5 } } };
    const merged = mergeImported(local, imported('u1', 'Lecture', D(7, 13)));
    expect(merged.completion).toBe('done');
    expect(merged.satisfaction).toEqual({ overall: 4, durationFit: 1 });
    expect(merged.occurrenceData['2026-09-07']).toBeTruthy();
  });

  it('keeps the LOCAL id, so parentId / routineId links survive', () => {
    const local = imported('u1', 'Lecture', D(7, 13));
    const inc = imported('u1', 'Lecture', D(7, 13));
    expect(mergeImported(local, inc).id).toBe(local.id);
    expect(local.id).not.toBe(inc.id);
  });
});

describe('a recurring Google event actually imports (§2.7)', () => {
  const series = {
    id: 'abc123',
    summary: 'Organic Chemistry',
    start: { dateTime: '2026-09-07T13:00:00' },
    end: { dateTime: '2026-09-07T14:00:00' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'],
  };

  it('unexpanded, it becomes ONE recurring task carrying its uid', () => {
    const out = importEvents([normalizeGoogleEvent(series)], { calendarId: CAL });
    expect(out).toHaveLength(1);
    expect(out[0].recurrence).toBeTruthy();
    expect(out[0].source).toEqual({ uid: 'abc123', calendarId: CAL, importedAt: null });
  });

  it('EXPANDED, every instance was skipped — the bug this replaced', () => {
    // Kept as a test because the failure was silent and total: a whole term of
    // classes imported as nothing, and the door reported success.
    const instance = normalizeGoogleEvent({
      ...series, id: 'abc123_20260907T130000Z', recurringEventId: 'abc123', recurrence: undefined,
    });
    expect(instance.recurrenceId).toBeDefined();
    expect(importEvents([instance])).toHaveLength(0);
  });

  it('a genuine override is still skipped, which is what that line is for', () => {
    const override = normalizeGoogleEvent({
      id: 'abc123_20260909T130000Z', recurringEventId: 'abc123',
      summary: 'Organic Chemistry (moved)',
      start: { dateTime: '2026-09-09T15:00:00' }, end: { dateTime: '2026-09-09T16:00:00' },
    });
    expect(importEvents([override])).toHaveLength(0);
  });

  it('the uid is stable across pulls, so week 5 updates week 1\'s task', () => {
    const first = importEvents([normalizeGoogleEvent(series)], { calendarId: CAL });
    const again = importEvents([normalizeGoogleEvent(series)], { calendarId: CAL });
    const plan = planImport(first.map((t) => t.toJSON()), again.map((t) => t.toJSON()), {
      calendarId: CAL, seenUids: ['abc123'], from: FROM, to: TO,
    });
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
  });
});

describe('the reported bug, end to end against a real Schedule', () => {
  // "there is a bug with loading from the calender where it doesn't clear out
  // current tasks and the resultant schedule is weird"
  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:class-1', 'SUMMARY:Organic Chemistry',
    'DTSTART:20260907T130000', 'DTEND:20260907T140000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:class-2', 'SUMMARY:Lab',
    'DTSTART:20260909T090000', 'DTEND:20260909T120000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const importOnce = (s, text) => {
    const events = parseICS(text);
    const tasks = importEvents(events, { importedAt: Date.now() });
    const plan = planImport(s.tasks.map((t) => t.toJSON()), tasks, {
      calendarId: null, seenUids: events.map((e) => e.uid),
    });
    return { plan, applied: applyImport(s, plan) };
  };

  it('importing the same file twice does not duplicate anything', () => {
    const s = new Schedule({});
    const first = importOnce(s, ICS);
    expect(first.applied).toMatchObject({ created: 2, updated: 0, removed: 0 });
    expect(s.tasks).toHaveLength(2);

    const second = importOnce(s, ICS);
    expect(second.applied).toMatchObject({ created: 0, updated: 2, removed: 0 });
    // The bug: this used to be 4.
    expect(s.tasks).toHaveLength(2);
  });

  it('a hand-planned task survives a re-import untouched', () => {
    const s = new Schedule({});
    importOnce(s, ICS);
    const mine = s.addFlexible({
      title: 'Write the essay', tags: ['study'],
      startTime: D(8, 10), endTime: D(8, 12),
    });
    importOnce(s, ICS);
    expect(s.tasks.find((t) => t.id === mine.id)).toBeTruthy();
    expect(s.tasks).toHaveLength(3);
  });

  it('a vetoed removal is kept', () => {
    const s = new Schedule({});
    importOnce(s, ICS);
    const gone = s.tasks[0].id;
    // The calendar now has neither event.
    const plan = planImport(s.tasks.map((t) => t.toJSON()), [], {
      calendarId: null, seenUids: [], from: FROM, to: TO,
    });
    expect(plan.remove).toHaveLength(2);
    const res = applyImport(s, plan, { skipRemovals: [gone] });
    expect(res).toMatchObject({ removed: 1, kept: 1 });
    expect(s.tasks.map((t) => t.id)).toEqual([gone]);
  });
});

describe('eventToTask carries provenance', () => {
  it('records the uid both doors already received', () => {
    const t = eventToTask({ uid: 'ics-1', summary: 'Gym', start: D(7, 7), end: D(7, 8), x: {} }, {
      calendarId: null, importedAt: 99,
    });
    expect(t.source).toEqual({ uid: 'ics-1', calendarId: null, importedAt: 99 });
  });

  it('leaves source null when the event has no uid at all', () => {
    expect(eventToTask({ summary: 'Nameless', start: D(7, 7), end: D(7, 8), x: {} }).source).toBe(null);
  });
});
