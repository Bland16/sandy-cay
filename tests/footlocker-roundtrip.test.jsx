// @vitest-environment jsdom
// The footlocker must not drop collections on the way back IN.
//
// This trap has now been sprung three times — `snapshots`/`lastSeenWeek`, then
// `_dismissed`, then `dayNotes`/`blockedDays`. Every one of them serializes
// perfectly (toJSON writes it, the constructor reads it), so a SAVE round trip
// looks flawless and every storage test passes. `useEngine#replace` copies field
// by field, and the field it forgets is erased in silence: no error, no empty
// state, just a holiday calendar that quietly isn't there any more.
//
// So this drives the REAL `replace` through the real hook rather than
// transcribing its body — a transcription would have to be edited to break,
// which is exactly what a regression test must not require.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App.jsx';
import {
  Schedule, Task, Zone, Bucket, Activity, Commitment, RoutineInstance,
  defaultConfig, exportState, summarizeImport,
} from '../src/core/index.js';
import { useEngine } from '../src/ui/useEngine.js';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
  // REAL timers: FileReader is genuinely async and the save is debounced 1.5s,
  // and faking the clock here made the import silently never complete.
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** A schedule shaped like the real file: holidays, and days actually taken off. */
const authored = () => {
  const s = new Schedule({ config: defaultConfig });
  s.addDayNote({ label: 'Thanksgiving', kind: 'holiday', from: '2026-11-25', to: '2026-11-27', source: 'US Holidays' });
  s.addDayNote({ label: 'Add/drop deadline', kind: 'note', from: '2026-11-26', to: '2026-11-26' });
  // Note the asymmetry, which is the point: the add/drop deadline is a note
  // that blocks NOTHING, and one blocked day carries no note at all.
  s.blockedDays.push('2026-11-25', '2026-11-26', '2026-11-27', '2026-12-25');
  s.markWeekSeen(new Date(2026, 10, 25));
  return s;
};

describe('the exported JSON', () => {
  it('carries day notes and blocked days as first-class keys', () => {
    const { data } = exportState(authored());
    // Authorable directly: a generator can write these instead of emitting
    // full-day blocker tasks and relying on a conversion.
    expect(data.blockedDays).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-12-25']);
    expect(data.dayNotes.map((n) => n.label)).toEqual(['Thanksgiving', 'Add/drop deadline']);
  });

  it('is summarized honestly, so the confirm can name what is arriving', () => {
    const sum = summarizeImport(exportState(authored()).data);
    expect(sum.valid).toBe(true);
    expect(sum.dayNoteCount).toBe(2);
    expect(sum.blockedDayCount).toBe(4);
  });
});

describe('useEngine#replace — the function that was dropping them', () => {
  // Driven through the REAL hook rather than transcribed. A transcription would
  // have to be edited to break, which is exactly what a regression test must
  // not require; the file-input plumbing in between is not what broke, so it is
  // deliberately not in the way.
  function Harness({ blob }) {
    const { sched, replace, version } = useEngine();
    void version;
    return (
      <div>
        <button type="button" onClick={() => replace(blob)}>go</button>
        <output data-testid="notes">{sched.dayNotes.map((n) => n.label).join('|')}</output>
        <output data-testid="blocked">{sched.blockedDays.join('|')}</output>
      </div>
    );
  }

  it('carries day notes and blocked days across, like every other collection', () => {
    const { data } = exportState(authored());
    render(<Harness blob={data} />);

    expect(screen.getByTestId('blocked').textContent).toBe(''); // fresh
    act(() => { fireEvent.click(screen.getByText('go')); });

    // Before the fix both of these were empty, with no error anywhere: importing
    // a footlocker erased every holiday and every day you had taken off.
    expect(screen.getByTestId('notes').textContent).toBe('Thanksgiving|Add/drop deadline');
    expect(screen.getByTestId('blocked').textContent)
      .toBe('2026-11-25|2026-11-26|2026-11-27|2026-12-25');
  });

  it('replaces rather than merges — an import is not an append', () => {
    const { data } = exportState(authored());
    function Pre({ blob }) {
      const { sched, replace } = useEngine();
      if (sched.blockedDays.length === 0 && sched.dayNotes.length === 0) {
        sched.blockDay(new Date(2026, 0, 1));
        sched.addDayNote({ label: 'Stale', from: '2026-01-01', to: '2026-01-01' });
      }
      return (
        <div>
          <button type="button" onClick={() => replace(blob)}>go</button>
          <output data-testid="notes">{sched.dayNotes.map((n) => n.label).join('|')}</output>
          <output data-testid="blocked">{sched.blockedDays.join('|')}</output>
        </div>
      );
    }
    render(<Pre blob={data} />);
    act(() => { fireEvent.click(screen.getByText('go')); });

    expect(screen.getByTestId('notes').textContent).not.toMatch(/Stale/);
    expect(screen.getByTestId('blocked').textContent).not.toMatch(/2026-01-01/);
  });
});

describe('useEngine#replace — structurally, so key #17 cannot slip through', () => {
  // ⚠️ THE HAND-MAINTAINED LIST IS THE BUG. Four fields have now been dropped
  // here — snapshots/lastSeenWeek, then _dismissed, then dayNotes/blockedDays,
  // then _commitmentDone — and each fix added one more line to a list that the
  // NEXT field will not be added to either. So this case checks no field by
  // name. It diffs the WHOLE of `toJSON()` across a real `replace`.
  //
  // The second assertion is what stops the guard rotting. A structural diff is
  // vacuous for any key the fixture leaves at its default: empty compares equal
  // to empty and the case passes while proving nothing. So the fixture must
  // make EVERY key non-trivial, and the test fails if it does not — which means
  // adding a 17th key to `toJSON` fails this case until someone populates it
  // here, and the diff then covers it for free.

  /** A schedule with every collection in `toJSON()` genuinely populated. */
  const fullyLoaded = () => {
    const s = new Schedule({ config: defaultConfig });
    const ws = new Date(2026, 8, 7); // Mon

    s.buckets.push(new Bucket({ label: 'Deep work', tags: ['study'], color: '#457B9D' }));
    s.zones.push(new Zone({ label: 'Mornings', matchTags: ['study'], windows: [{ day: 1, start: '09:00', end: '12:00' }] }));
    s.activities.push(new Activity({ label: 'Run', tags: ['exercise'], durationMin: 30, durationMax: 60 }));
    s.tasks.push(new Task({
      title: 'Read chapter 4', tags: ['study'], type: 'fixed',
      startTime: new Date(2026, 8, 7, 9, 0), endTime: new Date(2026, 8, 7, 10, 30),
      completion: 'done', satisfaction: { overall: 4 },
    }));
    s.retireTag('old-tag');
    s.addDayNote({ label: 'Thanksgiving', kind: 'holiday', from: '2026-11-25', to: '2026-11-27' });
    s.blockedDays.push('2026-12-25');

    const c = new Commitment({ title: 'ESF 2', tags: ['study'], amountMinPerWeek: 120 });
    s.commitments.push(c);
    s.routineInstances.push(new RoutineInstance({
      label: 'Morning out', startTime: new Date(2026, 8, 8, 7, 0), travelMin: 20,
      steps: [{ kind: 'task', label: 'Shower', durationMin: 15 }],
    }));

    s.retrain();                     // model
    s.snapshot(ws);                  // snapshots
    s.markWeekSeen(ws);              // lastSeenWeek
    s.dismissSuggestion('overpack', ws); // dismissed
    s.markCommitmentWeekDone(c.id, ws);  // commitmentDone
    return s;
  };

  /** "This key would compare equal to a fresh schedule's, so it proves nothing." */
  const isTrivial = (v) => v === null || v === undefined
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

  it('leaves no key of toJSON() at its default — or the diff below is vacuous', () => {
    const json = fullyLoaded().toJSON();
    const empty = Object.entries(json).filter(([, v]) => isTrivial(v)).map(([k]) => k);
    // If this fails, a key was added to `toJSON` without being given a value
    // here. Populate it in `fullyLoaded` — do not delete it from the check.
    expect(empty).toEqual([]);
  });

  it('carries every key across, whatever the keys turn out to be', () => {
    const s = fullyLoaded();
    const { data } = exportState(s);
    const before = s.toJSON();
    let after = null;

    function Harness() {
      const { sched, replace, version } = useEngine();
      void version;
      return (
        <button type="button" onClick={() => { replace(data); after = sched.toJSON(); }}>go</button>
      );
    }
    render(<Harness />);
    act(() => { fireEvent.click(screen.getByText('go')); });

    // Named individually so a failure says WHICH key, not just "objects differ".
    const dropped = Object.keys(before).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after?.[k]),
    );
    expect(dropped).toEqual([]);
  });
});

describe('the Cabana names what is arriving', () => {
  it('puts the day-note and blocked-day counts in the confirm', () => {
    const sum = summarizeImport(exportState(authored()).data);
    const extra = [
      sum.dayNoteCount ? `${sum.dayNoteCount} day notes` : null,
      sum.blockedDayCount ? `${sum.blockedDayCount} blocked days` : null,
    ].filter(Boolean).join(', ');
    // The string the Cabana builds. A summary that stays silent about a
    // collection is how nobody notices it never arrived.
    expect(extra).toBe('2 day notes, 4 blocked days');
  });
});
