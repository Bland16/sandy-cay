import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, resetIds, currentOpening, steerBias, priorityPressure } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

// Wednesday 2026-07-15; wide weekday window so openings are roomy.
const D = (d, h = 0, m = 0) => new Date(2026, 6, d, h, m, 0, 0);
const wideCfg = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });
const NOW = D(15, 14, 0);

function withBuckets(s) {
  s.addBucket({ label: 'Work', role: 'work', tags: ['work'] });
  s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] });
  s.addBucket({ label: 'Creative', role: 'creative', tags: ['art'] });
  s.addBucket({ label: 'Health', role: 'health', tags: ['gym'] });
  s.addBucket({ label: 'Social', role: 'social', tags: ['friends'] });
  return s;
}
// Add `n` recent rated tasks carrying `tag`, each overall/energy.
function rate(s, n, tag, overall, energy) {
  for (let i = 0; i < n; i += 1) {
    const day = 8 + (i % 6); // Jul 8–13, all within 14 days of NOW
    const t = s.addFixed({ title: `${tag}${i}`, tags: [tag], startTime: D(day, 9), endTime: D(day, 10) });
    t.completion = 'done';
    t.satisfaction = { overall, energy };
  }
}

describe('steerBias', () => {
  beforeEach(() => resetIds());

  it('is neutral at cold start (< 10 ratings)', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 3, 'work', 4, 1);
    const sb = steerBias(s, NOW);
    expect(sb.trained).toBe(false);
    expect(Object.values(sb.biases).every((v) => v === 0)).toBe(true);
  });

  it('running down → biases rest and health', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'work', 3, -1); // draining
    const sb = steerBias(s, NOW);
    expect(sb.trained).toBe(true);
    expect(sb.energyBalance).toBeLessThan(0);
    expect(sb.biases.rest).toBeGreaterThan(0);
    expect(sb.biases.health).toBeGreaterThan(0);
    expect(sb.reasons.rest).toMatch(/running down/i);
  });

  it('rest rated flat → shifts the lean to creative', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'rest', 2, 0); // lots of rest, low overall, energy neutral
    const sb = steerBias(s, NOW);
    expect(sb.biases.creative).toBeGreaterThan(0);
    expect(sb.biases.rest).toBeLessThanOrEqual(0);
    expect(sb.reasons.creative).toMatch(/flat/i);
  });

  it('charged + important work looming → biases work', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'work', 4, 1); // charged
    // Incomplete P5 work due within the lookahead → high priority pressure. The
    // 3-day horizon holds ~3900 usable minutes, so two 10-hour blocks clear 0.15.
    for (const day of [16, 17]) {
      const p = s.addFixed({ title: `Thesis${day}`, tags: ['work'], startTime: D(day, 8), endTime: D(day, 18) });
      p.priority = 5; p.deadline = D(17, 12);
    }
    const sb = steerBias(s, NOW);
    expect(sb.pressure).toBeGreaterThan(0.15);
    expect(sb.biases.work).toBeGreaterThan(0);
    expect(sb.reasons.work).toMatch(/looms|due|momentum/i);
  });

  it('charged + nothing pressing → biases creative and social', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'work', 4, 1); // charged, no looming deadlines
    const sb = steerBias(s, NOW);
    expect(sb.pressure).toBeLessThanOrEqual(0.15);
    expect(sb.biases.creative).toBeGreaterThan(0);
    expect(sb.biases.social).toBeGreaterThan(0);
  });
});

describe('priorityPressure', () => {
  beforeEach(() => resetIds());
  it('counts only incomplete P4–P5 work due within the lookahead', () => {
    const s = new Schedule({ config: wideCfg() });
    const p = s.addFixed({ title: 'Big', tags: ['x'], startTime: D(16, 9), endTime: D(16, 17) });
    p.priority = 5; p.deadline = D(17, 12);
    const low = s.addFixed({ title: 'Small', tags: ['x'], startTime: D(16, 18), endTime: D(16, 19) });
    low.priority = 2; low.deadline = D(17, 12); // ignored: low priority
    expect(priorityPressure(s, NOW)).toBeGreaterThan(0);
  });
});

describe('suggestActivities', () => {
  beforeEach(() => resetIds());

  it('offers only activities that fit the opening, fit-only at cold start', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    const rest = s.buckets.find((b) => b.role === 'rest');
    s.addActivity({ bucketId: rest.id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 90 });
    s.addActivity({ bucketId: rest.id, label: 'Long project', tags: ['rest'], durationMin: 240, durationMax: 300 });

    const opening = { start: D(15, 14), end: D(15, 15), minutes: 60 };
    const out = s.suggestActivities(NOW, { opening });
    expect(out.map((x) => x.activity.label)).toEqual(['Read']); // the 240-min one doesn't fit
    expect(out[0].reasons[0]).toMatch(/opening/);
  });

  it('steers the fitting activities: draining work floats rest/health up', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'work', 3, -1); // running down
    const rest = s.buckets.find((b) => b.role === 'rest');
    const health = s.buckets.find((b) => b.role === 'health');
    const work = s.buckets.find((b) => b.role === 'work');
    s.addActivity({ bucketId: rest.id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 60 });
    s.addActivity({ bucketId: health.id, label: 'Walk', tags: ['gym'], durationMin: 15, durationMax: 60 });
    s.addActivity({ bucketId: work.id, label: 'Email', tags: ['work'], durationMin: 15, durationMax: 60 });

    const opening = { start: D(15, 14), end: D(15, 15), minutes: 60 };
    const out = s.suggestActivities(NOW, { opening });
    expect(['rest', 'health']).toContain(out[0].role);
    expect(out[out.length - 1].activity.label).toBe('Email'); // work sinks
  });

  it('returns nothing when there is no opening', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });
    expect(s.suggestActivities(NOW, { opening: null })).toEqual([]);
  });
});

describe('placeActivity fills the opening', () => {
  beforeEach(() => resetIds());
  it('sizes the task to clamp(opening, min, max) and marks it user-placed', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    const a = s.addActivity({ bucketId: s.buckets[1].id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 90 });
    const { task } = s.placeActivity(a, D(15, 14), 45);
    expect((task.endTime - task.startTime) / 60000).toBe(45);
    expect(task.placedBy).toBe('user');
    expect(task.tags).toEqual(['rest']);
    // A 2-hour opening is capped at the activity's max.
    const { task: t2 } = s.placeActivity(a, D(15, 16), 120);
    expect((t2.endTime - t2.startTime) / 60000).toBe(90);
  });
});

describe('P-1 — the read path records nothing', () => {
  beforeEach(() => resetIds());
  it('suggestActivities / steerBias / priorityPressure never mutate the schedule', () => {
    const s = withBuckets(new Schedule({ config: wideCfg() }));
    rate(s, 12, 'work', 3, -1);
    s.addActivity({ bucketId: s.buckets[1].id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 60 });
    const opening = currentOpening(s, NOW);
    const before = JSON.stringify(s.toJSON());

    // Cycle the picker a bunch — exactly what "skipping" does.
    for (let i = 0; i < 5; i += 1) {
      s.suggestActivities(NOW, { opening });
      steerBias(s, NOW);
      priorityPressure(s, NOW);
    }

    expect(JSON.stringify(s.toJSON())).toBe(before); // untouched — no rating, no tracking
    expect(s.learning.sampleCount).toBe(0);
  });
});
