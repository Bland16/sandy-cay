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
  arrivalDepletionFor, loadForTask,
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

describe('the energy term — how depleted you arrive (D-1, C3)', () => {
  beforeEach(() => resetIds());

  // A week of heavy mornings and a long restorative afternoon, so the reserve
  // is deep by midday and recovered by evening. The DAY's total dip is the same
  // either way — which is exactly why C1 (day depth) was blind here and C3
  // (reserve at sit-down) was not.
  const spentMornings = () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -1.5, physical: -1 } });
    for (let i = 0; i < 3; i += 1) {
      s.addFixed({ title: `AM${i}`, tags: ['study'], startTime: at(0, 8 + i), endTime: at(0, 9 + i) });
    }
    s.addFixed({ title: 'Rest', tags: ['rest'], startTime: at(0, 15), endTime: at(0, 17) });
    return s;
  };

  it('reads deeper mid-morning than after a rest, on the same day', () => {
    const s = spentMornings();
    const dep = arrivalDepletionFor(s);
    const load = loadForTask(s, { tags: ['study'] });
    const spent = dep(at(0, 13), load);
    const recovered = dep(at(0, 19), load);
    expect(spent).toBeGreaterThan(recovered); // the whole point of C3 over C1
    expect(spent).toBeLessThanOrEqual(1);
    expect(recovered).toBeGreaterThanOrEqual(0);
  });

  // ⚠️ THE GATE. A task that spends nothing cannot make any day worse, so it
  // must have no opinion rather than inheriting a preference from the day's own
  // state. null becomes a constant across every candidate, which cannot move a
  // ranking — that is what "no opinion" has to mean inside a weighted sum.
  it('has no opinion about a task that carries no load', () => {
    const s = spentMornings();
    const dep = arrivalDepletionFor(s);
    expect(dep(at(0, 13), loadForTask(s, { tags: ['no-bucket-carries-this'] }))).toBeNull();
    expect(dep(at(0, 13), null)).toBeNull();
  });

  it('weighs the axes the task actually draws on', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    s.addBucket({ label: 'Gym', tags: ['gym'], load: { physical: 2 } });
    for (let i = 0; i < 3; i += 1) {
      s.addFixed({ title: `AM${i}`, tags: ['study'], startTime: at(0, 8 + i), endTime: at(0, 9 + i) });
    }
    const dep = arrivalDepletionFor(s);
    // Three hours of mental work drains mental and leaves physical untouched,
    // so a gym session at 13:00 should not read as "you arrive wrecked".
    const mental = dep(at(0, 13), loadForTask(s, { tags: ['study'] }));
    const physical = dep(at(0, 13), loadForTask(s, { tags: ['gym'] }));
    expect(mental).toBeGreaterThan(physical);
    expect(physical).toBe(0);
  });

  it('is bounded in [0,1] even when the day is far past any ceiling', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    for (let i = 0; i < 14; i += 1) {
      s.addFixed({ title: `H${i}`, tags: ['study'], startTime: at(0, 8 + i), endTime: at(0, 9 + i) });
    }
    const v = arrivalDepletionFor(s)(at(0, 22), loadForTask(s, { tags: ['study'] }));
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  // ⚠️ THE FIXTURE HAS TO MAKE THE TERMS DISAGREE. An earlier version put the
  // freshest slot first, where proximity already wanted to go — so both
  // configurations landed identically and the test proved nothing. Here the
  // EARLY free slot is the depleted one and the late one is recovered, so
  // proximity and energy pull opposite ways and the outcome says which won.
  //
  //   08:00–11:00  study, mental +2/hr   → reserve −6 by 11:00 (depletion .75)
  //   11:00–13:00  FREE, and depleted    ← proximity wants this
  //   13:00–15:00  rest,  mental −1.5/hr → reserve −3 by 15:00 (depletion .375)
  //   15:00–       FREE, and recovered   ← energy wants this
  //
  // ⚠️ AND EVERY DAY IN THE SEARCH WINDOW MUST CARRY IT. A first attempt loaded
  // Monday only; the sitting went to an empty Tuesday 08:00, which is both the
  // most proximate slot AND the freshest, so the two terms agreed and the test
  // was blind at every weight — including 1.5. Shaping one day proves nothing
  // when the placer can walk to an unshaped one.
  const conflicting = (energyWeight) => {
    const s = new Schedule({
      config: { ...defaultConfig, weights: { ...defaultConfig.weights, energy: energyWeight } },
    });
    s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 2 } });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -1.5, physical: -1 } });
    for (let d = 0; d < 5; d += 1) {
      for (let i = 0; i < 3; i += 1) {
        s.addFixed({ title: `AM${d}-${i}`, tags: ['study'], startTime: at(d, 8 + i), endTime: at(d, 9 + i) });
      }
      s.addFixed({ title: `Rest${d}`, tags: ['rest'], startTime: at(d, 13), endTime: at(d, 15) });
    }
    return s;
  };

  it('places a loaded sitting somewhere less depleted than it would without the term', () => {
    const place = (s) => s.addFlexible({ title: 'Flex', tags: ['study'], durationMin: 60, from: at(0, 8) });

    const withTerm = conflicting(defaultConfig.weights.energy);
    const without = conflicting(0);
    const a = place(withTerm);
    const b = place(without);

    const depA = arrivalDepletionFor(withTerm)(a.startTime, loadForTask(withTerm, a));
    const depB = arrivalDepletionFor(without)(b.startTime, loadForTask(without, b));
    expect(depA).toBeLessThan(depB);
    // And it is the later, recovered slot that won — not merely a different one.
    expect(a.startTime.getHours()).toBeGreaterThanOrEqual(15);
    expect(b.startTime.getHours()).toBeLessThan(13);
  });
});
