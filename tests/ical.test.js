import { describe, it, expect, beforeEach } from 'vitest';
import { Task, resetIds } from '../src/core/index.js';
import {
  toICS, parseICS, toRRULE, fromRRULE, deriveTags, eventToTask, importEvents,
  toICSDate, fromICSDate,
} from '../src/core/ical.js';

const D = (dd, h, mi = 0) => new Date(2026, 6, dd, h, mi, 0, 0);

function gym() {
  return new Task({
    title: 'Morning gym',
    type: 'fixed',
    pinned: true,
    tags: ['sports'],
    startTime: D(13, 8),
    endTime: D(13, 9),
    recurrence: {
      periods: [{
        windows: [
          { day: 'mon', start: '08:00', end: '09:00' },
          { day: 'wed', start: '08:00', end: '09:00' },
        ],
        interval: 1, effectiveFrom: null, effectiveUntil: null,
      }],
      anchorDate: D(13, 0),
      exceptions: [],
    },
  });
}

describe('iCalendar dates', () => {
  it('writes local floating time — 09:00 stays 09:00 wherever it is opened', () => {
    expect(toICSDate(D(13, 9, 30))).toBe('20260713T093000');
  });

  it('reads floating and UTC forms', () => {
    const floating = fromICSDate('20260713T093000');
    expect(floating.getHours()).toBe(9);
    expect(floating.getMinutes()).toBe(30);
    expect(fromICSDate('20260713T093000Z').getTime())
      .toBe(Date.UTC(2026, 6, 13, 9, 30, 0, 0));
    expect(fromICSDate('nonsense')).toBeNull();
  });
});

describe('recurrence maps to RRULE both ways', () => {
  beforeEach(() => resetIds());

  it('weekly windows → FREQ=WEEKLY;BYDAY', () => {
    expect(toRRULE(gym())).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('every-other-week carries INTERVAL (4D)', () => {
    const t = gym();
    t.recurrence.periods[0].interval = 2;
    expect(toRRULE(t)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
  });

  it('RRULE → windows, taking times from DTSTART', () => {
    const rec = fromRRULE('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR', D(13, 8), D(13, 9, 30));
    expect(rec.periods[0].interval).toBe(2);
    expect(rec.periods[0].windows).toEqual([
      { day: 'mon', start: '08:00', end: '09:30' },
      { day: 'fri', start: '08:00', end: '09:30' },
    ]);
  });

  it('a non-weekly rule is refused rather than mangled into our model', () => {
    expect(fromRRULE('FREQ=MONTHLY;BYMONTHDAY=1', D(13, 8), D(13, 9))).toBeNull();
  });

  it('a task survives an export → import round trip', () => {
    const ics = toICS([gym()]);
    const [ev] = parseICS(ics);
    const back = eventToTask(ev);
    expect(back.title).toBe('Morning gym');
    expect(back.type).toBe('fixed');
    expect(back.pinned).toBe(true); // via X-SANDYCAY-PINNED
    expect(back.tags).toContain('sports'); // via CATEGORIES
    expect(back.recurrence.periods[0].windows.map((w) => w.day)).toEqual(['mon', 'wed']);
  });
});

describe('export shape', () => {
  beforeEach(() => resetIds());

  it('a recurring parent exports as ONE event + RRULE, not N copies', () => {
    const ics = toICS([gym()]);
    expect(parseICS(ics).length).toBe(1);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('a skipped session becomes an EXDATE', () => {
    const t = gym();
    t.recurrence.exceptions.push({ date: '2026-07-15', action: 'skip' });
    expect(toICS([t])).toContain('EXDATE:20260715T080000');
  });

  it('a relocated session becomes a RECURRENCE-ID override at its new time', () => {
    const t = gym();
    t.recurrence.exceptions.push({ date: '2026-07-13', action: 'move', toDate: '2026-07-14', start: '17:00', end: '18:00' });
    const ics = toICS([t]);
    expect(ics).toContain('RECURRENCE-ID:20260713T080000'); // which session
    expect(ics).toContain('DTSTART:20260714T170000'); // where it actually went
    expect(parseICS(ics).length).toBe(2); // parent + override
  });

  it('uses CRLF and a VCALENDAR wrapper (RFC 5545)', () => {
    const ics = toICS([gym()]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('importing someone else\'s calendar', () => {
  beforeEach(() => resetIds());

  const raw = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:a@google.com',
    'SUMMARY:Lecture #study',
    'DTSTART:20260713T100000',
    'DTEND:20260713T113000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:b@google.com',
    'SUMMARY:Dinner with Ana',
    'DTSTART:20260713T190000',
    'DTEND:20260713T203000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('a #hashtag becomes a tag and leaves the title clean', () => {
    const { tags, title } = deriveTags({ summary: 'Lecture #study #uni' });
    expect(tags.sort()).toEqual(['study', 'uni']);
    expect(title).toBe('Lecture'); // the hashtag is not part of the name
  });

  it('a whole source can be tagged (“this is my Work calendar”)', () => {
    const { tags } = deriveTags({ summary: 'Standup' }, { sourceTags: ['work'] });
    expect(tags).toEqual(['work']);
  });

  it('tagFilter imports only the events you asked for', () => {
    const events = parseICS(raw);
    expect(events.length).toBe(2);
    const tasks = importEvents(events, { tagFilter: ['study'] });
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('Lecture');
  });

  it('no filter keeps everything', () => {
    expect(importEvents(parseICS(raw)).length).toBe(2);
  });

  it('a date range filters the import', () => {
    const tasks = importEvents(parseICS(raw), { from: D(13, 18), to: D(14, 0) });
    expect(tasks.map((t) => t.title)).toEqual(['Dinner with Ana']);
  });

  it('an imported event is a fixed anchor placed by the user, not auto-wandered', () => {
    const [t] = importEvents(parseICS(raw), { tagFilter: ['study'] });
    expect(t.type).toBe('fixed'); // it has a real time; it's an anchor
    expect(t.placedBy).toBe('user'); // re-optimize must not move someone's lecture
    expect(t.startTime.getHours()).toBe(10);
    expect(t.endTime.getHours()).toBe(11);
  });

  it('an event with no end gets a sane duration instead of a zero-length card', () => {
    const [t] = importEvents(parseICS([
      'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Mystery', 'DTSTART:20260713T090000', 'END:VEVENT',
    ].join('\r\n')));
    expect(t.getDuration()).toBe(60);
  });

  it('unfolds long folded lines (RFC 5545 75-octet wrap)', () => {
    const long = 'x'.repeat(200);
    const ics = toICS([new Task({ title: long, startTime: D(13, 9), endTime: D(13, 10) })]);
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(parseICS(ics)[0].summary).toBe(long); // survives the fold/unfold
  });
});
