// @vitest-environment jsdom
// The sync actually FIRING — design/GOOGLE-AS-STORAGE.md GS-6.
//
// ⚠️ WHY THIS FILE EXISTS, and it is the most important test in the sync set.
// Every other sync test calls the planner and the executor directly, so they
// all pass whether or not anything ever TRIGGERS a sync. The trigger is a React
// effect, and an effect that schedules a timer while depending on a callback's
// identity cancels its own pending work on the next unrelated re-render.
//
// That is exactly what happened: `now = () => Date.now()` as a DEFAULT
// PARAMETER built a new function every render, changing runSync, re-running the
// debounce effect, whose cleanup cleared the timer — so the sync never ran.
// Nothing errored. It simply never saved. 972 tests were green at the time.
//
// The network is mocked here so runs COMPLETE and can be counted; in jsdom the
// real Google script never loads, so an unmocked run hangs on the token and
// every later run is blocked behind it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Schedule, defaultConfig } from '../src/core/index.js';

// ⚠️ `cachedAccessToken` matters as much as `getAccessToken` here. `runSync`
// now refuses to run without a token ALREADY in hand, because every one of its
// callers is a non-gesture context where a Google popup cannot open. These
// tests exercise the sync's decisions, not sign-in, so they hold a live token
// throughout — omit it and the hook correctly does nothing at all.
let tokenHeld = true;
vi.mock('../src/ui/google.js', () => ({
  getAccessToken: vi.fn(async () => 'token-1'),
  cachedAccessToken: () => (tokenHeld ? 'token-1' : null),
  clearAccessToken: () => { tokenHeld = false; },
  readClientId: () => 'client',
}));

const pullMock = vi.fn(async () => ({ tasks: [], library: null, libraryError: null, dropped: [] }));
const applyPlanMock = vi.fn(async () => ({ synced: [], forgotten: [], failed: [] }));
const pushLibraryMock = vi.fn(async () => ({ events: 1, replaced: 0 }));

vi.mock('../src/ui/googleSync.js', () => ({
  makeApi: () => ({}),
  pull: (...a) => pullMock(...a),
  applyPlan: (...a) => applyPlanMock(...a),
  pushLibrary: (...a) => pushLibraryMock(...a),
  inspectCalendar: vi.fn(async () => ({ safe: true, foreign: 0, ours: 0, total: 0, foreignSample: [] })),
  // GS-11: day notes and blocked days go through the same executor with their
  // own encoder, so the mock has to offer them. Without these, reading the
  // export throws inside runSync and the failure LOOKS like "the library was
  // never pushed" — which is how this was found.
  encodeNoteParts: (n) => [n],
  encodeBlockedParts: (b) => [b],
  encodeTodoParts: (t) => [t],
}));

const { useGoogleSync, DEBOUNCE_MS, RETURN_PULL_MS, SYNC_CALENDAR_KEY } = await import('../src/ui/useGoogleSync.js');

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SYNC_CALENDAR_KEY, JSON.stringify('cal-1'));
  tokenHeld = true;
  pullMock.mockClear();
  applyPlanMock.mockClear();
  pushLibraryMock.mockClear();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

const setup = () => ({
  sched: new Schedule({ config: defaultConfig }),
  showToast: vi.fn(),
  mutate: vi.fn(),
});

/** How many full sync passes have run. `pull` is the first call of each. */
const runs = () => pullMock.mock.calls.length;

const mount = (props) => renderHook(
  ({ version, enabled }) => useGoogleSync({ ...props, version, enabled }),
  { initialProps: { version: 1, enabled: props.enabled } },
);

describe('it runs at all', () => {
  it('pulls once when the app opens signed in, and only once', async () => {
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: true, sched, mutate, showToast });
    await act(async () => { await Promise.resolve(); });
    expect(runs()).toBe(1);

    // Unrelated re-renders must not re-pull.
    rerender({ version: 1, enabled: true });
    rerender({ version: 1, enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(runs()).toBe(1);
  });

  it('does NOTHING, and says so, when no token is held', async () => {
    // Every caller of runSync is a non-gesture context, so asking Google here
    // cannot open a popup — it can only fail. Before this guard the failure was
    // reported as a sync error while the app went on showing localStorage as
    // though it were the calendar.
    tokenHeld = false;
    const { sched, showToast, mutate } = setup();
    const onAuthLost = vi.fn();
    mount({ enabled: true, sched, mutate, showToast, onAuthLost });
    await act(async () => { await Promise.resolve(); });

    expect(runs()).toBe(0);              // nothing was pulled
    expect(onAuthLost).toHaveBeenCalled(); // and the app was TOLD
  });

  it('⚠️ pulls AGAIN after reconnecting — the open-once latch re-arms', async () => {
    // `enabled` now means "can actually sync", so it goes false when the hour
    // runs out and true again when the user signs back in. The latch that stops
    // a re-render re-pulling must not also stop THAT: GS-3 says Google is the
    // truth, and a reconnect is exactly when we do not know what changed while
    // we were away.
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: true, sched, mutate, showToast });
    await act(async () => { await Promise.resolve(); });
    expect(runs()).toBe(1);

    rerender({ version: 1, enabled: false });          // the token expired
    await act(async () => { await Promise.resolve(); });
    expect(runs()).toBe(1);                            // and nothing ran

    rerender({ version: 1, enabled: true });           // signed back in
    await act(async () => { await Promise.resolve(); });
    expect(runs()).toBe(2);
  });
});

describe('the debounce survives re-renders', () => {
  it('⚠️ still fires when the app re-renders before the timer elapses', async () => {
    // The regression this file was written for. The real app re-renders
    // constantly — a toast, a hover, a panel opening — and if any of those
    // cancel the pending sync, nothing is ever saved and nothing says so.
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: true, sched, mutate, showToast });
    await act(async () => { await Promise.resolve(); });
    const afterOpen = runs();

    rerender({ version: 2, enabled: true });        // something changed
    rerender({ version: 2, enabled: true });        // ...then unrelated redraws
    rerender({ version: 2, enabled: true });

    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); await Promise.resolve(); });
    expect(runs()).toBe(afterOpen + 1);
  });

  it('collapses a burst of changes into ONE run', async () => {
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: true, sched, mutate, showToast });
    await act(async () => { await Promise.resolve(); });
    const afterOpen = runs();

    for (let v = 2; v <= 6; v += 1) {
      rerender({ version: v, enabled: true });
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { vi.advanceTimersByTime(500); });   // still typing
    }
    expect(runs()).toBe(afterOpen);                              // nothing yet

    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); await Promise.resolve(); });
    expect(runs()).toBe(afterOpen + 1);                          // one, not five
  });
});

describe('the library is not rewritten on every pass', () => {
  it('writes it once, then leaves it alone while only tasks change', async () => {
    // `pushLibrary` DELETES AND RECREATES its events, so pushing every pass
    // meant a delete plus an insert every five seconds of editing — pure quota
    // burn for a blob that changes when you add a bucket, not when you drag a
    // card. It also churned the library event's id, which makes a store harder
    // to inspect by hand.
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: true, sched, mutate, showToast });
    await act(async () => { await Promise.resolve(); });
    expect(pushLibraryMock).toHaveBeenCalledTimes(1);   // first run establishes it

    for (let v = 2; v <= 4; v += 1) {
      rerender({ version: v, enabled: true });
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); await Promise.resolve(); });
    }
    expect(runs()).toBeGreaterThan(1);                  // syncs did happen
    expect(pushLibraryMock).toHaveBeenCalledTimes(1);   // library did not move
  });
});

describe('a guest never syncs', () => {
  it('does nothing at all when disabled, however much changes', async () => {
    // The entry screen promises "nothing leaves this device", and this gate is
    // the whole of that promise.
    const { sched, showToast, mutate } = setup();
    const { rerender } = mount({ enabled: false, sched, mutate, showToast });
    rerender({ version: 2, enabled: false });
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS * 3); await Promise.resolve(); });
    expect(runs()).toBe(0);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('⚠️ what the calendar looked like is remembered between sessions', () => {
  // Reported 2026-10-01: a skip made on the laptop never reached the phone,
  // because each session took its FIRST PULL as "already seen". Edits made
  // while the app was closed were in that pull, so they were never adopted —
  // and the stale copy was later pushed back over them.
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

  it('a session opening after an edit elsewhere adopts it', async () => {
    const { sched, showToast, mutate } = setup();
    const gym = sched.toJSON().tasks; // empty schedule; the task arrives below
    const local = { id: 'gym', title: 'Gym' };
    sched.toJSON = () => ({ ...Schedule.prototype.toJSON.call(sched), tasks: [...gym, local] });

    // Session 1: the gym is in both places and gets synced.
    pullMock.mockImplementation(async () => ({
      tasks: [{ task: local, googleEventIds: ['ev-gym'], updated: 1000 }],
      library: null, libraryError: null, dropped: [],
    }));
    applyPlanMock.mockImplementation(async (_api, _cal, plan) => ({
      synced: plan.update.map(({ task }) => ({ task })), forgotten: [], failed: [],
      wrote: plan.update.length ? { 'ev-gym': 2000 } : {},
    }));
    const first = mount({ enabled: true, sched, mutate, showToast });
    await flush();
    first.unmount();
    expect(JSON.parse(window.localStorage.getItem('sandycay.sync.state')).seen).toEqual({ 'ev-gym': 2000 });

    // Between sessions, the laptop skips a session: Google now holds a newer copy.
    const laptop = { id: 'gym', title: 'Gym', occurrenceData: { '2026-09-29': { completion: 'skipped' } } };
    pullMock.mockImplementation(async () => ({
      tasks: [{ task: laptop, googleEventIds: ['ev-gym'], updated: 9000 }],
      library: null, libraryError: null, dropped: [],
    }));
    applyPlanMock.mockClear();

    // Session 2 — the phone opening.
    mount({ enabled: true, sched, mutate, showToast });
    await flush();
    const plan = applyPlanMock.mock.calls.find((c) => c[3] && c[3].commitmentIds)[2];
    expect(plan.adopt).toEqual([laptop]);
    expect(plan.update).toHaveLength(0);
  });
});

describe('⚠️ coming back to the tab pulls (design/TODO-LIST.md T-3)', () => {
  // An idle open device never pulled: only opening and a LOCAL edit did. So it
  // went on showing what the other device had already changed, indefinitely.
  const settle = async () => { await act(async () => { await Promise.resolve(); }); };
  const comeBack = async () => {
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
  };

  it('a return after a while pulls again', async () => {
    const { sched, showToast, mutate } = setup();
    mount({ enabled: true, sched, mutate, showToast });
    await settle();
    expect(runs()).toBe(1);

    await act(async () => { vi.advanceTimersByTime(RETURN_PULL_MS + 1); });
    await comeBack();
    expect(runs()).toBe(2);
  });

  it('but not on every alt-tab: one per RETURN_PULL_MS', async () => {
    const { sched, showToast, mutate } = setup();
    mount({ enabled: true, sched, mutate, showToast });
    await settle();

    // Straight after opening: the opening pull already covered it.
    await comeBack();
    expect(runs()).toBe(1);

    await act(async () => { vi.advanceTimersByTime(RETURN_PULL_MS + 1); });
    await comeBack();
    await comeBack();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(runs()).toBe(2);
  });

  it('is SILENT without a token — a courtesy pull must not raise "connect again"', async () => {
    const { sched, showToast, mutate } = setup();
    const onAuthLost = vi.fn();
    mount({ enabled: true, sched, mutate, showToast, onAuthLost });
    await settle();
    onAuthLost.mockClear();

    tokenHeld = false;
    await act(async () => { vi.advanceTimersByTime(RETURN_PULL_MS + 1); });
    await comeBack();
    expect(runs()).toBe(1);
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it('a guest never pulls on return either', async () => {
    const { sched, showToast, mutate } = setup();
    mount({ enabled: false, sched, mutate, showToast });
    await act(async () => { vi.advanceTimersByTime(RETURN_PULL_MS + 1); });
    await comeBack();
    expect(runs()).toBe(0);
  });
});
