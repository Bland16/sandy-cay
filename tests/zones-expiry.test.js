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

describe('§1.2 — exclusivity is symmetric across overlapping zones', () => {
  // A task routed into the zone it matches must still stay out of a *different*
  // exclusive zone it does not match, where the two overlap in time.
  const wideCfg = { ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } };

  beforeEach(() => resetIds());

  it('a matching task is not deposited inside an overlapping exclusive zone it does not match', () => {
    const s = new Schedule({ config: wideCfg });
    // Work claims 10:00–11:00 Mon; Study reserves 09:00–18:00 Mon and overlaps it.
    s.addZone({ label: 'Work', matchTags: ['work'], windows: [{ day: 'mon', start: '10:00', end: '11:00' }], exclusive: true });
    s.addZone({ label: 'Study', matchTags: ['study'], windows: [{ day: 'mon', start: '09:00', end: '18:00' }], exclusive: true });

    const t = s.addFlexible({ title: 'Work task', tags: ['work'], durationMin: 60, from: D(13) });
    const inStudy = (d) => d.getDay() === 1 && d.getHours() >= 9 && d.getHours() < 18;
    // Work's only window sits inside exclusive Study, so the Work zone has no
    // usable capacity Monday; the task relaxes to general windows — anywhere but
    // the study block.
    expect(inStudy(t.startTime)).toBe(false);
  });

  it('still routes a matching task into its own zone when there is no overlap conflict', () => {
    const s = new Schedule({ config: wideCfg });
    s.addZone({ label: 'Work', matchTags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '18:00' }], exclusive: true });
    const t = s.addFlexible({ title: 'Work task', tags: ['work'], durationMin: 60, from: D(13) });
    const h = t.startTime.getHours();
    expect(t.startTime.getDay()).toBe(1);
    expect(h >= 9 && h < 18).toBe(true); // inside its own Work zone
  });

  it('autoSchedule keeps a matching task clear of an overlapping exclusive zone', () => {
    const s = new Schedule({ config: wideCfg });
    s.addZone({ label: 'Work', matchTags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '18:00' }], exclusive: true });
    s.addZone({ label: 'Gym', matchTags: ['gym'], windows: [{ day: 'mon', start: '12:00', end: '13:00' }], exclusive: true });
    // Fill 09:00–12:00 so the greedy pass is tempted by the 12:00 Gym slot.
    s.addFlexible({ title: 'W1', tags: ['work'], startTime: D(13, 9), endTime: D(13, 10) });
    s.addFlexible({ title: 'W2', tags: ['work'], startTime: D(13, 10), endTime: D(13, 11) });
    s.addFlexible({ title: 'W3', tags: ['work'], startTime: D(13, 11), endTime: D(13, 12) });
    const target = s.addFlexible({ title: 'W4', tags: ['work'], durationMin: 60, from: D(13) });
    s.autoSchedule({ now: D(13) });
    const h = target.startTime.getHours();
    const inGym = target.startTime.getDay() === 1 && h >= 12 && h < 13;
    expect(inGym).toBe(false);
  });
});
