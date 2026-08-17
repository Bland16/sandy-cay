// @vitest-environment jsdom
// "Lay out this week" — D-3's manual path.
//
// The design was proven first, as a probe over 22 lifecycle cases
// (design/probes/probe-commitment-cases.mjs, written up in
// design/COMMITMENT-USE-CASES.md). These lock the parts a UI can break: that
// looking never writes, that the confirm names the real blocks, that pressing
// twice is a no-op, and that the footer never claims a week is done when it
// holds less than it owes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import {
  Schedule, defaultConfig, resetIds, weekStart as weekStartOf, addDays, dateKey,
  previewWeek, planWeek, layOutWeek, owedThisWeek, Task,
} from '../src/core/index.js';
import { recurrenceIntervals } from '../src/core/placement.js';
import CommitmentsEditor from '../src/ui/components/CommitmentsEditor.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MON = weekStartOf(new Date(2026, 8, 7)); // Mon 7 Sep 2026
const MON_6AM = new Date(2026, 8, 7, 6, 0, 0);
const at = (o, h, m = 0) => { const d = addDays(MON, o); d.setHours(h, m, 0, 0); return d; };
const D = (o) => dateKey(addDays(MON, o));

/** The same term week the probes use: classes Mon/Wed/Fri, seminars Tue/Thu. */
function termWeek() {
  resetIds();
  const s = new Schedule({ config: defaultConfig });
  const cls = (o, h, e, t) => s.addFixed({ title: t, tags: ['classes'], startTime: at(o, h), endTime: at(o, e) });
  cls(0, 9, 10, 'CHEM'); cls(2, 9, 10, 'CHEM'); cls(4, 9, 10, 'CHEM');
  cls(1, 11, 12, 'THEO'); cls(3, 11, 12, 'THEO');
  s.addFixed({ title: 'Gym', tags: ['gym'], startTime: at(0, 17), endTime: at(0, 19) });
  return s;
}

const COMMIT = {
  title: 'ENGR project',
  tags: ['study'],
  amountMinPerWeek: 240,
  from: D(0),
  until: D(76),
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
};

describe('previewWeek — looking, which must never write', () => {
  it('states what is owed and creates nothing (D-3)', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    const before = s.tasks.length;

    const p = previewWeek(s, MON, MON_6AM);
    expect(p.length).toBe(1);
    expect(p[0].state).toBe('owes');
    expect(p[0].owedMin).toBe(240);
    expect(owedThisWeek(s, MON, MON_6AM)).toBe(240);
    // "Opening a future week is looking, not asking, and looking must not write
    // tasks into a week." Reading the preview is looking.
    expect(s.tasks.length).toBe(before);
  });

  it('names the other three states rather than lumping them into "nothing"', () => {
    const s = termWeek();
    s.addCommitment({ ...COMMIT, title: 'later', from: D(7) });
    s.addCommitment({ ...COMMIT, title: 'over', from: D(-30), until: D(-1) });
    s.addCommitment({ ...COMMIT, title: 'missed', dueDay: 'thu' });
    const p = previewWeek(s, MON, new Date(2026, 8, 11, 12, 0)); // Friday
    const byTitle = Object.fromEntries(p.map((x) => [x.commitment.title, x.state]));
    expect(byTitle).toEqual({ later: 'outside', over: 'outside', missed: 'passed' });
  });

  it('reports a partly-laid-out week as PLACED vs OWED, never a bare "done"', () => {
    // Case E3. Delete a sitting by hand and the week holds less than it owes;
    // "done" would be the app stating something untrue.
    const s = termWeek();
    const c = s.addCommitment(COMMIT);
    layOutWeek(s, MON, MON_6AM);
    const mine = s.sittingsFor(c.id, MON);
    expect(mine.length).toBeGreaterThan(1);
    s.removeTask(mine[0].id);

    const p = previewWeek(s, MON, MON_6AM)[0];
    expect(p.state).toBe('done');
    expect(p.owedMin).toBe(240);
    expect(p.placedMin).toBeLessThan(240);
    expect(p.placedMin).toBeGreaterThan(0);
  });
});

describe('planWeek — the preview §3 requires, which must also not write', () => {
  it('returns the real blocks without touching the schedule', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    const before = s.tasks.length;
    const plan = planWeek(s, MON, MON_6AM);

    expect(plan.length).toBe(1);
    expect(plan[0].sittings.length).toBeGreaterThan(0);
    expect(s.tasks.length).toBe(before); // ⚠️ the whole point
  });

  it('predicts exactly what applying then does', () => {
    // A preview that disagrees with the result is worse than no preview. The
    // plan runs the REAL generator on a copy, so this holds by construction —
    // and the test exists because "by construction" has been wrong before.
    const s = termWeek();
    s.addCommitment(COMMIT);
    const plan = planWeek(s, MON, MON_6AM);
    const done = layOutWeek(s, MON, MON_6AM);

    const shape = (rs) => rs.map((r) => [
      r.commitment.title, r.shortfall,
      r.sittings.map((t) => `${dateKey(t.startTime)}@${t.startTime.getHours()}:${t.startTime.getMinutes()}/${t.getDuration()}`),
    ]);
    expect(shape(done)).toEqual(shape(plan));
  });
});

describe('layOutWeek — the writing half', () => {
  it('places the week and conserves the amount (§4.3)', () => {
    const s = termWeek();
    const c = s.addCommitment(COMMIT);
    const r = layOutWeek(s, MON, MON_6AM)[0];
    const placed = r.sittings.reduce((n, t) => n + t.getDuration(), 0);
    expect(placed + r.shortfall).toBe(240);
    expect(s.sittingsFor(c.id, MON).length).toBe(r.sittings.length);
  });

  it('is a NO-OP the second time (case E2)', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    layOutWeek(s, MON, MON_6AM);
    const after = s.tasks.length;
    expect(layOutWeek(s, MON, MON_6AM)).toEqual([]);
    expect(s.tasks.length).toBe(after);
  });

  it('lays out week TWO independently of week one', () => {
    // The per-week guard is what makes this work; a commitment laid out once
    // must not look laid out for the whole term.
    const s = termWeek();
    const c = s.addCommitment(COMMIT);
    layOutWeek(s, MON, MON_6AM);
    const w2 = layOutWeek(s, addDays(MON, 7), MON_6AM);
    expect(w2.length).toBe(1);
    expect(s.sittingsFor(c.id, addDays(MON, 7)).length).toBeGreaterThan(0);
  });

  it('routes around RECURRING anchors — sharp edge #3, reintroduced', () => {
    // ⚠️ Found by a probe agent, verified independently, and severe: the button
    // scheduled straight through a pinned recurring gym.
    //
    // `generateAll` built its shared occupied set with `baseOccupied(schedule,
    // null)`, whose fallback was `from = new Date(0)`. `recurrenceIntervals`
    // walks weeks forward from `weekStart(from)` under a 60-week guard, so from
    // the UNIX EPOCH it expanded 1970 and returned NOTHING for the week being
    // planned. Measured before the fix: 3 of 4 sittings on top of the block.
    //
    // ⚠️ `generateSittings` called DIRECTLY was always fine — it passes a real
    // commitment — so every existing test passed. The only broken path was the
    // one the UI uses. That is why this test goes through `layOutWeek`.
    const s = termWeek();
    s.tasks.push(new Task({
      title: 'Lab', tags: ['classes'], type: 'fixed', pinned: true,
      startTime: at(0, 8), endTime: at(0, 17),
      recurrence: {
        periods: [{
          windows: [
            { day: 'mon', start: '08:00', end: '17:00' },
            { day: 'wed', start: '08:00', end: '17:00' },
            { day: 'sat', start: '08:00', end: '17:00' },
          ],
          interval: 1,
          effectiveFrom: null,
          effectiveUntil: null,
        }],
        anchorDate: MON,
        exceptions: [],
      },
    }));
    s.addCommitment({ ...COMMIT, amountMinPerWeek: 600 });

    const occ = recurrenceIntervals(s, MON, addDays(MON, 7));
    expect(occ.length).toBeGreaterThan(0); // the fixture really does recur

    const rs = layOutWeek(s, MON, MON_6AM);
    const sittings = rs.flatMap((r) => r.sittings);
    expect(sittings.length).toBeGreaterThan(0);
    for (const t of sittings) {
      for (const o of occ) {
        expect(t.startTime < o.end && o.start < t.endTime).toBe(false);
      }
    }
  });

  it('generates ONE call for the whole week, so no two claim a day (§4.1.2)', () => {
    const s = termWeek();
    s.addCommitment({ ...COMMIT, title: 'ENGR', amountMinPerWeek: 180 });
    s.addCommitment({ ...COMMIT, title: 'CHEM', amountMinPerWeek: 120 });
    s.addCommitment({ ...COMMIT, title: 'Reading', amountMinPerWeek: 120, minSitting: 45, maxSitting: 90 });
    const rs = layOutWeek(s, MON, MON_6AM);
    const days = rs.flatMap((r) => r.sittings.map((t) => dateKey(t.startTime)));
    expect(new Set(days).size).toBe(days.length);
  });
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

function Harness({ sched, toasts }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return (
    <CommitmentsEditor
      sched={sched}
      mutate={mutate}
      weekStart={MON}
      now={MON_6AM}
      showToast={(m) => toasts.push(m)}
    />
  );
}

describe('the Cabana button', () => {
  it('states what the week owes, and writes nothing to render it', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    const before = s.tasks.length;
    render(<Harness sched={s} toasts={[]} />);
    const card = document.querySelector('.cabcard');
    // eslint-disable-next-line no-console
    console.log(`\nFOOTER: ${card.querySelector('.insight').textContent}\n`);
    expect(card.textContent).toContain('4h');
    expect(card.textContent).toContain('owed across 1 commitment');
    expect(s.tasks.length).toBe(before);
  });

  it('PREVIEWS before writing, and declining writes nothing (§3)', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    const before = s.tasks.length;
    const asked = [];
    vi.spyOn(window, 'confirm').mockImplementation((m) => { asked.push(m); return false; });

    render(<Harness sched={s} toasts={[]} />);
    fireEvent.click(screen.getByLabelText('Lay out this week'));

    expect(asked.length).toBe(1);
    // eslint-disable-next-line no-console
    console.log(`\nCONFIRM:\n${asked[0]}\n`);
    // It must name the BLOCKS, not merely the total — that is what makes it
    // an action you can agree to.
    expect(asked[0]).toMatch(/ENGR project/);
    expect(asked[0]).toMatch(/\d{2}:\d{2}/);
    expect(s.tasks.length).toBe(before); // declined → nothing written
  });

  it('accepting writes the week and reports it', () => {
    const s = termWeek();
    const c = s.addCommitment(COMMIT);
    const toasts = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Harness sched={s} toasts={toasts} />);
    fireEvent.click(screen.getByLabelText('Lay out this week'));

    expect(s.sittingsFor(c.id, MON).length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\nTOAST: ${toasts[0]}\n`);
    expect(toasts[0]).toMatch(/Laid out \d+ sitting/);
  });

  it('says why when NOTHING can be placed, instead of an empty confirm', () => {
    // ⚠️ Reported as "nothing generated, and no label or notification. Just
    // nothing." Reproduced by probe-nothing-happened.mjs: pressed at 22:40 on
    // the Sunday, the week had 20 minutes left against a 30-minute minimum
    // sitting. The plan was empty, so the confirm asked you to agree to doing
    // nothing and then reported "Laid out 0 sittings" — which reads exactly
    // like a broken button.
    const s = termWeek();
    s.addCommitment({ ...COMMIT, from: '2026-07-01', until: '2026-09-30', minSitting: 30 });
    const toasts = [];
    const asked = [];
    vi.spyOn(window, 'confirm').mockImplementation((m) => { asked.push(m); return true; });

    const LATE = new Date(2026, 8, 13, 22, 40); // Sunday of the test week, 22:40
    function Late() {
      const [, setV] = useState(0);
      const mutate = (fn) => { const r = fn(s); setV((v) => v + 1); return r; };
      return (
        <CommitmentsEditor
          sched={s} mutate={mutate} weekStart={MON} now={LATE}
          showToast={(m) => toasts.push(m)}
        />
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByLabelText('Lay out this week'));

    // eslint-disable-next-line no-console
    console.log(`
EMPTY-PLAN TOAST: ${toasts[0]}
`);
    expect(asked.length).toBe(0); // nothing to consent to, so nothing is asked
    expect(toasts[0]).toMatch(/No room left/);
    expect(toasts[0]).toMatch(/could not be placed/);
    expect(s.tasks.filter((t) => t.parentId).length).toBe(0);
  });

  it('is NEVER disabled — it answers instead (the "nothing appears" report)', () => {
    // ⚠️ Reported: "Nothing appears. No dialog, no toast, nothing." The button
    // was disabled whenever the week owed nothing, and `.btn2` has NO
    // `:disabled` styling anywhere in the stylesheet — so it looked exactly
    // like a working button and swallowed every click in silence. A disabled
    // control that cannot say why it is disabled is worse than no control.
    const s = termWeek();
    s.addCommitment({ ...COMMIT, from: D(7) }); // term starts next week
    const toasts = [];
    render(<Harness sched={s} toasts={toasts} />);

    const btn = screen.getByLabelText('Lay out this week');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    // eslint-disable-next-line no-console
    console.log(`
WHY-TOAST: ${toasts[0]}
`);
    expect(toasts[0]).toMatch(/Nothing owed/);
    expect(toasts[0]).toMatch(/no commitment runs this week/);
    expect(document.querySelector('.cabcard').textContent).toContain('nothing owed');
  });

  it('says WHICH reason — already laid out, rather than a generic nothing', () => {
    const s = termWeek();
    s.addCommitment(COMMIT);
    layOutWeek(s, MON, MON_6AM);
    const toasts = [];
    render(<Harness sched={s} toasts={toasts} />);
    fireEvent.click(screen.getByLabelText('Lay out this week'));
    // eslint-disable-next-line no-console
    console.log(`
ALREADY-TOAST: ${toasts[0]}
`);
    expect(toasts[0]).toMatch(/already laid out/);
  });

  it('says WHICH reason — the due day has passed', () => {
    const s = termWeek();
    s.addCommitment({ ...COMMIT, dueDay: 'thu' });
    const toasts = [];
    function Fri() {
      const [, setV] = useState(0);
      const mutate = (fn) => { const r = fn(s); setV((v) => v + 1); return r; };
      return (
        <CommitmentsEditor
          sched={s} mutate={mutate} weekStart={MON}
          now={new Date(2026, 8, 11, 12, 0)}
          showToast={(m) => toasts.push(m)}
        />
      );
    }
    render(<Fri />);
    fireEvent.click(screen.getByLabelText('Lay out this week'));
    // eslint-disable-next-line no-console
    console.log(`
PASSED-TOAST: ${toasts[0]}
`);
    expect(toasts[0]).toMatch(/due day has passed/);
  });

  it('says "2h of 4h laid out" rather than "done" after a hand deletion (E3)', () => {
    const s = termWeek();
    const c = s.addCommitment(COMMIT);
    layOutWeek(s, MON, MON_6AM);
    s.removeTask(s.sittingsFor(c.id, MON)[0].id);

    render(<Harness sched={s} toasts={[]} />);
    const line = document.querySelector('.cwdone');
    // eslint-disable-next-line no-console
    console.log(`\nPARTIAL: ${line.textContent}\n`);
    expect(line.textContent).toMatch(/ENGR project: .* of 4h laid out/);
    expect(line.textContent).not.toMatch(/^ENGR project: 4h of 4h/);
  });
});
