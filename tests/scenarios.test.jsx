// @vitest-environment jsdom
// Scenario shakedown — realistic end-to-end journeys through the reconciled model
// (role gone, tube energy, consolidated bucket editor, energy still-learning gate,
// load-based steering). Not unit tests: these drive whole user flows to catch
// UI-vs-engine disagreements the granular tests miss (the HANDOFF's core lesson).
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import Cabana from '../src/ui/components/Cabana.jsx';
import TagManager from '../src/ui/components/TagManager.jsx';

afterEach(cleanup);
beforeEach(() => { resetIds(); vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); }); // Wed noon, deterministic

function Harness({ sched, Comp, ...rest }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <Comp sched={sched} mutate={mutate} {...rest} />;
}

const wide = () => ({ ...defaultConfig, protectedTags: [], windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });

describe('scenario: a real week end-to-end (engine)', () => {
  it('author a bucket load → activity → place it → its energy derives from the bucket', () => {
    const s = new Schedule({ config: wide() });
    const work = s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    const a = s.addActivity({ bucketId: work.id, label: 'Essay', tags: ['work'], durationMin: 60, durationMax: 120 });
    // "Do it now" into a 90-min opening
    const { task } = s.placeActivity(a, new Date(2026, 6, 15, 14, 0), 90);
    expect((task.endTime - task.startTime) / 60000).toBe(90);
    // no explicit override → derives Work's load; net is a RATE × duration (1.5h × +2/hr = 3)
    const budget = s.energyBudget(new Date(2026, 6, 15, 12));
    expect(budget.mental.net).toBe(3);
    expect(budget.mental.low).toBe(-3); // one 90-min block drains the reserve to −3
  });

  it('energy stays "still learning" fresh, and calibrates after 3 weeks of ratings', () => {
    const s = new Schedule({ config: wide() });
    expect(s.energyCalibration().calibrated).toBe(false);
    for (const d of [1, 8, 15]) {
      const t = s.addFixed({ title: `r${d}`, tags: ['x'], startTime: new Date(2026, 6, d, 6), endTime: new Date(2026, 6, d, 7) });
      t.completion = 'done'; t.satisfaction = { overall: 3, energy: 0 };
    }
    expect(s.energyCalibration().calibrated).toBe(true);
  });

  it('load-based steering floats restorative activities up when you have been draining', () => {
    const s = new Schedule({ config: wide() });
    const work = s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    const rest = s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: -1 } });
    // a draining fortnight: 12 work tasks rated energy −1
    for (let i = 0; i < 12; i += 1) {
      const day = 1 + i;
      const t = s.addFixed({ title: `w${i}`, tags: ['work'], startTime: new Date(2026, 6, day, 9), endTime: new Date(2026, 6, day, 10) });
      t.completion = 'done'; t.satisfaction = { overall: 3, energy: -1 };
    }
    s.addActivity({ bucketId: rest.id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 60 });
    s.addActivity({ bucketId: work.id, label: 'Email', tags: ['work'], durationMin: 15, durationMax: 60 });
    const opening = { start: new Date(2026, 6, 15, 14), end: new Date(2026, 6, 15, 15), minutes: 60 };
    const out = s.suggestActivities(new Date(2026, 6, 15, 14), { opening });
    expect(out[0].activity.label).toBe('Read'); // restorative leads; demanding work sinks
  });

  it('re-optimize keeps a completed task where it happened', () => {
    const s = new Schedule({ config: wide() });
    const done = s.addFlexible({ title: 'Done', startTime: new Date(2026, 6, 13, 10), endTime: new Date(2026, 6, 13, 11) });
    done.completion = 'done';
    const before = done.startTime.getTime();
    s.autoSchedule({ now: new Date(2026, 6, 15, 12), weekStart: new Date(2026, 6, 13) });
    expect(done.startTime.getTime()).toBe(before);
  });
});

describe('scenario: the consolidated bucket card, driven', () => {
  it('seed → open a bucket → set its energy on the wave → bulk-add activities → they land in it', () => {
    const s = new Schedule({ config: wide() });
    render(<Harness sched={s} Comp={TagManager} />);

    fireEvent.click(screen.getByRole('button', { name: 'Seed starter buckets' }));
    expect(s.buckets.length).toBe(6);

    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
    // set mental restorative on the wave
    const wave = screen.getByLabelText('mental energy');
    fireEvent.keyDown(wave, { key: 'ArrowLeft' });
    fireEvent.keyDown(wave, { key: 'ArrowLeft' });
    expect(s.buckets.find((b) => b.label === 'Rest').load.mental).toBe(-2);

    // bulk-add three activities into Rest
    fireEvent.click(screen.getByRole('button', { name: 'Paste many activities to Rest' }));
    fireEvent.change(screen.getByLabelText('Bulk add activities to Rest'), { target: { value: 'Read\nNap\nStretch | 10-20' } });
    fireEvent.click(screen.getByRole('button', { name: /Add \d+ activities/ }));
    const rest = s.buckets.find((b) => b.label === 'Rest');
    expect(s.activities.filter((a) => a.bucketId === rest.id)).toHaveLength(3);
  });
});

describe('scenario: the full Cabana renders with a populated schedule', () => {
  it('all cards render together and a bucket drills into its activities', () => {
    const s = new Schedule({ config: wide() });
    const work = s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    s.addActivity({ bucketId: work.id, label: 'Essay', tags: ['work'] });
    s.addZone({ label: 'Study', matchTags: ['work'], windows: [{ day: 'sat', start: '09:00', end: '12:00' }], exclusive: true });
    s.addFixed({ title: 'Class', tags: ['work'], startTime: new Date(2026, 6, 15, 9), endTime: new Date(2026, 6, 15, 10) });

    render(<Harness sched={s} Comp={Cabana} weekStart={new Date(2026, 6, 13)} onBack={() => {}} onReplace={() => {}} onReset={() => {}} showToast={() => {}} />);

    // the key cards are all present
    expect(screen.getByText('Tuning')).toBeTruthy();
    expect(screen.getByText('Zones')).toBeTruthy();
    expect(screen.getByText('Tags & buckets')).toBeTruthy();
    expect(screen.getByText('Energy today')).toBeTruthy();
    expect(screen.getByText('Footlocker')).toBeTruthy();

    // and the consolidated card drills bucket → its activity
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Work' }));
    expect(screen.getByRole('button', { name: 'Edit activity Essay' })).toBeTruthy();
  });
});
