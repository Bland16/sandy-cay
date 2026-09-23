// A project spreads across its range (design/PROJECT-SPREAD.md).
//
// Reported from the running app: "I added a new project from Friday to Thursday
// and it scheduled all sessions during Saturday." Reproduced — 600 minutes over
// seven days laid FOUR sittings on the first day and one on the next, leaving
// five days of the range empty. Which day it piled onto is just where the range
// started.
//
// The cause was `redistribute` handing every chunk the same search floor while
// `proximity` (0.5) outweighs `balance` (0.35), so proximity won and the chunks
// crowded the front. Commitments have always called `spreadDays`; projects never
// did — two features laying N sittings over a range, only one of them spreading.

import { describe, it, expect } from 'vitest';
import { Schedule, dateKey } from '../src/core/index.js';

const FRI = new Date(2026, 8, 18, 0, 0, 0);    // Fri 18 Sep 2026
const THU = new Date(2026, 8, 24, 23, 59, 0);  // Thu 24 Sep 2026
const NOW = new Date(2026, 8, 18, 6, 0, 0);    // before the range opens

function project(s, { total = 600, minChunk = 60, maxChunk = 120, from = FRI, until = THU } = {}) {
  return s.addProject({
    title: 'Essay',
    tags: ['study'],
    now: NOW,
    chunking: { totalMinutes: total, minChunk, maxChunk, range: { from, until } },
  });
}

const daysUsed = (children) => [...new Set(children.map((c) => dateKey(c.startTime)))];

describe('a project spreads across its range', () => {
  it('THE REGRESSION: does not put every sitting on one day', () => {
    const s = new Schedule({});
    const { children } = project(s);
    expect(children.length).toBeGreaterThan(1);
    // Was 4-of-5 on day one. Every sitting on its own day now.
    expect(daysUsed(children).length).toBe(children.length);
  });

  it('reaches the far end of the range, not just the front', () => {
    const s = new Schedule({});
    const { children } = project(s);
    const last = children.reduce((m, c) => (c.startTime > m.startTime ? c : m));
    // The old behaviour never got past day two of a seven-day range.
    expect(last.startTime.getTime()).toBeGreaterThan(new Date(2026, 8, 21).getTime());
  });

  it('conserves the work — same minutes, same slicing, different days', () => {
    const s = new Schedule({});
    const { parent, children } = project(s, { total: 600 });
    expect(children.reduce((n, c) => n + c.getDuration(), 0)).toBe(600);
    expect(parent.chunking.totalMinutes).toBe(600);
    for (const c of children) {
      expect(c.getDuration()).toBeGreaterThanOrEqual(60);
      expect(c.getDuration()).toBeLessThanOrEqual(120);
    }
  });

  it('every sitting lands inside the range', () => {
    const s = new Schedule({});
    const { children } = project(s);
    for (const c of children) {
      expect(c.startTime.getTime()).toBeGreaterThanOrEqual(FRI.getTime());
      expect(c.endTime.getTime()).toBeLessThanOrEqual(THU.getTime());
    }
  });

  it('doubles up evenly when there are more chunks than days', () => {
    const s = new Schedule({});
    // 12 × 60m over a 3-day range — four sittings must share each day.
    const { children } = project(s, {
      total: 720, minChunk: 60, maxChunk: 60,
      from: FRI, until: new Date(2026, 8, 20, 23, 59, 0),
    });
    expect(children.length).toBe(12);
    const perDay = {};
    for (const c of children) perDay[dateKey(c.startTime)] = (perDay[dateKey(c.startTime)] || 0) + 1;
    const counts = Object.values(perDay);
    // Round-robin, so no day carries everything and none is left out.
    expect(counts.length).toBeGreaterThan(1);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('a one-sitting project still places', () => {
    const s = new Schedule({});
    const { children } = project(s, { total: 90, minChunk: 60, maxChunk: 120 });
    expect(children).toHaveLength(1);
    expect(children[0].getDuration()).toBe(90);
  });

  it('⚠️ the chosen day is a FLOOR, not a fence — a full day falls forward', () => {
    const s = new Schedule({});
    // Block the whole of Monday, which the spread would otherwise choose.
    const MON = new Date(2026, 8, 21);
    s.addFixed({
      title: 'All-day conference',
      startTime: new Date(2026, 8, 21, 8, 0, 0),
      endTime: new Date(2026, 8, 21, 23, 0, 0),
    });
    const { children, parent } = project(s);
    // Nothing is parked on top of the conference, and nothing is lost.
    expect(children.reduce((n, c) => n + c.getDuration(), 0)).toBe(600);
    expect(parent.schedulingWarning).toBe(false);
    for (const c of children) {
      if (dateKey(c.startTime) !== dateKey(MON)) continue;
      // If anything did land on Monday it must not overlap the conference.
      expect(c.startTime.getHours()).toBeGreaterThanOrEqual(23);
    }
  });
});
