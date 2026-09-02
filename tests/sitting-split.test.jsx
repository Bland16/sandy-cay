// @vitest-environment jsdom
// D-15 — "Do it now" does the part that fits and keeps the rest.
//
// The user's shape: *"if the minimum time of a session is included in the block
// even if the actual next task block is longer it should cut up the task into
// two."*
//
// ⚠️ THE SPEC'S OWN PREMISE WAS WRONG, and the probe caught it before any code
// was written. WEEKLY-PLANNING D-15 said "Do it now" CLAMPS to the opening and
// the remainder ceases to exist. That is `placeActivity` (library activities),
// which is NOT this path. An existing sitting goes through `doItNow`, which
// clamped nothing — it moved the FULL duration in, overflowed whatever bounded
// the opening, and then IGNORED `resolveDropConflicts`' rejection. Measured:
//
//     opening 11:15–12:00 (45m) · sitting 120m · Advisor PINNED at 12:00
//     placed  11:15–13:15  → overlapping Advisor, rejected:true,
//                            nothing snapped back, toast said it worked
//
// So this is a silent double-booking fix as much as a feature, and the two are
// the same fix: a piece that fits cannot overflow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import {
  Schedule, Commitment, Task, defaultConfig, resetIds,
} from '../src/core/index.js';
import WhatToDoPanel from '../src/ui/components/panels/WhatToDoPanel.jsx';

const MON = new Date(2026, 8, 7); // Mon 7 Sep 2026
const at = (h, m = 0) => { const d = new Date(MON); d.setHours(h, m, 0, 0); return d; };
const NOW = at(11, 15); // 45 minutes before a pinned noon meeting
const dur = (t) => t.getDuration();
const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/**
 * A 2-hour ESF sitting this afternoon, and a pinned Advisor meeting at noon
 * that makes the current opening exactly 45 minutes.
 */
function scene({ sittingMin = 120, minSitting = 30 } = {}) {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const c = s.addCommitment(new Commitment({
    title: 'ESF 2 Homework',
    tags: ['study'],
    amountMinPerWeek: 240,
    from: '2026-09-07',
    until: '2026-12-11',
    minSitting,
    maxSitting: 150,
    maxPerDay: 2,
  }));
  const sitting = new Task({
    title: 'ESF 2 Homework', tags: ['study'], type: 'flexible', parentId: c.id,
    startTime: at(14), endTime: new Date(at(14).getTime() + sittingMin * 60000),
  });
  s.tasks.push(sitting);
  const meeting = new Task({
    title: 'Advisor', type: 'fixed', pinned: true, startTime: at(12), endTime: at(13),
  });
  s.tasks.push(meeting);
  return { s, c, sitting, meeting };
}

const openingOf = (s) => s.tasks && { start: at(11, 15), end: at(12), minutes: 45 };

describe('the engine: when a sitting may be cut in two', () => {
  it('splits when both halves clear minSitting', () => {
    const { s, sitting } = scene();
    const res = s.splitSitting(sitting, openingOf(s));
    expect(res).toBeTruthy();
    expect(dur(res.started)).toBe(45);
    expect(dur(res.rest)).toBe(75);
    // The piece you are about to do sits INSIDE the opening — which is what
    // makes the overflow impossible rather than merely unlikely.
    expect(res.started.startTime.getTime()).toBe(at(11, 15).getTime());
    expect(res.started.endTime.getTime()).toBe(at(12).getTime());
    // The remainder stays in the slot the schedule had already found for it.
    expect(res.rest.startTime.getTime()).toBe(at(14).getTime());
  });

  it('keeps the commitment owing exactly what it owed — nothing vanishes', () => {
    // The governing constraint of WEEKLY-PLANNING §8: the debt must survive the
    // convenience. A split moves work; it never destroys any.
    const { s, c, sitting } = scene();
    const before = s.tasks.filter((t) => t.parentId === c.id).reduce((n, t) => n + dur(t), 0);
    s.splitSitting(sitting, openingOf(s));
    const after = s.tasks.filter((t) => t.parentId === c.id).reduce((n, t) => n + dur(t), 0);
    expect(after).toBe(before);
    expect(s.tasks.filter((t) => t.parentId === c.id)).toHaveLength(2);
  });

  it('the remainder is a real sitting of the same commitment', () => {
    // Or D-11's arithmetic would stop counting it and the week would think it
    // owed more than it does.
    const { s, c, sitting } = scene();
    const { rest } = s.splitSitting(sitting, openingOf(s));
    expect(rest.parentId).toBe(c.id);
    expect(rest.title).toBe('ESF 2 Homework');
    expect(rest.tags).toEqual(['study']);
    expect(s.sittingsFor(c.id, MON).map((t) => t.id)).toContain(rest.id);
  });

  it('refuses to split when the tail would be a fragment', () => {
    // 60m against a 45m opening leaves 15m, under the 30m floor. minSitting is
    // the anti-fragmentation guard and nothing may bypass it.
    const { s, sitting } = scene({ sittingMin: 60 });
    expect(s.planSittingSplit(sitting, openingOf(s))).toBeNull();
  });

  it('refuses to split when the head would be a fragment', () => {
    // The other end of the same rule: a 20-minute opening cannot start a
    // sitting whose minimum is 30.
    const { s, sitting } = scene();
    expect(s.planSittingSplit(sitting, { start: at(11, 40), end: at(12), minutes: 20 })).toBeNull();
  });

  it('leaves a sitting that already fits alone', () => {
    const { s, sitting } = scene({ sittingMin: 45 });
    expect(s.planSittingSplit(sitting, openingOf(s))).toBeNull();
  });

  it('never splits a plain task — D-15 is commitment sittings only', () => {
    // Activities are elastic between durationMin and durationMax, so filling 45
    // of a possible 120 is a complete answer, not a partial one. Deliberate.
    const { s } = scene();
    const plain = new Task({ title: 'Reading', type: 'flexible', startTime: at(14), endTime: at(16) });
    s.tasks.push(plain);
    expect(s.planSittingSplit(plain, openingOf(s))).toBeNull();
  });

  it('plans without writing', () => {
    const { s, sitting } = scene();
    const before = s.tasks.length;
    const was = `${sitting.startTime.toISOString()}/${sitting.endTime.toISOString()}`;
    s.planSittingSplit(sitting, openingOf(s));
    expect(s.tasks).toHaveLength(before);
    expect(`${sitting.startTime.toISOString()}/${sitting.endTime.toISOString()}`).toBe(was);
  });
});

function Harness({ sched, toasts }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return (
    <WhatToDoPanel
      sched={sched}
      now={NOW}
      mutate={mutate}
      onOpenTask={() => {}}
      onClose={() => {}}
      showToast={(m) => toasts.push(m)}
    />
  );
}

/** Press "Do it now" on whatever the panel is currently offering. */
const doItNow = () => fireEvent.click(screen.getByText(/Do it now/));

describe('the panel: Do it now', () => {
  it('does the part that fits and keeps the rest', () => {
    const { s, c, sitting, meeting } = scene();
    const toasts = [];
    render(<Harness sched={s} toasts={toasts} />);
    doItNow();

    expect(sitting.startTime.getTime()).toBe(at(11, 15).getTime());
    expect(dur(sitting)).toBe(45);
    expect(overlaps(sitting, meeting)).toBe(false);

    const sittings = s.tasks.filter((t) => t.parentId === c.id);
    expect(sittings).toHaveLength(2);
    expect(sittings.reduce((n, t) => n + dur(t), 0)).toBe(120);
    expect(toasts[0]).toMatch(/left for later/);
  });

  it('does not leave work sitting on top of a pinned meeting', () => {
    // ⚠️ THE BUG. Before the fix this placed 11:15–13:15 across the noon
    // Advisor meeting, because `doItNow` read only `outcome.displaced` and never
    // `outcome.rejected` — so the snap-back the engine asked for never happened
    // and the toast reported success over a silent double-book.
    //
    // Here the sitting CANNOT be split (its minimum is the whole thing), so the
    // fallback path is what runs — which is exactly the path that was broken.
    const { s, sitting, meeting } = scene({ sittingMin: 120, minSitting: 120 });
    const wasStart = sitting.startTime.getTime();
    const toasts = [];
    render(<Harness sched={s} toasts={toasts} />);
    doItNow();

    expect(overlaps(sitting, meeting)).toBe(false);
    expect(sitting.startTime.getTime()).toBe(wasStart); // snapped back
    expect(toasts[0]).toMatch(/Advisor|would not fit/i);
  });

  it('never changes what the commitment owes, whichever branch runs', () => {
    // The governing rule of WEEKLY-PLANNING §8 — the debt must survive the
    // convenience — asserted across BOTH outcomes, because they write
    // differently: one splits and moves, the other refuses and restores.
    //
    // ⚠️ This replaces a test that claimed to prove the split's rollback and
    // did not. It set up a blocker inside the opening, but `currentOpening`
    // simply walked PAST it and handed back a later opening, so no conflict
    // ever arose and the assertion held with the rollback deleted. That branch
    // is in fact unreachable today (a split piece fits inside an opening that
    // is free by construction); pretending otherwise with a green test is worse
    // than saying so.
    for (const minSitting of [30, 120]) { // 30 → splits · 120 → cannot split
      const { s, c } = scene({ minSitting });
      const owed = s.tasks.filter((t) => t.parentId === c.id).reduce((n, t) => n + dur(t), 0);
      const toasts = [];
      render(<Harness sched={s} toasts={toasts} />);
      doItNow();
      const after = s.tasks.filter((t) => t.parentId === c.id).reduce((n, t) => n + dur(t), 0);
      expect(after).toBe(owed);
      cleanup();
    }
  });
});
