// @vitest-environment jsdom
// Phase B — the Cabana Tag Manager and Activities editor, driven standalone with
// a tiny mutate harness (the components are pure: props are just sched + mutate).
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import { tagsInUse } from '../src/ui/components/TagEditor.jsx';
import TagManager from '../src/ui/components/TagManager.jsx';
import ActivitiesEditor from '../src/ui/components/ActivitiesEditor.jsx';
import EnergyCard from '../src/ui/components/EnergyCard.jsx';

afterEach(cleanup);

// mutate(fn) applies fn to the live schedule and forces a re-render — the same
// contract useEngine#mutate gives the real Cabana.
function Harness({ sched, Comp }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <Comp sched={sched} mutate={mutate} />;
}

function schedWith(...tagLists) {
  resetIds();
  const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
  tagLists.forEach((tags, i) => s.addFixed({
    title: `T${i}`, tags,
    startTime: new Date(2026, 6, 15, 9 + i, 0),
    endTime: new Date(2026, 6, 15, 10 + i, 0),
  }));
  return s;
}

describe('TagManager', () => {
  it('seeds the six starter buckets', () => {
    const s = schedWith();
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seed starter buckets' }));
    expect(s.buckets).toHaveLength(6);
  });

  it('adds a bucket', () => {
    const s = schedWith();
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bucket' }));
    expect(s.buckets).toHaveLength(1);
  });

  it('adds tags to a bucket in its editor, moving a tag out of any other bucket', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['foo'] });
    s.addBucket({ label: 'Work', role: 'work', tags: [] });
    render(<Harness sched={s} Comp={TagManager} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Work' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ tag' })); // TagEditor, same as on a task
    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const work = s.buckets.find((b) => b.label === 'Work');
    const rest = s.buckets.find((b) => b.label === 'Rest');
    expect(work.tags).toContain('foo');
    expect(rest.tags).not.toContain('foo'); // moved, not copied — a tag lives in one bucket
  });

  it('protection is a bucket-level toggle in the editor', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest', 'nap'] });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));

    const cb = screen.getByLabelText("Protect this bucket's tags");
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(s.config.protectedTags).toEqual(expect.arrayContaining(['rest', 'nap']));
    fireEvent.click(cb);
    expect(s.config.protectedTags).not.toContain('rest');
  });

  it('removes a bucket from its editor', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['foo'] });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' })); // drill in
    fireEvent.click(screen.getByRole('button', { name: 'Remove bucket Rest' }));
    expect(s.buckets).toHaveLength(0);
  });
});

describe('ActivitiesEditor', () => {
  it('points to Tags & buckets when there are no buckets', () => {
    const s = schedWith();
    render(<Harness sched={s} Comp={ActivitiesEditor} />);
    expect(screen.getByText(/Make a bucket in/)).toBeTruthy();
  });

  it('adds an activity to a bucket, defaulting its tags to the bucket', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest', 'nap'] });
    render(<Harness sched={s} Comp={ActivitiesEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add activity to Rest' }));
    expect(s.activities).toHaveLength(1);
    expect(s.activities[0].bucketId).toBe(s.buckets[0].id);
    expect(s.activities[0].tags).toEqual(['rest', 'nap']);
    expect(s.activities[0].durationMin).toBe(15);
    expect(s.activities[0].durationMax).toBe(60);
  });

  it('edits the duration and keeps max ≥ min', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: [] });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });
    render(<Harness sched={s} Comp={ActivitiesEditor} />);

    fireEvent.change(screen.getByLabelText('Read minimum minutes'), { target: { value: '90' } });
    expect(s.activities[0].durationMin).toBe(90);
    expect(s.activities[0].durationMax).toBe(90); // bumped up to satisfy max ≥ min
  });

  it('removes an activity', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', role: 'rest', tags: [] });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read' });
    render(<Harness sched={s} Comp={ActivitiesEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Read' }));
    expect(s.activities).toHaveLength(0);
  });
});

describe('retire hides a tag from the new-task picker', () => {
  it('excludes retired tags from the picker suggestions', () => {
    const s = schedWith(['foo', 'bar']);
    s.retireTag('bar');
    // The contract the Add/Task panels apply at their TagEditor call sites.
    const suggestions = tagsInUse(s).filter((t) => !s.isTagRetired(t));
    expect(suggestions).toContain('foo');
    expect(suggestions).not.toContain('bar');
  });
});

describe('L-1 energy UI', () => {
  const D = (d, h) => new Date(2026, 6, d, h, 0, 0, 0);
  const wide = () => ({ ...defaultConfig, protectedTags: [], windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });

  it('a bucket load dial updates the bucket load', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', role: 'work', tags: ['work'] });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Work' })); // drill in to edit

    const dial = screen.getByLabelText('Work mental load');
    expect(Number(dial.value)).toBe(2); // the work role default
    fireEvent.change(dial, { target: { value: '-1' } });
    expect(s.buckets[0].load.mental).toBe(-1);
  });

  it('the energy card flags an over-budget axis (physics, not a scold)', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', role: 'work', tags: ['work'] }); // mental +2, cap 8
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) });
    render(<EnergyCard sched={s} now={D(15, 12)} />);

    expect(screen.getByText('mental')).toBeTruthy();
    expect(screen.getAllByText('over budget').length).toBeGreaterThan(0); // 10 > 8
  });
});
