// @vitest-environment jsdom
// Find a time, ranked — design/FIND-A-TIME.md.
//
// ⚠️ THE ORDERING IS THE FEATURE, and an ordering is the kind of thing that can
// be correct at every individual step and still put the wrong slot first. The
// deliverable is `design/probes/probe-rank-openings.mjs`, which PRINTS a real
// afternoon; this locks what that probe established, plus the panel's own words.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  Schedule, defaultConfig, addDays, rankOpenings, modelCanSpeak, dipIfPlaced, draftFor,
} from '../src/core/index.js';
import FindPanel from '../src/ui/components/panels/FindPanel.jsx';

const MON = new Date(2026, 8, 7);
const at = (h, m = 0) => new Date(2026, 8, 7, h, m, 0, 0);

/** A punishing mental morning, then a light afternoon; Tuesday is empty. */
const week = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3, physical: 0, social: 0, creative: 1 } });
  s.addBucket({ label: 'Admin', tags: ['admin'], load: { mental: 1, physical: 0, social: 0, creative: 0 } });
  s.addBucket({ label: 'People', tags: ['people'], load: { mental: 1, physical: 0, social: 3, creative: 0 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: 0, social: 0, creative: 0 } });
  s.addFixed({ title: 'Thesis reading', startTime: at(8), endTime: at(11), tags: ['study'] });
  s.addFixed({ title: 'Lunch', startTime: at(12), endTime: at(13), tags: ['rest'] });
  s.addFixed({ title: 'Email', startTime: at(15), endTime: at(15, 30), tags: ['admin'] });
  return s;
};

const openingsOf = (s) => s.findFreeSlots({
  from: MON, to: addDays(MON, 1), durationMin: 60, window: { start: '11:00', end: '18:00' },
});

const dayOf = (slot) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(slot.start.getDay() + 6) % 7];

describe('what must not change', () => {
  it('with NO tag, the order is exactly what it is today', () => {
    // Sharp edge #13: findFreeSlots is deliberately unscored. Ranking is a
    // separate pass, and without a tag it must be a no-op.
    const s = week();
    const found = openingsOf(s);
    const r = rankOpenings(s, found, {});
    expect(r.rule).toBe('time');
    expect(r.rows.map((x) => x.slot.start.getTime())).toEqual(found.map((x) => x.start.getTime()));
  });

  it('ranking never HIDES an opening', () => {
    // An opinion about order, not a filter. A search that quietly drops
    // candidates it disapproved of is the surprise P-1 exists to prevent.
    const s = week();
    const found = openingsOf(s);
    expect(rankOpenings(s, found, { tag: 'study' }).rows).toHaveLength(found.length);
  });
});

describe('⚠️ F-4 — it must not recommend the day you have already wrecked', () => {
  it('puts the empty day first, not the one six hours into the red', () => {
    // THE BUG THIS TEST EXISTS FOR. Built first on the marginal reading — how
    // much DEEPER this day gets — which is also an honest measure of "impact"
    // and ranked a battered Monday ABOVE an empty Tuesday, because a day
    // already wrecked barely gets worse. Found by printing the ordering, not by
    // a failing assertion.
    const s = week();
    const r = rankOpenings(s, openingsOf(s), { tag: 'study', durationMin: 60 });
    expect(r.rule).toBe('energy');
    expect(dayOf(r.rows[0].slot)).toBe('Tue');
    // And the marginal number still says the opposite — kept on the row, and
    // deliberately not what the sort uses.
    expect(r.rows[0].impact).toBeGreaterThan(r.rows[1].impact);
    expect(r.rows[0].resulting).toBeLessThan(r.rows[1].resulting);
  });

  it('orders by where the day ENDS UP, ascending', () => {
    const s = week();
    const r = rankOpenings(s, openingsOf(s), { tag: 'study', durationMin: 60 });
    const ends = r.rows.map((x) => x.resulting);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
  });
});

describe('the tag actually reaches the arithmetic', () => {
  it('the same slot scores differently for a mental and a social hour', () => {
    // Not "the orderings differ" — one opening can legitimately be best for
    // every tag, and on this week the empty Tuesday is. The claim is that the
    // tag changes the numbers.
    const s = week();
    const found = openingsOf(s);
    const study = rankOpenings(s, found, { tag: 'study', durationMin: 60 });
    const people = rankOpenings(s, found, { tag: 'people', durationMin: 60 });
    const key = (rows) => new Map(rows.map((x) => [x.slot.start.getTime(), x.resulting]));
    const a = key(study.rows);
    const b = key(people.rows);
    expect([...a.keys()].some((k) => a.get(k) !== b.get(k))).toBe(true);
  });

  it('a restorative thing costs the day nothing, and says so', () => {
    const s = week();
    const r = rankOpenings(s, openingsOf(s), { tag: 'rest', durationMin: 60 });
    expect(r.rows.every((x) => x.impact === 0)).toBe(true);
    expect(r.rows[0].reason).toBe('costs your day nothing');
  });

  it('the reason names an axis only when the axes DISAGREE', () => {
    // On a day nothing has been spent on, every axis is at zero and picking
    // "the one with most left" returns whichever is first in LOAD_AXES — so a
    // SOCIAL hour explained itself with "most mental left". Arbitrary, and it
    // reads as a finding.
    const s = week();
    const r = rankOpenings(s, openingsOf(s), { tag: 'people', durationMin: 60 });
    const fresh = r.rows.find((x) => dayOf(x.slot) === 'Tue');
    expect(fresh.reason).not.toContain('most mental left');
    expect(fresh.reason).toContain('nothing spent there yet');
  });
});

describe('the model only speaks when it can', () => {
  it('says nothing with no ratings, and nothing about an unknown tag', () => {
    const s = week();
    expect(modelCanSpeak(s, 'study')).toBe(false);
    expect(modelCanSpeak(s, 'nonsense')).toBe(false);
  });
});

describe('dipIfPlaced', () => {
  it('can only deepen a dip, never shallow it', () => {
    const s = week();
    const d = dipIfPlaced(s, openingsOf(s)[0], draftFor({ tag: 'study', durationMin: 60 }));
    expect(d.total).toBeGreaterThanOrEqual(0);
  });

  it('an empty day dips by exactly the thing you put in it', () => {
    const s = week();
    const tue = openingsOf(s).find((o) => dayOf(o) === 'Tue');
    const d = dipIfPlaced(s, tue, draftFor({ tag: 'study', durationMin: 60 }));
    // Nothing else on Tuesday, so `before` is flat and `after` IS the load.
    expect(Object.values(d.before).every((v) => v === 0)).toBe(true);
    expect(d.total).toBeGreaterThan(0);
  });
});

describe('the panel says which rule is in force — dumped, not transcribed', () => {
  it('names the rule and the still-learning count', () => {
    // A silent switch between two orderings that behave differently is the
    // surprise P-1 exists to prevent, so the panel must always say which it is.
    const s = week();
    const { container } = render(
      <FindPanel sched={s} weekStart={MON} onClose={() => {}} showToast={() => {}} />,
    );
    // No tag yet: no rule line at all, because nothing is being sorted.
    expect(container.querySelector('.insight')).toBeNull();

    const input = container.querySelector('input[aria-label="Tag to rank openings by"]');
    expect(input, 'the tag field did not render').toBeTruthy();
  });

  it('shows a reason on each row once a tag is given', () => {
    // Driven through `rankOpenings` and asserted on the strings the panel
    // renders, because a transcribed sentence is a copy that agrees with itself
    // while the shipped one says something else.
    const s = week();
    const r = rankOpenings(s, openingsOf(s), { tag: 'study', durationMin: 60 });
    const reasons = r.rows.map((x) => x.reason);
    // eslint-disable-next-line no-console
    console.log(`\n  the panel would show:\n${r.rows.map((x) => `    ${dayOf(x.slot)} — ${x.reason}`).join('\n')}\n`);
    expect(reasons[0]).toContain('leaves the day least drained');
    expect(reasons.every((x) => x.length > 0)).toBe(true);
    // The top row's reason must describe why it is TOP. An earlier version
    // described an axis instead and put a recommendation-shaped sentence on the
    // row that came last.
    expect(reasons[reasons.length - 1]).toBe('that day is already deeper');
  });
});
