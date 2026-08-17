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
  weekStart as weekStartOf, addDays, dateKey, generateSittings,
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

/** The user's own words, and the "done when" of this build. */
const ENGR = {
  title: 'ENGR project',
  tags: ['study'],
  amountMin: 480,
  from: '2026-09-07',
  until: '2026-10-03',
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
};

describe('Commitment — the fields, and what they refuse', () => {
  it('stores hours as minutes and the period as inclusive day keys', () => {
    const c = new Commitment(ENGR);
    expect(c.amountMin).toBe(480);
    expect(c.from).toBe('2026-09-07');
    expect(c.until).toBe('2026-10-03');
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
    expect(c.engineInput().load).toBeUndefined();
  });

  it('has no cadence and no lastFilled — the ritual is not built', () => {
    // A stored field nothing reads drifts out of truth before its first user.
    const c = new Commitment({ ...ENGR, cadence: 'weekly', lastFilled: '2026-09-01' });
    expect(c.toJSON().cadence).toBeUndefined();
    expect(c.toJSON().lastFilled).toBeUndefined();
  });

  it('swaps a backwards period rather than storing one that generates nothing', () => {
    const c = new Commitment({ ...ENGR, from: '2026-10-03', until: '2026-09-07' });
    expect([c.from, c.until]).toEqual(['2026-09-07', '2026-10-03']);
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

describe('engineInput() — the boundary conversion (sharp edge #11)', () => {
  it('turns the INCLUSIVE last day into the half-open bound the placer wants', () => {
    const c = new Commitment(ENGR);
    const e = c.engineInput();
    expect(dateKey(e.from)).toBe('2026-09-07');
    // 4 October, not the 3rd. `placeTask` clips every window to `end ≤ deadline`,
    // so 3 Oct 00:00 would make the 2nd the last usable day — a whole day of
    // runway lost, silently, on every commitment the user ever writes.
    expect(dateKey(e.until)).toBe('2026-10-04');
    expect(e.until.getHours()).toBe(0);
  });

  it('lets work land ON the last day the user typed', () => {
    // Proven by execution, not by reading the bound: a one-day period where the
    // only day available IS the deadline day.
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    const c = new Commitment({
      ...ENGR, amountMin: 60, from: '2026-09-07', until: '2026-09-07', minSitting: 60,
    });
    const r = generateSittings(s, c.engineInput(), { now: new Date(2026, 8, 7, 6, 0) });
    expect(r.sittings.length).toBe(1);
    expect(dateKey(r.sittings[0].startTime)).toBe('2026-09-07');
  });

  it('feeds the real engine and lays out the ENGR project across weeks', () => {
    resetIds();
    const MON = weekStartOf(new Date(2026, 8, 7));
    const at = (o, h, e2) => { const d = addDays(MON, o); d.setHours(h, 0, 0, 0); const x = addDays(MON, o); x.setHours(e2, 0, 0, 0); return [d, x]; };
    const s = new Schedule({ config: defaultConfig });
    [[0, 9, 10], [2, 9, 10], [4, 9, 10], [1, 11, 12], [3, 11, 12]].forEach(([o, h, e2], i) => {
      const [st, en] = at(o, h, e2);
      s.addFixed({ title: `class ${i}`, tags: ['classes'], startTime: st, endTime: en });
    });
    const c = s.addCommitment(ENGR);
    const r = generateSittings(s, c.engineInput(), { now: new Date(2026, 8, 7, 8, 0) });

    expect(r.sittings.reduce((n, t) => n + t.getDuration(), 0) + r.shortfall).toBe(480);
    // §4.3: a shortfall is stated, never crammed — and here there is none.
    expect(r.shortfall).toBe(0);
    for (const t of r.sittings) {
      expect(t.getDuration()).toBeGreaterThanOrEqual(60);
      expect(t.getDuration()).toBeLessThanOrEqual(180);
      expect(t.parentId).toBe(c.id);
    }
    // maxPerDay 1 — one a day, the user's own words.
    const days = r.sittings.map((t) => dateKey(t.startTime));
    expect(new Set(days).size).toBe(days.length);
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
    s.updateCommitment(c.id, { title: 'ENGR pset', amountMin: 300 });
    expect(s.commitments[0].title).toBe('ENGR pset');
    expect(s.commitments[0].amountMin).toBe(300);
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
    generateSittings(s, c.engineInput(), { now: new Date(2026, 8, 7, 8, 0) });
    expect(s.sittingsFor(c.id).length).toBeGreaterThan(0);
    // Delete one by hand and the answer changes with it — a `lastFilled` flag
    // would still be claiming the period was filled.
    const before = s.sittingsFor(c.id).length;
    s.removeTask(s.sittingsFor(c.id)[0].id);
    expect(s.sittingsFor(c.id).length).toBe(before - 1);
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
