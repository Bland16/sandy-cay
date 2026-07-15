import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds, LearningModule } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const day = (offset, h) => new Date(2026, 6, 13 + offset, h, 0, 0, 0);

function ratedTask(title, hour, overall) {
  const t = new Task({ title, tags: ['study'], startTime: day(0, hour), endTime: day(0, hour + 1) });
  t.satisfaction = { overall, timingFit: 0, durationFit: 0, energy: 0 };
  return t;
}

describe('§5 learning module', () => {
  beforeEach(() => resetIds());

  it('cold start: forces w.preference 0 and modelScore 0 until ≥10 ratings', () => {
    const s = new Schedule({ config: defaultConfig });
    for (let i = 0; i < 5; i += 1) {
      const t = s.addFlexible({ title: `r${i}`, tags: ['study'], startTime: day(0, 9), endTime: day(0, 10) });
      t.satisfaction = { overall: 5, timingFit: 0, durationFit: 0, energy: 0 };
    }
    s.retrain();
    expect(s.learning.sampleCount).toBe(5);
    expect(s._weights().preference).toBe(0); // forced 0 below cold start
    expect(s._modelScore(s.tasks[0], { start: day(0, 9), end: day(0, 10) })).toBe(0);
  });

  it('trainer converges on a separable set (mornings high, evenings low)', () => {
    const model = new LearningModule(defaultConfig);
    const samples = [];
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`m${i}`, 9, 5)); // morning → high
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`e${i}`, 19, 1)); // evening → low
    model.train(samples);
    expect(model.sampleCount).toBe(12);
    expect(model.trained).toBe(true);

    const probe = new Task({ title: 'probe', tags: ['study'], startTime: day(0, 9), endTime: day(0, 10) });
    const morningScore = model.modelScore(probe, { start: day(0, 9), end: day(0, 10) });
    const eveningScore = model.modelScore(probe, { start: day(0, 19), end: day(0, 20) });
    expect(morningScore).toBeGreaterThan(eveningScore);

    // Weights are inspectable.
    const ins = model.inspect();
    const morning = ins.find((x) => x.label === 'time:morning');
    const evening = ins.find((x) => x.label === 'time:evening');
    expect(morning.weight).toBeGreaterThan(evening.weight);
  });

  it('w.preference becomes active at ≥10 ratings', () => {
    const s = new Schedule({ config: defaultConfig });
    for (let i = 0; i < 10; i += 1) {
      const t = s.addFlexible({ title: `r${i}`, tags: ['study'], startTime: day(0, 9), endTime: day(0, 10) });
      t.satisfaction = { overall: 5, timingFit: 0, durationFit: 0, energy: 0 };
    }
    s.retrain();
    expect(s.learning.sampleCount).toBe(10);
    expect(s._weights().preference).toBeGreaterThan(0);
  });
});

describe('R-5 a diverged model is discarded, never shipped', () => {
  beforeEach(() => resetIds());

  it('non-finite weights stay cold-start instead of poisoning every score', () => {
    const samples = [];
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`m${i}`, 9, 5));
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`e${i}`, 19, 1));

    const lm = new LearningModule(defaultConfig);
    // A runaway learning rate diverges gradient descent to Infinity/NaN.
    lm.train(samples, { learningRate: 1e9, epochs: 200 });

    expect(lm.diverged).toBe(true);
    expect(lm.trained).toBe(false); // refuses to claim it learned anything
    expect(lm.weights.every((w) => Number.isFinite(w))).toBe(true);

    // The whole point: scoring degrades to "no preference", never to NaN — a NaN
    // makes every "highest wins" comparison false and placement picks slot one.
    const score = lm.modelScore(samples[0], { start: day(0, 9), end: day(0, 10) });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });

  it('a healthy model still trains after a diverged run', () => {
    const samples = [];
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`m${i}`, 9, 5));
    for (let i = 0; i < 6; i += 1) samples.push(ratedTask(`e${i}`, 19, 1));
    const lm = new LearningModule(defaultConfig);
    lm.train(samples, { learningRate: 1e9, epochs: 50 });
    lm.train(samples); // sane defaults
    expect(lm.trained).toBe(true);
    expect(lm.diverged).toBe(false);
  });
});
