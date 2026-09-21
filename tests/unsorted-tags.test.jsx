// @vitest-environment jsdom
// F-11 (design/PLAN-AUDIT-2.md §2.1) — tags on real tasks that no bucket holds.
//
// They matter because `loadForTask` derives a task's energy from the buckets its
// tags belong to: a task matching none gets an all-zero vector and is silently
// invisible to the battery, `learnedCapacity`, the budget card and the report's
// spend/restore. Measured on a real library, a TENTH of the record was derived
// as zero-energy this way and nothing in the app said so.
//
// ⚠️ `unsortedTags` is NOT the same thing as the Tag manager's existing
// `orphans`, which is ACTIVITIES with no bucket — a library-tidiness matter.
// This is tags on real tasks, which is an energy-model matter.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, loadForTask, LOAD_AXES } from '../src/core/index.js';
import { unsortedTags } from '../src/ui/components/TagEditor.jsx';
import TagManager from '../src/ui/components/TagManager.jsx';

afterEach(cleanup);

const at = (day, h, mi = 0) => new Date(2026, 8, day, h, mi, 0, 0);

function schedWith() {
  const s = new Schedule({});
  s.addBucket({ label: 'Exercise', tags: ['gym'], load: { physical: 2 } });
  // 3 hours on a tag no bucket holds.
  s.addFixed({ title: 'Mystery block', tags: ['errand'], startTime: at(14, 9), endTime: at(14, 12) });
  // 30 minutes on another.
  s.addFixed({ title: 'Small thing', tags: ['admin'], startTime: at(14, 13), endTime: at(14, 13, 30) });
  // A bucketed tag, which must NOT appear.
  s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(15, 18), endTime: at(15, 19) });
  return s;
}

describe('F-11 — unsortedTags', () => {
  it('finds tags in use that no bucket holds, and ignores ones that are held', () => {
    const rows = unsortedTags(schedWith());
    expect(rows.map((r) => r.tag)).toEqual(['errand', 'admin']);
  });

  it('orders by HOURS, not alphabetically — the ordering is the finding', () => {
    const rows = unsortedTags(schedWith());
    // 'errand' carries 180 min, 'admin' 30 — alphabetically 'admin' would lead.
    expect(rows[0]).toMatchObject({ tag: 'errand', minutes: 180 });
    expect(rows[1]).toMatchObject({ tag: 'admin', minutes: 30 });
  });

  it('the consequence it exists to surface is real: those tasks derive zero load', () => {
    const s = schedWith();
    const mystery = s.tasks.find((t) => t.title === 'Mystery block');
    const gym = s.tasks.find((t) => t.title === 'Gym');
    const zero = loadForTask(s, mystery);
    expect(LOAD_AXES.every((a) => zero[a] === 0)).toBe(true);   // invisible to the battery
    expect(loadForTask(s, gym).physical).toBeGreaterThan(0);     // the bucketed one is not
  });

  it('returns nothing when every tag is bucketed', () => {
    const s = new Schedule({});
    s.addBucket({ label: 'Exercise', tags: ['gym'], load: { physical: 2 } });
    s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(14, 9), endTime: at(14, 10) });
    expect(unsortedTags(s)).toEqual([]);
  });

  it('ignores chunking parents, which hold no real hours', () => {
    const s2 = schedWith();
    // A bookkeeping parent carrying a stray tag must contribute no minutes.
    const parent = s2.addFixed({ title: 'Thesis', tags: ['writing'], startTime: at(16, 9), endTime: at(16, 12) });
    parent.chunking = { totalMinutes: 600, minChunk: 60, maxChunk: 120, range: {} };
    expect(unsortedTags(s2).find((r) => r.tag === 'writing')).toBeUndefined();
  });

});

describe('F-11 — the Tag manager button', () => {
  const noop = (fn) => (typeof fn === 'function' ? fn(schedWith()) : undefined);

  it('shows a button carrying the count, and the strip only once opened', () => {
    render(<TagManager sched={schedWith()} mutate={noop} />);
    const btn = screen.getByRole('button', { name: /unsorted tag/i });
    expect(btn.textContent).toContain('2'); // jest-dom matchers are not wired here
    // Closed by default — this card is not a warning surface (P-1).
    expect(screen.queryByText('Unsorted tags')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByText('Unsorted tags')).toBeTruthy();
    expect(screen.getByText('errand')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
  });

  it('is ABSENT when nothing is unsorted, rather than present and reporting zero', () => {
    const s = new Schedule({});
    s.addBucket({ label: 'Exercise', tags: ['gym'], load: { physical: 2 } });
    s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(14, 9), endTime: at(14, 10) });
    render(<TagManager sched={s} mutate={() => {}} />);
    expect(screen.queryByRole('button', { name: /unsorted tag/i })).toBeNull();
  });
});
