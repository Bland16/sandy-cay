// Google Calendar encoding — design/GOOGLE-AS-STORAGE.md P0.
//
// Pure functions, no network, no account. `design/probes/probe-google-encode.mjs`
// prints the actual bytes; this locks the behaviour.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig, seed, Task } from '../src/core/index.js';
import {
  encodeTask, decodeEvent, kindOf, chunkString, packPayload, unpackPayload,
  checksum, byteLength, idQuery, KIND, CHUNK_BYTES, ENCODING_VERSION, encodeTaskParts,
} from '../src/core/googleEncode.js';

const at = (h, m = 0) => new Date(2026, 8, 7, h, m, 0, 0);
const sched = () => new Schedule({ config: defaultConfig });

describe('a task survives the round trip', () => {
  it('keeps every field that matters', () => {
    const s = sched();
    const t = s.addFixed({
      title: 'Orientation', startTime: at(9), endTime: at(10, 30),
      tags: ['school', 'admin'], priority: 2, details: 'Bring the form', pinned: true,
    });
    const back = decodeEvent({ ...encodeTask(t, { timeZone: 'America/New_York' }), id: 'abc12' });

    expect(back.ok).toBe(true);
    expect(back.task.id).toBe(t.id);
    expect(back.task.title).toBe('Orientation');
    expect(back.task.tags).toEqual(['school', 'admin']);
    expect(back.task.details).toBe('Bring the form');
    expect(back.task.priority).toBe(2);
    expect(back.task.pinned).toBe(true);
    expect(back.task.startTime).toBe(t.startTime.getTime());
    expect(back.task.endTime).toBe(t.endTime.getTime());
    expect(back.googleEventId).toBe('abc12');
  });

  it('stores the timezone EXPLICITLY, which epoch-ms cannot', () => {
    // The reason this encoding makes probe-b-tz.mjs's bug less reachable: a
    // Google event carries {dateTime, timeZone}; Task.startTime is bare ms.
    const s = sched();
    const t = s.addFixed({ title: 'x', startTime: at(9), endTime: at(10) });
    const ev = encodeTask(t, { timeZone: 'America/New_York' });
    expect(ev.start.timeZone).toBe('America/New_York');
    expect(ev.end.timeZone).toBe('America/New_York');
  });

  it('does NOT duplicate times into the payload', () => {
    // Two homes for one value is how the two copies drift — and it is what
    // would let a stale payload overrule a hand edit made in Google.
    const s = sched();
    const t = s.addFixed({ title: 'x', startTime: at(9), endTime: at(10) });
    const priv = encodeTask(t, {}).extendedProperties.private;
    const payload = unpackPayload(priv).value;
    expect(payload).not.toContain('startTime');
    expect(payload).not.toContain('endTime');
    expect(payload).not.toContain('"title"');
  });

  it('a hand edit in Google wins (GS-4 / R-1)', () => {
    const s = sched();
    const t = s.addFixed({ title: 'x', startTime: at(9), endTime: at(10) });
    const ev = encodeTask(t, {});
    ev.start = { dateTime: at(15).toISOString(), timeZone: 'UTC' };
    ev.end = { dateTime: at(16).toISOString(), timeZone: 'UTC' };
    expect(decodeEvent(ev).task.startTime).toBe(at(15).getTime());
  });

  it('the EVENT beats the payload even if a stale time is somehow in there', () => {
    // Today this cannot arise, because times are NATIVE and never written to
    // the payload. It is locked anyway: if a later version ever does put a time
    // in there, the event must still win, or a hand edit in Google Calendar
    // would be silently reverted by a stale copy — the exact surprise R-1 and
    // GS-4 exist to prevent. Without this, the ordering in decodeEvent is
    // load-bearing and untested.
    const ev = encodeTask({ id: 'a', title: 'x' }, {});
    const priv = ev.extendedProperties.private;
    const stale = JSON.stringify({ id: 'a', startTime: at(3).getTime(), endTime: at(4).getTime() });
    Object.assign(priv, packPayload(stale));
    ev.start = { dateTime: at(15).toISOString(), timeZone: 'UTC' };
    ev.end = { dateTime: at(16).toISOString(), timeZone: 'UTC' };
    const r = decodeEvent(ev);
    expect(r.ok).toBe(true);
    expect(r.task.startTime).toBe(at(15).getTime());
    expect(r.task.endTime).toBe(at(16).getTime());
  });
});

describe('reconstruction through the REAL Task constructor', () => {
  // ⚠️ The tests above compare fields one by one, and that is how a whole field
  // went missing without anything failing: recurrence was excluded from the
  // payload as "native", so every repeating task decoded to a one-off. Nothing
  // errored. Comparing toJSON to toJSON is what catches a field that simply is
  // not there any more.
  it('every seeded task rebuilds byte-identically', () => {
    const s = seed();
    expect(s.tasks.length).toBeGreaterThan(0);
    for (const t of s.tasks) {
      const back = decodeEvent(encodeTask(t, {}));
      expect(back.ok).toBe(true);
      expect(Task.fromJSON(back.task).toJSON()).toEqual(t.toJSON());
    }
  });

  it('rebuilds a task whose every field is set to a NON-DEFAULT value', () => {
    // ⚠️ The seed alone is not enough, and mutation proved it: dropping
    // `history` from the payload changed nothing, because seeded tasks carry
    // the DEFAULT history and `Task.fromJSON` regenerates that same default. A
    // dropped field is only visible when its value differs from what the
    // constructor would invent on its own. So this one sets everything to
    // something the constructor would never produce.
    const t = Task.fromJSON({
      id: 'kitchen-sink-0001',
      title: 'Kitchen sink',
      details: 'every field carries a non-default value',
      tags: ['alpha', 'beta'],
      type: 'fixed',
      pinned: true,
      priority: 5,
      startTime: at(9).getTime(),
      endTime: at(11).getTime(),
      deadline: at(18).getTime(),
      placedBy: 'user',
      activityId: 'act-0007',
      schedulingWarning: 'parked outside a window',
      schedulingInfo: { reason: 'no free slot' },
      missedDeadline: true,
      completion: 0.75,
      satisfaction: { rating: 4, facets: { focus: 1, energy: -1, timing: 0 } },
      energyAt: { physical: -2, mental: -3, social: 1, emotional: 0 },
      dayFillAtCompletion: 0.63,
      history: { moveCount: 3, displacedCount: 2, rippleCount: 1, carriedCount: 4 },
      occurrenceData: { '2026-09-07': { completion: 1, satisfaction: { rating: 5 } } },
      load: { physical: 2, mental: -1, social: 0, emotional: 1 },
      isOccurrence: false,
      routineId: 'laundry-0001',
      stepIndex: 2,
      occurrenceDate: '2026-09-07',
      parentId: 'essay-0002',
    });

    const before = t.toJSON();
    // Guard the guard: if these ever coincide with the defaults, this test
    // silently stops testing anything.
    expect(before.history).not.toEqual({ moveCount: 0, displacedCount: 0, rippleCount: 0, carriedCount: 0 });
    expect(before.occurrenceData).not.toEqual({});

    const back = decodeEvent(encodeTask(t, {}));
    expect(back.ok).toBe(true);
    expect(Task.fromJSON(back.task).toJSON()).toEqual(before);
  });

  it('a RECURRING task keeps its whole pattern', () => {
    // The specific regression. RRULE is strictly poorer than this app's model
    // (periods with their own bounds, per-window freq, move/add exceptions), so
    // the payload has to carry it losslessly.
    const s = seed();
    const recurring = s.tasks.filter((t) => t.recurrence);
    expect(recurring.length).toBeGreaterThan(0);
    for (const t of recurring) {
      const back = decodeEvent(encodeTask(t, {}));
      expect(back.task.recurrence).toBeTruthy();
      expect(back.task.recurrence).toEqual(t.toJSON().recurrence);
    }
  });

  it('⚠️ emits an RRULE by DEFAULT, so Google shows the whole series', () => {
    // THE BUG, reported from a real browser: a repeating task appeared in
    // Google Calendar as a SINGLE event. The pattern round-tripped perfectly
    // (it lives in the payload), so the app was right and every test passed —
    // but Google had no rule to expand.
    //
    // The cause was an OPT-IN design: `encodeTask` emitted a rule only if a
    // caller passed one, and no caller did. An option a caller must remember is
    // an option a caller will forget, so it is derived now.
    const s = seed();
    const t = s.tasks.find((x) => x.recurrence);
    expect(t).toBeTruthy();
    const ev = encodeTask(t, {});
    expect(ev.recurrence).toBeTruthy();
    expect(ev.recurrence[0]).toMatch(/^RRULE:FREQ=/);
  });

  it('gives a NON-repeating task no rule at all', () => {
    const s = seed();
    const one = s.tasks.find((x) => !x.recurrence);
    expect(encodeTask(one, {}).recurrence).toBeUndefined();
  });

  it('an explicit null suppresses the rule; absent means derive it', () => {
    // The distinction the first version of this fix got wrong: `rrule` had a
    // DEFAULT of null, which made the derive branch unreachable, so the fix
    // looked correct and did nothing.
    const s = seed();
    const t = s.tasks.find((x) => x.recurrence);
    expect(encodeTask(t, { rrule: null }).recurrence).toBeUndefined();
    expect(encodeTask(t, {}).recurrence).toBeTruthy();
  });

  it('the RRULE is a DISPLAY MIRROR and never the truth', () => {
    const s = seed();
    const t = s.tasks.find((x) => x.recurrence);
    const ev = encodeTask(t, { rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO' });
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
    // Wrecking the mirror must not change what decodes.
    ev.recurrence = ['RRULE:FREQ=DAILY'];
    expect(decodeEvent(ev).task.recurrence).toEqual(t.toJSON().recurrence);
  });
});

describe('kind — because parentId is overloaded', () => {
  // A project chunk's parentId is a Task; a commitment sitting's parentId is a
  // Commitment (generate.js). Nothing on the task says which, so it cannot be
  // derived later and must be resolved once, at encode time.
  const commitmentIds = new Set(['stat-hw-0009']);

  it('classifies each kind', () => {
    expect(kindOf({ id: 'a' }, { commitmentIds })).toBe(KIND.TASK);
    expect(kindOf({ id: 'a', routineId: 'r1', stepIndex: 0 }, { commitmentIds })).toBe(KIND.ROUTINE_STEP);
    expect(kindOf({ id: 'a', chunking: { totalMinutes: 60 } }, { commitmentIds })).toBe(KIND.PROJECT_PARENT);
    expect(kindOf({ id: 'a', parentId: 'essay-0002' }, { commitmentIds })).toBe(KIND.PROJECT_CHUNK);
    expect(kindOf({ id: 'a', parentId: 'stat-hw-0009' }, { commitmentIds })).toBe(KIND.COMMITMENT_SITTING);
  });

  it('cannot tell a sitting from a chunk WITHOUT the resolver', () => {
    // Locked deliberately: this is the argument for storing sc.kind rather than
    // re-deriving it on the far side, and it must not be "fixed" by guessing.
    expect(kindOf({ id: 'a', parentId: 'stat-hw-0009' })).toBe(KIND.PROJECT_CHUNK);
  });

  it('writes the kind onto the event, so decode never re-derives it', () => {
    const ev = encodeTask({ id: 'a-5', title: 'Stats', parentId: 'stat-hw-0009' }, { commitmentIds });
    expect(ev.extendedProperties.private['sc.kind']).toBe(KIND.COMMITMENT_SITTING);
    // and decoding trusts it, with no commitment list in sight
    expect(decodeEvent(ev).kind).toBe(KIND.COMMITMENT_SITTING);
  });

  it('lifts ref and step index out as queryable properties', () => {
    const ev = encodeTask({ id: 'a', title: 'x', routineId: 'laundry-1', stepIndex: 2 }, {});
    expect(ev.extendedProperties.private['sc.ref']).toBe('laundry-1');
    expect(ev.extendedProperties.private['sc.i']).toBe('2');
  });
});

describe('chunking — Google truncates over 1024 bytes SILENTLY', () => {
  // ⚠️ GOOGLE'S limit, hardcoded on purpose. Asserting against CHUNK_BYTES
  // instead would be circular — it is our own constant, so raising the cut past
  // what Google actually allows would move the goalposts with it and the test
  // would stay green while every long payload silently lost its tail. Caught by
  // mutation, which is the only reason this number is written out here.
  const GOOGLE_VALUE_LIMIT = 1024;

  it('keeps our cut safely under Google\'s hard ceiling', () => {
    expect(CHUNK_BYTES).toBeLessThan(GOOGLE_VALUE_LIMIT);
    // Headroom, not a hairline: a key plus JSON escaping travels with the value.
    expect(GOOGLE_VALUE_LIMIT - CHUNK_BYTES).toBeGreaterThanOrEqual(64);
  });

  it('never emits a chunk over GOOGLE\'s limit, at any length', () => {
    for (const len of [1, 899, 900, 901, 1023, 1024, 1025, 1799, 1800, 1801, 4096]) {
      const str = 'z'.repeat(len);
      const p = packPayload(str);
      const n = Number(p['sc.json.n']);
      for (let i = 0; i < n; i += 1) {
        expect(byteLength(p[`sc.json.${i}`])).toBeLessThanOrEqual(GOOGLE_VALUE_LIMIT);
      }
      expect(unpackPayload(p).value).toBe(str);
    }
  });

  it('DETECTS truncation instead of returning half a task', () => {
    const big = 'y'.repeat(5000);
    const p = packPayload(big);
    const cut = { ...p, 'sc.json.0': p['sc.json.0'].slice(0, 400) };
    const r = unpackPayload(cut);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum/);
  });

  it('detects a missing chunk', () => {
    const p = packPayload('y'.repeat(3000));
    const n = Number(p['sc.json.n']);
    delete p[`sc.json.${n - 1}`];
    const r = unpackPayload(p);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing/);
  });

  it('never splits a multi-byte character', () => {
    // A naive byte-slice halves a 4-byte emoji and the halves rejoin as a
    // DIFFERENT string — corruption on every save rather than rarely.
    const emoji = '🌊'.repeat(400);
    expect(byteLength('🌊')).toBe(4);
    const r = unpackPayload(packPayload(emoji));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(emoji);
    const accents = 'é'.repeat(700);
    expect(unpackPayload(packPayload(accents)).value).toBe(accents);
  });

  it('chunkString measures BYTES, not characters', () => {
    const parts = chunkString('🌊'.repeat(300), 100);
    for (const p of parts) expect(byteLength(p)).toBeLessThanOrEqual(100);
  });

  it('checksum is stable and dependency-free', () => {
    expect(checksum('abc')).toBe(checksum('abc'));
    expect(checksum('abc')).not.toBe(checksum('abd'));
    expect(checksum('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('refusals — what it will not quietly accept', () => {
  it('treats a foreign event as not ours, not as corruption', () => {
    const r = decodeEvent({ summary: 'Dentist', id: 'zz' });
    expect(r.ok).toBe(false);
    expect(r.notOurs).toBe(true);
  });

  it('refuses an event written by a NEWER encoding', () => {
    // A partial read would drop the fields this build does not know about, and
    // writing that back would destroy them for the newer client.
    const ev = encodeTask({ id: 'a', title: 'x' }, {});
    ev.extendedProperties.private['sc.v'] = String(ENCODING_VERSION + 1);
    const r = decodeEvent(ev);
    expect(r.ok).toBe(false);
    expect(r.notOurs).toBeUndefined();
  });

  it('refuses a payload that is not JSON', () => {
    const ev = encodeTask({ id: 'a', title: 'x' }, {});
    const priv = ev.extendedProperties.private;
    priv['sc.json.0'] = 'not json{';
    delete priv['sc.json.sum'];
    expect(decodeEvent(ev).ok).toBe(false);
  });

  it('reports rather than throws, so one bad event cannot fail a whole pull', () => {
    expect(() => decodeEvent(null)).not.toThrow();
    expect(() => decodeEvent({})).not.toThrow();
    expect(() => unpackPayload(null)).not.toThrow();
  });
});

describe('the event id problem', () => {
  it('never mints a Google event id', () => {
    // Task ids look like "x-0001": a hyphen, and x is outside base32hex's a-v.
    // Google assigns the id; we find the event again by property query.
    const ev = encodeTask({ id: 'x-0001', title: 'x' }, {});
    expect(ev.id).toBeUndefined();
    expect(ev.extendedProperties.private['sc.id']).toBe('x-0001');
    expect(idQuery('x-0001')).toBe('sc.id=x-0001');
  });
});

describe('the description is human-only', () => {
  it('says what the thing is, and is never the source of truth', () => {
    const ev = encodeTask({ id: 'a', title: 'Wash', routineId: 'laundry-1', stepIndex: 1 }, {});
    expect(ev.description).toContain('routine step 2');
    // Wrecking the description must not affect what decodes.
    ev.description = 'the cat sat on the keyboard';
    const r = decodeEvent(ev);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe(KIND.ROUTINE_STEP);
    expect(r.task.stepIndex).toBe(1);
  });
});

describe('a repeat that ENDS — the shape no fixture had', () => {
  // ⚠️ WHY THIS BLOCK EXISTS. A real sync wrote 18 tasks and refused 8, every
  // refusal `date.getTime is not a function`, and every refused task a course.
  // The one thing courses have that nothing else here did is a TERM END —
  // `period.effectiveUntil`. `safeRRULE` works on the JSON form, where dates are
  // epoch ms; `toRRULE` works on the MODEL form and calls `.getTime()` on that
  // field. Everything in the seed repeats FOREVER, so 1014 green tests took the
  // null branch and the whole class of bug was invisible.
  //
  // The probe that found it prints the shapes:
  //   node design/probes/probe-google-bounded-repeat.mjs
  const term = () => new Date(2026, 11, 12).getTime(); // exclusive bound

  const course = (s, title, windows) => s.addFixed({
    title,
    startTime: at(10),
    endTime: at(10, 50),
    tags: ['class'],
    recurrence: {
      periods: [{
        windows,
        interval: 1,
        effectiveFrom: new Date(2026, 8, 7).getTime(),
        effectiveUntil: term(),
      }],
      anchorDate: new Date(2026, 8, 7).getTime(),
      exceptions: [],
    },
  });

  const sameTime = [
    { day: 'mon', start: '10:00', end: '10:50' },
    { day: 'wed', start: '10:00', end: '10:50' },
    { day: 'fri', start: '10:00', end: '10:50' },
  ];

  it('encodes at all, instead of throwing on the way to Google', () => {
    const s = sched();
    const t = course(s, 'General Chemistry I', sameTime);
    const ev = encodeTask(t, { timeZone: 'America/New_York' });
    expect(ev.recurrence[0]).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=/);
  });

  it('states UNTIL in UTC, which RFC 5545 §3.3.10 requires beside a zoned DTSTART', () => {
    // Not pedantry: Google answers a rule it will not accept with a 400, and
    // the event then does not appear AT ALL — the same way a BYDAY that
    // excluded its own DTSTART made a repeating gym vanish.
    const s = sched();
    const ev = encodeTask(course(s, 'Discussion', sameTime), { timeZone: 'America/New_York' });
    expect(ev.recurrence[0]).toMatch(/UNTIL=\d{8}T\d{6}Z/);
  });

  it('keeps the LAST session of term inside the rule', () => {
    // `toRRULE` bounds at MIDNIGHT of the last day it runs, which is right for
    // the `.ics` file and drops that day here: UNTIL includes an occurrence
    // that STARTS at or before it, and a 10:00 class starts after midnight.
    const s = sched();
    const ev = encodeTask(course(s, 'Lab', sameTime), { timeZone: 'America/New_York' });
    const [, stamp] = /UNTIL=(\d{8}T\d{6})Z/.exec(ev.recurrence[0]);
    const untilAt = Date.UTC(
      +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
      +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15),
    );
    const lastClass = new Date(2026, 11, 11, 10, 0, 0, 0).getTime(); // Fri 11 Dec
    expect(untilAt).toBeGreaterThanOrEqual(lastClass);
  });

  it('carries the bound onto EVERY part of a split task', () => {
    // A task with different times on different days is one event per time, and
    // that path used to hand-build its own rule — which meant it silently
    // dropped UNTIL and a class that ends in December repeated forever.
    const s = sched();
    const t = course(s, 'Foundations + Studio', [
      { day: 'tue', start: '09:00', end: '10:00' },
      { day: 'thu', start: '13:00', end: '15:00' },
    ]);
    const parts = encodeTaskParts(t, { timeZone: 'America/New_York' });
    expect(parts).toHaveLength(2);
    expect(parts[0].recurrence[0]).toMatch(/BYDAY=TU;UNTIL=\d{8}T\d{6}Z/);
    expect(parts[1].recurrence[0]).toMatch(/BYDAY=TH;UNTIL=\d{8}T\d{6}Z/);
  });

  it('refuses to split a MONTHLY pattern into weekly lies', () => {
    // The hand-built rule always said FREQ=WEEKLY. A monthly pattern with two
    // times therefore became two weekly events anchored at the same instant —
    // a mirror that lies, which is the one thing this encoding refuses to be.
    // The honest answer is ONE event, no rule, and the reason on the event.
    const s = sched();
    const t = s.addFixed({
      title: 'Board meeting',
      startTime: at(9),
      endTime: at(10),
      recurrence: {
        periods: [{
          freq: 'monthly',
          windows: [
            { monthDay: 1, start: '09:00', end: '10:00' },
            { monthDay: 15, start: '14:00', end: '15:00' },
          ],
          interval: 1,
          effectiveFrom: new Date(2026, 8, 1).getTime(),
          effectiveUntil: null,
        }],
        anchorDate: new Date(2026, 8, 1).getTime(),
        exceptions: [],
      },
    });
    const parts = encodeTaskParts(t, { timeZone: 'America/New_York' });
    expect(parts).toHaveLength(1);
    expect(parts[0].recurrence).toBeUndefined();
    expect(parts[0].extendedProperties.private['sc.norrule']).toBe('windows-differ');
  });
});
