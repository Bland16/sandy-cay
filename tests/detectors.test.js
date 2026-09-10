import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { driftCheck, starvationCheck, skipStreakCheck, pinnedRatioNote, overpackCheck, durationFitSuggestion } from '../src/core/detectors.js';
import { defaultConfig } from '../src/core/config.js';
import { addDays, dateKey } from '../src/core/time.js';

const W0 = new Date(2026, 6, 13, 0, 0, 0, 0);

describe('§7.2/7.3 detectors', () => {
  beforeEach(() => resetIds());

  /** A Monday gym at 08:00, with `moves` of its recent weeks dragged to 10:00. */
  const gymDrifting = (weeks, moves) => {
    const t = new Task({
      title: 'Gym', type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    for (let i = 0; i < moves; i += 1) {
      t.recurrence.exceptions.push({ date: dateKey(addDays(W0, i * 7)), action: 'move', start: '10:00', end: '11:00' });
    }
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(t);
    // Most-recent-first, as the report supplies them.
    const ws = Array.from({ length: weeks }, (_, i) => addDays(W0, (weeks - 1 - i) * 7));
    return { t, run: () => driftCheck(s, t, ws, defaultConfig) };
  };

  it('drift: \u22654 of last 5 occurrences moved same direction \u226530min', () => {
    const res = gymDrifting(5, 5).run();
    expect(res.drift).toBe(true);
    expect(res.direction).toBe('later');
    expect(res.median).toBe(120);
    expect(res.total).toBe(5);
  });

  // \u26a0\ufe0f THE DENOMINATOR WAS THE MOVES, NOT THE SESSIONS \u2014 the same defect that
  // made "exercise blocks may want to be shorter" fire on three complaints out
  // of twenty. The sample came from `exceptions` filtered to `action: 'move'`,
  // so only sessions the user had DRAGGED could enter it. Sixteen that started
  // exactly where the pattern said were invisible to the arithmetic.
  it('counts the sessions that ran ON the pattern, not just the ones you moved', () => {
    // Twenty weeks of gym; four of them moved. Under the old rule the sample was
    // those four, all four counted, and 4 >= driftHits fired.
    // The four moves are the OLDEST weeks, so under the old rule they were the
    // entire sample — four of four, `4 >= driftHits`, fired. The sample is now
    // the last five OCCURRENCES, which are five unremarkable on-pattern weeks.
    const res = gymDrifting(20, 4).run();
    expect(res.total).toBe(defaultConfig.detectors.driftN); // five sessions, not four moves
    expect(res.drift).toBe(false);
    expect(res.median).toBe(0); // they ran where the pattern said
  });

  // \u2026and the detector must still fire when the drift is real, or the fix has
  // simply switched it off. Four of the last five moved is a genuine finding.
  it('still fires when most of the recent sessions really did move', () => {
    const res = gymDrifting(5, 4).run();
    expect(res.drift).toBe(true);
    expect(res.count).toBe(4);
    expect(res.total).toBe(5);
  });

  // The finding is bounded in time: `driftN` occurrences out of the weeks it is
  // given, so old moves cannot produce a claim about the present.
  it('reports a denominator it can actually name', () => {
    const res = gymDrifting(3, 3).run();
    // Three weeks supplied, so three sessions \u2014 not the config constant. The
    // report printed "of the last {driftN}" regardless, inventing sessions.
    expect(res.total).toBe(3);
    expect(res.total).not.toBe(defaultConfig.detectors.driftN);
  });

  it('starvation: displaced + carried ≥ 3', () => {
    const t = new Task({ title: 'Guitar', startTime: W0, endTime: addDays(W0, 0) });
    t.history.displacedCount = 2;
    t.history.carriedCount = 1;
    expect(starvationCheck(t, defaultConfig).starving).toBe(true);
    expect(starvationCheck(t, defaultConfig).count).toBe(3);
  });

  it('skip-streak: ≥3 consecutive weeks EXPLICITLY skipped', () => {
    const s = new Schedule({ config: defaultConfig });
    const t = new Task({
      title: 'Gym',
      type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    // Mark 3 weeks skipped in occurrenceData.
    for (let i = 0; i < 3; i += 1) {
      t.occurrenceData[dateKey(addDays(W0, i * 7))] = { completion: 'skipped' };
    }
    s.tasks.push(t);
    const weekStarts = [addDays(W0, 14), addDays(W0, 7), W0]; // most recent first
    const res = skipStreakCheck(s, t, weekStarts, defaultConfig);
    expect(res.streak).toBe(3);
    expect(res.flag).toBe(true);
  });

  /** The same gym, with whatever `occurrenceData` you hand it. */
  const gym = (data) => {
    const t = new Task({
      title: 'Gym', type: 'fixed',
      startTime: new Date(2026, 6, 13, 8, 0),
      endTime: new Date(2026, 6, 13, 9, 0),
      recurrence: {
        periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1, effectiveFrom: null, effectiveUntil: null }],
        anchorDate: W0,
        exceptions: [],
      },
    });
    for (let i = 0; i < 3; i += 1) {
      const d = data(i);
      if (d) t.occurrenceData[dateKey(addDays(W0, i * 7))] = d;
    }
    return t;
  };
  const weeks = [addDays(W0, 14), addDays(W0, 7), W0]; // most recent first
  const streakOf = (t) => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(t);
    return skipStreakCheck(s, t, weeks, defaultConfig);
  };

  // ⚠️ AN UNRATED SESSION IS NOT A SESSION THAT DID NOT HAPPEN. This counted a
  // week when every occurrence was skipped OR CARRIED NO RATING, and the report
  // prints the result as fact — "Gym hasn't happened in 3 weeks" — with "Let it
  // go" beside it. Rating is optional everywhere else in this app; here its
  // absence was read as absence of the event.
  it('does not call a session you went to and never rated a session you skipped', () => {
    const res = streakOf(gym(() => ({ completion: 'done' })));
    expect(res.streak).toBe(0);
    expect(res.flag).toBe(false);
  });

  it('treats a partial the same way — it happened', () => {
    expect(streakOf(gym(() => ({ completion: 'partial' }))).flag).toBe(false);
  });

  // The third state, and the one the old rule collapsed into "skipped": no
  // record at all means WE DO NOT KNOW, which is not evidence of absence. The
  // detector goes quiet rather than asserting something it cannot support.
  it('says nothing about weeks it has no record of', () => {
    const res = streakOf(gym(() => null));
    expect(res.streak).toBe(0);
    expect(res.flag).toBe(false);
  });

  // …and a real skip still counts, or the fix has simply disabled the detector.
  it('still counts weeks that were actually skipped, and stops at the one that was not', () => {
    expect(streakOf(gym(() => ({ completion: 'skipped' }))).streak).toBe(3);
    // most-recent-first: skipped, skipped, then a week you turned up for.
    const mixed = gym((i) => (i === 0 ? { completion: 'done' } : { completion: 'skipped' }));
    const res = streakOf(mixed);
    expect(res.streak).toBe(2);
    expect(res.flag).toBe(false);
  });

  // ⚠️ THE THREE SENTENCES THAT SHIPPED AND WERE WRONG. Reported twice from the
  // real report: "break blocks may want to be shorter — 2 of 3", "exercise — 3
  // of 4", "social — 3 of 5". The floor was 3 beside a 60% bar, so two out of
  // three cleared it. The ratio was never the problem; there was almost nothing
  // behind it.
  describe('the duration suggestion needs evidence, and does not second-guess', () => {
    const sess = (fit, overall, i) => {
      const t = new Task({
        title: `s${i}`, tags: ['exercise'], type: 'fixed',
        startTime: new Date(2026, 8, 7, 9, 0), endTime: new Date(2026, 8, 7, 10, 0),
      });
      t.completion = 'done';
      t.satisfaction = { overall, durationFit: fit };
      return t;
    };
    /** `long` said too-long, `right` said just-right, all rated `overall`. */
    const pool = (long, right, overall) => [
      ...Array.from({ length: long }, (_, i) => sess(1, overall, i)),
      ...Array.from({ length: right }, (_, i) => sess(0, overall, 100 + i)),
    ];
    const fit = (p) => durationFitSuggestion(p, 'exercise', defaultConfig);

    it('says nothing on the evidence that produced the complaints', () => {
      expect(fit(pool(2, 1, 3)).suggest).toBe(false); // break,    2 of 3
      expect(fit(pool(3, 1, 3)).suggest).toBe(false); // exercise, 3 of 4
      expect(fit(pool(3, 2, 3)).suggest).toBe(false); // social,   3 of 5
    });

    // ⚠️ THE CONTROL. Every assertion above is satisfied by a detector that has
    // been switched off. Real evidence must still get through.
    it('still speaks when there is enough behind it', () => {
      const r = fit(pool(6, 2, 2.5));
      expect(r).toMatchObject({ suggest: true, direction: 'shorter', count: 6, total: 8 });
      expect(fit(pool(12, 8, 3)).suggest).toBe(true);
    });

    // The user's own rule, chosen 2026-09-10: three of four exercise sessions
    // said the block ran long while every one was rated 4–5 shells and usually
    // energizing. "Ran long" beside a five-shell rating is a note about the
    // clock, not a complaint about the activity.
    it('does not tell you to cut short the thing you rate highest', () => {
      const r = fit(pool(6, 2, 4.5)); // same counts as the control above
      expect(r.suggest).toBe(false);
      expect(r.content).toBe(true);
      expect(r.meanOverall).toBeGreaterThanOrEqual(defaultConfig.detectors.durationFitContentAt);
    });

    // …and the gate is about SATISFACTION, not about the counts: the identical
    // pool rated poorly must still fire, or the two rules are entangled.
    it('is a satisfaction gate, not a second floor', () => {
      expect(fit(pool(6, 2, 4.5)).suggest).toBe(false);
      expect(fit(pool(6, 2, 2.0)).suggest).toBe(true);
    });
  });

  it('pinnedRatio note fires above 0.5', () => {
    expect(pinnedRatioNote({ pinnedRatio: 0.62 }, defaultConfig).note).toBe(true);
    expect(pinnedRatioNote({ pinnedRatio: 0.4 }, defaultConfig).note).toBe(false);
  });

  it('overpack: ≥3 days avg break ≤ minimum × 1.5', () => {
    const s = new Schedule({ config: defaultConfig });
    // Build 3 days each with two back-to-back tasks (0-min break).
    for (let d = 0; d < 3; d += 1) {
      s.addFixed({ title: `a${d}`, startTime: new Date(2026, 6, 13 + d, 9, 0), endTime: new Date(2026, 6, 13 + d, 11, 0) });
      s.addFixed({ title: `b${d}`, startTime: new Date(2026, 6, 13 + d, 11, 0), endTime: new Date(2026, 6, 13 + d, 13, 0) });
    }
    const res = overpackCheck(s, W0, defaultConfig);
    expect(res.overpacked).toBe(true);
    expect(res.packedDays).toBeGreaterThanOrEqual(3);
  });
});
