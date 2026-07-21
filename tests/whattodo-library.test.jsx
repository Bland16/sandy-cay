// @vitest-environment jsdom
// Phase C — the library fallback inside the "what to do" panel: real tasks first,
// library activities surface as you cycle past them, and cycling records nothing.
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import WhatToDoPanel from '../src/ui/components/panels/WhatToDoPanel.jsx';

afterEach(cleanup);

const D = (d, h = 0, m = 0) => new Date(2026, 6, d, h, m, 0, 0);
const NOW = D(15, 14, 0); // Wed 14:00
const wideCfg = () => ({ ...defaultConfig, windows: { ...defaultConfig.windows, monFri: { start: '06:00', end: '23:00' } } });

function Harness({ sched }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return (
    <WhatToDoPanel sched={sched} now={NOW} mutate={mutate} onOpenTask={() => {}} onClose={() => {}} showToast={() => {}} />
  );
}

function libraryOnly() {
  resetIds();
  const s = new Schedule({ config: wideCfg() });
  s.addBucket({ label: 'Rest', role: 'rest', tags: ['rest'] });
  s.addActivity({ bucketId: s.buckets[0].id, label: 'Read', tags: ['rest'], durationMin: 15, durationMax: 90 });
  return s;
}

describe('WhatToDoPanel — library fallback', () => {
  it('with no waiting tasks, a fitting library activity is offered and can be done', () => {
    const s = libraryOnly();
    render(<Harness sched={s} />);
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('from your library')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Do it now/ }));
    expect(s.tasks.some((t) => t.title === 'Read')).toBe(true); // instantiated into the opening
  });

  it('ranks a real waiting task first, and reveals the library on "Another"', () => {
    const s = libraryOnly();
    s.addFlexible({ title: 'Essay', tags: ['work'], startTime: D(15, 15), endTime: D(15, 16) });
    render(<Harness sched={s} />);

    // The real task leads; the library isn't the headline pick.
    expect(screen.getByText('Essay')).toBeTruthy();
    expect(screen.queryByText('from your library')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Another/ }));
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('from your library')).toBeTruthy();
  });

  it('cycling records nothing (P-1: it never watches what you skip)', () => {
    const s = libraryOnly();
    s.addFlexible({ title: 'Essay', tags: ['work'], startTime: D(15, 15), endTime: D(15, 16) });
    const before = s.tasks.length;
    render(<Harness sched={s} />);

    fireEvent.click(screen.getByRole('button', { name: /Another/ }));
    fireEvent.click(screen.getByRole('button', { name: /Another/ }));

    expect(s.tasks.length).toBe(before); // no task added by skipping
    expect(s.learning.sampleCount).toBe(0); // no rating recorded
  });
});
