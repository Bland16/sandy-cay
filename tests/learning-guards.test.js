// Guards for the learning module's honesty machinery, and for the week-load
// capacity that the report draws a reference line against.
//
// Every case here is a defect that shipped. None of them threw, and none of
// them was visible in the suite — they were all found by reading, which is why
// each one gets a test that would have caught it.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Schedule, Task, Bucket, resetIds, getWeekLoad, weekStart as weekStartOf, addDays,
  humanLabel, isNarratable, MODEL_LAYOUT_VERSION, LearningModule,
} from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';

const MON = () => weekStartOf(new Date(2026, 8, 9)); // a fixed Wednesday's week
const at = (offset, h, m = 0) => {
  const d = addDays(MON(), offset);
  d.setHours(h, m, 0, 0);
  return d;
};

const rated = (title, dayOffset, hour, overall, extra = {}) => {
  const t = new Task({
    title, tags: ['study'], type: 'fixed',
    startTime: at(dayOffset, hour), endTime: at(dayOffset, hour + 1),
  });
  t.completion = 'done';
  t.satisfaction = { overall, ...extra };
  return t;
};

describe('getWeekLoad — a blocked day has no capacity', () => {
  beforeEach(() => resetIds());

  // The report normalises its sand bars against `capacityMin` and draws that
  // capacity as a reference line. `dayCapacityMin(config, date)` cannot see
  // blocked days — they live on the schedule — so a day the user barred the
  // scheduler from reported its full window against zero scheduled minutes, and
  // the chart painted a full-height line over an empty bar: "you had ten hours
  // and used none", for a decision the user made on purpose.
  it('reports zero capacity, not a full window, for a day the user blocked', () => {
    const s = new Schedule({ config: defaultConfig });
    const thu = addDays(MON(), 3);
    s.blockDay(thu);

    const load = getWeekLoad(s, MON());
    const day = load.perDay[3];

    expect(day.capacityMin).toBe(0);
    expect(day.blocked).toBe(true);
    // And it must not drag the week's own denominator upward either.
    const open = load.perDay.filter((d) => !d.blocked);
    expect(load.capacityMin).toBe(open.reduce((n, d) => n + d.capacityMin, 0));
  });

  it('leaves every other day untouched, and says which is which', () => {
    const s = new Schedule({ config: defaultConfig });
    s.blockDay(addDays(MON(), 3));

    const load = getWeekLoad(s, MON());
    expect(load.perDay.filter((d) => d.blocked)).toHaveLength(1);
    for (const d of load.perDay.filter((x) => !x.blocked)) {
      expect(d.capacityMin).toBeGreaterThan(0);
    }
  });

  // fillRatio divides by capacity. Zero capacity must read as 0, never NaN or
  // Infinity — a NaN here would reach the chart as a bar of height "NaN%".
  it('does not divide by a zero window', () => {
    const s = new Schedule({ config: defaultConfig });
    s.blockDay(MON());
    s.tasks.push(new Task({
      title: 'Snuck in', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10),
    }));
    const day = getWeekLoad(s, MON()).perDay[0];
    expect(Number.isFinite(day.fillRatio)).toBe(true);
    expect(day.fillRatio).toBe(0);
  });
});

describe('the model layout — moveCount is gone, and cannot come back silently', () => {
  beforeEach(() => resetIds());

  const trainOn = (tasks) => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    s.tasks.push(...tasks);
    s.retrain();
    return s;
  };

  it('no longer carries a moveCount column', () => {
    const s = trainOn(Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    const labels = s.learning.inspect().map((x) => x.label);
    expect(labels).not.toContain('moveCount');
  });

  // The counter itself is untouched — only the FEATURE went. It is still in
  // SPEC §1.1, still round-trips, and is still what a drag increments.
  it('still records history.moveCount on a drag', () => {
    const t = new Task({ title: 'Drag me', startTime: at(0, 9), endTime: at(0, 10) });
    t.moveTo(at(0, 11));
    expect(t.history.moveCount).toBe(1);
  });

  // ⚠️ THE ONE THAT CATCHES A FORGOTTEN VERSION BUMP. Removing a trailing
  // column without bumping MODEL_LAYOUT_VERSION fails silently: modelScore
  // walks the shorter vector against the longer stored weights, the leading
  // columns still line up, and there is no crash and no NaN — just quiet drift
  // in every placement. Length disagreement can only mean a layout change.
  it('refuses a stored model whose weights and labels disagree in length', () => {
    const m = LearningModule.fromJSON({
      layoutVersion: MODEL_LAYOUT_VERSION,
      vocab: ['study'],
      weights: new Array(40).fill(0.5),
      labels: ['tag:study', 'time:morning'],
      bias: 0.5,
      sampleCount: 30,
      trained: true,
    }, defaultConfig);

    expect(m.needsRetrain).toBe(true);
    expect(m.trained).toBe(false);
    expect(m.weights).toHaveLength(0);
  });

  it('discards a v4 save and retrains from the ratings that produced it', () => {
    const s = trainOn(Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    const json = s.toJSON();
    json.model.layoutVersion = 4; // as an older build wrote it

    const revived = Schedule.fromJSON(json);
    expect(revived.learning.layoutVersion).toBe(MODEL_LAYOUT_VERSION);
    expect(revived.learning.sampleCount).toBe(12); // rebuilt, not lost
    expect(revived.learning.weights.every((w) => Number.isFinite(w))).toBe(true);
  });
});

describe('observations — the untried/neutral distinction', () => {
  beforeEach(() => resetIds());

  // `observations` was counted for the 7 duration columns only and left at 0
  // for the other ~20, while inspect()'s docstring promises the count is what
  // tells "0 because never tried" from "0 because neutral". For tags, times and
  // weekdays it delivered neither — and both narration surfaces rank on the
  // weight alone as a result.
  it('is counted for tag, time and weekday columns, not just duration', () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    s.tasks.push(...Array.from({ length: 12 }, (_, i) => rated(`t${i}`, 0, 9, 4)));
    s.retrain();

    const byLabel = new Map(s.learning.inspect().map((x) => [x.label, x]));
    expect(byLabel.get('tag:study').observations).toBe(12);
    expect(byLabel.get('time:morning').observations).toBe(12);
    // Monday only — every other weekday must read as genuinely unobserved.
    expect(byLabel.get('day:mon').observations).toBe(12);
    expect(byLabel.get('day:sat').observations).toBe(0);
  });

  // It survived exactly until the page was refreshed, so every consumer that
  // respects the distinction silently got the degraded copy.
  it('survives a JSON round-trip', () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    s.tasks.push(...Array.from({ length: 12 }, (_, i) => rated(`t${i}`, 0, 9, 4)));
    s.retrain();

    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    const byLabel = new Map(revived.learning.inspect().map((x) => [x.label, x]));
    expect(byLabel.get('tag:study').observations).toBe(12);
    expect(byLabel.get('day:sat').observations).toBe(0);
  });
});

describe('a corrupt rating costs one sample, not the model', () => {
  beforeEach(() => resetIds());

  // `typeof NaN === 'number'`, so a NaN overall passed both filters, went
  // through clamp (Math.max/Math.min propagate NaN), took every weight with it,
  // and the divergence guard then refused to ship the fit. One bad rating
  // disabled learning permanently, with no error and a UI saying "cold start".
  it('a NaN rating is dropped at the door and the rest still train', () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    s.tasks.push(...Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    s.tasks.push(rated('corrupt', 0, 14, NaN));
    s.retrain();

    expect(s.learning.sampleCount).toBe(12); // the good ones, and only those
    expect(s.learning.trained).toBe(true);
    expect(s.learning.diverged).toBe(false);
    expect(s.learning.weights.every((w) => Number.isFinite(w))).toBe(true);
  });
});

describe('the report never claims a preference for what you rated worst', () => {
  beforeEach(() => resetIds());

  // THE SHIPPED DEFECT. `buildInsight` ranked by Math.abs(weight) — correct,
  // magnitude is the right ranking key — and the sentence beneath it said "the
  // model leans toward X" unconditionally. So the strongest weight being
  // NEGATIVE meant the sheet asserted a preference for the one time of day the
  // user consistently rated 1/5. The list it replaced carried the sign.
  it('a strongly disliked hour is reported as below, never as leaned toward', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    // ⚠️ The good ratings are SPREAD across four time buckets and the bad ones
    // concentrated in one, so the negative weight is the largest by magnitude.
    // That is what makes this a real guard: with the positives concentrated the
    // old `Math.abs` sort happened to pick a positive column and looked right.
    // Measured on this fixture: time:night = -0.542, every positive ≈ +0.176.
    const HRS = [9, 12, 15, 19];
    for (let i = 0; i < 32; i += 1) s.tasks.push(rated(`day${i}`, i % 5, HRS[i % 4], 4));
    for (let i = 0; i < 14; i += 1) s.tasks.push(rated(`night${i}`, i % 7, 22, 1));
    s.retrain();

    const { insight } = buildWrapReport(s, MON());
    expect(insight.cold).toBe(false);
    expect(insight.top.length).toBeGreaterThan(0); // not vacuously satisfied

    const night = insight.top.find((w) => w.label === 'time:night');
    expect(night).toBeTruthy(); // the strongest column must be the one reported
    expect(night.shells).toBeLessThan(0); // and reported as BELOW, not toward
    expect(night.text).toMatch(/evening/i); // in plain language, not "time:night"
    expect(night.text).not.toMatch(/^time:/);
  });

  it('never offers a column with too little evidence behind it', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    for (let i = 0; i < 30; i += 1) s.tasks.push(rated(`t${i}`, i % 5, 9, 4));
    s.retrain();

    const { insight } = buildWrapReport(s, MON());
    const min = defaultConfig.learning.interactionMinSamples ?? 4;
    for (const w of insight.top) expect(w.observations).toBeGreaterThanOrEqual(min);
  });

  // priority/dayFill/placedByUser stay in the fit and never get a sentence.
  it('never narrates a column that is not about when or what you scheduled', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    for (let i = 0; i < 30; i += 1) s.tasks.push(rated(`t${i}`, i % 5, 9, 4 - (i % 3)));
    s.retrain();

    const { insight } = buildWrapReport(s, MON());
    for (const w of insight.top) expect(isNarratable(w.label)).toBe(true);
  });
});

describe('humanLabel — plain language, generated from the feature constants', () => {
  // SPEC §5 asks the Cabana for "plain-language preferences"; both surfaces
  // printed the raw internal string, so a printed sheet could read "the model
  // leans toward dur:45-90".
  it('says every family the way a person would', () => {
    expect(humanLabel('tag:study')).toBe('study'); // the user's own word
    expect(humanLabel('day:thu')).toBe('Thursdays');
    expect(humanLabel('time:morning')).toMatch(/^mornings \(\d+–\d+\)$/);
    expect(humanLabel('dur:45-90')).toBe('45–90 minute sittings');
    expect(humanLabel('dur:<15')).toMatch(/under 15 minutes/);
    expect(humanLabel('dur:>240')).toMatch(/over 4 hours/);
  });

  it('never leaks a raw machine string for a narratable column', () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    s.tasks.push(...Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    s.retrain();
    for (const w of s.learning.inspect()) {
      if (!isNarratable(w.label)) continue;
      expect(humanLabel(w.label)).not.toMatch(/^(tag|time|day|dur):/);
    }
  });

  // These stay in the FIT — they are real confound controls — and never get a
  // sentence. priority is a claim about the user's own labelling; dayFill's
  // weight flips sign between retrains; placedByUser narrates the user's
  // relationship with the app and its negative reading is a P-1 hazard.
  it('excludes the three columns that must never be spoken', () => {
    expect(isNarratable('priority')).toBe(false);
    expect(isNarratable('dayFill')).toBe(false);
    expect(isNarratable('placedByUser')).toBe(false);
    expect(isNarratable('tag:study')).toBe(true);
    expect(isNarratable('time:evening')).toBe(true);
  });
});
