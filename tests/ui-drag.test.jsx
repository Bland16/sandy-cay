// @vitest-environment jsdom
// M2.1 interaction tests — drag-to-move (A), border resize (B) and the
// ripple/displace chooser (C), driven through the real <App/> and the real
// engine. jsdom has no layout, so Element.getBoundingClientRect is stubbed from
// the same geometry contract the app publishes on its columns
// (data-dropzone / data-day-index / data-start-hour / data-pxh).
//
// Seed week (deterministic, see src/core/index.js seed()):
//   Mon  08:00 Morning gym (pinned recurrence occurrence) · 09:00 Team standup
//        10:00 + 12:30 Thesis chunks
//   Tue  08:00 Thesis · 12:00 Lunch with Priya · 18:00 Study for midterm
//   Wed  08:00 Read novel (flexible, unpinned)
//   Thu  14:00 Dentist (fixed)
//   Fri  08:00 Morning gym · 16:00 Weekly review (pinned) · 20:00 Movie night (rest)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { gridBounds } from '../src/ui/format.js';
import { seed } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

const COL_LEFT0 = 60;
const COL_W = 100;
const COL_TOP = 200;
const PXH = 34; // WeekGrid
// Follow the grid's own contract rather than duplicating a magic number — the
// day is 5am-anchored and 24h tall, and these tests should track it.
const { start: START_HOUR, end: END_HOUR } = gridBounds();
const COL_H = (END_HOUR - START_HOUR) * PXH;

/** Screen y of a minute-of-day in the week grid. */
const yAt = (h, m = 0) => COL_TOP + (h + m / 60 - START_HOUR) * PXH;
/** Screen x of the left edge of day column i (Mon = 0). */
const xAt = (dayIndex) => COL_LEFT0 + dayIndex * COL_W;

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
  toJSON() {},
});

// A fixed Wednesday. A fresh flexible's origin is "now", so proximity lands the
// seed's flexibles on now's own weekday: Mon col0, Tue col1, Wed col2. These
// tests hardcode Wed col2 (the seed also skips the gym on Wed, freeing its
// Wed morning). Run any other day and the flexible drifts a column, so the
// suite was red Thu-Sun. Freeze to a Wednesday and placement is deterministic
// every day; 09:00 clears the 5am-grid boundary and only Date is faked so
// testing-library's async timers survive. (The one test that sets its own clock
// below likewise uses 2026-07-15, a Wednesday.)
const FIXED_WEDNESDAY = new Date(2026, 6, 15, 9, 0, 0); // Wed 2026-07-15 09:00

let origRect;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_WEDNESDAY);
  // The app no longer ships demo data — it starts empty. These tests want the
  // seed week, so they hand it to the app the way a returning user would: via
  // persisted state.
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed(new Date()).toJSON()));
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
  vi.useRealTimers();
});

function pointer(type, clientX, clientY) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

/** Scoped to the grid: the drag ghost renders a second copy of the same card. */
const grid = () => document.querySelector('.grid') || document.querySelector('.dvgrid');
const cardFor = (title) => within(grid()).getByText(title).closest('.card');
const allCardsFor = (title) => within(grid()).getAllByText(title).map((n) => n.closest('.card'));
const columnOf = (el) => Number(el.closest('[data-dropzone]').dataset.dayIndex);
/** Cards under 44px are compact and hide .tm, so read the span off aria-label. */
const timeOf = (el) => el.getAttribute('aria-label').split(' · ')[1];

/** Drag a card's body so its top-left lands on (toX, toY). */
function dragBody(card, toX, toY) {
  const r = card.getBoundingClientRect();
  const gx = 20;
  const gy = 6;
  fireEvent(card, pointer('pointerdown', r.left + gx, r.top + gy));
  fireEvent(window, pointer('pointermove', r.left + gx + 20, r.top + gy + 20));
  fireEvent(window, pointer('pointermove', toX + gx, toY + gy));
  fireEvent(window, pointer('pointerup', toX + gx, toY + gy));
}

/** Drag a card's wave (start) or sand (end) strip to screen y `toY`. */
function dragStrip(card, edge, toY) {
  const strip = card.querySelector(edge === 'start' ? '.wave' : '.sand');
  const r = card.getBoundingClientRect();
  const y0 = edge === 'start' ? r.top + 2 : r.top + r.height - 2;
  fireEvent(strip, pointer('pointerdown', r.left + 30, y0));
  fireEvent(window, pointer('pointermove', r.left + 30, y0 + 20));
  fireEvent(window, pointer('pointermove', r.left + 30, toY));
  fireEvent(window, pointer('pointerup', r.left + 30, toY));
}

describe('A — drag to move', () => {
  it('drops onto empty time: 15-min snap + target day column, engine-applied', () => {
    render(<App />);
    const novel = cardFor('Read novel'); // Wed 08:00–09:00
    expect(columnOf(novel)).toBe(2);
    expect(timeOf(novel)).toBe('08:00–09:00');

    // Saturday (col 5), 10:08 → snaps up to 10:15.
    dragBody(novel, xAt(5) + 3, yAt(10, 8));

    const moved = cardFor('Read novel');
    expect(columnOf(moved)).toBe(5);
    expect(timeOf(moved)).toBe('10:15–11:15');
  });

  it('rejects a drop onto a pinned task: snap-back + §3.1 toast, nothing moved', () => {
    render(<App />);
    const dentist = cardFor('Dentist'); // Thu 14:00–15:00, fixed
    dragBody(dentist, xAt(4) + 3, yAt(16)); // onto Fri 16:00 "Weekly review" (pinned)

    expect(screen.getByRole('status').textContent).toBe('Conflicts with pinned: Weekly review');
    const after = cardFor('Dentist');
    expect(columnOf(after)).toBe(3); // still Thursday
    expect(timeOf(after)).toBe('14:00–15:00');
    expect(document.querySelector('.chooser')).toBeNull();
  });

  it('asks rather than rejects on a recurring occurrence (§4C), and Cancel moves nothing', () => {
    // M2.1 rejected this drop outright. §4C says that's too rigid: a recurring
    // session is a question, not a wall — sometimes the appointment legitimately
    // wins. Cancel is the path that still ends where the old rejection did.
    render(<App />);
    const standup = cardFor('Team standup'); // Mon 09:00
    dragBody(standup, xAt(0) + 3, yAt(8)); // onto Mon 08:00 "Morning gym"

    const menu = document.querySelector('.occmenu');
    expect(menu).toBeTruthy();
    expect(menu.textContent).toMatch(/Morning gym/);

    fireEvent.click(within(menu).getByText(/Cancel/).closest('.opt'));

    expect(document.querySelector('.occmenu')).toBeNull();
    expect(timeOf(cardFor('Team standup'))).toBe('09:00–09:30');
    expect(allCardsFor('Morning gym').length).toBe(2); // both occurrences intact
  });

  it('works in the day view too (same geometry contract, PXH 42)', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText('Wed')[0]); // day view is a main-area mode
    expect(screen.getByText(/Wednesday/)).toBeTruthy();

    const col = document.querySelector('.dvcol[data-dropzone]');
    expect(col.dataset.dayIndex).toBe('2');
    const dvPxh = Number(col.dataset.pxh);
    const dvY = (h) => COL_TOP + (h - Number(col.dataset.startHour)) * dvPxh;

    const novel = cardFor('Read novel');
    dragBody(novel, xAt(2) + 3, dvY(11));
    expect(timeOf(cardFor('Read novel'))).toBe('11:00–12:00');
  });

  it('Esc during the drag cancels it', () => {
    render(<App />);
    const novel = cardFor('Read novel');
    const r = novel.getBoundingClientRect();
    fireEvent(novel, pointer('pointerdown', r.left + 20, r.top + 6));
    fireEvent(window, pointer('pointermove', r.left + 60, r.top + 90));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent(window, pointer('pointerup', r.left + 60, r.top + 90));

    const after = cardFor('Read novel');
    expect(columnOf(after)).toBe(2);
    expect(timeOf(after)).toBe('08:00–09:00');
  });
});

describe('B — resize via the themed borders (OD-1)', () => {
  it('sand strip moves endTime, start anchored, snapped to 15', () => {
    render(<App />);
    dragStrip(cardFor('Read novel'), 'end', yAt(10, 8)); // → 10:15
    expect(timeOf(cardFor('Read novel'))).toBe('08:00–10:15');
  });

  it('wave strip moves startTime, end anchored', () => {
    render(<App />);
    dragStrip(cardFor('Dentist'), 'start', yAt(13, 22)); // snaps down to 13:15
    expect(timeOf(cardFor('Dentist'))).toBe('13:15–15:00');
  });

  it('holds the 15-min minimum duration — the borders cannot cross', () => {
    render(<App />);
    dragStrip(cardFor('Read novel'), 'end', yAt(6)); // far above the start
    expect(timeOf(cardFor('Read novel'))).toBe('08:00–08:15');
  });

  it('a recurring session running long extends THIS occurrence only (§4.4)', () => {
    // The gym is pinned + recurring (Mon/Wed/Fri 08:00–09:00, Wed skipped). It
    // ran long today — that's one session, not a new routine — so it writes a
    // per-occurrence exception and Friday's gym is untouched.
    render(<App />);
    const monBefore = allCardsFor('Morning gym').find((c) => columnOf(c) === 0);
    expect(timeOf(monBefore)).toBe('08:00–09:00');

    dragStrip(monBefore, 'end', yAt(9, 30));

    const after = allCardsFor('Morning gym');
    expect(timeOf(after.find((c) => columnOf(c) === 0))).toBe('08:00–09:30'); // today ran long
    expect(timeOf(after.find((c) => columnOf(c) === 4))).toBe('08:00–09:00'); // routine intact
  });

  it('an occurrence can be dragged within its own day — this session only', () => {
    render(<App />);
    const mon = allCardsFor('Morning gym').find((c) => columnOf(c) === 0);
    dragBody(mon, xAt(0), yAt(10)); // 08:00 → 10:00, same Monday

    const after = allCardsFor('Morning gym');
    const moved = after.find((c) => columnOf(c) === 0);
    expect(timeOf(moved)).toBe('10:00–11:00'); // today shifted
    expect(timeOf(after.find((c) => columnOf(c) === 4))).toBe('08:00–09:00'); // routine intact
  });

  it('skip today, do it tomorrow: an occurrence relocates to another day', () => {
    render(<App />);
    const mon = allCardsFor('Morning gym').find((c) => columnOf(c) === 0);
    dragBody(mon, xAt(3), yAt(14)); // Monday → Thursday 14:00

    const after = allCardsFor('Morning gym');
    expect(after.some((c) => columnOf(c) === 0)).toBe(false); // Monday freed up
    const moved = after.find((c) => columnOf(c) === 3);
    expect(moved).toBeTruthy();
    expect(timeOf(moved)).toBe('14:00–15:00'); // it happened Thursday
    expect(timeOf(after.find((c) => columnOf(c) === 4))).toBe('08:00–09:00'); // routine intact
  });

  it('resizing a post-midnight task keeps it post-midnight (F2 regression)', () => {
    // The grid is 5am-anchored: a 02:00 task lives at row 26 of the PREVIOUS
    // night's column. begin() used to record raw getHours()*60, i.e. 120, which
    // is 24h below the column's own coordinate space — the resize clamp then
    // collapsed and forced the start to 05:00, yielding a 22-hour task.
    render(<App />);
    dragBody(cardFor('Read novel'), xAt(2), yAt(26)); // → Wed column, 02:00
    expect(timeOf(cardFor('Read novel'))).toBe('02:00–03:00');

    dragStrip(cardFor('Read novel'), 'start', yAt(26, 30)); // pull the start to 02:30
    expect(timeOf(cardFor('Read novel'))).toBe('02:30–03:00'); // not 05:00–03:00
  });

  it('body drag is move, never resize', () => {
    render(<App />);
    const novel = cardFor('Read novel');
    dragBody(novel, xAt(2) + 3, yAt(13));
    // Duration preserved (a move), not stretched (a resize).
    expect(timeOf(cardFor('Read novel'))).toBe('13:00–14:00');
  });
});

describe('C — ripple ⟺ displace chooser (OD-8)', () => {
  it('a drop onto a flexible task opens the chooser with both options', () => {
    render(<App />);
    dragBody(cardFor('Dentist'), xAt(2) + 3, yAt(8)); // onto Wed 08:00 "Read novel"

    const chooser = document.querySelector('.chooser');
    expect(chooser).toBeTruthy();
    const opts = [...chooser.querySelectorAll('.opt')].map((b) => b.textContent);
    expect(opts[0]).toMatch(/Ripple day/);
    expect(opts[1]).toMatch(/Displace/);
    // Exactly one pre-highlighted default, and it holds focus so Enter commits it.
    const picked = chooser.querySelectorAll('.opt.pick');
    expect(picked.length).toBe(1);
    expect(document.activeElement).toBe(picked[0]);
  });

  it('Displace evicts the collided task via the engine — no overlap left', () => {
    render(<App />);
    dragBody(cardFor('Dentist'), xAt(2) + 3, yAt(8));
    fireEvent.click(screen.getByText(/Displace/).closest('.opt'));

    expect(document.querySelector('.chooser')).toBeNull();
    expect(timeOf(cardFor('Dentist'))).toBe('08:00–09:00');
    expect(columnOf(cardFor('Dentist'))).toBe(2);
    // Read novel was re-placed somewhere else — it no longer starts at 08:00.
    expect(timeOf(cardFor('Read novel'))).not.toBe('08:00–09:00');
    expect(screen.getByRole('status').textContent).toMatch(/Displaced/);
  });

  it('Esc cancels the whole operation and snaps the card back', () => {
    render(<App />);
    dragBody(cardFor('Dentist'), xAt(2) + 3, yAt(8));
    expect(document.querySelector('.chooser')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.chooser')).toBeNull();
    expect(columnOf(cardFor('Dentist'))).toBe(3); // back on Thursday
    expect(timeOf(cardFor('Dentist'))).toBe('14:00–15:00');
    expect(timeOf(cardFor('Read novel'))).toBe('08:00–09:00'); // untouched
  });

  it('a resize into a downstream task opens the chooser, and Ripple shifts the day', () => {
    render(<App />);
    // Team standup Mon 09:00–09:30 → drag the sand strip to 10:30, over the
    // 10:00 Thesis chunk.
    dragStrip(cardFor('Team standup'), 'end', yAt(10, 30));
    const chooser = document.querySelector('.chooser');
    expect(chooser).toBeTruthy();

    const ripple = screen.getByText(/Ripple day/).closest('.opt');
    expect(ripple.disabled).toBe(false);
    fireEvent.click(ripple);

    expect(document.querySelector('.chooser')).toBeNull();
    expect(timeOf(cardFor('Team standup'))).toBe('09:00–10:30');
    // The 10:00 Thesis chunk is no longer where it was.
    const thesis = allCardsFor('Thesis');
    const monday = thesis.filter((c) => columnOf(c) === 0).map(timeOf);
    expect(monday).not.toContain('10:00–12:00');
  });
});

describe('rating a session writes to that session, not the pattern (F5)', () => {
  it('rating Monday\'s gym does not rate Friday\'s, and the pattern stays clean', () => {
    render(<App />);
    // Open Monday's gym and give it 4 shells.
    const mon = allCardsFor('Morning gym').find((c) => columnOf(c) === 0);
    fireEvent.click(mon);
    const shells = document.querySelectorAll('.shells .sh');
    expect(shells.length).toBe(5);
    fireEvent.click(shells[3]); // 4 shells

    // Monday's panel remembers it…
    expect(document.querySelectorAll('.shells .sprite:not(.off)').length).toBe(4);

    // …but Friday's session is a different session and must be unrated.
    fireEvent.keyDown(document, { key: 'Escape' });
    const fri = allCardsFor('Morning gym').find((c) => columnOf(c) === 4);
    fireEvent.click(fri);
    expect(document.querySelectorAll('.shells .sprite:not(.off)').length).toBe(0);
  });
});
