// The generation engine (design/WEEKLY-PLANNING.md §4.1.1 / §4.1.2).
//
// §4.1.1 was chosen from SEVEN candidates evaluated twice; six lost. These tests
// lock the properties that made candidate 5 win, because every losing candidate
// failed one of them and a "simplification" would quietly reintroduce it.
import { describe, it, expect } from 'vitest';
import {
  Schedule, defaultConfig, resetIds, weekStart as weekStartOf, addDays, dateKey,
  generateSittings, generateAll, runwayEnd, gapsOnDay, addMinutes, Task,
} from '../src/core/index.js';

const MON = weekStartOf(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const NOW = new Date(2026, 8, 7, 8, 0, 0);
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };

/** A real term week: classes Mon/Wed/Fri, seminars Tue/Thu, gym Monday evening. */
const termWeek = () => {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const cls = (o, h, e, t) => s.addFixed({ title: t, tags: ['classes'], startTime: at(o, h), endTime: at(o, e) });
  cls(0, 9, 10, 'CHEM'); cls(2, 9, 10, 'CHEM'); cls(4, 9, 10, 'CHEM');
  cls(1, 11, 12, 'THEO'); cls(3, 11, 12, 'THEO');
  cls(0, 13, 14, 'disc'); cls(1, 14, 15, 'ENGR'); cls(3, 14, 15, 'ENGR');
  s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(0, 17), endTime: at(0, 19) });
  return s;
};

const commitment = (over) => ({
  id: 'p', title: 'Coursework', tags: ['study'],
  amountMin: 480, from: MON, until: addDays(MON, 13),
  minSitting: 60, maxSitting: 180, maxPerDay: 1,
  ...over,
});

const daysUsed = (sittings) => [...new Set(sittings.map((t) => dateKey(t.startTime)))].sort();
const longestStreak = (sittings) => {
  const d = daysUsed(sittings);
  if (!d.length) return 0;
  let best = 1; let run = 1;
  for (let i = 1; i < d.length; i += 1) {
    run = (new Date(d[i]) - new Date(d[i - 1])) === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
};

describe('nothing is placed in hours that have already gone', () => {
  // ⚠️ Found by design/probes/probe-commitment-cases.mjs (A3/A4), and it is the
  // THIRD time this class of defect has appeared: `redistribute` laid chunks
  // into a Monday that had gone, and `placeTask`'s parking branch put overdue
  // work at 08:00 that same morning. Both were floored at `now`; this one was
  // not, because `generateSittings` floored at `dayStart(now)` — midnight
  // TODAY — so today's gaps were reported from the 08:00 window opening however
  // late it already was.
  //
  // Measured: with the clock at noon on Wednesday, a 3h sitting was placed at
  // Wednesday 10:30 — ninety minutes into the past.
  it('does not place earlier TODAY than the clock', () => {
    const s = termWeek();
    const WED_NOON = new Date(2026, 8, 9, 12, 0, 0);
    const r = generateSittings(s, commitment(), { now: WED_NOON });
    expect(r.sittings.length).toBeGreaterThan(0);
    for (const t of r.sittings) {
      expect(t.startTime.getTime()).toBeGreaterThanOrEqual(WED_NOON.getTime());
    }
  });

  it('reports the OPEN MINUTES left today from the clock, not the window opening', () => {
    // ⚠️ This one nearly shipped unproven. Reverting the `gapsOnDay` floor left
    // both tests above still GREEN, because `searchFrom` alone stops the bad
    // placement — so the floor was an unproven change, which is the exact shape
    // this project has twice caught as a vacuous fix. It earns its place for a
    // different reason and needs its own test:
    //
    // step 3 picks the LONGEST gaps first, and without the floor today's run
    // reads 08:00–23:00 however late it is. A half-spent Wednesday advertises
    // fifteen hours and gets chosen over a genuinely empty Saturday. The same
    // over-count reaches rho through `openMinutesFor`, understating exactly the
    // commitment that is most constrained.
    const s = termWeek();
    const WED = addDays(MON, 2);
    const NOON = new Date(2026, 8, 9, 12, 0, 0);
    const probe = new Task({
      title: 'p', tags: ['study'], type: 'flexible',
      startTime: WED, endTime: addMinutes(WED, 60),
    });
    const open = gapsOnDay(s, probe, WED, [], null).reduce((n, g) => n + g.minutes, 0);
    const left = gapsOnDay(s, probe, WED, [], NOON).reduce((n, g) => n + g.minutes, 0);
    expect(left).toBeLessThan(open);
    for (const g of gapsOnDay(s, probe, WED, [], NOON)) {
      expect(g.start.getTime()).toBeGreaterThanOrEqual(NOON.getTime());
    }
  });

  it('still uses the REST of today — the floor must not become an exclusion', () => {
    // An afternoon is still time. Scoped to a window where TODAY is the only
    // day there is, because over a fortnight the spread may legitimately pick
    // another day and the test would be asserting the spread, not the floor.
    // (My first version did exactly that and failed for the wrong reason.)
    const s = termWeek();
    const WED_NOON = new Date(2026, 8, 9, 12, 0, 0);
    const r = generateSittings(
      s,
      commitment({ amountMin: 120, minSitting: 60, maxSitting: 120, from: addDays(MON, 2), until: addDays(MON, 3) }),
      { now: WED_NOON },
    );
    expect(r.sittings.length).toBe(1);
    expect(dateKey(r.sittings[0].startTime)).toBe('2026-09-09');
    expect(r.sittings[0].startTime.getHours()).toBeGreaterThanOrEqual(12);
  });
});

describe('R* is a PREFERENCE, not a wall (PLAN D-10)', () => {
  // ⚠️ Found by a probe agent, decided by the user 2026-08-16.
  //
  // §4.4 argues the finish-early buffer is a preference and `scoring.js`
  // already applies it. §4.1.1 step 1 applied it a SECOND time by truncating
  // the candidate DAYS at R* — and `runwayEnd(Mon, next Mon)` is Sat 14:24, so
  // a Monday-planned Mon–Sun week NEVER OFFERED SUNDAY. 47 of 3000 fuzzed weeks
  // reported a shortfall while a Sunday with room sat empty; for a student the
  // weekend is exactly where the long runs live (§4.5).
  const weekdaysFull = () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    for (let d = 0; d < 5; d += 1) {
      s.addFixed({ title: `full ${d}`, tags: ['classes'], startTime: at(d, 8), endTime: at(d, 21) });
    }
    return s;
  };
  const thesis = (amountMin) => ({
    ...commitment(), amountMin, minSitting: 90, maxSitting: 240, maxPerDay: 1, until: addDays(MON, 7),
  });

  it('reaches Sunday rather than manufacturing a shortfall', () => {
    // Measured with the retry disabled: short 15m across Sat+Mon+Wed+Thu with
    // Sunday untouched. With it: short 5m, Sunday used. The 5m residual is gap
    // arithmetic — the bounds cannot tile 600m exactly — not the wall.
    const r = generateSittings(weekdaysFull(), thesis(600), { now: NOW });
    expect(r.sittings.some((t) => t.startTime.getDay() === 0)).toBe(true);
    expect(r.shortfall).toBeLessThan(15);
  });

  it('leaves a week that ALREADY fits alone — finish-early is preserved', () => {
    // The retry fires only when the buffered plan falls short, so a week that
    // can afford the buffer still finishes early and never touches Sunday.
    const r = generateSittings(weekdaysFull(), thesis(180), { now: NOW });
    expect(r.shortfall).toBe(0);
    expect(r.sittings.some((t) => t.startTime.getDay() === 0)).toBe(false);
  });

  it('keeps runwayEnd itself unchanged — the buffer is not deleted', () => {
    const end = runwayEnd(MON, addDays(MON, 10));
    expect(Math.round((addDays(MON, 10) - end) / 86400000)).toBe(2);
  });
});

describe('step 5 re-homes by CAPACITY, not by position', () => {
  // ⚠️ Found by a probe agent. Sittings leave step 4 DESCENDING by minutes;
  // `spreadDays` returns days ASCENDING by date. They were paired POSITIONALLY,
  // so the longest sitting was always handed the earliest candidate day
  // whatever that day's longest free run was — `placeTask` then fell through to
  // its last-resort park and dropped a 3h block on top of an all-day booking
  // while the app reported "700/700m short 0m". In a 2000-week fuzz, 68 of 77
  // parked sittings were this.
  //
  // It also falsified this module's own header: "the day already has room for
  // it by construction".
  const tapering = () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    // A week that gets FREER as it goes on — the shape that exposes it.
    s.addFixed({ title: 'Mon work', tags: ['work'], startTime: at(0, 8), endTime: at(0, 21) });
    s.addFixed({ title: 'Tue work', tags: ['work'], startTime: at(1, 8), endTime: at(1, 20) });
    return s;
  };
  const big = { ...commitment(), amountMin: 700, minSitting: 60, maxSitting: 180, maxPerDay: 1, until: addDays(MON, 7) };

  it('never lays a sitting on top of what is already there', () => {
    const s = tapering();
    const r = generateSittings(s, big, { now: NOW });
    expect(r.sittings.length).toBeGreaterThan(0);
    for (const t of r.sittings) {
      for (const o of s.tasks) {
        if (o === t || o.chunking || !o.startTime || !o.endTime) continue;
        expect(t.startTime < o.endTime && o.startTime < t.endTime).toBe(false);
      }
    }
  });

  it('states the shortfall instead of claiming a full week it could not place', () => {
    // Before the capacity fix: "700/700m short 0m" with a 3h sitting sitting on
    // top of an all-day booking. The honest answer is a stated shortfall.
    //
    // ⚠️ The fixture is a week that GENUINELY cannot fit it — every day booked
    // 08:00–21:00, so 120m a day. My first version used the tapering week, and
    // the later `rest`-pool fix made that week fully placeable, so the test was
    // asserting a shortfall that had correctly stopped existing.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    for (let d = 0; d < 7; d += 1) {
      s.addFixed({ title: `busy ${d}`, tags: ['work'], startTime: at(d, 8), endTime: at(d, 21) });
    }
    const r = generateSittings(s, big, { now: NOW });
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    expect(placed + r.shortfall).toBe(700);
    expect(r.shortfall).toBeGreaterThan(0);
    // …and still nothing on top of anything.
    for (const t of r.sittings) {
      for (const o of s.tasks) {
        if (o === t || o.chunking || !o.startTime || !o.endTime) continue;
        expect(t.startTime < o.endTime && o.startTime < t.endTime).toBe(false);
      }
    }
  });

  it('never gives up minutes while a candidate day still has room', () => {
    // ⚠️ A REGRESSION INTRODUCED BY THE CAPACITY FIX ABOVE, found by the probe
    // agent in a 3000-week fuzz (6 hits). Day matching searched only `spread`
    // plus the sitting's own gap day — but the spread is a PREFERENCE for which
    // days, not a shortlist of the only legal ones. One week dropped 160m into
    // the shortfall while Tuesday held a free 175m run and no sittings at all.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    // Each day booked from 08:00 until it tapers — later days are freer, so
    // `spreadDays` picks a subset and leaves days with room unpicked.
    [21, 20, 19, 18, 17].forEach((h, i) => s.addFixed({
      title: `busy ${i}`, tags: ['work'], startTime: at(i, 8), endTime: at(i, h),
    }));
    const c = { ...commitment(), amountMin: 700, minSitting: 60, maxSitting: 180, maxPerDay: 1, until: addDays(MON, 7) };
    const r = generateSittings(s, c, { now: NOW });

    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    expect(placed + r.shortfall).toBe(700);
    expect(r.shortfall).toBe(0); // every minute found a day
    expect(r.sittings.length).toBe(4);
  });

  it('respects maxPerDay above 1 — it was only ever safe at 1 by luck', () => {
    // `spreadDays` returning fewer days than sittings made `|| sit.gap.date`
    // refill the tail from the original gaps, and the per-day counter
    // `chooseSittings` maintained was never re-checked after the re-home.
    const s = tapering();
    for (const maxPerDay of [2, 3]) {
      const r = generateSittings(s, { ...big, maxPerDay, maxSitting: 120, amountMin: 480 }, { now: NOW });
      const perDay = {};
      for (const t of r.sittings) {
        const k = dateKey(t.startTime);
        perDay[k] = (perDay[k] || 0) + 1;
      }
      for (const n of Object.values(perDay)) expect(n).toBeLessThanOrEqual(maxPerDay);
    }
  });
});

describe('step 1 — R* ends a fifth of the runway early', () => {
  it('reserves a fifth of the RUNWAY, not a fifth of the task', () => {
    const end = runwayEnd(MON, addDays(MON, 10));
    // 10 days of runway → the last 2 are buffer.
    expect(Math.round((addDays(MON, 10) - end) / 86400000)).toBe(2);
  });
});

describe('steps 3–4 — sittings are GAP-SHAPED', () => {
  it('fits the whole amount and reports no shortfall when the week has room', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment(), { now: NOW });
    expect(r.sittings.reduce((n, t) => n + t.getDuration(), 0)).toBe(480);
    expect(r.shortfall).toBe(0);
  });

  it('does NOT equalise — that line was corrected out of the spec', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment(), { now: NOW });
    const sizes = r.sittings.map((t) => t.getDuration());
    // Equalising 480 over 3 would give 160/160/160, and the third day's longest
    // run may be shorter than that — "a number the week cannot honour", which is
    // exactly what eliminated candidates 2, 4, 6 and 7.
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it('never emits a sitting below the stated minimum', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment({ minSitting: 90 }), { now: NOW });
    for (const t of r.sittings) expect(t.getDuration()).toBeGreaterThanOrEqual(90);
  });

  it('never exceeds the stated maximum', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment({ maxSitting: 120 }), { now: NOW });
    for (const t of r.sittings) expect(t.getDuration()).toBeLessThanOrEqual(120);
  });

  it('a 45-minute amount is ONE 45-minute sitting, not a booked block', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment({ amountMin: 45, minSitting: 30, until: addDays(MON, 6) }), { now: NOW });
    expect(r.sittings).toHaveLength(1);
    expect(r.sittings[0].getDuration()).toBe(45);
  });

  it('honours maxPerDay', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment({ maxPerDay: 1 }), { now: NOW });
    expect(daysUsed(r.sittings)).toHaveLength(r.sittings.length);
  });
});

describe('step 5 — spread, because burnout is CLUSTERING not sitting length', () => {
  it('does not lay 20 hours down consecutive evenings', () => {
    const s = termWeek();
    const r = generateSittings(s, commitment({ amountMin: 1200, minSitting: 120, maxSitting: 240 }), { now: NOW });
    expect(r.sittings.length).toBeGreaterThan(2);
    // Greedy would give one run the length of the whole set. Shortening the
    // sitting to "fix" that produces MORE consecutive evenings, not fewer.
    expect(longestStreak(r.sittings)).toBeLessThan(r.sittings.length);
  });
});

describe('step 6 — the placer cannot undo the plan', () => {
  it('places nothing before now', () => {
    const s = termWeek();
    const late = new Date(2026, 8, 9, 12, 0, 0); // Wed midday
    const r = generateSittings(s, commitment(), { now: late });
    for (const t of r.sittings) expect(t.startTime.getTime()).toBeGreaterThanOrEqual(new Date(2026, 8, 9).getTime());
  });

  it('places nothing on a blocked day (D-6 binds the generator too)', () => {
    const s = termWeek();
    for (let i = 0; i < 14; i += 1) if (i % 2 === 0) s.blockDay(addDays(MON, i));
    const r = generateSittings(s, commitment({ amountMin: 240 }), { now: NOW });
    for (const t of r.sittings) expect(s.isDayBlocked(t.startTime)).toBe(false);
  });

  it('overlaps nothing already in the day', () => {
    const s = termWeek();
    const before = s.tasks.map((t) => ({ start: t.startTime, end: t.endTime }));
    const r = generateSittings(s, commitment(), { now: NOW });
    for (const t of r.sittings) {
      for (const iv of before) {
        expect(t.startTime < iv.end && iv.start < t.endTime).toBe(false);
      }
    }
  });
});

describe('§4.1.2 — several commitments', () => {
  const three = () => ([
    { id: 'a', title: 'Thesis', tags: ['study'], amountMin: 600, from: MON, until: addDays(MON, 13), minSitting: 60, maxSitting: 180, maxPerDay: 1, priority: 3 },
    { id: 'b', title: 'Reading', tags: ['study'], amountMin: 240, from: MON, until: addDays(MON, 13), minSitting: 60, maxSitting: 120, maxPerDay: 1, priority: 3 },
    { id: 'c', title: 'Lab', tags: ['study'], amountMin: 120, from: MON, until: addDays(MON, 4), minSitting: 60, maxSitting: 120, maxPerDay: 1, priority: 5 },
  ]);

  it('orders by ρ descending — amount owed over its OWN open time', () => {
    const s = termWeek();
    const out = generateAll(s, three(), { now: NOW });
    const rhos = out.map((r) => r.rho);
    expect(rhos).toEqual([...rhos].sort((a, b) => b - a));
    // A nearer deadline shrinks the denominator, so the small urgent Lab
    // outranks the larger Reading despite owing a quarter as much.
    const order = out.map((r) => r.commitment.title);
    expect(order.indexOf('Lab')).toBeLessThan(order.indexOf('Reading'));
  });

  it('is SEQUENTIAL — commitments do not all aim at the same days', () => {
    const s = termWeek();
    const out = generateAll(s, three(), { now: NOW });
    const all = out.flatMap((r) => r.days);
    // Independent spreading makes three commitments collide on day 0, 2, 4 —
    // the same "no sibling awareness" flaw the engine evaluation found in
    // scoring.js, relocated into the generator.
    expect(all.length).toBe(new Set(all).size);
  });

  it('is idempotent in its ordering, so replanning is stable', () => {
    const a = generateAll(termWeek(), three(), { now: NOW }).map((r) => r.commitment.title);
    const b = generateAll(termWeek(), three(), { now: NOW }).map((r) => r.commitment.title);
    expect(a).toEqual(b);
  });
});

describe('§4.3 — a shortfall is stated, never hidden', () => {
  it('reports what would not fit rather than cramming it in', () => {
    const s = termWeek();
    // 200 hours cannot fit in a fortnight, and saying so is the answer.
    const r = generateSittings(s, commitment({ amountMin: 12000 }), { now: NOW });
    expect(r.shortfall).toBeGreaterThan(0);
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    expect(placed + r.shortfall).toBe(12000);
  });
});
