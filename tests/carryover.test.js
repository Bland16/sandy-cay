import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds, letThemGo } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

// From-week = week of 2026-07-06 (Mon). To-week = 2026-07-13. "now" = Wed 07-15.
const FROM = new Date(2026, 6, 6, 0, 0, 0, 0);
const TO = new Date(2026, 6, 13, 0, 0, 0, 0);
const NOW = new Date(2026, 6, 15, 12, 0, 0, 0);
const F = (offset, h, mi = 0) => {
  const d = new Date(FROM.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(h, mi, 0, 0);
  return d;
};

describe('3E — carryOver classification (OD-9/13)', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('classifies recurring / missed-deadline / carried', () => {
    // Normal incomplete flexible in the past → carried.
    const normal = s.addFlexible({ title: 'Read', startTime: F(0, 10), endTime: F(0, 11) });
    // Deadline already passed → missedDeadline, not moved.
    const missed = s.addFlexible({ title: 'Late paper', startTime: F(0, 12), endTime: F(0, 13), deadline: F(1, 12) });
    // Recurring → dropped (regenerated naturally).
    const rec = new Task({
      title: 'Standup',
      type: 'fixed',
      startTime: F(0, 9),
      endTime: F(0, 9, 30),
      recurrence: { periods: [{ windows: [{ day: 'mon', start: '09:00', end: '09:30' }], interval: 1, effectiveFrom: null, effectiveUntil: null }], anchorDate: FROM, exceptions: [] },
    });
    s.tasks.push(rec);

    const res = s.carryOver(FROM, TO, { now: NOW });
    expect(res.carried.map((t) => t.id)).toContain(normal.id);
    expect(res.missedDeadline.map((t) => t.id)).toContain(missed.id);
    expect(res.dropped.map((t) => t.id)).toContain(rec.id);
    // Carried task moved into the target week + counter incremented.
    expect(normal.getDayIndex(TO)).toBeGreaterThanOrEqual(0);
    expect(normal.getDayIndex(TO)).toBeLessThanOrEqual(6);
    expect(normal.history.carriedCount).toBe(1);
    expect(missed.missedDeadline).toBe(true);
  });

  it('letThemGo marks incomplete past tasks skipped (guilt-free end)', () => {
    const t = s.addFlexible({ title: 'Chore', startTime: F(0, 10), endTime: F(0, 11) });
    const released = letThemGo(s, FROM, { now: NOW });
    expect(released.map((x) => x.id)).toContain(t.id);
    expect(t.completion).toBe('skipped');
  });
});

describe('§2.2 — carryOver keeps a non-work task out of the exclusive zone', () => {
  const wideCfg = { ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } };
  const workZone = () => ({
    label: 'Work',
    matchTags: ['work'],
    windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({ day, start: '09:00', end: '18:30' })),
    exclusive: true,
  });
  const inZone = (d) => {
    const h = d.getHours() + d.getMinutes() / 60;
    return d.getDay() >= 1 && d.getDay() <= 5 && h >= 9 && h < 18.5;
  };

  it('a carried personal task lands in ordinary hours, never in work time', () => {
    resetIds();
    const s = new Schedule({ config: wideCfg });
    s.addZone(workZone());
    // A personal errand from last week (Tue), incomplete and now in the past.
    const errand = s.addFlexible({ title: 'Errand', tags: ['personal'], startTime: F(1, 10), endTime: F(1, 11) });
    errand.placedBy = 'user';

    const res = s.carryOver(FROM, TO, { now: NOW });
    const carried = res.carried.find((t) => t.id === errand.id);
    expect(carried).toBeTruthy();
    expect(inZone(carried.startTime)).toBe(false);
  });
});
