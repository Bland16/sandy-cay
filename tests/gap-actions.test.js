// 3C / 3D — the freed-gap offer's engine-facing half (SPEC §3.8, §3.9), and
// OD-7's per-row resolutions. Pure: no DOM, no React. The UI half is driven
// through <App/> in ui-bulk.test.jsx.
import { describe, it, expect, beforeEach } from 'vitest';
import { Schedule, Task, resetIds } from '../src/core/index.js';
import { defaultConfig } from '../src/core/config.js';
import {
  backfillCandidates,
  backfillGap,
  protectGap,
  protectSomeRecovery,
  worthOffering,
  gapMinutes,
  needsReviewFor,
  movableFor,
  nextSameWeekday,
  nextFreeSlot,
} from '../src/ui/gapActions.js';

const MON = new Date(2026, 6, 13, 0, 0, 0, 0); // a Monday
const D = (offset, h, mi = 0) => {
  const d = new Date(MON.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(h, mi, 0, 0);
  return d;
};

let s;
beforeEach(() => {
  resetIds();
  s = new Schedule({ config: defaultConfig });
});

describe('§3.8 — when a gap is worth offering at all', () => {
  it('offers at the threshold and stays quiet below it', () => {
    expect(s.config.backfillOfferThreshold).toBe(45);
    expect(worthOffering(s, { start: D(0, 9), end: D(0, 9, 44) })).toBe(false);
    expect(worthOffering(s, { start: D(0, 9), end: D(0, 9, 45) })).toBe(true);
    expect(gapMinutes({ start: D(0, 9), end: D(0, 10) })).toBe(60);
  });
});

describe('§3.8 — backfill candidate order', () => {
  it('takes a schedulingWarning task first (tier 1)', () => {
    // A warned task later in the week, and an ordinary one. Tier 1 wins even
    // though both fit — the flagged task is the one that couldn't be placed.
    const warned = new Task({
      title: 'Parked task',
      type: 'flexible',
      startTime: D(3, 9),
      endTime: D(3, 10),
      schedulingWarning: true,
    });
    s.tasks.push(warned);
    s.addFlexible({ title: 'Ordinary', startTime: D(3, 14), endTime: D(3, 15) });

    const gap = { start: D(1, 10), end: D(1, 11) };
    const cands = backfillCandidates(s, gap);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].task.id).toBe(warned.id);
    expect(cands[0].tier).toBe(1);
  });

  it('takes an urgent-deadline task next (tier 2), using §2.4\'s own slack test', () => {
    // Urgency is about slack, not about having a deadline: 11:00–12:00 is
    // walled off, so the only hour left before this task's noon deadline is
    // the gap itself → slack 0 < duration × urgencyFactor.
    s.addFixed({ title: 'Wall', startTime: D(1, 11), endTime: D(1, 12) });
    const urgent = s.addFlexible({
      title: 'Due at noon',
      startTime: D(1, 14),
      endTime: D(1, 15),
      deadline: D(1, 12),
    });
    const gap = { start: D(1, 10), end: D(1, 11) };
    const pick = backfillCandidates(s, gap).find((c) => c.task.id === urgent.id);
    expect(pick).toBeTruthy();
    expect(pick.tier).toBe(2);
  });

  it('a deadline task with room to spare is NOT urgent — it stays tier 3', () => {
    // The mirror of the above, and the reason the tier exists: having a
    // deadline is not the same as being short of time.
    const roomy = s.addFlexible({
      title: 'Due at six',
      startTime: D(1, 14),
      endTime: D(1, 15),
      deadline: D(1, 18),
    });
    const pick = backfillCandidates(s, { start: D(1, 10), end: D(1, 11) })
      .find((c) => c.task.id === roomy.id);
    expect(pick ? pick.tier : null).not.toBe(2);
  });

  it('NEVER offers a user-placed task, however well it fits (§3.8, explicit)', () => {
    const mine = s.addFlexible({ title: 'Where I put it', startTime: D(1, 14), endTime: D(1, 15) });
    mine.placedBy = 'user';
    mine.schedulingWarning = true; // even flagged — placement is still my call

    const cands = backfillCandidates(s, { start: D(1, 10), end: D(1, 11) });
    expect(cands.map((c) => c.task.id)).not.toContain(mine.id);
  });

  it('never offers a pinned, fixed, protected or already-done task', () => {
    const pinned = s.addFlexible({ title: 'Pinned', startTime: D(1, 14), endTime: D(1, 15) });
    pinned.pinned = true;
    s.addFixed({ title: 'Fixed', startTime: D(1, 15), endTime: D(1, 16) });
    s.addFlexible({ title: 'Rest', tags: ['rest'], startTime: D(1, 16), endTime: D(1, 17) });
    const done = s.addFlexible({ title: 'Done', startTime: D(2, 9), endTime: D(2, 10) });
    done.completion = 'done';

    const titles = backfillCandidates(s, { start: D(1, 10), end: D(1, 11) }).map((c) => c.task.title);
    expect(titles).not.toContain('Pinned');
    expect(titles).not.toContain('Fixed');
    expect(titles).not.toContain('Rest');
    expect(titles).not.toContain('Done');
  });

  it('never offers a task too long for the gap', () => {
    s.addFlexible({ title: 'Two hours', startTime: D(1, 14), endTime: D(1, 16) });
    const cands = backfillCandidates(s, { start: D(1, 10), end: D(1, 11) });
    expect(cands.map((c) => c.task.title)).not.toContain('Two hours');
  });

  it('backfillGap moves the pick into the gap and clears its warning', () => {
    const warned = new Task({
      title: 'Parked task',
      type: 'flexible',
      startTime: D(3, 9),
      endTime: D(3, 10),
      schedulingWarning: true,
    });
    s.tasks.push(warned);

    const gap = { start: D(1, 10), end: D(1, 11) };
    const r = backfillGap(s, gap);

    expect(r).toBeTruthy();
    expect(r.task.id).toBe(warned.id);
    expect(warned.startTime.getTime()).toBe(gap.start.getTime());
    expect(warned.endTime.getTime()).toBe(gap.end.getTime());
    expect(warned.schedulingWarning).toBe(false);
    // Backfill is an automatic placement, and says so — it must not masquerade
    // as a decision the user made.
    expect(warned.placedBy).toBe('auto');
  });

  it('backfillGap reports null rather than forcing something in', () => {
    // Nothing in the schedule at all: no candidates, no placement.
    expect(backfillGap(s, { start: D(1, 10), end: D(1, 11) })).toBeNull();
  });

  it('respects a zone: a gap outside the task\'s zone is not offered to it', () => {
    s.addZone({
      label: 'Study zone',
      matchTags: ['study'],
      windows: [{ day: 'tue', start: '18:00', end: '21:00' }],
      exclusive: true,
    });
    const study = new Task({
      title: 'Study',
      type: 'flexible',
      tags: ['study'],
      startTime: D(1, 18),
      endTime: D(1, 19),
      schedulingWarning: true,
    });
    s.tasks.push(study);

    // A 10:00 Tuesday gap is outside the study zone — the engine's own window
    // rules refuse it, so it never reaches the offer.
    const cands = backfillCandidates(s, { start: D(1, 10), end: D(1, 11) });
    expect(cands.map((c) => c.task.title)).not.toContain('Study');
  });
});

describe('§3.8 — protect', () => {
  it('fills the gap with a rest blocker', () => {
    const gap = { start: D(1, 10), end: D(1, 11) };
    const b = protectGap(s, gap);
    expect(b.tags).toContain('rest');
    expect(b.type).toBe('fixed');
    expect(b.startTime.getTime()).toBe(gap.start.getTime());
    expect(b.endTime.getTime()).toBe(gap.end.getTime());
    // It must survive the engine's own eviction rules, or it isn't protection.
    expect(b.isAnchored(s.config.protectedTags)).toBe(true);
  });
});

describe('§7.3 — the overpack notice\'s one suggestion', () => {
  it('protectSomeRecovery blocks a real opening', () => {
    const b = protectSomeRecovery(s, MON, MON);
    expect(b).toBeTruthy();
    expect(b.tags).toContain('rest');
    expect(b.getDuration()).toBe(s.config.defaultDuration);
  });

  it('reports null rather than inventing time when the week is genuinely full', () => {
    // Wall every day of the week end to end.
    for (let i = 0; i < 7; i += 1) {
      s.addFixed({ title: `Wall ${i}`, startTime: D(i, 0), endTime: D(i, 23, 59) });
    }
    expect(protectSomeRecovery(s, MON, MON)).toBeNull();
  });
});

describe('OD-7 — the Clear Day panel\'s reads and resolutions', () => {
  it('splits the day exactly the way evacuateDay does', () => {
    const flex = s.addFlexible({ title: 'Study', startTime: D(1, 10), endTime: D(1, 11) });
    const pinned = s.addFlexible({ title: 'Gym', startTime: D(1, 12), endTime: D(1, 13) });
    pinned.pinned = true;
    const fixed = s.addFixed({ title: 'Standup', startTime: D(1, 9), endTime: D(1, 9, 30) });
    const rest = s.addFlexible({ title: 'Nap', tags: ['rest'], startTime: D(1, 15), endTime: D(1, 16) });

    const review = needsReviewFor(s, D(1, 0)).map((t) => t.id);
    const movable = movableFor(s, D(1, 0)).map((t) => t.id);

    expect(movable).toEqual([flex.id]);
    expect(review).toContain(pinned.id);
    expect(review).toContain(fixed.id);
    expect(review).toContain(rest.id);
    expect(review).not.toContain(flex.id);

    // The panel's own sets must agree with the engine's, or the panel lies
    // about what the commit is going to do.
    const res = s.evacuateDay(D(1, 0), { blockDay: false });
    expect(res.needsReview.map((t) => t.id).sort()).toEqual(review.sort());
  });

  it('next-same-weekday keeps the time of day, seven days on', () => {
    const t = s.addFixed({ title: 'Standup', startTime: D(1, 9), endTime: D(1, 9, 30) });
    const { start, end } = nextSameWeekday(t);
    expect(start.getTime()).toBe(D(8, 9).getTime());
    expect(end.getTime()).toBe(D(8, 9, 30).getTime());
    expect(start.getDay()).toBe(t.startTime.getDay());
  });

  it('next-free-slot is forward-only — never before the day being cleared', () => {
    const t = s.addFixed({ title: 'Standup', startTime: D(2, 9), endTime: D(2, 10) });
    const slot = nextFreeSlot(s, t, D(2, 0));
    expect(slot).toBeTruthy();
    expect(slot.start.getTime()).toBeGreaterThanOrEqual(D(3, 0).getTime());
  });
});
