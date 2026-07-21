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
import ZonesEditor from '../src/ui/components/ZonesEditor.jsx';

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

describe('§7.1 — a long activity list stays navigable', () => {
  // 12 activities in one bucket: enough to page at the default size of 8.
  const bucketOf = (n) => {
    resetIds();
    const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    for (let i = 0; i < n; i += 1) {
      s.addActivity({ bucketId: s.buckets[0].id, label: `Act ${String(i).padStart(2, '0')}`, durationMin: 15, durationMax: 60 });
    }
    return s;
  };
  const openRest = () => fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
  const rows = () => screen.queryAllByRole('button', { name: /^Edit activity / });

  it('a short list shows no filter, no sort and no pager — the calm case is untouched', () => {
    render(<Harness sched={bucketOf(3)} Comp={TagManager} />);
    openRest();
    expect(rows()).toHaveLength(3);
    expect(screen.queryByLabelText(/Filter activities/)).toBeNull();
    expect(screen.queryByLabelText('Sort activities')).toBeNull();
    expect(screen.queryByLabelText('Next page of activities')).toBeNull();
  });

  it('a long list pages at 8, and next/prev walk it', () => {
    render(<Harness sched={bucketOf(12)} Comp={TagManager} />);
    openRest();
    expect(rows()).toHaveLength(8);
    expect(screen.getByText('1 of 2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Next page of activities'));
    expect(rows()).toHaveLength(4);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByLabelText('Next page of activities').disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Previous page of activities'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByLabelText('Previous page of activities').disabled).toBe(true);
  });

  it('filtering from a later page returns to page 1 instead of showing an empty list', () => {
    // The specific hazard of having both controls: filter down to 1 result while
    // sitting on page 2 and, without the reset, you see nothing at all.
    render(<Harness sched={bucketOf(12)} Comp={TagManager} />);
    openRest();
    fireEvent.click(screen.getByLabelText('Next page of activities')); // → page 2
    expect(screen.getByText('2 of 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Filter activities/), { target: { value: 'Act 03' } });
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText(/^\d+ of \d+$/)).toBeNull(); // one page → pager hidden
  });

  it('a filter matching nothing says so, and offers a way back', () => {
    render(<Harness sched={bucketOf(12)} Comp={TagManager} />);
    openRest();
    fireEvent.change(screen.getByLabelText(/Filter activities/), { target: { value: 'zzz' } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'clear the filter' }));
    expect(rows()).toHaveLength(8); // back to the full first page
  });

  it('Z–A reverses the order', () => {
    render(<Harness sched={bucketOf(12)} Comp={TagManager} />);
    openRest();
    expect(rows()[0].getAttribute('aria-label')).toBe('Edit activity Act 00');

    fireEvent.change(screen.getByLabelText('Sort activities'), { target: { value: 'za' } });
    expect(rows()[0].getAttribute('aria-label')).toBe('Edit activity Act 11');
  });

  it('most-used ranks by instantiations in the window, and leaving the bucket clears the filter', () => {
    const s = bucketOf(12);
    const target = s.activities.find((a) => a.label === 'Act 07');
    for (let i = 0; i < 3; i += 1) {
      s.addFixed({ title: 'Act 07', startTime: new Date(2026, 6, 15 + i, 9), endTime: new Date(2026, 6, 15 + i, 10), activityId: target.id });
    }
    render(<Harness sched={s} Comp={TagManager} />);
    openRest();
    fireEvent.change(screen.getByLabelText('Sort activities'), { target: { value: 'used' } });
    expect(rows()[0].getAttribute('aria-label')).toBe('Edit activity Act 07');

    // A filter left behind in one bucket must not follow you into the next view.
    fireEvent.change(screen.getByLabelText(/Filter activities/), { target: { value: 'Act 03' } });
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /All buckets/ }));
    openRest();
    expect(rows()).toHaveLength(8);
  });
});

describe('§7.1 — pasting duplicates', () => {
  const emptyBucket = () => {
    resetIds();
    const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
    s.addBucket({ label: 'Rest', tags: ['rest'] });
    return s;
  };
  const openPaste = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
    fireEvent.click(screen.getByRole('button', { name: /Paste many activities/ }));
  };
  const type = (text) => fireEvent.change(screen.getByLabelText(/Bulk add activities/), { target: { value: text } });

  it('the same line twice in one paste creates one activity', () => {
    const s = emptyBucket();
    render(<Harness sched={s} Comp={TagManager} />);
    openPaste();
    type('meditate | 15-30\nmeditate | 15-30\nnap | 20-45');

    expect(screen.getByText(/skipping 1 duplicate/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Add 2 activities$/ }));
    expect(s.activities.map((a) => a.label)).toEqual(['meditate', 'nap']);
  });

  it('pasting the same block twice is idempotent', () => {
    const s = emptyBucket();
    render(<Harness sched={s} Comp={TagManager} />);
    openPaste();
    type('meditate | 15-30\nnap | 20-45');
    fireEvent.click(screen.getByRole('button', { name: /^Add 2 activities$/ }));
    expect(s.activities).toHaveLength(2);

    // Committing leaves you inside the bucket editor, so reopen the sheet only.
    fireEvent.click(screen.getByRole('button', { name: /Paste many activities/ }));
    type('meditate | 15-30\nnap | 20-45');
    // Everything is already here, so there is nothing to add — and the button says so.
    expect(screen.getByText(/skipping 2 duplicates/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Add activities$/ }).disabled).toBe(true);
    expect(s.activities).toHaveLength(2);
  });

  it('names what it is skipping rather than silently swallowing it', () => {
    const s = emptyBucket();
    render(<Harness sched={s} Comp={TagManager} />);
    openPaste();
    type('meditate | 15-30\nMEDITATE | 20-45'); // case-insensitive match
    expect(screen.getByText(/skipping 1 duplicate: MEDITATE/)).toBeTruthy();
  });
});

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
    // Inheriting: ghost tubes, the source named, and the state announced (§5.3).
    expect(document.querySelector('.energyctl.inheriting')).toBeTruthy();
    expect(document.querySelector('.enfloat.ghost')).toBeTruthy();
    expect(wave.getAttribute('aria-valuetext')).toMatch(/inherited/);
    expect(screen.getByText(/inheriting from/)).toBeTruthy();

    fireEvent.keyDown(wave, { key: 'ArrowRight' }); // one stop toward spend → −1
    expect(s.activities[0].load).not.toBeNull();
    expect(s.activities[0].load.mental).toBe(-1);
    // Committed: solid tubes, no "inherited" in the announcement.
    expect(document.querySelector('.energyctl.inheriting')).toBeNull();
    expect(document.querySelector('.enfloat.ghost')).toBeNull();
    expect(screen.getByLabelText('mental energy').getAttribute('aria-valuetext')).not.toMatch(/inherited/);

    fireEvent.click(screen.getByRole('button', { name: '↺ inherit Rest' }));
    expect(s.activities[0].load).toBeNull(); // back to inheriting
    expect(document.querySelector('.energyctl.inheriting')).toBeTruthy();
  });

  it('committing one axis keeps the other three at their inherited values', () => {
    // The trap in a "touch to commit" control: writing only the touched axis
    // would snap the other three to zero the moment you nudge one, silently
    // discarding the bucket's character. onChange sends the whole vector.
    resetIds();
    const s = new Schedule({ config: wide() });
    s.addBucket({ label: 'Rest', tags: ['rest'], load: { mental: -2, physical: 1, social: -1, creative: 2 } });
    s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', durationMin: 15, durationMax: 60 });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit activity Read' }));

    fireEvent.keyDown(screen.getByLabelText('mental energy'), { key: 'ArrowRight' }); // −2 → −1
    const load = s.activities[0].load;
    expect(load.mental).toBe(-1);      // the one we moved
    expect(load.physical).toBe(1);     // inherited, preserved
    expect(load.social).toBe(-1);
    expect(load.creative).toBe(2);
  });
});

describe('§8 — retire completes the pair', () => {
  const bucketWithTags = () => {
    resetIds();
    const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
    s.addBucket({ label: 'Rest', tags: ['rest', 'nap'] });
    return s;
  };
  const openRest = () => fireEvent.click(screen.getByRole('button', { name: 'Edit bucket Rest' }));

  it('a bucket tag can be retired, and comes back from the strip', () => {
    const s = bucketWithTags();
    render(<Harness sched={s} Comp={TagManager} />);
    openRest();

    fireEvent.click(screen.getByRole('button', { name: 'Retire nap' }));
    expect(s.retiredTags).toContain('nap');
    // Retire is an archive, NOT a removal: the bucket keeps the tag, so history
    // and energy resolution are untouched.
    expect(s.buckets[0].tags).toContain('nap');

    fireEvent.click(screen.getByRole('button', { name: /All buckets/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Un-retire nap' }));
    expect(s.retiredTags).not.toContain('nap');
  });

  it('remove-from-bucket and retire are different verbs, and say so', () => {
    const s = bucketWithTags();
    render(<Harness sched={s} Comp={TagManager} />);
    openRest();

    fireEvent.click(screen.getByRole('button', { name: 'Remove nap from bucket' }));
    expect(s.buckets[0].tags).not.toContain('nap'); // gone from the bucket…
    expect(s.retiredTags).not.toContain('nap'); // …but not retired
  });

  it('an already-retired tag offers no second retire button', () => {
    const s = bucketWithTags();
    s.retireTag('nap');
    render(<Harness sched={s} Comp={TagManager} />);
    openRest();
    expect(screen.queryByRole('button', { name: 'Retire nap' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retire rest' })).toBeTruthy();
  });

  it('zones do not get the retire affordance — it belongs to the bucket editor', () => {
    const s = bucketWithTags();
    s.addZone({ label: 'Work', matchTags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '17:00' }] });
    render(<Harness sched={s} Comp={ZonesEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit zone Work' }));
    expect(screen.queryByRole('button', { name: 'Retire work' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove work' })).toBeTruthy();
  });
});
