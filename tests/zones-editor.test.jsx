// @vitest-environment jsdom
// ZonesEditor — the Zones card unified onto the shared drill-in idiom
// (design/EDITOR-REDESIGN.md): shared TagEditor for match tags, weekday preset,
// and the inclusive end-date edge (sharp edge #11) preserved through extraction.
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, resetIds, dateKey, lastRunDay } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import ZonesEditor from '../src/ui/components/ZonesEditor.jsx';

afterEach(cleanup);

function Harness({ sched }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <ZonesEditor sched={sched} mutate={mutate} />;
}

describe('ZonesEditor (shared drill-in idiom)', () => {
  it('adds a zone, routes it via the shared TagEditor, and the weekday preset fills Mon–Fri', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' })); // drills into the editor
    expect(s.zones).toHaveLength(1);

    // match tag via the shared TagEditor (replaces the bespoke ZoneTags)
    fireEvent.click(screen.getByRole('button', { name: '＋ tag' }));
    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'work' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(s.zones[0].matchTags).toContain('work');

    // weekday preset uses the first window's hours for Mon–Fri
    fireEvent.click(screen.getByRole('button', { name: '＋ every weekday' }));
    const days = new Set(s.zones[0].windows.map((w) => w.day));
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) expect(days.has(d)).toBe(true);
  });

  it('stores the end date as the inclusive last-run day (sharp edge #11)', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.change(screen.getByLabelText('Zone end date'), { target: { value: '2026-07-24' } });
    // stored half-open, but reads back as the 24th (the last day it runs)
    expect(dateKey(lastRunDay(s.zones[0].effectiveUntil))).toBe('2026-07-24');
  });

  it('removes a zone from its editor', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    s.addZone({ label: 'Work', matchTags: [], windows: [] });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit zone Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove zone Work' }));
    expect(s.zones).toHaveLength(0);
  });
});
