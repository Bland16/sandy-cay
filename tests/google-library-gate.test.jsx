// @vitest-environment jsdom
// GS-8 — the library gate. design/GOOGLE-AS-STORAGE.md §7.
//
// ⚠️ WHAT THIS EXISTS TO PREVENT, and it was real, not theoretical:
// `pull` decoded the library and handed it back as `remote.library`, and
// nothing in the app read it. A second device got its tasks and none of its
// buckets, zones, activities, commitments or routines — and then pushed its own
// fresh starter set over the top, taking the real one out of the store.
// `design/probes/probe-google-second-device.mjs` drives that end to end.
//
// The gate is rendered through the REAL hook here, not called as a function.
// That is the lesson of `sync-debounce.test.jsx`: this file's sibling bugs all
// lived in whether anything TRIGGERED the code, and a test that calls the parts
// directly passes either way.
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Schedule, defaultConfig, seedStarterBuckets } from '../src/core/index.js';
import {
  LIBRARY_KEYS, LIBRARY_FIELD, libraryFrom, diffLibrary, applyLibrary,
} from '../src/core/googleLibrary.js';

vi.mock('../src/ui/google.js', () => ({
  getAccessToken: vi.fn(async () => 'token-1'),
  readClientId: () => 'client',
}));

const pullMock = vi.fn();
const applyPlanMock = vi.fn(async () => ({ synced: [], forgotten: [], failed: [] }));
const pushLibraryMock = vi.fn(async () => ({ events: 1, replaced: 0 }));

vi.mock('../src/ui/googleSync.js', () => ({
  makeApi: () => ({}),
  pull: (...a) => pullMock(...a),
  applyPlan: (...a) => applyPlanMock(...a),
  pushLibrary: (...a) => pushLibraryMock(...a),
  inspectCalendar: vi.fn(async () => ({
    safe: true, foreign: 0, ours: 0, total: 0, foreignSample: [],
  })),
  // GS-11: day notes and blocked days go through the same executor with their
  // own encoder, so the mock has to offer them. Without these, reading the
  // export throws inside runSync and the failure LOOKS like "the library was
  // never pushed".
  encodeNoteParts: (n) => [n],
  encodeBlockedParts: (b) => [b],
}));

const { useGoogleSync, SYNC_CALENDAR_KEY, freshLibraryHash } = await import('../src/ui/useGoogleSync.js');

const freshSchedule = () => {
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  return s;
};

/** A schedule with content of its own — NOT what a new install produces. */
const usedSchedule = () => {
  const s = freshSchedule();
  s.addBucket({ label: 'Thesis', tags: ['thesis'] });
  return s;
};

const remoteLibrary = () => {
  const s = freshSchedule();
  s.addBucket({ label: 'Fieldwork', tags: ['field'] });
  s.addZone({
    label: 'Work',
    tags: ['work'],
    exclusive: true,
    windows: [{ day: 'mon', start: '09:00', end: '17:00' }],
  });
  return libraryFrom(s.toJSON());
};

const emptyPull = async () => ({
  tasks: [], library: null, libraryError: null, dropped: [], unreadable: new Set(),
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SYNC_CALENDAR_KEY, JSON.stringify('cal-1'));
  pullMock.mockReset();
  applyPlanMock.mockClear();
  pushLibraryMock.mockClear();
  pullMock.mockImplementation(emptyPull);
});
afterEach(() => { vi.restoreAllMocks(); });

const mount = (props) => renderHook(
  ({ version, enabled }) => useGoogleSync({ ...props, version, enabled }),
  { initialProps: { version: 1, enabled: true } },
);

describe('the field map cannot drift from the key list', () => {
  it('every library key names a field on Schedule', () => {
    // Schedule.js already carries this collection list three times and its own
    // comments count the halves that must move together. This makes a fourth
    // copy safe: add a collection, forget the mapping, fail here.
    const s = freshSchedule();
    for (const key of LIBRARY_KEYS) {
      expect(LIBRARY_FIELD[key], `no field mapped for "${key}"`).toBeTruthy();
      expect(s, `Schedule has no "${LIBRARY_FIELD[key]}"`).toHaveProperty(LIBRARY_FIELD[key]);
    }
  });
});

describe('diffLibrary compares CONTENT, not counts', () => {
  it('two same-length bucket lists are not the same list', () => {
    // Exactly the shape of a phone that seeded its own starter set over yours:
    // eleven here, eleven there, and none of them the same eleven.
    const a = libraryFrom(freshSchedule().toJSON());
    const mine = freshSchedule();
    mine.buckets[0].label = 'Renamed';
    const b = libraryFrom(mine.toJSON());
    const d = diffLibrary(a, b);

    expect(d.same).toBe(false);
    expect(d.differing.map((r) => r.key)).toContain('buckets');
    const row = d.differing.find((r) => r.key === 'buckets');
    expect(row.here).toBe(row.there); // same COUNT, different content
  });

  it('is true only when every collection matches', () => {
    const a = libraryFrom(usedSchedule().toJSON());
    expect(diffLibrary(a, a).same).toBe(true);
    expect(diffLibrary(a, a).differing).toHaveLength(0);
  });
});

describe('applyLibrary revives through the real constructors', () => {
  it('brings the collections across and leaves tasks alone', () => {
    const phone = freshSchedule();
    phone.addFixed({
      title: 'Mine',
      startTime: new Date(2026, 8, 7, 9),
      endTime: new Date(2026, 8, 7, 10),
    });
    const r = applyLibrary(phone, remoteLibrary());

    expect(r.applied).toEqual(expect.arrayContaining(['buckets', 'zones', 'config', 'model']));
    expect(phone.buckets.some((b) => b.label === 'Fieldwork')).toBe(true);
    expect(phone.zones).toHaveLength(1);
    // A revived zone must be a Zone, not a bare object — placement calls methods
    // on it, and a plain object would fail deep inside the scheduler instead.
    expect(typeof phone.zones[0].activeOn).toBe('function');
    expect(typeof phone.learning.toJSON).toBe('function');
    // Tasks are events in their own right and reconcile per-task.
    expect(phone.tasks).toHaveLength(1);
    expect(phone.tasks[0].title).toBe('Mine');
  });
});

describe('the gate, through the real hook', () => {
  it('a FRESH device adopts the library in the calendar', async () => {
    const lib = remoteLibrary();
    pullMock.mockImplementation(async () => ({
      tasks: [], library: lib, libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = freshSchedule();
    const mutate = vi.fn((fn) => fn(sched));

    mount({ sched, mutate, showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(sched.buckets.some((b) => b.label === 'Fieldwork')).toBe(true);
    expect(sched.zones).toHaveLength(1);
  });

  it('⚠️ a USED device is frozen, and writes NOTHING', async () => {
    // The whole point. A device that has content of its own cannot adopt, and
    // must not push — its `dirtyAt` is stamped when it NOTICES a difference,
    // which is now, so it would beat every genuine edit made while it slept.
    pullMock.mockImplementation(async () => ({
      tasks: [], library: remoteLibrary(), libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = usedSchedule();
    const mutate = vi.fn((fn) => fn(sched));

    const { result } = mount({ sched, mutate, showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.libraryState?.conflict).toBe(true);
    expect(result.current.libraryState.rows.map((r) => r.key)).toContain('buckets');
    // Not one write of any kind — tasks included.
    expect(applyPlanMock).not.toHaveBeenCalled();
    expect(pushLibraryMock).not.toHaveBeenCalled();
    // And nothing local changed either.
    expect(sched.buckets.some((b) => b.label === 'Fieldwork')).toBe(false);
    expect(sched.buckets.some((b) => b.label === 'Thesis')).toBe(true);
  });

  it('agreement is not a conflict — the sync runs normally', async () => {
    const sched = usedSchedule();
    pullMock.mockImplementation(async () => ({
      tasks: [],
      library: libraryFrom(sched.toJSON()),
      libraryError: null,
      dropped: [],
      unreadable: new Set(),
    }));
    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.libraryState).toBeNull();
    expect(applyPlanMock).toHaveBeenCalled();
  });

  it('a calendar with no library yet is not a conflict', async () => {
    // First ever push: there is nothing up there to disagree with.
    const sched = usedSchedule();
    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.libraryState).toBeNull();
    expect(pushLibraryMock).toHaveBeenCalled();
  });

  it('Derive from calendar resolves it, and then the sync is free', async () => {
    pullMock.mockImplementation(async () => ({
      tasks: [], library: remoteLibrary(), libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = usedSchedule();
    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.libraryState?.conflict).toBe(true);

    await act(async () => { await result.current.deriveLibraryFromCalendar(); });

    expect(result.current.libraryState).toBeNull();
    expect(sched.buckets.some((b) => b.label === 'Fieldwork')).toBe(true);
    expect(sched.buckets.some((b) => b.label === 'Thesis')).toBe(false);
  });

  it('Sync library now resolves it the other way', async () => {
    pullMock.mockImplementation(async () => ({
      tasks: [], library: remoteLibrary(), libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = usedSchedule();
    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.libraryState?.conflict).toBe(true);

    await act(async () => { await result.current.pushLibraryNow(); });

    expect(result.current.libraryState).toBeNull();
    expect(pushLibraryMock).toHaveBeenCalled();
    // This device was right, so it keeps what it had.
    expect(sched.buckets.some((b) => b.label === 'Thesis')).toBe(true);
  });
});

describe('what counts as fresh', () => {
  it('is stable, because a moving value would freeze every device forever', () => {
    expect(freshLibraryHash()).toBe(freshLibraryHash());
  });
});

describe('the Cabana says it, and the suite READS what it says', () => {
  // ⚠️ Dumped, not transcribed. This repo has shipped three presentation
  // defects past a green suite — a whole block that vanished, a control that
  // lied about its own effect, a label that rendered as "Whenpick a time" —
  // because behaviour tests cannot see a missing field or a run-together word.
  // So this renders the real Cabana and prints what a person is actually shown.
  it('names every disagreeing collection, with both counts', async () => {
    const { render, screen } = await import('@testing-library/react');
    const Cabana = (await import('../src/ui/components/Cabana.jsx')).default;
    const { weekStart: weekStartOf } = await import('../src/core/index.js');

    const sched = usedSchedule();
    render(
      <Cabana
        sched={sched}
        mutate={(fn) => fn(sched)}
        weekStart={weekStartOf(new Date(2026, 8, 7))}
        onBack={() => {}}
        onReplace={() => {}}
        onReset={() => {}}
        showToast={() => {}}
        session="google"
        onChangeSession={() => {}}
        sync={{
          calendarId: 'cal-1',
          status: 'error',
          lastError: null,
          syncNow: () => {},
          forget: () => {},
          resetState: () => {},
          pushLibraryNow: async () => {},
          deriveLibraryFromCalendar: async () => {},
          libraryState: {
            conflict: true,
            rows: [
              { key: 'buckets', same: false, here: 11, there: 4 },
              { key: 'zones', same: false, here: 0, there: 1 },
            ],
          },
        }}
      />,
    );

    const box = document.querySelector('.syncconflict');
    expect(box, 'the conflict box did not render at all').toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`\n  the Cabana shows:\n${box.textContent.replace(/\s+/g, ' ').trim().replace(/(.{78}\s)/g, '$1\n  ')}\n`);

    const rows = [...document.querySelectorAll('.synclibdiff li')].map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    // The human name, not the JSON key — "buckets" is our word, not theirs.
    expect(rows[0]).toContain('Tag buckets');
    // Both counts, because "buckets differ" is unactionable and "11 here · 4 in
    // the calendar" tells you which side is the stale one.
    expect(rows[0]).toContain('11 here');
    expect(rows[0]).toContain('4 in the calendar');
    expect(rows[1]).toContain('Zones');

    // Both answers are offered, and neither is dressed as the safe one.
    expect(screen.getByText(/This device is right/)).toBeTruthy();
    expect(screen.getByText(/The calendar is right/)).toBeTruthy();
    // And the ordinary Sync now button must not offer a way around the freeze.
    const syncNow = [...document.querySelectorAll('button')].find((b) => /Sync now/.test(b.textContent));
    expect(syncNow.disabled, 'Sync now stayed clickable during a freeze').toBe(true);
  });
});

describe('⚠️ asked ONCE per session — the loop fix', () => {
  // The library question used to be re-decided on EVERY pass. Adopting calls
  // `mutate`, which bumps `version`, which schedules another sync, which asks
  // again — so whenever the answer did not come back identical the second time,
  // the app either adopted forever at five-second intervals or landed in a
  // freeze it had caused itself.
  //
  // A single-pass test cannot see any of that, which is why these re-render.
  // `design/probes/probe-sync-convergence.mjs` runs six passes and prints them.
  const rerenderTwice = async (result, rerender) => {
    for (let v = 2; v <= 3; v += 1) {
      rerender({ version: v, enabled: true });
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { vi.advanceTimersByTime(6000); await Promise.resolve(); });
    }
    return result;
  };

  it('adopts on the first pass and NEVER adopts again', async () => {
    vi.useFakeTimers();
    const lib = remoteLibrary();
    pullMock.mockImplementation(async () => ({
      tasks: [], library: lib, libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = freshSchedule();
    const mutate = vi.fn((fn) => fn(sched));

    const { result, rerender } = mount({ sched, mutate, showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    const afterFirst = mutate.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);          // it DID adopt

    await rerenderTwice(result, rerender);

    // ⚠️ The whole point: later passes must not keep adopting. Each adoption is
    // a mutate, and each mutate schedules the next pass.
    expect(sched.buckets.some((b) => b.label === 'Fieldwork')).toBe(true);
    expect(mutate.mock.calls.length).toBe(afterFirst);
    vi.useRealTimers();
  });

  it('⚠️ but a FREEZE keeps refusing — settled is not the same as waved through', async () => {
    // If "asked once" also silenced an unresolved conflict, the gate would
    // quietly admit the stale device it exists to stop. Only agreement,
    // adoption, or one of the two Cabana buttons counts as an answer.
    vi.useFakeTimers();
    pullMock.mockImplementation(async () => ({
      tasks: [], library: remoteLibrary(), libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = usedSchedule();
    const { result, rerender } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.libraryState?.conflict).toBe(true);

    await rerenderTwice(result, rerender);

    expect(result.current.libraryState?.conflict).toBe(true);
    expect(applyPlanMock).not.toHaveBeenCalled();
    expect(pushLibraryMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('and answering it lets the sync run again', async () => {
    vi.useFakeTimers();
    pullMock.mockImplementation(async () => ({
      tasks: [], library: remoteLibrary(), libraryError: null, dropped: [], unreadable: new Set(),
    }));
    const sched = usedSchedule();
    const { result, rerender } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.libraryState?.conflict).toBe(true);

    await act(async () => { await result.current.pushLibraryNow(); });
    expect(result.current.libraryState).toBeNull();

    await rerenderTwice(result, rerender);
    // Settled, so the question is not re-asked and the freeze does not return.
    expect(result.current.libraryState).toBeNull();
    expect(applyPlanMock).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('⚠️ the bulk-delete guard covers EVERY collection, not just tasks', () => {
  // GS-11 routed day notes and blocked days through the same planner as tasks
  // and inherited none of its protections. An emptied calendar — a re-made one,
  // a footlocker restore, events cleared by hand — took every holiday and every
  // blocked day with it, silently. `isBulkDelete` already recognised the
  // situation; nothing on that path asked it.
  //
  // `design/probes/probe-bulk-delete-gap.mjs` drives it end to end.
  const NOTES = [
    ['Thanksgiving', '2026-11-26'], ['Reading week', '2026-11-23'], ['Term ends', '2026-12-12'],
    ['Mum visiting', '2026-10-03'], ['Conference', '2026-09-18'], ['Bank holiday', '2026-08-31'],
  ];

  const withNotes = () => {
    const s = usedSchedule();
    for (const [label, day] of NOTES) s.addDayNote({ label, from: day, to: day });
    return s;
  };

  it('stops the pass when the notes would be wiped, and changes NOTHING', async () => {
    const sched = withNotes();
    // The sync remembers pushing them; the calendar no longer has them.
    const state = { lastSyncAt: 1, entries: {}, noteEntries: {} };
    for (const n of sched.dayNotes) state.noteEntries[n.id] = { hash: 'x', eventId: `ev-${n.id}`, dirtyAt: 0 };
    window.localStorage.setItem('sandycay.sync.state', JSON.stringify(state));

    pullMock.mockImplementation(async () => ({
      tasks: [],
      notes: [],            // ← everything gone from the calendar
      blockedDays: [],
      library: libraryFrom(sched.toJSON()),
      libraryError: null,
      dropped: [],
      unreadable: new Set(),
    }));

    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(sched.dayNotes).toHaveLength(NOTES.length);
    expect(result.current.status).toBe('error');
    expect(result.current.lastError).toMatch(/day notes/);
    // "Nothing was changed" has to be true of the WHOLE pass, which is why the
    // plans are all computed before anything is written.
    expect(applyPlanMock).not.toHaveBeenCalled();
    expect(pushLibraryMock).not.toHaveBeenCalled();
  });

  it('says which collection it stopped for', async () => {
    const sched = usedSchedule();
    for (const day of ['2026-12-24', '2026-12-25', '2026-12-26']) {
      sched.blockDay(new Date(2026, 11, Number(day.slice(-2))));
    }
    const state = { lastSyncAt: 1, entries: {}, blockedEntries: {} };
    for (const d of sched.blockedDays) {
      state.blockedEntries[`blocked-${d}`] = { hash: 'x', eventId: `ev-${d}`, dirtyAt: 0 };
    }
    window.localStorage.setItem('sandycay.sync.state', JSON.stringify(state));

    pullMock.mockImplementation(async () => ({
      tasks: [],
      notes: [],
      blockedDays: [],
      library: libraryFrom(sched.toJSON()),
      libraryError: null,
      dropped: [],
      unreadable: new Set(),
    }));

    const { result } = mount({ sched, mutate: vi.fn((fn) => fn(sched)), showToast: vi.fn() });
    await act(async () => { await Promise.resolve(); });

    expect(sched.blockedDays).toHaveLength(3);
    expect(result.current.lastError).toMatch(/blocked days/);
  });
});
