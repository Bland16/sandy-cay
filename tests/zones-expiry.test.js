import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Zone, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const D = (d, h = 0) => new Date(2026, 6, d, h, 0, 0, 0); // July 2026
const MON = D(13);

/** A summer-job work zone: weekdays 09:00–18:30, ending after Fri Jul 24. */
function workZone(extra = {}) {
  return {
    label: 'Work',
    matchTags: ['work'],
    windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({ day, start: '09:00', end: '18:30' })),
    exclusive: true,
    ...extra,
  };
}

describe('§1.2 zones can expire', () => {
  beforeEach(() => resetIds());

  it('a zone with no dates is always in force (unchanged behaviour)', () => {
    const z = new Zone(workZone());
    expect(z.activeOn(D(13))).toBe(true);
    expect(z.activeOn(D(500))).toBe(true);
  });

  it('effectiveUntil is exclusive at day granularity — the 24th is the last day', () => {
    const z = new Zone(workZone({ effectiveUntil: D(25) }));
    expect(z.activeOn(D(24, 12))).toBe(true); // Friday, still working
    expect(z.activeOn(D(25))).toBe(false); // Saturday, job's over
    expect(z.activeOn(D(27))).toBe(false);
  });

  it('effectiveFrom holds the zone off until it starts', () => {
    const z = new Zone(workZone({ effectiveFrom: D(20) }));
    expect(z.activeOn(D(19))).toBe(false);
    expect(z.activeOn(D(20))).toBe(true);
  });

  it('an expired exclusive zone stops carving personal time out of the day', () => {
    // While the job runs, 09:00–18:30 is reserved for work: a personal task is
    // pushed outside it. Once it expires, that time is ordinary again.
    const s = new Schedule({ config: { ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '08:00', end: '22:00' } } } });
    s.addZone(workZone({ effectiveUntil: D(25) }));

    const during = s.addFlexible({ title: 'Errand', tags: ['personal'], from: D(20) });
    const hour = during.startTime.getHours() + during.startTime.getMinutes() / 60;
    expect(hour < 9 || hour >= 18.5).toBe(true); // kept out of work hours

    const after = s.addFlexible({ title: 'Errand later', tags: ['personal'], from: D(27) });
    expect(after.startTime.getTime()).toBeGreaterThanOrEqual(D(27).getTime());
  });

  it('an expired zone no longer routes its own tagged work', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addZone(workZone({ effectiveUntil: D(25) }));
    // After the job ends there is no Work zone, so a work task is placed by the
    // general windows and must NOT be flagged "outside the Work zone".
    const t = s.addFlexible({ title: 'Admin', tags: ['work'], from: D(27) });
    expect(t.schedulingInfo).toBeNull();
  });

  it('dates survive a JSON round trip', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addZone(workZone({ effectiveFrom: D(13), effectiveUntil: D(25) }));
    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    const z = back.zones[0];
    expect(z.activeOn(D(24))).toBe(true);
    expect(z.activeOn(D(25))).toBe(false);
  });
});
