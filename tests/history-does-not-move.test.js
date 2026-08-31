// Work that has already happened is never re-placed.
//
// Reported 2026-08-31: "Do it now still has some serious bugs with moving
// past/completed assignments."
//
// §2.4 settled this rule and only `autoSchedule` implemented it — its comment
// states it outright ("a resolved task is history, never a re-placement
// candidate; moving finished work into the present/future is the bug this
// guards"). `carryOver`, `projects` and `backfillCandidates` each re-derived it
// by hand. THREE MOVERS NEVER GOT IT: `resolveDropConflicts`, `rippleShift` and
// `evacuateDay` all moved finished work, measured.
//
// And "Do it now" is where a user meets it, because `currentOpening` was the
// CAUSE: it filtered on `completion === null`, so an assignment finished
// 09:00–11:00 left its hours looking free, the panel offered them, and the drop
// then evicted the finished task into the future.
//
// ⚠️ THE RULE HAS TWO HALVES AND THEY ARE NOT SYMMETRIC:
//   done / partial — you were there. Never moves, and STILL HOLDS its slot.
//   skipped        — you weren't. Never moves, and does NOT hold its slot.
// Collapsing them into one `completion != null` check gets `skipped` wrong in
// the opposite direction, which is why `Task` grew two predicates and not one.
import { describe, it, expect } from 'vitest';
import {
  Schedule, Task, defaultConfig, resetIds,
  resolveDropConflicts, rippleShift, evacuateDay, currentOpening,
} from '../src/core/index.js';

const DAY = new Date(2026, 7, 31); // Mon 31 Aug 2026
const at = (h, m = 0) => { const d = new Date(DAY); d.setHours(h, m, 0, 0); return d; };
const slotOf = (t) => `${t.startTime.toDateString()} ${t.startTime.toTimeString().slice(0, 5)}`;

function withTask(props) {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const t = new Task({ type: 'flexible', ...props });
  s.tasks.push(t);
  return { s, t };
}

/** An assignment finished this morning, 09:00–11:00. */
const finished = () => withTask({
  title: 'Stats problem set', startTime: at(9), endTime: at(11), completion: 'done',
});

describe('the opening does not offer hours that are already spent', () => {
  it('steps past finished work', () => {
    const { s } = finished();
    const op = currentOpening(s, at(9, 30));
    expect(op.start.getTime()).toBe(at(11).getTime());
  });

  it('but a SKIPPED session really does free its hour', () => {
    // The half the old filter got right, and the reason it looked correct.
    const { s } = withTask({ title: 'Gym', startTime: at(9), endTime: at(10), completion: 'skipped' });
    const op = currentOpening(s, at(9, 30));
    expect(op.start.getTime()).toBe(at(9, 30).getTime());
  });
});

describe('a drop never shoves history aside', () => {
  it('snaps back off finished work instead of evicting it', () => {
    const { s, t } = finished();
    const before = slotOf(t);
    const dropped = new Task({ title: 'Reading', type: 'flexible', startTime: at(9, 30), endTime: at(10, 30) });
    s.tasks.push(dropped);

    const res = resolveDropConflicts(s, dropped, { now: at(9, 30) });
    expect(res.rejected).toBe(true);
    expect(res.snapBack).toBe(true);
    expect(res.reason).toMatch(/finished work/i);
    expect(res.displaced).toHaveLength(0);
    expect(slotOf(t)).toBe(before); // the whole complaint
  });

  it('treats a skipped session as not there at all', () => {
    // It does not move — but it does not block either, so the drop simply lands.
    const { s, t } = withTask({ title: 'Gym', startTime: at(9), endTime: at(10), completion: 'skipped' });
    const before = slotOf(t);
    const dropped = new Task({ title: 'Reading', type: 'flexible', startTime: at(9), endTime: at(10) });
    s.tasks.push(dropped);

    const res = resolveDropConflicts(s, dropped, { now: at(9) });
    expect(res.rejected).toBeFalsy();
    expect(res.displaced).toHaveLength(0);
    expect(slotOf(t)).toBe(before);
  });

  it('still displaces LIVE work — the guard must not freeze the engine', () => {
    // ⚠️ The obvious wrong fix is one that stops every displacement. This is the
    // case that has to keep working, and it is why the predicate is `completion`
    // and not "is in the past".
    const { s, t } = withTask({ title: 'Reading', startTime: at(14), endTime: at(15) });
    const before = slotOf(t);
    const dropped = new Task({ title: 'Call', type: 'flexible', startTime: at(14), endTime: at(15) });
    s.tasks.push(dropped);

    const res = resolveDropConflicts(s, dropped, { now: at(13) });
    expect(res.rejected).toBeFalsy();
    expect(res.displaced).toHaveLength(1);
    expect(slotOf(t)).not.toBe(before);
  });
});

describe('a ripple stops at history rather than dragging it along', () => {
  it('does not shift finished work when an earlier task overruns', () => {
    const { s, t } = finished();
    const before = slotOf(t);
    const pivot = new Task({ title: 'Standup', type: 'fixed', startTime: at(8), endTime: at(9) });
    s.tasks.push(pivot);

    rippleShift(s, pivot, 60);
    expect(slotOf(t)).toBe(before);
  });

  it('is a WALL, so nothing downstream of it is dragged through either', () => {
    const { s, t } = finished();
    const before = slotOf(t);
    const pivot = new Task({ title: 'Standup', type: 'fixed', startTime: at(8), endTime: at(9) });
    s.tasks.push(pivot);
    const later = new Task({ title: 'Reading', type: 'flexible', startTime: at(12), endTime: at(13) });
    s.tasks.push(later);
    const laterBefore = slotOf(later);

    const res = rippleShift(s, pivot, 60);
    expect(slotOf(t)).toBe(before);
    expect(slotOf(later)).toBe(laterBefore);
    expect(res.shifted.map((x) => x.title)).not.toContain('Stats problem set');
  });

  it('still ripples LIVE work downstream', () => {
    const { s, t } = withTask({ title: 'Reading', startTime: at(10), endTime: at(11) });
    const before = slotOf(t);
    const pivot = new Task({ title: 'Standup', type: 'fixed', startTime: at(9), endTime: at(10) });
    s.tasks.push(pivot);

    rippleShift(s, pivot, 60);
    expect(slotOf(t)).not.toBe(before);
  });
});

describe('clearing a day clears what is left of it', () => {
  it('leaves finished work where it happened', () => {
    const { s, t } = finished();
    const before = slotOf(t);
    const res = evacuateDay(s, at(12));
    expect(res.relocated).toHaveLength(0);
    expect(slotOf(t)).toBe(before);
  });

  it('does not ask a human about it either — it needs no decision', () => {
    // It is not `needsReview`: that list is for anchors somebody must choose
    // about. Work that already happened has nothing left to decide.
    const { s } = finished();
    const res = evacuateDay(s, at(12));
    expect(res.needsReview.map((x) => x.title)).not.toContain('Stats problem set');
  });

  it('still relocates the live work on that day', () => {
    const { s, t } = withTask({ title: 'Reading', startTime: at(14), endTime: at(15) });
    const before = slotOf(t);
    const res = evacuateDay(s, at(12));
    expect(res.relocated).toHaveLength(1);
    expect(slotOf(t)).not.toBe(before);
  });
});
