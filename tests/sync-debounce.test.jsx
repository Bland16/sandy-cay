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

vi.mock('../src/ui/google.js', () => ({
  getAccessToken: vi.fn(async () => 'token-1'),
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
}));

const { useGoogleSync, DEBOUNCE_MS, SYNC_CALENDAR_KEY } = await import('../src/ui/useGoogleSync.js');

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SYNC_CALENDAR_KEY, JSON.stringify('cal-1'));
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
