// Guards for the learning module's honesty machinery, and for the week-load
// capacity that the report draws a reference line against.
//
// Every case here is a defect that shipped. None of them threw, and none of
// them was visible in the suite — they were all found by reading, which is why
// each one gets a test that would have caught it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('the model layout — moveCount and placedBy are gone, and cannot come back silently', () => {
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

  it('no longer carries a placedByUser column', () => {
    const s = trainOn(Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    const labels = s.learning.inspect().map((x) => x.label);
    expect(labels).not.toContain('placedByUser');
  });

  // ⚠️ THE LEAKAGE ITSELF, stated as behaviour rather than as a column name.
  //
  // Ticking a task done partway through is `updateTask({ endTime: cut })`
  // (App.jsx), and `updateTask` flips `placedBy` to 'user' on ANY time change.
  // So an engine-placed task the user never touched became `placedByUser=1`
  // BECAUSE THEY FINISHED IT EARLY — the outcome feeding back into the input.
  // Measured before the fix: identical tasks, one finished early, produced
  // different feature vectors. Nothing the model sees may depend on that.
  it('cannot tell a task finished early from the same task finished on time', () => {
    const s = trainOn(Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    const mk = () => new Task({
      title: 'Study', tags: ['study'], placedBy: 'auto',
      startTime: at(0, 9), endTime: at(0, 11),
    });
    const onTime = mk();
    const early = mk();
    s.tasks.push(early);
    s.updateTask(early.id, { completion: 'done', endTime: at(0, 9, 30) });

    expect(early.placedBy).toBe('user'); // the flip still happens — stability needs it
    expect(onTime.placedBy).toBe('auto');
    expect(s.learning.featureVector(early, { start: at(0, 9), end: at(0, 11) }))
      .toEqual(s.learning.featureVector(onTime, { start: at(0, 9), end: at(0, 11) }));
  });

  // The other direction, and the reason the column could not simply be fixed:
  // `ratedSamples` hard-codes `placedBy:'auto'` on every materialised
  // occurrence, so a recurring event the user placed BY HAND read 0. The column
  // was a mixture of "not recurring" and "finished early", not a fact about
  // choosing a time. `stability` still reads the field on the parent.
  it('does not let a hand-placed recurring event read as engine-placed', () => {
    const s = trainOn(Array.from({ length: 12 }, (_, i) => rated(`t${i}`, i % 5, 9, 4)));
    const parent = new Task({
      title: 'Gym', tags: ['exercise'], placedBy: 'user',
      startTime: at(0, 7), endTime: at(0, 8),
      recurrence: { freq: 'weekly', interval: 1, byDay: ['mon'], until: null, exceptions: [] },
    });
    const key = `${at(0, 7).getFullYear()}-${String(at(0, 7).getMonth() + 1).padStart(2, '0')}-${String(at(0, 7).getDate()).padStart(2, '0')}`;
    parent.occurrenceData = {
      [key]: {
        at: at(0, 7).toISOString(), endAt: at(0, 8).toISOString(),
        satisfaction: { overall: 1 }, completion: 'done',
      },
    };
    s.tasks.push(parent);

    const occ = s.ratedSamples().find((t) => t.isOccurrence && t.parentId === parent.id);
    expect(occ).toBeTruthy();
    expect(occ.placedBy).toBe('auto'); // still what ratedSamples writes
    expect(parent.placedBy).toBe('user'); // and still disagrees with it
    // … which is exactly why no column may be built on the difference.
    expect(s.learning.labels).not.toContain('placedByUser');
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

  // priority/dayFill stay in the fit and never get a sentence.
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
  // weight flips sign between retrains. (`placedByUser` was a third until
  // layout v6 dropped it from the fit outright — see the leakage guard below.)
  it('excludes the columns that must never be spoken', () => {
    expect(isNarratable('priority')).toBe(false);
    expect(isNarratable('dayFill')).toBe(false);
    expect(isNarratable('tag:study')).toBe(true);
    expect(isNarratable('time:evening')).toBe(true);
  });
});

describe('the energy term — how depleted you arrive (D-1, C3)', () => {
  // ⚠️ THE CLOCK IS PINNED, and these cases were time-bombed without it.
  //
  // `MON()` is the week of 2026-09-09 — which BECAME the current week on
  // 2026-09-07, at which point `from: at(0, 8)` was a moment in the past.
  // Placement refuses the past, so both configurations were clamped to the same
  // remaining slots, the energy term had nothing left to choose between, and
  // the assertion failed on two identical numbers.
  //
  // Scoped to this describe on purpose: fake timers and the `await import()`
  // calls elsewhere in this file do not mix well. Same fix as
  // placement-range-floor.test.js, which went off two days earlier.
  beforeEach(() => {
    resetIds();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 6, 0, 0)); // the fixture Monday, 06:00
  });
  afterEach(() => { vi.useRealTimers(); });

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

  // ⚠️ THE TASK BEING PLACED IS NOT ALREADY SPENT. `findBestSlot` scores
  // candidates for a task that is ALREADY in `schedule.tasks`, and `reserveAt`
  // had no exclusion — so its own load counted as drain the user had supposedly
  // taken, at every candidate at or after where it currently sat. Measured on a
  // day holding NOTHING BUT the task: depletion 0 at 08:00 and 1.00 at 10:00,
  // 14:00 and 18:00, on an empty day. It made the term a blanket "earlier than
  // wherever this already is" force that outvoted proximity and stability.
  it('does not count the task being placed against itself', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    const essay = s.addFixed({
      title: 'Essay', tags: ['work'], startTime: at(0, 9), endTime: at(0, 13),
    });
    const dep = arrivalDepletionFor(s);
    const load = loadForTask(s, essay);
    // The day holds only this task, so every candidate arrives at a fresh day.
    for (const h of [8, 10, 14, 18]) {
      expect(dep(at(0, h), load, { excludeId: essay.id })).toBe(0);
    }
    // Without the exclusion the same day reads as fully spent from 10:00 on,
    // which is the bug — kept here so the exclusion cannot quietly stop working.
    expect(dep(at(0, 14), load)).toBeGreaterThan(0.9);
  });

  // ⚠️ RESTORING WORK WANTS THE DEPLETED SLOT. `Math.abs` let an all-negative
  // load through the gate and it was then scored exactly like a spender, while
  // scoring.js rewards `1 − depletion`, i.e. arriving FRESH. So the term put a
  // nap BEFORE a five-hour grind rather than after it. generate.js#energyRank
  // has had the sign branch all along: "Spending seeks the least-depleted day,
  // restoring the most."
  it('scores a restorative task toward the drained slot, not the fresh one', () => {
    const s = new Schedule({ config: defaultConfig });
    s.addBucket({ label: 'Deep', tags: ['work'], load: { mental: 2, creative: 1 } });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: -1 } });
    for (let h = 9; h < 14; h += 1) {
      s.addFixed({ title: `W${h}`, tags: ['work'], startTime: at(0, h), endTime: at(0, h + 1) });
    }
    const dep = arrivalDepletionFor(s);
    const nap = loadForTask(s, { tags: ['rest'] });

    const fresh = dep(at(0, 7), nap); // before the grind
    const drained = dep(at(0, 17), nap); // after it
    // scoring.js uses `1 − depletion`, so LOWER depletion scores higher. Rest
    // must therefore read as MORE depleted where the user is fresh.
    expect(fresh).toBeGreaterThan(drained);
    expect(drained).toBeLessThan(0.5);
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

describe('a user with no preference is told they have none', () => {
  beforeEach(() => resetIds());

  // ⚠️ THE INTERCEPT LEAK. Every one-hot block sums to 1, so each is collinear
  // with the unpenalised bias and nothing identifies the split. From b = 0 the
  // descent carries the level up through that null space, which converges far
  // slower than the signal directions — so at 400 epochs the level had not
  // arrived and the shortfall sat in the one-hot columns, indistinguishable
  // from learned preference.
  //
  // Measured before the fix, on thirty IDENTICAL ratings: bias 0.135, and
  // tag:study 0.126 / dur:45-90 0.105 / priority 0.076 / day:wed 0.025 — six
  // columns over the display floor, from data containing one tag, one priority
  // and one rating value. The report would have printed "leans toward study".
  const flat = () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    for (let i = 0; i < 30; i += 1) s.tasks.push(rated(`f${i}`, i % 5, 9 + (i % 4), 3));
    s.retrain();
    return s;
  };

  it('puts the level in the intercept, not in the columns', () => {
    const s = flat();
    expect(s.learning.bias).toBeCloseTo(0.5, 6); // a 3 of 5, exactly
    for (const w of s.learning.inspect()) {
      expect(Math.abs(w.weight)).toBeLessThan(0.01);
    }
  });

  it('the report says nothing rather than inventing a preference', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const { insight } = buildWrapReport(flat(), MON());
    expect(insight.cold).toBe(false); // 30 ratings — it is past the floor
    expect(insight.top).toHaveLength(0); // and it still has nothing to say
  });

  // The fix must not buy its honesty by flattening real signal too.
  it('still finds a preference that is genuinely there', () => {
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    const HRS = [9, 12, 15, 19];
    for (let i = 0; i < 32; i += 1) s.tasks.push(rated(`d${i}`, i % 5, HRS[i % 4], 4));
    for (let i = 0; i < 14; i += 1) s.tasks.push(rated(`n${i}`, i % 7, 22, 1));
    s.retrain();

    const night = s.learning.inspect().find((w) => w.label === 'time:night');
    expect(night.weight).toBeLessThan(-0.3); // measured ≈ −0.59
  });
});

describe('authority is earned by being right, not by rating count', () => {
  beforeEach(() => resetIds());

  // Ratings arranged as SERIES, the way a real week is: several recurring
  // things, each rated a few times. `_assessSkill` folds by parentId, so a
  // whole series leaves together — holding out one occurrence while its
  // siblings stay in training measures "can you predict Tuesday gym from
  // eleven other Tuesday gyms", which is trivially yes and means nothing.
  const seriesUser = (utility, seed = 3) => {
    let r = seed;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'B', tags: ['study', 'gym', 'admin'] }));
    const TAGS = ['study', 'gym', 'admin'];
    const HOURS = [9, 13, 19, 22];
    for (let series = 0; series < 10; series += 1) {
      const tag = TAGS[series % TAGS.length];
      const hour = HOURS[series % HOURS.length];
      const parent = new Task({
        title: `p${series}`, tags: [tag], type: 'fixed',
        startTime: at(series % 5, hour), endTime: at(series % 5, hour + 1),
      });
      s.tasks.push(parent);
      for (let k = 0; k < 4; k += 1) {
        const t = new Task({
          title: `p${series}-${k}`, tags: [tag], type: 'fixed',
          startTime: at(k % 5, hour), endTime: at(k % 5, hour + 1),
        });
        t.parentId = parent.id;
        t.completion = 'done';
        const u = utility(tag, hour) + (rnd() - 0.5) * 0.3;
        t.satisfaction = { overall: Math.max(1, Math.min(5, Math.round(1 + 4 * u))) };
        s.tasks.push(t);
      }
    }
    s.retrain();
    return s;
  };

  it('keeps its authority when the fit genuinely predicts held-out ratings', () => {
    const s = seriesUser((tag, hour) => (hour <= 9 ? 0.85 : 0.2));
    expect(s.learning.trained).toBe(true);
    expect(s.learning.skill).toBeGreaterThan(0);
    expect(s._weights().preference).toBeGreaterThan(0);
    expect(s._modelIsTrustworthy()).toBe(true);
  });

  // ⚠️ THE CASE NO COUNT-BASED GATE CAN SEE. Forty ratings — four times the
  // cold-start floor — from someone with no real preference at all. The fit
  // passes every headcount, fits the noise, and would steer every placement.
  it('gives up its authority when the fit is no better than an average', () => {
    const s = seriesUser(() => 0.5);
    expect(s.learning.sampleCount).toBeGreaterThan(defaultConfig.coldStartRatings);
    expect(s.learning.trained).toBe(true); // "trained" only means the fit ran
    expect(s.learning.skill).toBeLessThanOrEqual(0);
    expect(s._weights().preference).toBe(0);
    expect(s._modelScore(s.tasks[1], null)).toBe(0);
  });

  it('does not punish a small honest dataset for being small', () => {
    // Too little to split into folds: skill is null, meaning "not assessed",
    // which must not read as "no skill".
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
    for (let i = 0; i < 12; i += 1) s.tasks.push(rated(`t${i}`, i % 5, 9, 4));
    s.retrain();
    expect(s.learning.skill).toBeNull();
    expect(s._modelIsTrustworthy()).toBe(true);
  });

  it('survives a reload, so a reload cannot restore authority the fit lost', () => {
    const s = seriesUser(() => 0.5);
    const revived = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(revived.learning.skill).toBeLessThanOrEqual(0);
    expect(revived._weights().preference).toBe(0);
  });
});

describe('config values that were declared and never read', () => {
  beforeEach(() => resetIds());

  // Documented as Cabana-tunable, named in SPEC §2.3's own formula, and read by
  // nothing: placement.js hardcoded `1`. Setting it did nothing at all — the
  // same class of defect as `deadlineBufferHours`, which was read but never
  // declared. Both directions of the same gap.
  it('stabilityBonus actually changes the score it is documented to change', async () => {
    const { score, normalizeWeights } = await import('../src/core/index.js');
    const common = {
      slotStart: at(0, 9), origin: at(0, 9), lookaheadHorizonMin: 4320,
      dayFillAfter: 0.5, modelScore: 0, slotEnd: at(0, 10),
      deadline: null, runwayStart: null, arrivalDepletion: null,
    };
    const w = normalizeWeights(defaultConfig.weights);
    const withBonus = score({ ...common, stability: defaultConfig.stabilityBonus, weights: w });
    const without = score({ ...common, stability: 0, weights: w });
    expect(withBonus).toBeGreaterThan(without);
  });

  it('reserveBias is declared where the values around it are', () => {
    // It existed only as a `?? 0.2` inside suggest.js, so the largest nudge
    // after loadBias was invisible to anyone reading or tuning the config.
    expect(defaultConfig.suggest.reserveBias).toBe(0.2);
  });
});

describe('config values a saved file can carry into the engine', () => {
  beforeEach(() => resetIds());

  // ⚠️ `?? 0` IS NOT A NUMBER GUARD. It catches null and undefined and nothing
  // else, and these values arrive from a JSON file. A NaN made every weight NaN
  // — and `sum <= 0` does NOT fire on NaN, because `NaN <= 0` is false — so
  // `findBestSlot` scored every candidate NaN, no comparison was ever true, and
  // the first slot the walker produced won. Every placement in the app becomes
  // "the earliest gap", silently.
  //
  // `"0,5"` is not exotic: it is what a decimal comma types, `+` CONCATENATES
  // it rather than adding, and it survives a JSON round trip untouched.
  it('cannot be knocked into NaN by one bad weight', async () => {
    const { normalizeWeights } = await import('../src/core/index.js');
    for (const bad of [NaN, '0,5', 'abc', Infinity, undefined, null]) {
      const w = normalizeWeights({ ...defaultConfig.weights, proximity: bad });
      const sum = Object.values(w).reduce((n, v) => n + v, 0);
      for (const v of Object.values(w)) expect(Number.isFinite(v)).toBe(true);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  // The quietest of the lot, and the one with no NaN to notice: `proximity: -1`
  // left a sum of 0.2, so the normalized proximity came out at −5.0 — five times
  // the magnitude of every other term and pointing the WRONG WAY, while the set
  // still summed to 1 and looked entirely ordinary.
  it('never turns a negative weight into the loudest term in the sum', async () => {
    const { normalizeWeights } = await import('../src/core/index.js');
    const w = normalizeWeights({ ...defaultConfig.weights, proximity: -1 });
    for (const v of Object.values(w)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(w.proximity).toBe(0); // off, which is the one safe reading of it
  });

  // ⚠️ A CAPACITY IS A DENOMINATOR, and `Number.isFinite` is not enough for one.
  // 0 and −3 are both finite and both survive a save. Measured against a day
  // that had spent 3 of a prior 6 — so the answer is 0.3333 and the fixture
  // genuinely discriminates rather than saturating at 1:
  //
  //     capacity  6   depletion  0.3333   energy term 0.6667
  //     capacity  0   depletion  1.0000   energy term 0.0000
  //     capacity −3   depletion −0.6667   energy term 1.6667   ← out of bounds
  //
  // `Math.min(1, spent / cap)` has no lower bound, so a negative capacity gives
  // a negative depletion, `1 − depletion` exceeds 1, and the energy term grows
  // past its own weight — enough to outvote every other term in the score.
  it('never lets a bad capacity push the energy term outside [0, 1]', async () => {
    const { arrivalDepletionFor, loadForTask } = await import('../src/core/index.js');
    const results = [];
    for (const cap of [6, 0, -3, NaN, 'x']) {
      const cfg = JSON.parse(JSON.stringify(defaultConfig));
      cfg.energy.capacity.mental = cap;
      const s = new Schedule({ config: cfg });
      s.addBucket({ label: 'Study', tags: ['study'], load: { mental: 3 } });
      s.addFixed({ title: 'Grind', tags: ['study'], startTime: at(0, 9), endTime: at(0, 10) });
      const draft = new Task({ title: 'Next', tags: ['study'], startTime: at(0, 15), endTime: at(0, 16) });
      const d = arrivalDepletionFor(s)(at(0, 15), loadForTask(s, draft));
      expect(d).not.toBeNull();
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      results.push(d);
    }
    // Not saturated at either end — or the bounds above hold for the wrong
    // reason and this case proves nothing.
    expect(results[0]).toBeGreaterThan(0);
    expect(results[0]).toBeLessThan(1);
    // Every bad value falls back to the same prior, so it answers as a valid
    // config does rather than merely staying inside the rails.
    for (const d of results) expect(d).toBeCloseTo(results[0], 10);
  });
});

describe('a suggestion may not contradict its own evidence', () => {
  beforeEach(() => resetIds());

  const sessions = (specs) => specs.map(([i, fit, overall]) => {
    const t = new Task({
      title: `Gym ${i}`, tags: ['exercise'], type: 'fixed',
      startTime: at(i % 5, 17), endTime: at(i % 5, 18),
    });
    t.completion = 'done';
    t.satisfaction = { overall, durationFit: fit, energy: 1 };
    return t;
  });

  // ⚠️ THE SHIPPED DEFECT, reported by the user: "it told me that exercise
  // should be shorter and I went back — they've all been 4 stars or over and
  // usually energizing."
  //
  // `durationFitSuggestion` filtered to `durationFit !== 0` and then took 60% OF
  // THAT, so every session explicitly called the right length was dropped from
  // the denominator. Three "too long" out of twenty became 3/3 = 100%.
  it('does not call three complaints out of twenty a consensus', async () => {
    const { durationFitSuggestion } = await import('../src/core/index.js');
    const tasks = sessions([
      ...Array.from({ length: 17 }, (_, i) => [i, 0, 5]), // "just right", loved
      ...Array.from({ length: 3 }, (_, i) => [17 + i, 1, 4]), // "too long"
    ]);
    expect(durationFitSuggestion(tasks, 'exercise').suggest).toBe(false);
  });

  it('still fires when the sessions that answered genuinely agree', async () => {
    const { durationFitSuggestion } = await import('../src/core/index.js');
    const tasks = sessions([
      ...Array.from({ length: 8 }, (_, i) => [i, 1, 3]), // 8 of 10 said too long
      ...Array.from({ length: 2 }, (_, i) => [8 + i, 0, 4]),
    ]);
    const r = durationFitSuggestion(tasks, 'exercise');
    expect(r.suggest).toBe(true);
    expect(r.direction).toBe('shorter');
    // And it carries the evidence so the sentence can state it.
    expect(r.count).toBe(8);
    expect(r.total).toBe(10);
  });

  // "just right" is an ANSWER, not an absence — the task panel's own word for
  // durationFit: 0. Dropping it from the denominator inverted the finding.
  it('counts "just right" as an answer to the duration question', async () => {
    const { durationFitSuggestion } = await import('../src/core/index.js');
    const allFine = sessions(Array.from({ length: 10 }, (_, i) => [i, 0, 5]));
    expect(durationFitSuggestion(allFine, 'exercise').suggest).toBe(false);
  });

  it('the sentence states its own numerator and denominator', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'Gym', tags: ['exercise'] }));
    s.tasks.push(...sessions([
      ...Array.from({ length: 8 }, (_, i) => [i, 1, 3]),
      ...Array.from({ length: 2 }, (_, i) => [8 + i, 0, 4]),
    ]));
    const fit = buildWrapReport(s, MON()).suggestions.find((x) => x.kind === 'duration-fit');
    expect(fit).toBeTruthy();
    expect(fit.detail).toMatch(/8 of 10/);
    // Never the unfalsifiable claim it used to make.
    expect(fit.detail).not.toMatch(/^Most /);
  });
});

describe('one door: a model with no skill is silent EVERYWHERE', () => {
  beforeEach(() => resetIds());

  // ⚠️ THE GAP THIS EXISTS TO CATCH, and it was mine. `_modelIsTrustworthy` was
  // added on 2026-09-03 and wired into `_weights` and `_modelScore` only, while
  // whatToDo, the wrap report's insight and the Cabana went on testing
  // `learning.trained` directly — which means nothing more than "gradient
  // descent produced finite numbers". So a fit measured as WORSE than
  // predicting the average was silenced in placement and still narrated in
  // three other places. Exactly the shape of the `ratedSamples` bug, introduced
  // three days after that lesson was written down.
  const noSkill = (seed = 3) => {
    let r = seed;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const s = new Schedule({ config: defaultConfig });
    s.buckets.push(new Bucket({ label: 'B', tags: ['study', 'gym', 'admin'] }));
    const TAGS = ['study', 'gym', 'admin'];
    const HOURS = [9, 13, 19, 22];
    for (let series = 0; series < 10; series += 1) {
      const tag = TAGS[series % TAGS.length];
      const hour = HOURS[series % HOURS.length];
      const parent = new Task({
        title: `p${series}`, tags: [tag], type: 'fixed',
        startTime: at(series % 5, hour), endTime: at(series % 5, hour + 1),
      });
      s.tasks.push(parent);
      for (let k = 0; k < 4; k += 1) {
        const t = new Task({
          title: `p${series}-${k}`, tags: [tag], type: 'fixed',
          startTime: at(k % 5, hour), endTime: at(k % 5, hour + 1),
        });
        t.parentId = parent.id;
        t.completion = 'done';
        // No preference whatsoever — pure noise around the middle.
        t.satisfaction = { overall: Math.max(1, Math.min(5, Math.round(3 + (rnd() - 0.5) * 1.2))) };
        s.tasks.push(t);
      }
    }
    s.retrain();
    return s;
  };

  it('the gate is one method, and every surface asks it', () => {
    const s = noSkill();
    expect(s.learning.trained).toBe(true); // the fit ran and produced numbers
    expect(s.learning.skill).toBeLessThanOrEqual(0); // and it is no better than a mean
    expect(s.modelMaySpeak()).toBe(false);
  });

  it('placement does not steer', () => {
    const s = noSkill();
    expect(s._weights().preference).toBe(0);
    expect(s._modelScore(s.tasks[1], null)).toBe(0);
  });

  it('the wrap report does not narrate it', async () => {
    const { buildWrapReport } = await import('../src/ui/report.js');
    const { insight } = buildWrapReport(noSkill(), MON());
    expect(insight.cold).toBe(true); // not "here is what I learned"
  });

  it('what-to-do never claims you rate this kind of work well', async () => {
    const { whatToDo } = await import('../src/core/index.js');
    const s = noSkill();
    s.addFixed({ title: 'Something', tags: ['study'], startTime: at(0, 15), endTime: at(0, 16) });
    const picks = whatToDo(s, at(0, 14)) || [];
    for (const p of picks) {
      for (const reason of p.reasons || []) {
        expect(reason).not.toMatch(/rate this kind of work well/i);
      }
    }
  });
});

describe('spreadDays — energy nudges, and may not overrule spacing', () => {
  // ⚠️ `distance` is in ARRAY INDICES and `rank` is a reserve dip in LOAD-HOURS,
  // and they were summed: `distance - rank * 0.25`. A dip of 14 — an ordinary
  // heavy day — was therefore worth 3.5 days of spacing, more than the step
  // between sittings, so energy did not nudge, it overruled. Measured
  // (probe-spread-nudge.mjs): the old rule chose 3,4,6,10,13 instead of
  // 0,3,6,10,13 — pulling one sitting three days and landing it ADJACENT to the
  // next, which is precisely the consecutive-day clustering this module exists
  // to prevent. Its own header: "burnout is clustering, not sitting length."
  const MONDAY = new Date(2026, 8, 7);
  const pool = Array.from({ length: 14 }, (_, i) => addDays(MONDAY, i));
  const idx = (d) => pool.findIndex((x) => x.getTime() === d.getTime());

  it('a deep dip cannot drag a sitting off its even position', async () => {
    const { spreadDays } = await import('../src/core/index.js');
    // One day far fresher than the rest, three days off the ideal position.
    const rank = (d) => (idx(d) === 3 ? 14 : 0);
    const chosen = spreadDays(pool, 5, { rank }).map(idx);
    // Ideal spread is 0, 3.25, 6.5, 9.75, 13 — the first sitting stays at 0.
    expect(chosen[0]).toBe(0);
    const ideal = [0, 3.25, 6.5, 9.75, 13];
    for (let i = 0; i < chosen.length; i += 1) {
      expect(Math.abs(chosen[i] - ideal[i])).toBeLessThanOrEqual(1);
    }
  });

  it('never creates a consecutive pair the unbounded rule created', async () => {
    const { spreadDays } = await import('../src/core/index.js');
    const rank = (d) => (idx(d) === 3 ? 14 : 0);
    const chosen = spreadDays(pool, 5, { rank }).map(idx).sort((a, b) => a - b);
    for (let i = 1; i < chosen.length; i += 1) {
      expect(chosen[i] - chosen[i - 1]).toBeGreaterThan(1);
    }
  });

  it('still lets energy break a NEAR-TIE, which is all a nudge should do', async () => {
    const { spreadDays } = await import('../src/core/index.js');
    // ⚠️ A first version of this test gave a rank to a day a FULL DAY off the
    // ideal and expected the choice to move. It does not, and that is the bound
    // working: 0.75 of a day cannot overcome a whole day of distance. A nudge
    // may only settle a near-tie, so the fixture has to offer one.
    //
    // The second ideal position is 3.25, so day 3 sits 0.25 away and day 4 sits
    // 0.75 — a gap of half a day, which the nudge can just cover.
    const flat = spreadDays(pool, 5, { rank: () => 0 }).map(idx);
    const tilted = spreadDays(pool, 5, { rank: (d) => (idx(d) === 4 ? 10 : 0) }).map(idx);
    expect(flat[1]).toBe(3);
    expect(tilted[1]).toBe(4); // energy settled it — by exactly one day
  });
});
