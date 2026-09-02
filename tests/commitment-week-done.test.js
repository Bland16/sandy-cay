// D-13 "this week is done" and D-14 "remove this week's blocks".
//
// The user's shape (2026-08-31), which is what resolved D-16:
//
//   "I wouldn't mark a week done, I would mark a specific task done — for
//    instance ESF 2 Homework. I have that split in two sessions. If I finish in
//    the first session, I can mark my week's commitment as done for that week
//    and the second session disappears."
//
// So it is ONE COMMITMENT'S week, never the week as a whole, and the sittings
// that have not happened yet go while history stays.
//
// ⚠️ THE TWO ARE ONE MECHANISM AND DIFFER IN ONE THING. Both remove only the
// UNRESOLVED sittings — you can never delete work you actually did. D-14 stores
// nothing, so D-11's arithmetic makes the week owe again by itself; D-13 stores
// a mark that overrides that arithmetic. Implementing "done" as *just* deleting
// the remaining sittings looks identical the moment you press it and then comes
// apart: `previewWeek` would see `placedMin < owedMin`, call the week `owes`,
// and a top-up would put the work straight back.
import { describe, it, expect } from 'vitest';
import { Schedule, Commitment, Task, defaultConfig, resetIds, addDays } from '../src/core/index.js';
import { previewWeek, layOutWeek } from '../src/core/commitmentWeek.js';

const MON = new Date(2026, 8, 7); // Mon 7 Sep 2026
const NOW = (() => { const d = new Date(MON); d.setHours(6, 0, 0, 0); return d; })();
const at = (off, h) => { const d = addDays(MON, off); d.setHours(h, 0, 0, 0); return d; };

function scene() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const c = s.addCommitment(new Commitment({
    title: 'ESF 2 Homework', tags: ['study'],
    amountMinPerWeek: 180, from: '2026-09-07', until: '2026-12-11',
    minSitting: 45, maxSitting: 120, maxPerDay: 1,
  }));
  // Two sessions, as in the report: 2h Monday, 1h Wednesday.
  s.tasks.push(new Task({ title: 'ESF 2 Homework', tags: ['study'], type: 'flexible', parentId: c.id, startTime: at(0, 9), endTime: at(0, 11) }));
  s.tasks.push(new Task({ title: 'ESF 2 Homework', tags: ['study'], type: 'flexible', parentId: c.id, startTime: at(2, 9), endTime: at(2, 10) }));
  return { s, c };
}

const row = (s, c) => previewWeek(s, MON, NOW).find((p) => p.commitment.id === c.id);
const titlesOf = (s, c) => s.sittingsFor(c.id, MON).map((t) => `${t.startTime.toDateString().slice(0, 3)} ${t.getDuration()}m`).sort();

describe('D-13 — marking one commitment\'s week done', () => {
  it('removes the session that has not happened and keeps the one that has', () => {
    // The reported case exactly: finish in session one, session two disappears.
    const { s, c } = scene();
    s.sittingsFor(c.id, MON).find((t) => t.startTime.getTime() === at(0, 9).getTime()).completion = 'done';

    const res = s.markCommitmentWeekDone(c.id, MON);
    expect(res.removed).toHaveLength(1);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].completion).toBe('done');
    expect(titlesOf(s, c)).toEqual(['Mon 120m']);
  });

  it('keeps a SKIPPED session too — the app does not rewrite what happened', () => {
    // `skipped` is resolved: you declined it, and that is a record.
    const { s, c } = scene();
    s.sittingsFor(c.id, MON).find((t) => t.startTime.getTime() === at(0, 9).getTime()).completion = 'skipped';
    const res = s.markCommitmentWeekDone(c.id, MON);
    expect(res.kept.map((t) => t.completion)).toEqual(['skipped']);
    expect(res.removed).toHaveLength(1);
  });

  it('settles the week even though the sittings no longer add up', () => {
    // ⚠️ THE POINT OF STORING THE MARK. After the removal only 120m of 180m sits
    // on the grid; without the mark D-11 would call that `owes` and a top-up
    // would put the work straight back.
    const { s, c } = scene();
    s.sittingsFor(c.id, MON)[0].completion = 'done';
    s.markCommitmentWeekDone(c.id, MON);

    const p = row(s, c);
    expect(p.state).toBe('done');
    expect(p.remainingMin).toBe(0);
    expect(p.placedMin).toBeLessThan(180); // still reports honestly what is there
  });

  it('and a top-up puts nothing back', () => {
    const { s, c } = scene();
    s.sittingsFor(c.id, MON)[0].completion = 'done';
    s.markCommitmentWeekDone(c.id, MON);
    const before = s.sittingsFor(c.id, MON).length;

    layOutWeek(s, MON, NOW);
    expect(s.sittingsFor(c.id, MON)).toHaveLength(before);
  });

  it('is per commitment and per week — it says nothing about any other', () => {
    const { s, c } = scene();
    const other = s.addCommitment(new Commitment({
      title: 'Gym', tags: ['gym'], amountMinPerWeek: 120,
      from: '2026-09-07', until: '2026-12-11',
    }));
    s.markCommitmentWeekDone(c.id, MON);

    expect(s.isCommitmentWeekDone(c.id, MON)).toBe(true);
    expect(s.isCommitmentWeekDone(other.id, MON)).toBe(false);
    expect(s.isCommitmentWeekDone(c.id, addDays(MON, 7))).toBe(false);
    expect(row(s, other).state).not.toBe('done');
  });

  it('is reversible, and does not resurrect the plan it removed', () => {
    // Un-marking says "I was wrong, I am not finished" — not "put my old blocks
    // back". You lay it out again, exactly as D-14 leaves you.
    const { s, c } = scene();
    s.sittingsFor(c.id, MON)[0].completion = 'done';
    s.markCommitmentWeekDone(c.id, MON);
    s.unmarkCommitmentWeekDone(c.id, MON);

    const p = row(s, c);
    expect(s.isCommitmentWeekDone(c.id, MON)).toBe(false);
    expect(p.state).toBe('owes');
    expect(p.remainingMin).toBe(60); // 180 owed − 120 still on the grid
    expect(s.sittingsFor(c.id, MON)).toHaveLength(1);
  });

  it('survives a save and reload', () => {
    const { s, c } = scene();
    s.markCommitmentWeekDone(c.id, MON);
    const back = Schedule.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.isCommitmentWeekDone(c.id, MON)).toBe(true);
  });
});

describe('D-14 — removing this week\'s blocks', () => {
  it('clears the placement and the week owes again', () => {
    const { s, c } = scene();
    expect(row(s, c).remainingMin).toBe(0); // 180m laid out of 180m owed

    const res = s.clearCommitmentWeek(c.id, MON);
    expect(res.removed).toHaveLength(2);
    expect(row(s, c).state).toBe('owes');
    expect(row(s, c).remainingMin).toBe(180);
  });

  it('cannot delete work you actually did', () => {
    const { s, c } = scene();
    s.sittingsFor(c.id, MON)[0].completion = 'partial';
    const res = s.clearCommitmentWeek(c.id, MON);

    expect(res.kept).toHaveLength(1);
    expect(res.removed).toHaveLength(1);
    // Those hours were spent, so they still count as placed and the week owes
    // only the difference.
    expect(row(s, c).remainingMin).toBe(60);
  });

  it('does NOT settle the week — that is the whole difference from D-13', () => {
    const { s, c } = scene();
    s.clearCommitmentWeek(c.id, MON);
    expect(s.isCommitmentWeekDone(c.id, MON)).toBe(false);

    // …and laying out again refills it, which is what "remove" means.
    layOutWeek(s, MON, NOW);
    expect(row(s, c).remainingMin).toBe(0);
  });
});
