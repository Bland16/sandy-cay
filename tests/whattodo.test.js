import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0);
const D = (offset, h, mi = 0) => new Date(2026, 6, 13 + offset, h, mi, 0, 0);

describe('§6 whatToDo (cold start)', () => {
  let s;
  beforeEach(() => {
    resetIds();
    s = new Schedule({ config: defaultConfig });
  });

  it('ranks by urgency/fit/priority, returns ≤3 with reasons', () => {
    s.addFlexible({ title: 'Low', priority: 1, startTime: D(0, 11), endTime: D(0, 12) });
    s.addFlexible({ title: 'Due tomorrow', priority: 3, startTime: D(0, 13), endTime: D(0, 14), deadline: D(1, 12) });
    s.addFlexible({ title: 'High', priority: 5, startTime: D(0, 14), endTime: D(0, 15) });
    s.addFlexible({ title: 'Other', priority: 2, startTime: D(0, 15), endTime: D(0, 16) });

    const now = D(0, 9, 0);
    const picks = s.whatToDo(now);
    expect(picks.length).toBeLessThanOrEqual(3);
    expect(picks.length).toBeGreaterThan(0);
    // Every pick carries at least one reason derived from scoring terms.
    for (const p of picks) expect(p.reasons.length).toBeGreaterThan(0);
    // Scores are sorted descending.
    for (let i = 1; i < picks.length; i += 1) expect(picks[i - 1].score).toBeGreaterThanOrEqual(picks[i].score);
  });

  it('a schedulingWarning task floats to the top', () => {
    const warn = s.addFlexible({ title: 'Parked', priority: 1, startTime: D(0, 16), endTime: D(0, 17) });
    warn.schedulingWarning = true;
    s.addFlexible({ title: 'Normal', priority: 3, startTime: D(0, 12), endTime: D(0, 13) });
    const picks = s.whatToDo(D(0, 9));
    expect(picks[0].task.id).toBe(warn.id);
  });
});
