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

describe('Activities (consolidated into the bucket editor)', () => {
  const openBucket = (name) => fireEvent.click(screen.getByRole('button', { name: `Edit bucket ${name}` }));

  it('adds an activity to a bucket, defaulting its tags to the bucket', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', tags: ['rest', 'nap'] });
    render(<Harness sched={s} Comp={TagManager} />);
    openBucket('Rest');
    fireEvent.click(screen.getByRole('button', { name: 'Add activity to Rest' }));
    expect(s.activities).toHaveLength(1);
    expect(s.activities[0].bucketId).toBe(s.buckets[0].id);
    expect(s.activities[0].tags).toEqual(['rest', 'nap']);
    expect(s.activities[0].durationMin).toBe(15);
    expect(s.activities[0].durationMax).toBe(60);
  });

  it('edits the duration and keeps max ≥ min', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', tags: [] });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });
    render(<Harness sched={s} Comp={TagManager} />);
    openBucket('Rest');
    fireEvent.click(screen.getByRole('button', { name: 'Edit activity Read' })); // drill in
    fireEvent.change(screen.getByLabelText('Read minimum minutes'), { target: { value: '90' } });
    expect(s.activities[0].durationMin).toBe(90);
    expect(s.activities[0].durationMax).toBe(90); // bumped up to satisfy max ≥ min
  });

  it('removes an activity', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', tags: [] });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read' });
    render(<Harness sched={s} Comp={TagManager} />);
    openBucket('Rest');
    fireEvent.click(screen.getByRole('button', { name: 'Edit activity Read' })); // drill in
    fireEvent.click(screen.getByRole('button', { name: 'Remove activity Read' }));
    expect(s.activities).toHaveLength(0);
  });

  it('bulk-adds many activities from a pasted list (one per line, optional length/tags)', () => {
    const s = schedWith();
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    render(<Harness sched={s} Comp={TagManager} />);
    openBucket('Rest');
    fireEvent.click(screen.getByRole('button', { name: 'Paste many activities to Rest' }));
    fireEvent.change(screen.getByLabelText('Bulk add activities to Rest'), {
      target: { value: 'Read\nSketch | 30-90 | art, calm\n\n  Nap  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add \d+ activities/ }));
    expect(s.activities).toHaveLength(3); // blank line skipped
    const read = s.activities.find((a) => a.label === 'Read');
    expect(read.tags).toEqual(['rest']); // falls back to the bucket's tags
    const sketch = s.activities.find((a) => a.label === 'Sketch');
    expect(sketch.durationMin).toBe(30);
    expect(sketch.durationMax).toBe(90);
    expect(sketch.tags).toEqual(['art', 'calm']);
    expect(s.activities.every((a) => a.bucketId === s.buckets[0].id)).toBe(true);
  });

  it('opens an "Unbucketed activities" view for orphans (bucket deleted)', () => {
    const s = schedWith();
    const b = s.addBucket({ label: 'Rest', tags: [] });
    s.addActivity({ bucketId: b.id, label: 'Read' });
    s.removeBucket(b.id); // orphans the activity
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open unbucketed activities' }));
    expect(screen.getByRole('button', { name: 'Edit activity Read' })).toBeTruthy();
  });

  it('deleting a bucket via its editor orphans the activity, which can then be re-filed', () => {
    resetIds();
    const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
    const rest = s.addBucket({ label: 'Rest', tags: ['rest'] });
    const work = s.addBucket({ label: 'Work', tags: ['work'] });
    s.addActivity({ bucketId: rest.id, label: 'Read', tags: ['rest'] });
    render(<Harness sched={s} Comp={TagManager} />);

    // delete the Rest bucket from inside its editor
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove bucket Rest' }));

    // the activity survived (not deleted) and is now unbucketed
    expect(s.activities).toHaveLength(1);
    expect(s.activities[0].bucketId).toBeNull();
    // Rest is gone; Work remains
    expect(s.buckets.map((b) => b.label)).toEqual(['Work']);

    // it surfaces under "Unbucketed activities" and re-files to Work
    fireEvent.click(screen.getByRole('button', { name: 'Open unbucketed activities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit activity Read' }));
    fireEvent.change(screen.getByLabelText('Activity bucket'), { target: { value: work.id } });
    expect(s.activities[0].bucketId).toBe(work.id);
  });

  it('the paste-many sheet does not leak from a deleted bucket into the next', () => {
    resetIds();
    const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    s.addBucket({ label: 'Work', tags: ['work'] });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste many activities to Rest' }));
    expect(screen.getByLabelText('Bulk add activities to Rest')).toBeTruthy(); // sheet open
    fireEvent.click(screen.getByRole('button', { name: 'Remove bucket Rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Work' }));
    // the next bucket shows its add buttons, not a leaked paste textarea
    expect(screen.getByRole('button', { name: 'Add activity to Work' })).toBeTruthy();
    expect(screen.queryByLabelText('Bulk add activities to Work')).toBeNull();
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

  it('a bucket energy wave updates the bucket load', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } }); // user-authored load
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Work' })); // drill in to edit

    // The tube-float on a wave: a slider per axis, no numerals — value is position.
    const wave = screen.getByLabelText('mental energy');
    expect(Number(wave.getAttribute('aria-valuenow'))).toBe(2); // the authored load
    fireEvent.keyDown(wave, { key: 'ArrowLeft' }); // spend → restore, one stop at a time
    fireEvent.keyDown(wave, { key: 'ArrowLeft' });
    fireEvent.keyDown(wave, { key: 'ArrowLeft' });
    expect(s.buckets[0].load.mental).toBe(-1);
  });

  // Calibrate the energy budget: energy ratings across three distinct weeks.
  const calibrate = (s) => {
    for (const d of [1, 8, 15]) {
      const r = s.addFixed({ title: `rate${d}`, tags: ['x'], startTime: D(d, 5), endTime: D(d, 6) });
      r.completion = 'done'; r.satisfaction = { overall: 3, energy: 0 };
    }
  };

  it('stays "still learning" until calibrated — no fabricated ceiling or verdict', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } });
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) });
    render(<EnergyCard sched={s} now={D(15, 12)} />); // no ratings → uncalibrated
    expect(screen.getByText(/still learning/i)).toBeTruthy();
    expect(screen.queryByText('in the red')).toBeNull(); // never a verdict pre-calibration
  });

  it('the energy card flags a reserve in the red once calibrated (physics, not a scold)', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Work', tags: ['work'], load: { mental: 2 } }); // +2/hr, cap 8
    for (let i = 0; i < 5; i += 1) s.addFixed({ title: `W${i}`, tags: ['work'], startTime: D(15, 7 + i), endTime: D(15, 8 + i) }); // 5h straight
    calibrate(s);
    render(<EnergyCard sched={s} now={D(15, 12)} />);

    expect(screen.getByText('mental')).toBeTruthy();
    expect(screen.getAllByText('in the red').length).toBeGreaterThan(0); // reserve bottoms at −10 < −cap
  });

  it('an activity carries its own energy via the wave, or inherits its bucket', () => {
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2 } });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });
    render(<Harness sched={s} Comp={TagManager} />);

    expect(s.activities[0].load).toBeNull(); // inherits by default
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' })); // open the bucket
    fireEvent.click(screen.getByRole('button', { name: 'Edit activity Read' })); // then the activity
    // The wave starts on the inherited bucket load (mental −2); moving it sets an override.
    const wave = screen.getByLabelText('mental energy');
    expect(Number(wave.getAttribute('aria-valuenow'))).toBe(-2);
    fireEvent.keyDown(wave, { key: 'ArrowRight' }); // one stop toward spend → −1
    expect(s.activities[0].load).not.toBeNull();
    expect(s.activities[0].load.mental).toBe(-1);

    fireEvent.click(screen.getByRole('button', { name: 'Read inherit bucket energy' }));
    expect(s.activities[0].load).toBeNull(); // back to inheriting
  });
});
