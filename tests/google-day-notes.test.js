// GS-11 — a day note is an ALL-DAY EVENT, not a row in the library.
//
// design/GOOGLE-AS-STORAGE.md §4.2 always said so; the build carried them in the
// library blob and parked the divergence with a note saying what had to happen
// when it was undone. Both halves land together, and this file locks both:
// the events exist, AND the library no longer carries a second copy.
//
// The second half is not bookkeeping. A library copy alongside the events would
// resurrect a note deleted in Google on every single sync, forever.
//
// `design/probes/probe-google-day-notes.mjs` prints the shapes.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig, dateFromKey } from '../src/core/index.js';
import {
  encodeDayNote, encodeBlockedDay, decodeDayEvent, allDayRRULE, dayAfter, dayBefore,
  KIND_DAYNOTE, KIND_BLOCKED,
} from '../src/core/googleDayNotes.js';
import { LIBRARY_KEYS, libraryFrom, missingFromLibrary } from '../src/core/googleLibrary.js';
import { pull, applyPlan, encodeNoteParts, encodeBlockedParts } from '../src/ui/googleSync.js';
import { planSync, emptyState } from '../src/core/syncPlan.js';
import { applyLocalNotes, applyLocalBlocked, blockedRecord } from '../src/ui/useGoogleSync.js';

const sched = () => new Schedule({ config: defaultConfig });

/** The in-memory Google used across the sync tests. */
function fakeGoogle() {
  const events = new Map();
  let seq = 0;
  let clock = 1_000_000;
  return {
    listAll: async () => [...events.values()].map((e) => ({ ...e })),
    insert: async (_cal, body) => {
      seq += 1; clock += 1;
      const id = `ev${seq}`;
      events.set(id, { ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    patch: async (_cal, id, body) => {
      clock += 1;
      events.set(id, { ...events.get(id), ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    remove: async (_cal, id) => { events.delete(id); return null; },
    _events: events,
  };
}

describe('⚠️ the exclusive end date, which is the whole bug', () => {
  // `end.date` is EXCLUSIVE and `DayNote.to` is INCLUSIVE. Getting this wrong
  // does not error — it lengthens or shortens every holiday by a day, quietly,
  // on every sync. Sharp edge #11 in its original form.
  it('a ONE-day note ends the NEXT day on the wire, and comes back one day', () => {
    const s = sched();
    const n = s.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26', kind: 'holiday' });
    const ev = encodeDayNote(n);

    expect(ev.start.date).toBe('2026-11-26');
    expect(ev.end.date).toBe('2026-11-27');

    const back = decodeDayEvent({ ...ev, id: 'g1' });
    expect(back.ok).toBe(true);
    expect(back.note.from).toBe('2026-11-26');
    expect(back.note.to).toBe('2026-11-26');
  });

  it('a five-day range comes back five days, not four or six', () => {
    const s = sched();
    const n = s.addDayNote({ label: 'Reading week', from: '2026-11-23', to: '2026-11-27' });
    const back = decodeDayEvent({ ...encodeDayNote(n), id: 'g2' });
    expect([back.note.from, back.note.to]).toEqual(['2026-11-23', '2026-11-27']);
  });

  it('an event with no end at all is a single day', () => {
    const ev = encodeDayNote(sched().addDayNote({ label: 'X', from: '2026-03-09', to: '2026-03-09' }));
    delete ev.end;
    const back = decodeDayEvent({ ...ev, id: 'g3' });
    expect(back.note.from).toBe('2026-03-09');
    expect(back.note.to).toBe('2026-03-09');
  });

  it('the two day helpers are exact inverses', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-12-31', '2028-02-29']) {
      expect(dayBefore(dayAfter(d))).toBe(d);
    }
  });
});

describe('what Google owns, a hand edit changes (GS-4)', () => {
  it('a rename and a move in Google both land here', () => {
    const s = sched();
    const n = s.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });
    const edited = {
      ...encodeDayNote(n),
      id: 'g1',
      summary: 'Thanksgiving (moved)',
      start: { date: '2026-11-27' },
      end: { date: '2026-11-28' },
    };
    const back = decodeDayEvent(edited);
    expect(back.note.label).toBe('Thanksgiving (moved)');
    expect([back.note.from, back.note.to]).toEqual(['2026-11-27', '2026-11-27']);
  });

  it('label, from and to are NOT duplicated into the payload', () => {
    // Carrying them twice invites the two copies to disagree, and the event's
    // own fields are the ones a hand edit changes.
    const n = sched().addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });
    const priv = encodeDayNote(n).extendedProperties.private;
    const payload = JSON.parse(
      Array.from({ length: Number(priv['sc.json.n']) }, (_, i) => priv[`sc.json.${i}`]).join(''),
    );
    expect(payload.label).toBeUndefined();
    expect(payload.from).toBeUndefined();
    expect(payload.to).toBeUndefined();
    expect(payload.kind).toBeDefined();   // this one has no native home
  });
});

describe('a repeating note is an all-day rule, which is not a task rule', () => {
  it('⚠️ bounds with a DATE, because DTSTART is a DATE', () => {
    // RFC 5545 §3.3.10, the other way round from the task fix: a task carries
    // `UNTIL=…T045959Z` because its DTSTART is a date-time. Handing that to an
    // all-day event is invalid, and an invalid rule is a 400 with the event
    // never appearing at all.
    const rule = allDayRRULE({
      periods: [{
        windows: [{ day: 'mon', start: '00:00', end: '23:59' }],
        interval: 1,
        effectiveFrom: new Date(2026, 8, 7).getTime(),
        effectiveUntil: new Date(2026, 11, 12).getTime(),
      }],
      anchorDate: new Date(2026, 8, 7).getTime(),
      exceptions: [],
    });
    expect(rule).toMatch(/UNTIL=\d{8}$/);
    expect(rule).not.toMatch(/UNTIL=\d{8}T/);
  });

  it('a birthday goes out as FREQ=YEARLY', () => {
    const n = sched().addDayNote({
      label: 'Ada birthday',
      from: '2026-12-10',
      to: '2026-12-10',
      recurrence: {
        periods: [{
          freq: 'yearly',
          windows: [{ month: 12, monthDay: 10 }],
          interval: 1,
          effectiveFrom: new Date(2026, 11, 10).getTime(),
          effectiveUntil: null,
        }],
        anchorDate: new Date(2026, 11, 10).getTime(),
        exceptions: [],
      },
    });
    expect(encodeDayNote(n).recurrence[0]).toMatch(/FREQ=YEARLY/);
  });
});

describe('blocked days', () => {
  it('go out as a one-day all-day event and come back as a date', () => {
    const ev = encodeBlockedDay('2026-12-24');
    expect(ev.start.date).toBe('2026-12-24');
    expect(ev.end.date).toBe('2026-12-25');
    const back = decodeDayEvent({ ...ev, id: 'g5' });
    expect(back.kind).toBe(KIND_BLOCKED);
    expect(back.day).toBe('2026-12-24');
  });

  it('are not confused with day notes', () => {
    const n = sched().addDayNote({ label: 'X', from: '2026-12-24', to: '2026-12-24' });
    expect(decodeDayEvent({ ...encodeDayNote(n), id: 'a' }).kind).toBe(KIND_DAYNOTE);
    expect(decodeDayEvent({ ...encodeBlockedDay('2026-12-24'), id: 'b' }).kind).toBe(KIND_BLOCKED);
  });
});

describe('⚠️ and they are GONE from the library, in the same change', () => {
  it('neither is a library key any more', () => {
    expect(LIBRARY_KEYS).not.toContain('dayNotes');
    expect(LIBRARY_KEYS).not.toContain('blockedDays');
  });

  it('the blob does not carry a second copy', () => {
    // The failure this prevents: the library copy silently resurrecting a note
    // you deleted in Google, on every sync, forever.
    const s = sched();
    s.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });
    s.blockDay(dateFromKey('2026-12-24'));
    const lib = libraryFrom(s.toJSON());
    expect(lib.dayNotes).toBeUndefined();
    expect(lib.blockedDays).toBeUndefined();
  });

  it('and the homeless-collection guard still reports NOTHING homeless', () => {
    // `missingFromLibrary` answers "does this collection have a home at all".
    // Moving a key out of LIBRARY_KEYS without recording where it went would
    // make it report a fault that is not one — or worse, hide a real one.
    const s = sched();
    s.addDayNote({ label: 'X', from: '2026-11-26', to: '2026-11-26' });
    expect(missingFromLibrary(s.toJSON())).toEqual([]);
  });
});

describe('the round trip through the REAL sync', () => {
  // Encoding correctly is not the same as being carried. The task side shipped
  // an encoder that no caller ever asked for a rule from, and a library that
  // nothing ever read — both individually correct, neither connected.
  it('notes reach Google, come back, and land in a fresh schedule', async () => {
    const api = fakeGoogle();
    const here = sched();
    here.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26', kind: 'holiday' });
    here.addDayNote({ label: 'Reading week', from: '2026-11-23', to: '2026-11-27', tags: ['term'] });

    const plan = planSync(here.dayNotes.map((n) => n.toJSON()), [], emptyState());
    expect(plan.create).toHaveLength(2);
    const applied = await applyPlan(api, 'cal', plan, { encode: encodeNoteParts });
    expect(applied.failed).toEqual([]);
    expect(applied.synced).toHaveLength(2);

    const remote = await pull(api, 'cal');
    expect(remote.notes).toHaveLength(2);
    expect(remote.tasks).toHaveLength(0);     // a note is not a task

    const there = sched();
    applyLocalNotes(there, planSync([], remote.notes, emptyState()));

    expect(there.dayNotes.map((n) => n.label).sort()).toEqual(['Reading week', 'Thanksgiving']);
    const week = there.dayNotes.find((n) => n.label === 'Reading week');
    expect(week.dayCount).toBe(5);
    expect(week.coversDate(new Date(2026, 10, 27))).toBe(true);   // the 27th, inclusive
    expect(week.coversDate(new Date(2026, 10, 28))).toBe(false);
  });

  it('blocked days make the same trip', async () => {
    const api = fakeGoogle();
    const here = sched();
    // A DATE, not a key — `dateFromKey` because `new Date('2026-12-24')` is UTC
    // midnight and lands on the 23rd here (sharp edge #4).
    here.blockDay(dateFromKey('2026-12-24'));
    here.blockDay(dateFromKey('2026-12-25'));

    const plan = planSync(here.blockedDays.map(blockedRecord), [], emptyState());
    const applied = await applyPlan(api, 'cal', plan, { encode: encodeBlockedParts });
    expect(applied.failed).toEqual([]);

    const remote = await pull(api, 'cal');
    expect(remote.blockedDays.map((b) => b.task.day).sort()).toEqual(['2026-12-24', '2026-12-25']);

    const there = sched();
    applyLocalBlocked(there, planSync([], remote.blockedDays, emptyState()));
    expect(there.blockedDays).toEqual(['2026-12-24', '2026-12-25']);
    expect(there.isDayBlocked(new Date(2026, 11, 24))).toBe(true);
  });

  it('⚠️ a note deleted in Google is deleted here, and does NOT come back', async () => {
    // The exact failure the library copy would have caused.
    const api = fakeGoogle();
    const here = sched();
    here.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26' });

    let state = emptyState();
    const first = planSync(here.dayNotes.map((n) => n.toJSON()), [], state);
    const applied = await applyPlan(api, 'cal', first, { encode: encodeNoteParts });
    state = { lastSyncAt: 1, entries: Object.fromEntries(applied.synced.map((r) => [r.task.id, { hash: '', eventId: r.eventId, dirtyAt: 0 }])) };

    // Deleted by hand in Google.
    for (const id of [...api._events.keys()]) await api.remove('cal', id);

    const remote = await pull(api, 'cal');
    const second = planSync(here.dayNotes.map((n) => n.toJSON()), remote.notes, state);
    // Synced before, now absent there → deleted on the other device.
    expect(second.deleteLocal).toContain(here.dayNotes[0].id);
    applyLocalNotes(here, second);
    expect(here.dayNotes).toHaveLength(0);
  });
});
