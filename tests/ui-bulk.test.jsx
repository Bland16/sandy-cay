// @vitest-environment jsdom
// M2.2 — the bulk flows and toasts, driven through the real <App/> and the real
// engine: D Clear Day (§3.4/OD-7), E removal + early-completion offer (§3.8/3.9),
// F occurrence-drop menu (§4C), G overpack notice (§7.3).
//
// Geometry is stubbed from the same contract the app publishes on its columns,
// exactly as ui-drag.test.jsx does — see that file's header.
//
// Seed week (deterministic, src/core/index.js seed()):
//   Mon  08:00 Morning gym (pinned recurrence occurrence) · 09:00 Team standup
//        10:00 + 12:30 Thesis chunks
//   Tue  08:00 Thesis · 12:00 Lunch with Priya · 18:00 Study for midterm
//   Wed  08:00 Read novel (flexible, unpinned)
//   Thu  14:00 Dentist (fixed)
//   Fri  08:00 Morning gym · 16:00 Weekly review (pinned) · 20:00 Movie night (rest)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, Task, defaultConfig, resetIds, dateKey, seed } from '../src/core/index.js';
import { gridBounds } from '../src/ui/format.js';

const STORAGE_KEY = 'sandy-cay:schedule:v1';
const COL_LEFT0 = 60;
const COL_W = 100;
const COL_TOP = 200;
const PXH = 34;
const { start: START_HOUR, end: END_HOUR } = gridBounds();
const COL_H = (END_HOUR - START_HOUR) * PXH;

const yAt = (h, m = 0) => COL_TOP + (h + m / 60 - START_HOUR) * PXH;
const xAt = (dayIndex) => COL_LEFT0 + dayIndex * COL_W;

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
  toJSON() {},
});

let origRect;
beforeEach(() => {
  // The app ships empty now, so a test wanting the seed week hands it over the
  // same way a returning user would: persisted state. bootWith() overwrites
  // this for tests that state their own week.
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed(new Date()).toJSON()));
  resetIds();
  origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stub() {
    if (this.dataset && this.dataset.dropzone !== undefined) {
      return rect(xAt(Number(this.dataset.dayIndex)), COL_TOP, COL_W, COL_H);
    }
    if (this.classList && this.classList.contains('card')) {
      const col = this.closest('[data-dropzone]');
      if (!col) return rect(0, 0, 0, 0);
      const cr = col.getBoundingClientRect();
      return rect(
        cr.left + 3,
        cr.top + (parseFloat(this.style.top) || 0),
        cr.width - 6,
        parseFloat(this.style.height) || 30,
      );
    }
    return rect(0, 0, 0, 0);
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = origRect;
  cleanup();
});

function pointer(type, clientX, clientY) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

const grid = () => document.querySelector('.grid') || document.querySelector('.dvgrid');
const cardFor = (title) => within(grid()).getByText(title).closest('.card');
const allCardsFor = (title) => within(grid()).getAllByText(title).map((n) => n.closest('.card'));
const columnOf = (el) => Number(el.closest('[data-dropzone]').dataset.dayIndex);
const timeOf = (el) => el.getAttribute('aria-label').split(' · ')[1];

function dragBody(card, toX, toY) {
  const r = card.getBoundingClientRect();
  const gx = 20;
  const gy = 6;
  fireEvent(card, pointer('pointerdown', r.left + gx, r.top + gy));
  fireEvent(window, pointer('pointermove', r.left + gx + 20, r.top + gy + 20));
  fireEvent(window, pointer('pointermove', toX + gx, toY + gy));
  fireEvent(window, pointer('pointerup', toX + gx, toY + gy));
}

/** Boot <App/> against a hand-built schedule instead of the seed, by writing it
 *  where useEngine looks first. Lets a test state its own week. */
function bootWith(build) {
  const s = new Schedule({ config: defaultConfig });
  build(s);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
  return s;
}

/** The Monday of the week <App/> will open on. */
function thisMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const at = (dayIndex, h, mi = 0) => {
  const d = thisMonday();
  d.setDate(d.getDate() + dayIndex);
  d.setHours(h, mi, 0, 0);
  return d;
};

const openDayMenu = (dayIndex) => fireEvent.click(document.querySelectorAll('.dhdots')[dayIndex]);
const openClearDay = (dayIndex) => {
  openDayMenu(dayIndex);
  fireEvent.click(screen.getByText(/Clear this day/));
  return document.querySelector('.claripanel');
};

// ---------------------------------------------------------------- D
describe('D — Clear Day panel (§3.4 / OD-7)', () => {
  it('reaches the panel from the day header ⋯, with block-day ON by default', () => {
    render(<App />);
    const panel = openClearDay(2);
    expect(panel).toBeTruthy();
    expect(panel.textContent).toMatch(/Clear Wednesday/);

    // OD-7: an evacuated day left unblocked silently refills, so the toggle
    // defaults on and you must opt OUT.
    const toggle = within(panel).getByRole('switch', { name: /Block this day/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('is a panel with a scope choice, not a confirm', () => {
    render(<App />);
    const panel = openClearDay(0);
    const scopes = within(panel).getAllByRole('radio');
    expect(scopes.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/Flexibles only/),
      expect.stringMatching(/Full clear/),
    ]);
    // Flexibles-only is the opening scope: the narrower action is the default.
    expect(scopes[0].getAttribute('aria-checked')).toBe('true');
  });

  it('full clear: every pinned/fixed task gets its own row, and Clear day stays disabled until each is resolved', () => {
    render(<App />);
    const panel = openClearDay(0); // Monday — Team standup (fixed) needs a call
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));

    const rows = panel.querySelectorAll('.cdrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toMatch(/Team standup/);

    const commit = within(panel).getByText('Clear day').closest('button');
    expect(commit.disabled).toBe(true);

    // Its own control, resolved individually — nothing pinned moves in a batch.
    fireEvent.change(within(rows[0]).getByLabelText(/Reschedule Team standup/), {
      target: { value: 'leave' },
    });
    expect(commit.disabled).toBe(false);
  });

  it('full clear with several anchors needs EVERY row resolved, not just one', () => {
    render(<App />);
    const panel = openClearDay(4); // Friday — Weekly review (pinned) + Movie night (rest)
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));

    const rows = [...panel.querySelectorAll('.cdrow')];
    expect(rows.length).toBe(2);
    const commit = within(panel).getByText('Clear day').closest('button');

    fireEvent.change(within(rows[0]).getByRole('combobox'), { target: { value: 'leave' } });
    expect(commit.disabled).toBe(true); // one down, one to go
    fireEvent.change(within(rows[1]).getByRole('combobox'), { target: { value: 'skip' } });
    expect(commit.disabled).toBe(false);
  });

  it('flexibles-only commits without touching the anchors, and relocates forward', () => {
    render(<App />);
    expect(columnOf(cardFor('Read novel'))).toBe(2); // Wed

    const panel = openClearDay(2);
    fireEvent.click(within(panel).getByText('Clear day'));

    expect(document.querySelector('.claripanel')).toBeNull();
    // Forward-only: it went to a LATER day, never an earlier one (§3.4).
    expect(columnOf(cardFor('Read novel'))).toBeGreaterThan(2);
    // Block-day was on → the engine's full-day blocker holds the day open.
    expect(columnOf(cardFor('Out sick'))).toBe(2);
  });

  it('a resolved row is acted on: "next same weekday" moves that task a week on', () => {
    render(<App />);
    const panel = openClearDay(0);
    fireEvent.click(within(panel).getByText(/Full clear/).closest('.cdopt'));
    fireEvent.change(within(panel).getByLabelText(/Reschedule Team standup/), {
      target: { value: 'next-weekday' },
    });
    fireEvent.click(within(panel).getByText('Clear day'));

    // Gone from this week's Monday — it moved to next Monday.
    expect(within(grid()).queryByText('Team standup')).toBeNull();
    fireEvent.click(screen.getByLabelText('Next week'));
    expect(columnOf(cardFor('Team standup'))).toBe(0);
    expect(timeOf(cardFor('Team standup'))).toBe('09:00–09:30');
  });

  it('block-day can be turned off — clear the day but keep it available', () => {
    render(<App />);
    const panel = openClearDay(2);
    fireEvent.click(within(panel).getByRole('switch', { name: /Block this day/i }));
    fireEvent.click(within(panel).getByText('Clear day'));

    expect(within(grid()).queryByText('Out sick')).toBeNull();
  });

  it('Esc closes the panel and leaves the day alone', () => {
    render(<App />);
    openClearDay(2);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.claripanel')).toBeNull();
    expect(columnOf(cardFor('Read novel'))).toBe(2); // untouched
    expect(timeOf(cardFor('Read novel'))).toBe('08:00–09:00');
  });
});

// ---------------------------------------------------------------- E
describe('E — removal & early-completion offer (§3.8 / §3.9)', () => {
  const deleteViaPanel = (title) => {
    fireEvent.click(cardFor(title));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm delete'));
  };

  it('deleting a ≥45-min task offers three fates, none imposed (P-1)', () => {
    render(<App />);
    deleteViaPanel('Read novel'); // 60 min

    const offer = document.querySelector('.gaptoast');
    expect(offer).toBeTruthy();
    const opts = [...offer.querySelectorAll('.opt')].map((b) => b.textContent);
    expect(opts[0]).toMatch(/Leave open/);
    expect(opts[1]).toMatch(/Backfill/);
    expect(opts[2]).toMatch(/Protect/);
    // Leave open is the default and holds focus, so Enter takes it.
    expect(document.activeElement).toBe(offer.querySelectorAll('.opt')[0]);
    // A freed hour is not a problem: nothing here is dressed as a warning.
    expect(offer.querySelector('.warn, .danger, .linkish')).toBeNull();
  });

  it('says nothing at all below the 45-minute threshold', () => {
    bootWith((s) => {
      s.addFlexible({ title: 'Quick errand', startTime: at(2, 10), endTime: at(2, 10, 30) });
    });
    render(<App />);
    deleteViaPanel('Quick errand'); // 30 min < 45
    expect(document.querySelector('.gaptoast')).toBeNull();
  });

  it('Leave open dismisses without moving anything', () => {
    render(<App />);
    const before = timeOf(cardFor('Study for midterm'));
    deleteViaPanel('Read novel');
    fireEvent.click(within(document.querySelector('.gaptoast')).getByText(/Leave open/).closest('.opt'));

    expect(document.querySelector('.gaptoast')).toBeNull();
    expect(timeOf(cardFor('Study for midterm'))).toBe(before);
  });

  it('Esc leaves the gap open — the same answer as the default', () => {
    render(<App />);
    deleteViaPanel('Read novel');
    expect(document.querySelector('.gaptoast')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.gaptoast')).toBeNull();
  });

  it('Protect fills the freed gap with a rest blocker', () => {
    render(<App />);
    deleteViaPanel('Read novel'); // Wed 08:00–09:00
    fireEvent.click(within(document.querySelector('.gaptoast')).getByText(/Protect/).closest('.opt'));

    const rest = cardFor('Recovery time');
    expect(columnOf(rest)).toBe(2);
    expect(timeOf(rest)).toBe('08:00–09:00');
  });

  it('Backfill names its pick before you take it, then moves exactly that task', () => {
    // A flagged task the engine couldn't place, and an hour that just came free.
    bootWith((s) => {
      s.addFixed({ title: 'Cancelled thing', startTime: at(2, 10), endTime: at(2, 11) });
      const parked = s.addFlexible({ title: 'Parked task', startTime: at(4, 9), endTime: at(4, 10) });
      parked.schedulingWarning = true;
      parked.placedBy = 'auto';
    });
    render(<App />);
    deleteViaPanel('Cancelled thing');

    const offer = document.querySelector('.gaptoast');
    const backfill = within(offer).getByText(/Backfill/).closest('.opt');
    expect(backfill.disabled).toBe(false);
    // P-1: an action you can't preview is one you can't consent to.
    expect(backfill.textContent).toMatch(/Parked task/);

    fireEvent.click(backfill);
    expect(columnOf(cardFor('Parked task'))).toBe(2);
    expect(timeOf(cardFor('Parked task'))).toBe('10:00–11:00');
  });

  it('Backfill is offered but disabled when nothing fits — never a silent no-op', () => {
    bootWith((s) => {
      s.addFixed({ title: 'Cancelled thing', startTime: at(2, 10), endTime: at(2, 11) });
    });
    render(<App />);
    deleteViaPanel('Cancelled thing');

    const backfill = within(document.querySelector('.gaptoast')).getByText(/Backfill/).closest('.opt');
    expect(backfill.disabled).toBe(true);
    expect(backfill.textContent).toMatch(/nothing fits/);
  });

  it('never backfills a user-placed task (§3.8, explicit)', () => {
    bootWith((s) => {
      s.addFixed({ title: 'Cancelled thing', startTime: at(2, 10), endTime: at(2, 11) });
      const mine = s.addFlexible({ title: 'Where I put it', startTime: at(4, 9), endTime: at(4, 10) });
      mine.schedulingWarning = true;
      mine.placedBy = 'user'; // I put it there on purpose
    });
    render(<App />);
    deleteViaPanel('Cancelled thing');

    const backfill = within(document.querySelector('.gaptoast')).getByText(/Backfill/).closest('.opt');
    expect(backfill.disabled).toBe(true);
    expect(columnOf(cardFor('Where I put it'))).toBe(4); // stayed exactly put
  });

  it('finishing early truncates the block, crosshatches the remainder and offers it', () => {
    // A task that is in progress *now*, whichever day the suite runs on: the
    // completion rule is "before its end", so the clock has to be inside it.
    const now = new Date();
    const dayIndex = (now.getDay() + 6) % 7;
    const start = new Date(now.getTime() - 10 * 60000);
    const end = new Date(now.getTime() + 90 * 60000);
    bootWith((s) => {
      s.addFixed({ title: 'Long meeting', startTime: start, endTime: end });
    });
    render(<App />);

    // Read the span BEFORE the click: React updates the card in place, so the
    // node itself is not a snapshot of anything.
    const endBefore = timeOf(cardFor('Long meeting')).split('–')[1];
    fireEvent.click(within(cardFor('Long meeting')).getByLabelText(/Mark "Long meeting" done/));

    // Truncated through the engine — the freed minutes are genuinely free.
    const after = cardFor('Long meeting');
    const endAfter = timeOf(after).split('–')[1];
    expect(endAfter).not.toBe(endBefore);
    expect(new Date(`1970-01-01T${endAfter}`).getTime())
      .toBeLessThan(new Date(`1970-01-01T${endBefore}`).getTime());

    // The remainder is drawn rather than silently vanishing, in the same lane.
    const band = grid().querySelectorAll('.remainder');
    expect(band.length).toBe(1);
    expect(band[0].getAttribute('title')).toMatch(/Long meeting/);

    // …and the same 3C offer fires for [now → original end].
    expect(document.querySelector('.gaptoast')).toBeTruthy();
    expect(document.querySelector('.gaptoast').textContent).toMatch(/finished early/);
    expect(columnOf(after)).toBe(dayIndex);
  });

  it('un-completing restores the span a mis-click truncated', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 10 * 60000);
    const end = new Date(now.getTime() + 90 * 60000);
    bootWith((s) => {
      s.addFixed({ title: 'Long meeting', startTime: start, endTime: end });
    });
    render(<App />);

    const before = timeOf(cardFor('Long meeting'));
    const check = () => within(cardFor('Long meeting')).getByLabelText(/Mark "Long meeting" done/);
    fireEvent.click(check());
    expect(timeOf(cardFor('Long meeting'))).not.toBe(before);

    fireEvent.click(check());
    expect(timeOf(cardFor('Long meeting'))).toBe(before);
    expect(grid().querySelectorAll('.remainder').length).toBe(0);
  });

  it('finishing a RELOCATED session early keeps it where it was moved to', () => {
    // addException REPLACES the whole exception for a date, so the truncation
    // write has to carry an existing `toDate` across. Without that, a session
    // moved to another day snaps back to its pattern day just for finishing
    // early — the pattern silently reclaiming a session the user had moved.
    //
    // Pinned to a fixed clock: this needs the wall clock to be *inside* the
    // session, and a conditional skip would just be a green test that never ran.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 15, 10, 5, 0, 0)); // Wed 10:05
    try {
      const mon = new Date(2026, 6, 13);
      const wed = new Date(2026, 6, 15);
      bootWith((s) => {
        s.tasks.push(new Task({
          title: 'Weekly sync',
          type: 'fixed',
          startTime: new Date(2026, 6, 13, 8, 0),
          endTime: new Date(2026, 6, 13, 9, 0),
          recurrence: {
            periods: [{ windows: [{ day: 'mon', start: '08:00', end: '09:00' }], interval: 1 }],
            anchorDate: mon,
            // Already moved off Monday: this week it happens Wednesday 10:00.
            exceptions: [{ date: dateKey(mon), action: 'move', toDate: dateKey(wed), start: '10:00', end: '11:30' }],
          },
        }));
      });
      render(<App />);

      expect(columnOf(cardFor('Weekly sync'))).toBe(2); // Wednesday, as moved
      fireEvent.click(within(cardFor('Weekly sync')).getByLabelText(/Mark "Weekly sync" done/));

      const after = cardFor('Weekly sync');
      expect(columnOf(after)).toBe(2); // still Wednesday — NOT back on Monday
      // Truncated toward the 10:05 clock, but floored at OD-1's 15-minute
      // minimum: the same floor the resize borders refuse to cross.
      expect(timeOf(after)).toBe('10:00–10:15');
    } finally {
      vi.useRealTimers();
    }
  });

  it('finishing a task that has not started yet truncates nothing', () => {
    render(<App />);
    // "Movie night" is Friday 20:00 — either long past or not yet begun, and
    // neither is an early finish.
    const card = cardFor('Movie night');
    const before = timeOf(card);
    fireEvent.click(within(card).getByLabelText(/Mark "Movie night" done/));

    expect(timeOf(cardFor('Movie night'))).toBe(before);
    expect(grid().querySelectorAll('.remainder').length).toBe(0);
  });
});

// ---------------------------------------------------------------- F
describe('F — occurrence-drop menu (§4C)', () => {
  it('opens a menu with three answers and NO silent default', () => {
    render(<App />);
    dragBody(cardFor('Team standup'), xAt(0) + 3, yAt(8)); // onto Mon 08:00 gym

    const menu = document.querySelector('.occmenu');
    expect(menu).toBeTruthy();
    const opts = [...menu.querySelectorAll('.opt')].map((b) => b.textContent);
    expect(opts[0]).toMatch(/Move this session/);
    expect(opts[1]).toMatch(/Skip this session/);
    expect(opts[2]).toMatch(/Cancel/);
    // 4C is explicit: the cost heuristic does not apply here, so nothing is
    // pre-highlighted and Enter commits nothing.
    expect(menu.querySelectorAll('.opt.pick').length).toBe(0);
  });

  it('Skip this session: the session goes, the pattern does not, the drop lands', () => {
    render(<App />);
    dragBody(cardFor('Team standup'), xAt(0) + 3, yAt(8));
    fireEvent.click(within(document.querySelector('.occmenu')).getByText(/Skip this session/).closest('.opt'));

    expect(document.querySelector('.occmenu')).toBeNull();
    const gyms = allCardsFor('Morning gym');
    expect(gyms.some((c) => columnOf(c) === 0)).toBe(false); // Monday's session skipped
    expect(timeOf(gyms.find((c) => columnOf(c) === 4))).toBe('08:00–09:00'); // Friday intact
    // The appointment took the slot.
    expect(timeOf(cardFor('Team standup'))).toBe('08:00–08:30');
    expect(columnOf(cardFor('Team standup'))).toBe(0);
  });

  it('Move this occurrence: the session relocates, the pattern does not, the drop lands', () => {
    render(<App />);
    dragBody(cardFor('Team standup'), xAt(0) + 3, yAt(8));

    const move = within(document.querySelector('.occmenu')).getByText(/Move this session/).closest('.opt');
    expect(move.disabled).toBe(false);
    expect(move.textContent).toMatch(/\d\d:\d\d/); // says where, before you agree
    fireEvent.click(move);

    expect(document.querySelector('.occmenu')).toBeNull();
    const gyms = allCardsFor('Morning gym');
    expect(gyms.length).toBe(2); // still two sessions — it moved, it didn't vanish
    expect(timeOf(gyms.find((c) => columnOf(c) === 4))).toBe('08:00–09:00'); // Friday intact
    // Monday's session is somewhere else now, not on top of the appointment.
    const monday = gyms.find((c) => columnOf(c) === 0);
    if (monday) expect(timeOf(monday)).not.toBe('08:00–09:00');
    expect(timeOf(cardFor('Team standup'))).toBe('08:00–08:30');
  });

  it('Esc cancels the drop and snaps the appointment back', () => {
    render(<App />);
    dragBody(cardFor('Team standup'), xAt(0) + 3, yAt(8));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.occmenu')).toBeNull();
    expect(timeOf(cardFor('Team standup'))).toBe('09:00–09:30');
    expect(allCardsFor('Morning gym').length).toBe(2);
    expect(timeOf(allCardsFor('Morning gym').find((c) => columnOf(c) === 0))).toBe('08:00–09:00');
  });
});

// ---------------------------------------------------------------- G
describe('G — overpack notice (§7.3)', () => {
  /** Three days of back-to-back work: avg break 0 ≤ minimum × 1.5. */
  const packed = () => bootWith((s) => {
    for (let d = 0; d < 3; d += 1) {
      s.addFixed({ title: `Block ${d}a`, startTime: at(d, 9), endTime: at(d, 11) });
      s.addFixed({ title: `Block ${d}b`, startTime: at(d, 11), endTime: at(d, 13) });
    }
  });

  const reoptimize = () => {
    fireEvent.click(screen.getByLabelText('Week menu'));
    fireEvent.click(screen.getByText(/Re-optimize week/));
  };

  it('fires only after a full re-optimize, and states the physics without a verdict', () => {
    packed();
    render(<App />);
    expect(document.querySelector('.overpack')).toBeNull(); // not on mere load

    reoptimize();
    const notice = document.querySelector('.overpack');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/packed/);
    expect(notice.textContent).toMatch(/compressed on 3 days/);
    // P-1: physics yes, morality no. No imperative, no verdict, no coral.
    expect(notice.textContent).not.toMatch(/!|should|too much|you /i);
    expect(notice.className).not.toMatch(/warn|danger/);
  });

  it('is non-modal and in flow — it overlays nothing', () => {
    packed();
    render(<App />);
    reoptimize();
    const notice = document.querySelector('.overpack');
    // Not on the z-scale at all: it is a line above the grid, not a layer.
    expect(notice.style.position).toBe('');
    expect(notice.style.zIndex).toBe('');
    // The grid is still fully usable underneath it.
    expect(cardFor('Block 0a')).toBeTruthy();
  });

  it('is dismissible, and one dismissal is final until the next re-optimize', () => {
    packed();
    render(<App />);
    reoptimize();
    fireEvent.click(screen.getByLabelText('Dismiss this notice'));
    expect(document.querySelector('.overpack')).toBeNull();

    // Navigating around must not resurrect it.
    fireEvent.click(screen.getByLabelText('Next week'));
    fireEvent.click(screen.getByText('Today'));
    expect(document.querySelector('.overpack')).toBeNull();

    reoptimize(); // a fresh full run may say it again
    expect(document.querySelector('.overpack')).toBeTruthy();
  });

  it('carries at most one suggestion, and it is the Protect action', () => {
    packed();
    render(<App />);
    reoptimize();
    const notice = document.querySelector('.overpack');
    expect(notice.querySelectorAll('.opl').length).toBe(1);

    fireEvent.click(within(notice).getByText(/Block some recovery time/));
    expect(document.querySelector('.overpack')).toBeNull();
    expect(cardFor('Recovery time')).toBeTruthy();
  });

  it('a comfortable week gets no notice at all', () => {
    render(<App />); // the seed week breathes
    reoptimize();
    expect(document.querySelector('.overpack')).toBeNull();
  });
});
