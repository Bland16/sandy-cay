// @vitest-environment jsdom
// The two NARROW doors into a footlocker file.
//
// The plain Import replaces the whole schedule — right for a restore, wrong for
// the commoner want: "I built a good activity library on the old save and I'd
// like it here, but I am not throwing away this term's week to get it."
//
// A file cannot say which you meant, so there are two doors and each states
// what it does. This locks the behaviour AND the sentence, because the sentence
// is the only thing standing between "top up" and "lose this term's buckets".
//
// `design/probes/probe-library-merge.mjs` prints both outcomes side by side.
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  Schedule, defaultConfig, weekStart as weekStartOf,
  planLibraryMerge, applyLibraryMerge, applyLibrary,
} from '../src/core/index.js';
import Cabana from '../src/ui/components/Cabana.jsx';

/** The old save: a well-built activity library. */
const oldSave = () => {
  const s = new Schedule({ config: defaultConfig });
  const study = s.addBucket({ label: 'Study', tags: ['study'] });
  const body = s.addBucket({ label: 'Body', tags: ['gym'] });
  s.addActivity({ label: 'Read a paper', bucketId: study.id, durationMin: 45 });
  s.addActivity({ label: 'Problem set', bucketId: study.id, durationMin: 90 });
  s.addActivity({ label: 'Swim', bucketId: body.id, durationMin: 60 });
  s.addZone({ label: 'Old work', tags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '17:00' }] });
  return s.toJSON();
};

/** This term: some overlap, some of my own, and a week I care about. */
const thisTerm = () => {
  const s = new Schedule({ config: defaultConfig });
  const study = s.addBucket({ label: 'study', tags: ['study'] });   // same name, different case
  s.addBucket({ label: 'Thesis', tags: ['thesis'] });
  s.addActivity({ label: 'read a paper', bucketId: study.id, durationMin: 45 });
  s.addFixed({
    title: 'Orientation',
    startTime: new Date(2026, 8, 7, 9),
    endTime: new Date(2026, 8, 7, 10),
  });
  s.addZone({ label: 'This term work', tags: ['work'], windows: [{ day: 'tue', start: '09:00', end: '17:00' }] });
  return s;
};

describe('add what is missing', () => {
  it('adds only what I do not have, matched by name within a bucket', () => {
    const s = thisTerm();
    const plan = planLibraryMerge(s, oldSave());

    expect(plan.activityCount).toBe(2);
    expect(plan.skippedCount).toBe(1);
    expect(plan.skipped[0].label).toBe('Read a paper');  // case-insensitive match

    applyLibraryMerge(s, oldSave());
    expect(s.activities.map((a) => a.label).sort()).toEqual(['Problem set', 'Swim', 'read a paper']);
  });

  it('reuses my bucket instead of making a second one with the same name', () => {
    const s = thisTerm();
    applyLibraryMerge(s, oldSave());
    expect(s.buckets.filter((b) => b.label.toLowerCase() === 'study')).toHaveLength(1);
    const study = s.buckets.find((b) => b.label.toLowerCase() === 'study');
    expect(s.activities.find((a) => a.label === 'Problem set').bucketId).toBe(study.id);
  });

  it('brings the bucket an activity needs, but nothing else', () => {
    const s = thisTerm();
    applyLibraryMerge(s, oldSave());
    expect(s.buckets.some((b) => b.label === 'Body')).toBe(true);   // Swim needed it
    // Zones are NOT part of "add missing activities", and saying so is the
    // difference between this door and the one beside it.
    expect(s.zones.map((z) => z.label)).toEqual(['This term work']);
  });

  it('⚠️ never touches my tasks or my own buckets', () => {
    const s = thisTerm();
    applyLibraryMerge(s, oldSave());
    expect(s.tasks.map((t) => t.title)).toEqual(['Orientation']);
    expect(s.buckets.some((b) => b.label === 'Thesis')).toBe(true);
  });

  it('is idempotent — importing the same file twice adds nothing', () => {
    const s = thisTerm();
    applyLibraryMerge(s, oldSave());
    const after = s.activities.length;
    const second = applyLibraryMerge(s, oldSave());
    expect(second.activitiesAdded).toBe(0);
    expect(s.activities).toHaveLength(after);
  });

  it('refuses a file that is not one, and says why', () => {
    const s = thisTerm();
    expect(planLibraryMerge(s, { nope: true }).valid).toBe(false);
    expect(planLibraryMerge(s, { schemaVersion: 9 }).valid).toBe(false);
    expect(typeof planLibraryMerge(s, {}).reason).toBe('string');
  });
});

describe('restore setup only', () => {
  it('takes the file\'s whole library and KEEPS my tasks', () => {
    const s = thisTerm();
    applyLibrary(s, oldSave());
    expect(s.activities).toHaveLength(3);
    expect(s.zones.map((z) => z.label)).toEqual(['Old work']);
    // The cost, stated: this door discards. That is what restore MEANS, and it
    // is why the confirm has to say so.
    expect(s.buckets.some((b) => b.label === 'Thesis')).toBe(false);
    expect(s.tasks.map((t) => t.title)).toEqual(['Orientation']);
  });
});

describe('the Cabana asks a question you can actually answer', () => {
  let asked;
  beforeEach(() => {
    asked = [];
    vi.spyOn(window, 'confirm').mockImplementation((m) => { asked.push(m); return false; });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const mount = (sched) => {
    render(
      <Cabana
        sched={sched}
        mutate={(fn) => fn(sched)}
        weekStart={weekStartOf(new Date(2026, 8, 7))}
        onBack={() => {}}
        onReplace={() => {}}
        onReset={() => {}}
        showToast={(m) => asked.push(`TOAST: ${m}`)}
      />,
    );
  };

  /** Drive the real hidden input the real button opens. */
  const pick = (index, blob) => {
    const inputs = [...document.querySelectorAll('input[accept="application/json"]')];
    const file = new File([JSON.stringify(blob)], 'save.json', { type: 'application/json' });
    Object.defineProperty(inputs[index], 'files', { value: [file], configurable: true });
    inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('names the counts and promises nothing is lost, dumped not transcribed', async () => {
    // ⚠️ Read off the RENDERED component. A transcribed string is a copy that
    // agrees with itself while the shipped one says something else — this repo
    // has been unable to see presentation four times now.
    const sched = thisTerm();
    mount(sched);
    pick(1, oldSave());                       // 0 = Import, 1 = Add missing, 2 = Restore setup

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    const msg = asked[0];
    // eslint-disable-next-line no-console
    console.log(`\n  Add missing activities asks:\n    ${msg}\n`);

    expect(msg).toContain('Add 2 activities');
    expect(msg).toContain('1 bucket');          // Body, which Swim needs
    expect(msg).toContain('1 you already have will be skipped');
    expect(msg).toContain('Nothing you have is changed or removed');
    // Declined, so nothing happened.
    expect(sched.activities).toHaveLength(1);
  });

  it('⚠️ the restore door SAYS it discards, and says what survives', async () => {
    const sched = thisTerm();
    mount(sched);
    pick(2, oldSave());

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    const msg = asked[0];
    // eslint-disable-next-line no-console
    console.log(`  Restore setup only asks:\n    ${msg}\n`);

    expect(msg).toContain('Replace');
    expect(msg).toContain('Your tasks are kept');
    expect(msg).toContain('discarded');
    expect(sched.buckets.some((b) => b.label === 'Thesis')).toBe(true);   // declined
  });

  it('says so plainly when the file adds nothing new', async () => {
    const sched = thisTerm();
    // A file holding only what we already have.
    const same = new Schedule({ config: defaultConfig });
    const b = same.addBucket({ label: 'study', tags: ['study'] });
    same.addActivity({ label: 'read a paper', bucketId: b.id, durationMin: 45 });

    mount(sched);
    pick(1, same.toJSON());

    await waitFor(() => expect(asked.some((a) => a.startsWith('TOAST:'))).toBe(true));
    expect(asked.find((a) => a.startsWith('TOAST:'))).toContain('Nothing new');
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
