// @vitest-environment jsdom
// R-A — the routine MODEL (design/ROUTINES.md).
//
// The hybrid, decided 2026-08-16:
//   STORED   the PROGRAM   — RoutineInstance: the steps and waits as run, plus
//                            this run's one-time adjustments
//   DERIVED  the PLACEMENT — touchpoint tasks carrying routineId + stepIndex
//
// Neither half alone works: derived cannot hold a per-run tweak (a wait is not
// a task), stored alone drifts from the grid. These tests lock the split.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import {
  Schedule, Activity, RoutineInstance, Task, defaultConfig,
  exportState, summarizeImport,
} from '../src/core/index.js';
import { useEngine } from '../src/ui/useEngine.js';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The spec's own example: load → wash → switch → dry → fold. */
const LAUNDRY = {
  label: 'Laundry',
  steps: [
    { label: 'load', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'wash', kind: 'passive', durationMin: 45, durationMax: 45 },
    { label: 'switch', kind: 'active', durationMin: 2, durationMax: 5 },
    { label: 'dry', kind: 'passive', durationMin: 60, durationMax: 60 },
    { label: 'fold', kind: 'active', durationMin: 10, durationMax: 15 },
  ],
};

describe('Activity — steps and travel', () => {
  it('is a ROUTINE only when it has steps', () => {
    expect(new Activity(LAUNDRY).isRoutine).toBe(true);
    expect(new Activity({ label: 'Read' }).isRoutine).toBe(false);
    expect(new Activity({ label: 'Read', steps: [] }).isRoutine).toBe(false);
  });

  it('separates ATTENTION from ELAPSED — the whole point of a passive wait', () => {
    const a = new Activity(LAUNDRY);
    // Elapsed: 2 + 45 + 2 + 60 + 10 = 119m of wall clock.
    expect(a.span().min).toBe(119);
    // Attention: 2 + 2 + 10 = 14m. You are FREE for the other 105.
    expect(a.attentionMin()).toBe(14);
    expect(a.activeSteps().map((s) => s.label)).toEqual(['load', 'switch', 'fold']);
  });

  it('allows SUB-15 steps, which the grid floor forbids everywhere else', () => {
    // Decision 2: a 2-minute switch cannot exist at the 15-minute floor, and
    // routine steps are placed programmatically and never hand-resized.
    const a = new Activity(LAUNDRY);
    expect(a.steps[0].durationMin).toBe(2);
    // …while the ordinary activity duration still has its floor.
    expect(new Activity({ label: 'x', durationMin: 5 }).durationMin).toBe(15);
  });

  it('fuses travel as a lead-in — the gym\'s "can\'t just go whenever"', () => {
    const gym = new Activity({ label: 'Gym', travelMin: 15, durationMin: 45, durationMax: 60 });
    expect(gym.isRoutine).toBe(false);
    expect(gym.span()).toEqual({ min: 60, max: 75 });
    expect(gym.attentionMin()).toBe(60);
  });

  it('keeps a wait\'s FLOOR when a ceiling is typed below it', () => {
    // R-1: min is physics, max is preference. A preference may not overrule
    // the machine not being finished.
    const a = new Activity({
      label: 'Waffles',
      steps: [{ label: 'cook', kind: 'passive', durationMin: 5, maxWaitMin: 2 }],
    });
    expect(a.steps[0].durationMin).toBe(5);
    expect(a.steps[0].maxWaitMin).toBe(5);
  });

  it('carries maxWaitMin only on a WAIT, and round-trips both ways', () => {
    const a = new Activity({
      label: 'Waffles',
      steps: [
        { label: 'in the air fryer', kind: 'active', durationMin: 2, maxWaitMin: 99 },
        { label: 'cooking', kind: 'passive', durationMin: 5, maxWaitMin: 10 },
        { label: 'eat', kind: 'active', durationMin: 10 },
      ],
    });
    expect(a.steps[0].maxWaitMin).toBe(null); // meaningless on an active step
    expect(a.steps[1].maxWaitMin).toBe(10);
    const back = Activity.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(back.toJSON()).toEqual(a.toJSON());
  });

  it('an activity with no steps round-trips exactly as before', () => {
    const a = new Activity({ label: 'Read', bucketId: 'b', durationMin: 20, durationMax: 90 });
    const back = Activity.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(back.toJSON()).toEqual(a.toJSON());
    expect(back.steps).toBe(null);
    expect(back.travelMin).toBe(0);
  });
});

describe('RoutineInstance — the frozen program', () => {
  const START = new Date(2026, 8, 7, 19, 0, 0);

  it('lays the chain out at the spec\'s own offsets', () => {
    const run = RoutineInstance.fromActivity(new Activity(LAUNDRY), START);
    // load @0 · wash 45 · switch @47 · dry 60 · fold @109
    expect(run.offsets().map((o) => o.offsetMin)).toEqual([0, 47, 109]);
    expect(run.offsets().map((o) => o.label)).toEqual(['load', 'switch', 'fold']);
    expect(run.spanMin).toBe(119);
    expect(run.attentionMin).toBe(14);
  });

  it('uses each wait\'s FLOOR for the offsets, never its ceiling', () => {
    // R-1: min is physics — the machine is not finished, so the next
    // touchpoint may never be earlier. max is a preference and does not move
    // anchors. A ceiling must therefore change nothing here.
    const withCeiling = new Activity({
      label: 'L',
      steps: [
        { label: 'a', kind: 'active', durationMin: 2 },
        { label: 'w', kind: 'passive', durationMin: 45, maxWaitMin: 50 },
        { label: 'b', kind: 'active', durationMin: 2 },
      ],
    });
    const run = RoutineInstance.fromActivity(withCeiling, START);
    expect(run.offsets().map((o) => o.offsetMin)).toEqual([0, 47]);
    expect(run.waits()).toEqual([{ stepIndex: 1, fromMin: 2, toMin: 47, maxWaitMin: 50 }]);
  });

  it('WAITS ARE NOT TOUCHPOINTS — they never become tasks', () => {
    const run = RoutineInstance.fromActivity(new Activity(LAUNDRY), START);
    expect(run.steps.length).toBe(5);
    expect(run.offsets().length).toBe(3); // only the active ones
    expect(run.waits().map((w) => w.stepIndex)).toEqual([1, 3]);
  });

  it('adjusts THIS RUN without touching the saved routine', () => {
    // §"Program once, adjust per run" — the same "this one vs the pattern"
    // split §4C already gives recurrence occurrences.
    const activity = new Activity(LAUNDRY);
    const run = RoutineInstance.fromActivity(activity, START, {
      steps: { 1: { durationMin: 60 }, 4: { skip: true } },
    });
    // The wash stretched, and the fold is gone from THIS run.
    expect(run.offsets().map((o) => o.offsetMin)).toEqual([0, 62]);
    expect(run.offsets().map((o) => o.label)).toEqual(['load', 'switch']);
    // ⚠️ The library template is untouched — the whole point.
    expect(activity.steps[1].durationMin).toBe(45);
    expect(activity.steps.length).toBe(5);
  });

  it('FREEZES the program, so editing the library never rewrites history', () => {
    const activity = new Activity(LAUNDRY);
    const run = RoutineInstance.fromActivity(activity, START);
    activity.steps[1].durationMin = 90; // the library changes later
    expect(run.offsets().map((o) => o.offsetMin)).toEqual([0, 47, 109]);
  });

  it('runs a SIMPLE activity as a one-step chain, needing no special case', () => {
    const run = RoutineInstance.fromActivity(new Activity({ label: 'Read', durationMin: 30 }), START);
    expect(run.offsets()).toEqual([{ stepIndex: 0, offsetMin: 0, label: 'Read', durationMin: 30, durationMax: 60 }]);
  });

  it('round-trips through JSON', () => {
    const run = RoutineInstance.fromActivity(new Activity(LAUNDRY), START, { travelMin: 10 });
    const back = RoutineInstance.fromJSON(JSON.parse(JSON.stringify(run.toJSON())));
    expect(back.toJSON()).toEqual(run.toJSON());
    expect(back.startTime.getTime()).toBe(START.getTime());
    expect(back.offsets()[0].offsetMin).toBe(10); // travel is the lead-in
  });
});

describe('Schedule — the split in practice', () => {
  const START = new Date(2026, 8, 7, 19, 0, 0);
  const withRun = () => {
    const s = new Schedule({ config: defaultConfig });
    const a = s.addActivity({ ...LAUNDRY, bucketId: null });
    const run = s.addRoutineInstance(RoutineInstance.fromActivity(a, START));
    // The DERIVED half: one task per active step, carrying the link.
    run.offsets().forEach((o) => {
      const t = new Task({
        title: `${run.label} — ${o.label}`,
        type: 'fixed',
        startTime: new Date(START.getTime() + o.offsetMin * 60000),
        endTime: new Date(START.getTime() + (o.offsetMin + o.durationMin) * 60000),
        routineId: run.id,
        stepIndex: o.stepIndex,
      });
      s.tasks.push(t);
    });
    return { s, run };
  };

  it('derives the chain from the TASKS, in program order', () => {
    const { s, run } = withRun();
    const tp = s.touchpointsFor(run.id);
    expect(tp.length).toBe(3);
    expect(tp.map((t) => t.stepIndex)).toEqual([0, 2, 4]);
    expect(tp.map((t) => t.startTime.getHours() * 60 + t.startTime.getMinutes()))
      .toEqual([19 * 60, 19 * 60 + 47, 20 * 60 + 49]);
  });

  it('a hand-deleted touchpoint shortens the chain WITHOUT invalidating the program', () => {
    // The reason the placement is derived: a stored member list would now be
    // claiming three touchpoints while the grid holds two.
    const { s, run } = withRun();
    s.removeTask(s.touchpointsFor(run.id)[1].id);
    expect(s.touchpointsFor(run.id).length).toBe(2);
    expect(s.routineInstances.length).toBe(1);
    expect(run.steps.length).toBe(5); // the program is intact
  });

  it('a hand-MOVED touchpoint keeps its step number (R-1)', () => {
    // Sorted by stepIndex, not by time: your hand may put it anywhere, and it
    // does not stop being the step it is.
    const { s, run } = withRun();
    const tp = s.touchpointsFor(run.id);
    tp[2].startTime = new Date(START.getTime() - 60 * 60000); // fold, dragged earlier
    expect(s.touchpointsFor(run.id).map((t) => t.stepIndex)).toEqual([0, 2, 4]);
  });

  it('deletes as a GROUP — half a laundry is not a thing you meant to keep', () => {
    const { s, run } = withRun();
    const other = s.addFixed({ title: 'Dinner', startTime: new Date(2026, 8, 7, 18, 0), endTime: new Date(2026, 8, 7, 18, 30) });
    s.removeRoutineInstance(run.id);
    expect(s.routineInstances.length).toBe(0);
    expect(s.touchpointsFor(run.id)).toEqual([]);
    expect(s.tasks.find((t) => t.id === other.id)).toBeTruthy(); // untouched
  });
});

describe('the five halves that have to move together (sharp edge #15)', () => {
  const authored = () => {
    const s = new Schedule({ config: defaultConfig });
    const a = s.addActivity({ ...LAUNDRY });
    s.addRoutineInstance(RoutineInstance.fromActivity(a, new Date(2026, 8, 7, 19, 0)));
    s.addRoutineInstance(RoutineInstance.fromActivity(a, new Date(2026, 8, 8, 19, 0), {
      steps: { 1: { durationMin: 60 } },
    }));
    return s;
  };

  it('halves 1+2 — toJSON writes them and the constructor reads them back', () => {
    const { data } = exportState(authored());
    expect(data.routineInstances.length).toBe(2);
    const back = Schedule.fromJSON(data);
    expect(back.routineInstances.length).toBe(2);
    expect(back.routineInstances[0]).toBeInstanceOf(RoutineInstance);
    // The per-run adjustment survives — the reason the program is stored at all.
    expect(back.routineInstances[1].steps[1].durationMin).toBe(60);
    expect(back.routineInstances[0].steps[1].durationMin).toBe(45);
    // …and the Activity's steps survive too.
    expect(back.activities[0].steps.length).toBe(5);
  });

  it('half 3 — the import summary counts them', () => {
    const sum = summarizeImport(exportState(authored()).data);
    expect(sum.routineCount).toBe(2);
  });

  it('half 4 — useEngine#replace carries them, through the REAL hook', () => {
    const { data } = exportState(authored());
    function Harness({ blob }) {
      const { sched, replace, version } = useEngine();
      void version;
      return (
        <div>
          <button type="button" onClick={() => replace(blob)}>go</button>
          <output data-testid="runs">{sched.routineInstances.map((r) => r.label).join('|')}</output>
        </div>
      );
    }
    render(<Harness blob={data} />);
    expect(screen.getByTestId('runs').textContent).toBe('');
    act(() => { fireEvent.click(screen.getByText('go')); });
    expect(screen.getByTestId('runs').textContent).toBe('Laundry|Laundry');
  });

  it('an old save with no routineInstances key loads clean', () => {
    const { data } = exportState(new Schedule({ config: defaultConfig }));
    delete data.routineInstances;
    expect(data.schemaVersion).toBe(1);
    expect(Schedule.fromJSON(data).routineInstances).toEqual([]);
  });

  it('a Task round-trips its routine link', () => {
    const t = new Task({
      title: 'switch', type: 'fixed',
      startTime: new Date(2026, 8, 7, 19, 47), endTime: new Date(2026, 8, 7, 19, 49),
      routineId: 'laundry-run', stepIndex: 2,
    });
    const back = Task.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
    expect(back.routineId).toBe('laundry-run');
    expect(back.stepIndex).toBe(2);
    // An ordinary task keeps nulls rather than undefined, so the pair is symmetric.
    const plain = Task.fromJSON(JSON.parse(JSON.stringify(new Task({ title: 'x' }).toJSON())));
    expect(plain.routineId).toBe(null);
    expect(plain.stepIndex).toBe(null);
  });
});
