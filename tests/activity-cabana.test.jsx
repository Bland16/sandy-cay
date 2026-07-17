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

  it('surfaces an unused tag as Unbucketed and assigns it to a bucket (moving, not copying)', () => {
    const s = schedWith(['foo']);
    s.addBucket({ label: 'Rest', role: 'rest', tags: [] });
    s.addBucket({ label: 'Work', role: 'work', tags: [] });
    render(<Harness sched={s} Comp={TagManager} />);

    const [rest, work] = s.buckets;
    const select = screen.getByLabelText('Bucket for foo'); // proves it surfaced
    fireEvent.change(select, { target: { value: rest.id } });
    expect(s.buckets.find((b) => b.id === rest.id).tags).toContain('foo');

    // Re-assigning moves it — never in two buckets at once.
    fireEvent.change(screen.getByLabelText('Bucket for foo'), { target: { value: work.id } });
    expect(s.buckets.find((b) => b.id === rest.id).tags).not.toContain('foo');
    expect(s.buckets.find((b) => b.id === work.id).tags).toContain('foo');
  });

  it('toggles a tag protected (absorbs the old Tag roles card)', () => {
    const s = schedWith(['foo']);
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByLabelText('Protect foo'));
    expect(s.config.protectedTags).toContain('foo');
    fireEvent.click(screen.getByLabelText('Protect foo'));
    expect(s.config.protectedTags).not.toContain('foo');
  });

  it('retires and un-retires a tag', () => {
    const s = schedWith(['foo']);
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retire foo' }));
    expect(s.isTagRetired('foo')).toBe(true);
    // The action flips to un-retire.
    fireEvent.click(screen.getByRole('button', { name: 'Un-retire foo' }));
    expect(s.isTagRetired('foo')).toBe(false);
  });

  it('removing a bucket returns its tags to Unbucketed', () => {
    const s = schedWith(['foo']);
    s.addBucket({ label: 'Rest', role: 'rest', tags: ['foo'] });
    render(<Harness sched={s} Comp={TagManager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove bucket Rest' }));
    expect(s.buckets).toHaveLength(0);
    // 'foo' is still a known tag, now unbucketed and offered again.
    expect(screen.getByLabelText('Bucket for foo')).toBeTruthy();
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
