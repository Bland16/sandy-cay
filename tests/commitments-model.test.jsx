// @vitest-environment jsdom
// The stored commitment (design/WEEKLY-PLANNING.md §2/§4).
//
// The engine has been built and proven since 2026-08-16 and had no stored home,
// so the user could not create a commitment at all. This locks the model — and
// in particular the FOUR halves that have to move together, because sharp edge
// #15 has been sprung three times by a field that had only three of them:
// the constructor, `toJSON`, `useEngine#replace`, and the import summary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import {
  Schedule, Commitment, defaultConfig, exportState, summarizeImport, resetIds,
  weekStart as weekStartOf, addDays, dateKey, generateSittings, generateAll,
} from '../src/core/index.js';
import { useEngine } from '../src/ui/useEngine.js';
import Cabana from '../src/ui/components/Cabana.jsx';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** A term commitment: 4h a week of ENGR, across four whole weeks. */
const ENGR = {
  title: 'ENGR project',
  tags: ['study'],
  amountMinPerWeek: 240,
  from: '2026-09-07', // Monday
  until: '2026-10-04', // the Sunday four weeks later
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
};

const MON = new Date(2026, 8, 7); // Mon 7 Sep 2026, the term's first week

describe('Commitment — the fields, and what they refuse', () => {
  it('stores the WEEKLY amount as minutes and the term as inclusive day keys', () => {
    const c = new Commitment(ENGR);
    // Per WEEK, not a total across the term. The field is named for it because
    // it was briefly built as a total, and a name that outlives its meaning is
    // how this codebase's bugs live.
    expect(c.amountMinPerWeek).toBe(240);
    expect(c.amountMin).toBeUndefined();
    expect(c.from).toBe('2026-09-07');
    expect(c.until).toBe('2026-10-04');
    expect(c.dueDay).toBe(null); // optional; the week's end by default
    expect(c.minSitting).toBe(60);
    expect(c.maxSitting).toBe(180);
    expect(c.maxPerDay).toBe(1);
    expect(c.priority).toBe(3);
  });

  it('has NO load field — energy derives from tags', () => {
    // The locked decision that cancelled the task-panel dials. A `load` here
    // would be a second, divergent answer to a settled question, and the engine
    // would prefer it over every bucket the tags touch.
    const c = new Commitment({ ...ENGR, load: { mental: 2 } });
    expect(c.load).toBeUndefined();
    expect(c.toJSON().load).toBeUndefined();
    expect(c.engineInputForWeek(MON).load).toBeUndefined();
  });

  it('has no cadence and no lastFilled — weekly only, and laid-out is derived', () => {
    // A stored field nothing reads drifts out of truth before its first user.
    const c = new Commitment({ ...ENGR, cadence: 'weekly', lastFilled: '2026-09-01' });
    expect(c.toJSON().cadence).toBeUndefined();
    expect(c.toJSON().lastFilled).toBeUndefined();
  });

  it('swaps a backwards period rather than storing one that generates nothing', () => {
    const c = new Commitment({ ...ENGR, from: '2026-10-04', until: '2026-09-07' });
    expect([c.from, c.until]).toEqual(['2026-09-07', '2026-10-04']);
  });

  it('never lets the sitting maximum fall below the minimum', () => {
    const c = new Commitment({ ...ENGR, minSitting: 120, maxSitting: 30 });
    expect(c.maxSitting).toBe(120);
  });

  it('round-trips every own property through JSON', () => {
    const c = new Commitment({ ...ENGR, priority: 5 });
    const back = Commitment.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    for (const k of Object.keys(c)) expect(back[k]).toEqual(c[k]);
  });
});

describe('engineInputForWeek() — the per-week period (sharp edge #11)', () => {
  /** A real term week: classes Mon/Wed/Fri 09-10, seminars Tue/Thu 11-12. */
  const termWeek = () => {
    resetIds();
    const ws = weekStartOf(MON);
    const s = new Schedule({ config: defaultConfig });
    [[0, 9, 10], [2, 9, 10], [4, 9, 10], [1, 11, 12], [3, 11, 12]].forEach(([o, h, e2], i) => {
      const st = addDays(ws, o); st.setHours(h, 0, 0, 0);
      const en = addDays(ws, o); en.setHours(e2, 0, 0, 0);
      s.addFixed({ title: `class ${i}`, tags: ['classes'], startTime: st, endTime: en });
    });
    return s;
  };

  it('bounds a week Monday → the Sunday AFTER it, exclusive', () => {
    const e = new Commitment(ENGR).engineInputForWeek(MON);
    expect(dateKey(e.from)).toBe('2026-09-07');
    // 14 Sep, not the 13th. `placeTask` clips every window to `end ≤ deadline`,
    // so a bound of Sunday 00:00 would make Saturday the last usable day — a
    // day of runway lost, silently, EVERY WEEK.
    expect(dateKey(e.until)).toBe('2026-09-14');
    expect(e.until.getHours()).toBe(0);
    // The engine's own field name is unchanged: the week's amount IS its amount.
    expect(e.amountMin).toBe(240);
  });

  it('honours an optional due weekday by shortening the week', () => {
    const e = new Commitment({ ...ENGR, dueDay: 'thu' }).engineInputForWeek(MON);
    // Thursday 10 Sep is the last usable day, so the bound is Friday the 11th.
    expect(dateKey(e.until)).toBe('2026-09-11');
  });

  it('PROVES the due day by placing — nothing lands after Thursday', () => {
    // Reading the bound is not proof. §4.1.1 step 2 only offers days inside R*,
    // so a Thursday deadline must make Fri/Sat/Sun uncandidates outright.
    const s = termWeek();
    const c = new Commitment({ ...ENGR, dueDay: 'thu', amountMinPerWeek: 240 });
    const r = generateSittings(s, c.engineInputForWeek(MON), { now: new Date(2026, 8, 7, 6, 0) });
    expect(r.sittings.length).toBeGreaterThan(0);
    for (const t of r.sittings) {
      expect(dateKey(t.startTime) <= '2026-09-10').toBe(true);
    }
  });

  it('starts mid-week when the TERM starts mid-week, not on the Monday', () => {
    // A commitment beginning on the Wednesday must not place on the Monday.
    const c = new Commitment({ ...ENGR, from: '2026-09-09' });
    const e = c.engineInputForWeek(MON);
    expect(dateKey(e.from)).toBe('2026-09-09');
  });

  it('stops at the TERM end when the term ends mid-week', () => {
    const c = new Commitment({ ...ENGR, until: '2026-09-09' });
    const e = c.engineInputForWeek(MON);
    expect(dateKey(e.until)).toBe('2026-09-10'); // exclusive bound after Wed 9th
  });

  it('returns null for a week outside the term — nothing owed, nothing offered', () => {
    const c = new Commitment(ENGR);
    expect(c.engineInputForWeek(addDays(MON, -7))).toBe(null);
    expect(c.engineInputForWeek(addDays(MON, 35))).toBe(null);
    expect(c.coversWeek(MON)).toBe(true);
  });

  it('owes NOTHING once the due day has passed — no shortfall from time passing', () => {
    // ⚠️ Found by design/probes/probe-mixed-terms.mjs, and it is not cosmetic.
    // A commitment due Thursday, asked on FRIDAY, used to return a Mon→Thu
    // window; `generateSittings` floors its search at `now`, finds no legal day,
    // places nothing and reports the WHOLE amount as a shortfall. So the
    // preview promised "owes 3h" for work that could no longer be done, and the
    // button manufactured a 3h shortfall out of the passage of time — which
    // §4.3 (state it once), D-3 (never grow it) and §5 (no "you missed your
    // target") each forbid on their own.
    const c = new Commitment({ ...ENGR, dueDay: 'thu' });
    const THU = new Date(2026, 8, 10, 12, 0);
    const FRI = new Date(2026, 8, 11, 12, 0);

    // ON the due day there are still hours left, so it is still owed.
    expect(c.engineInputForWeek(MON, THU)).not.toBe(null);
    // The day AFTER, the week is over for this commitment.
    expect(c.engineInputForWeek(MON, FRI)).toBe(null);

    // And prove the consequence rather than the bound: generating on Friday
    // must not produce a 240-minute shortfall out of nowhere.
    const s = termWeek();
    const input = c.engineInputForWeek(MON, FRI);
    const results = generateAll(s, [input].filter(Boolean), { now: FRI });
    expect(results).toEqual([]);
  });

  it('still owes a whole-week commitment on Friday — Sat and Sun remain', () => {
    // The guard must not swallow a commitment that genuinely has days left.
    const c = new Commitment(ENGR); // no dueDay → the week's end
    expect(c.engineInputForWeek(MON, new Date(2026, 8, 11, 12, 0))).not.toBe(null);
  });

  it('lays out the SAME amount in every week of the term', () => {
    // The whole point of a weekly rate: week two owes its own 4h, and the
    // "already laid out" check is per week or week two never generates at all.
    const s = termWeek();
    const c = s.addCommitment(ENGR);
    const w1 = generateSittings(s, c.engineInputForWeek(MON), { now: new Date(2026, 8, 7, 6, 0) });
    const w2 = generateSittings(s, c.engineInputForWeek(addDays(MON, 7)), { now: new Date(2026, 8, 7, 6, 0) });

    for (const r of [w1, w2]) {
      expect(r.sittings.reduce((n, t) => n + t.getDuration(), 0) + r.shortfall).toBe(240);
      expect(r.shortfall).toBe(0); // §4.3: stated when it happens; here it does not
      for (const t of r.sittings) {
        expect(t.getDuration()).toBeGreaterThanOrEqual(60);
        expect(t.getDuration()).toBeLessThanOrEqual(180);
        expect(t.parentId).toBe(c.id);
      }
      const days = r.sittings.map((t) => dateKey(t.startTime));
      expect(new Set(days).size).toBe(days.length); // maxPerDay 1
    }
    // Two distinct weeks, no overlap between them.
    const w1days = w1.sittings.map((t) => dateKey(t.startTime));
    const w2days = w2.sittings.map((t) => dateKey(t.startTime));
    expect(w1days.every((d) => d < '2026-09-14')).toBe(true);
    expect(w2days.every((d) => d >= '2026-09-14')).toBe(true);
  });
});

describe('Schedule — the collection', () => {
  it('adds, updates through the constructor, and removes', () => {
    const s = new Schedule({ config: defaultConfig });
    const c = s.addCommitment(ENGR);
    expect(s.commitments.length).toBe(1);

    // An EDIT re-validates. A partial patch that skipped the clamps is how a
    // maxSitting under its minSitting gets stored and then generates nothing.
    s.updateCommitment(c.id, { maxSitting: 15 });
    expect(s.commitments[0].maxSitting).toBe(60);
    s.updateCommitment(c.id, { title: 'ENGR pset', amountMinPerWeek: 300 });
    expect(s.commitments[0].title).toBe('ENGR pset');
    expect(s.commitments[0].amountMinPerWeek).toBe(300);
    expect(s.commitments[0].id).toBe(c.id); // the id survives a rename

    expect(s.removeCommitment(c.id)).toBeTruthy();
    expect(s.commitments.length).toBe(0);
  });

  it('gives two identically-titled commitments distinct ids', () => {
    // The two-new-buckets bug: slug(title) alone collides, and a shared id makes
    // `find(id === …)` return the wrong one, so editing the second edits the first.
    const s = new Schedule({ config: defaultConfig });
    const a = s.addCommitment({ ...ENGR, title: 'New commitment' });
    const b = s.addCommitment({ ...ENGR, title: 'New commitment' });
    expect(a.id).not.toBe(b.id);
  });

  it('finds a commitment its sittings by looking, not by a stored flag', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const c = s.addCommitment(ENGR);
    expect(s.sittingsFor(c.id)).toEqual([]);
    generateSittings(s, c.engineInputForWeek(MON), { now: new Date(2026, 8, 7, 6, 0) });
    expect(s.sittingsFor(c.id).length).toBeGreaterThan(0);
    // Delete one by hand and the answer changes with it — a `lastFilled` flag
    // would still be claiming the period was filled.
    const before = s.sittingsFor(c.id).length;
    s.removeTask(s.sittingsFor(c.id)[0].id);
    expect(s.sittingsFor(c.id).length).toBe(before - 1);
  });

  it('answers "laid out?" PER WEEK — without that, week two never generates', () => {
    // ⚠️ The un-weeked answer is the trap: a commitment laid out ONCE looks laid
    // out for every week of the term, so nothing after week one would ever be
    // offered — and an automatic trigger reading it would instead re-lay week
    // one on every single app open.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const c = s.addCommitment(ENGR);
    generateSittings(s, c.engineInputForWeek(MON), { now: new Date(2026, 8, 7, 6, 0) });

    expect(s.sittingsFor(c.id, MON).length).toBeGreaterThan(0);
    expect(s.sittingsFor(c.id, addDays(MON, 7))).toEqual([]);
    // And every sitting the week claims really is inside it.
    for (const t of s.sittingsFor(c.id, MON)) {
      expect(dateKey(t.startTime) >= '2026-09-07').toBe(true);
      expect(dateKey(t.startTime) <= '2026-09-13').toBe(true);
    }
  });
});

describe('the four halves that have to move together (sharp edge #15)', () => {
  const authored = () => {
    const s = new Schedule({ config: defaultConfig });
    s.addCommitment(ENGR);
    s.addCommitment({ ...ENGR, title: 'Reading', amountMin: 180, maxSitting: 120 });
    return s;
  };

  it('half 1+2 — toJSON writes them and the constructor reads them back', () => {
    const { data } = exportState(authored());
    expect(data.commitments.map((c) => c.title)).toEqual(['ENGR project', 'Reading']);
    const back = Schedule.fromJSON(data);
    expect(back.commitments.map((c) => c.title)).toEqual(['ENGR project', 'Reading']);
    expect(back.commitments[1].maxSitting).toBe(120);
    expect(back.commitments[0]).toBeInstanceOf(Commitment);
  });

  it('half 3 — the import summary counts them', () => {
    const sum = summarizeImport(exportState(authored()).data);
    expect(sum.valid).toBe(true);
    expect(sum.commitmentCount).toBe(2);
  });

  it('half 3b — the REAL Cabana confirm names them, dumped not transcribed', async () => {
    // Driven through the actual component and the actual file input, because a
    // transcribed string is a copy that agrees with itself while the shipped one
    // says something else. The suite has been unable to see presentation three
    // times; this prints what the user is actually asked.
    const { data } = exportState(authored());
    const asked = [];
    vi.spyOn(window, 'confirm').mockImplementation((msg) => { asked.push(msg); return false; });
    const sched = new Schedule({ config: defaultConfig });
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
    // The footlocker input, NOT the .ics one — the Cabana has both, and the
    // calendar card's comes first in the DOM. (A bare `input[type=file]` picked
    // the wrong one and got "No events found in that file", which is the
    // clearest possible argument for driving the real component.)
    const input = document.querySelector('input[accept="application/json"]');
    expect(input).toBeTruthy();
    const file = new File([JSON.stringify(data)], 'schedule.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      // FileReader is genuinely async; the suite's own footlocker test learned
      // this the hard way with fake timers. Poll rather than guess a duration.
      for (let i = 0; i < 100 && !asked.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 20); });
      }
    });

    expect(asked.length).toBe(1);
    // eslint-disable-next-line no-console
    console.log('CABANA IMPORT CONFIRM:\n  ' + asked[0]);
    expect(asked[0]).toContain('2 standing commitments');
  });

  it('half 4 — useEngine#replace carries them, driven through the REAL hook', () => {
    // Transcribing `replace`'s body would mean the test has to be edited to
    // break, which is exactly what a regression test must not require.
    const { data } = exportState(authored());
    function Harness({ blob }) {
      const { sched, replace, version } = useEngine();
      void version;
      return (
        <div>
          <button type="button" onClick={() => replace(blob)}>go</button>
          <output data-testid="commits">{sched.commitments.map((c) => c.title).join('|')}</output>
        </div>
      );
    }
    render(<Harness blob={data} />);
    expect(screen.getByTestId('commits').textContent).toBe('');
    act(() => { fireEvent.click(screen.getByText('go')); });
    // Dropped here, a restored footlocker would keep the generated sittings on
    // the grid with nothing left that owes them.
    expect(screen.getByTestId('commits').textContent).toBe('ENGR project|Reading');
  });

  it('an old save with no commitments key loads clean — schemaVersion stays 1', () => {
    const { data } = exportState(new Schedule({ config: defaultConfig }));
    delete data.commitments;
    expect(data.schemaVersion).toBe(1);
    expect(Schedule.fromJSON(data).commitments).toEqual([]);
  });
});
