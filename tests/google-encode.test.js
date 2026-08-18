// Google Calendar encoding — design/GOOGLE-AS-STORAGE.md P0.
//
// Pure functions, no network, no account. `design/probes/probe-google-encode.mjs`
// prints the actual bytes; this locks the behaviour.
import { describe, it, expect } from 'vitest';
import { Schedule, defaultConfig } from '../src/core/index.js';
import {
  encodeTask, decodeEvent, kindOf, chunkString, packPayload, unpackPayload,
  checksum, byteLength, idQuery, KIND, CHUNK_BYTES, ENCODING_VERSION,
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
