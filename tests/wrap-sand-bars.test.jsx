// @vitest-environment jsdom
// The sand bars (§7.1) — scheduled hours per day, against each day's own window.
//
// The docblock over `SandBars` always claimed "scheduled-vs-capacity, which is
// physics", and the code divided by `peak`, the week's busiest day. So the
// fullest day was 100% tall in EVERY week ever printed, a 3-hour week and a
// 60-hour week drew the identical picture, and no two weeks could be compared —
// in the one chart on the sheet whose whole job is comparison. `getWeekLoad`
// computes `capacityMin` per day and it was thrown away.
//
// These lock the fix, and the two ways it can go wrong.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import App from '../src/App.jsx';
import { Schedule, Task, defaultConfig, weekStart as weekStartOf, addDays } from '../src/core/index.js';
import { STORAGE_KEY } from '../src/ui/useEngine.js';

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: !/max-width/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.innerWidth = 1440;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const ws = () => weekStartOf(new Date());
const at = (o, h, m = 0) => { const d = addDays(ws(), o); d.setHours(h, m, 0, 0); return d; };

const persist = (s) => {
  window.localStorage.setItem('sandycay.session', 'guest');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s.toJSON()));
};

const openReport = () => {
  fireEvent.click(screen.getByLabelText(/week menu/i));
  fireEvent.click(screen.getByText(/wrap report/i));
};

const pct = (el, prop) => parseFloat((el.style[prop] || '0').replace('%', ''));
const bars = () => [...document.querySelectorAll('.rp-bar')];

describe('§7.1 sand bars — measured against the day, not against the week', () => {
  it('does NOT draw the busiest day at full height just for being busiest', () => {
    // Two hours on a Monday whose window is fifteen. Under the old `peak`
    // normalisation this bar was 100% tall — the entire defect, in one number.
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'A short week', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    const fill = bars()[0].querySelector('.rp-bar-fill');
    const h = pct(fill, 'height');
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(30); // 2h of a 15h window — a light day, drawn light
  });

  it('draws each day against its OWN window, so Sunday differs from a weekday', () => {
    // Stock config opens Mon–Sat at 08:00 and Sunday at 10:00, so the same two
    // hours fill more of a Sunday. If the marker were a week-wide constant the
    // two would sit at the same height.
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'Mon', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    s.tasks.push(new Task({
      title: 'Sun', type: 'fixed', startTime: at(6, 11), endTime: at(6, 13),
    }));
    persist(s);

    render(<App />);
    openReport();

    const monCap = bars()[0].querySelector('.rp-bar-cap');
    const sunCap = bars()[6].querySelector('.rp-bar-cap');
    expect(monCap).toBeTruthy();
    expect(sunCap).toBeTruthy();
    // Sunday's window is shorter, so its ceiling sits lower on a shared axis.
    expect(pct(sunCap, 'bottom')).toBeLessThan(pct(monCap, 'bottom'));
  });

  it('lets an over-full day overshoot its ceiling rather than clipping at it', () => {
    // Over-full days are physics, not a failing (P-1) — the axis grows to fit
    // them. Clipping the bar at the line would report a lie as a tidy chart.
    const s = new Schedule({ config: defaultConfig });
    for (let h = 8; h < 23; h += 1) {
      s.tasks.push(new Task({
        title: `Block ${h}`, type: 'fixed', startTime: at(1, h), endTime: at(1, h + 1),
      }));
    }
    persist(s);

    render(<App />);
    openReport();

    const bar = bars()[1];
    const fill = bar.querySelector('.rp-bar-fill');
    const cap = bar.querySelector('.rp-bar-cap');
    expect(cap).toBeTruthy();
    // The fill reaches at least the ceiling; nothing is truncated below it.
    expect(pct(fill, 'height')).toBeGreaterThanOrEqual(pct(cap, 'bottom') - 1);
  });

  it('draws NO ceiling on a day the user blocked', () => {
    // A blocked day has no window to be measured against. Drawing a full-height
    // reference line over an empty bar reads as "you had all this and used
    // none" — manufacturing a shortfall out of the user's own decision.
    const s = new Schedule({ config: defaultConfig });
    s.blockDay(addDays(ws(), 3));
    s.tasks.push(new Task({
      title: 'Elsewhere', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    expect(bars()[3].querySelector('.rp-bar-cap')).toBeNull();
    expect(bars()[0].querySelector('.rp-bar-cap')).toBeTruthy();
  });

  it('says in words what the dashed line means, for a reader who cannot see it', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({
      title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 11),
    }));
    persist(s);

    render(<App />);
    openReport();

    const label = document.querySelector('.rp-chart').getAttribute('aria-label');
    expect(label).toMatch(/window/i);
  });
});

// SPEC.md §7.1 names five Statistics items: getWeekLoad, getTagBreakdown,
// satisfaction by tag×time, break compression, and planned-vs-actual. The
// pruning pass of 2026-09-02 rendered two and left the other three builders
// running into a view model nothing read. These hold the restored ones on the
// page, because "nothing failed when they were cut" is exactly why they were.
describe('§7.1 — the Statistics the spec names are actually rendered', () => {
  const rated = (s, title, offset, hour, overall) => {
    const t = s.addFixed({
      title, tags: ['study'], startTime: at(offset, hour), endTime: at(offset, hour + 1),
    });
    t.completion = 'done';
    t.satisfaction = { overall };
    return t;
  };

  it('break compression is on the sheet, and blames the packer not the reader', () => {
    const s = new Schedule({ config: defaultConfig });
    // Two sessions with a gap between them — one gap is all it takes to measure.
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    s.tasks.push(new Task({ title: 'B', type: 'fixed', startTime: at(0, 12), endTime: at(0, 13) }));
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByText(/breathing room/i)).toBeTruthy();
    expect(screen.getByText(/average gap between sessions/i)).toBeTruthy();
    // The best P-1 line in the file: compression is the packer's doing.
    expect(screen.getByText(/what the packer left you/i)).toBeTruthy();
  });

  it('tag × time-of-day is on the sheet, and every cell shows what it rests on', () => {
    const s = new Schedule({ config: defaultConfig });
    rated(s, 'One rating', 0, 9, 5);
    rated(s, 'Another', 1, 19, 2);
    rated(s, 'And another', 2, 19, 4);
    persist(s);

    render(<App />);
    openReport();

    expect(screen.getByText(/how things felt, by time of day/i)).toBeTruthy();
    const matrix = document.querySelector('.rp-matrix');
    expect(matrix).toBeTruthy();
    // ⚠️ THE COUNTS ARE THE POINT. A 5.0 from one rating and a 5.0 from six
    // looked identical, which is what actually made the grid a scorecard.
    expect(matrix.textContent).toMatch(/·\d/);
    expect(screen.getByText(/how many ratings it rests on/i)).toBeTruthy();
  });

  it('says nothing about gaps on a week with no back-to-back sessions', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'Only one', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    // getBreakCompression returns null rather than 0 for a one-task day,
    // "because 'you took no breaks' would be a lie" — the section is absent.
    expect(screen.queryByText(/breathing room/i)).toBeNull();
  });
});

describe('§7.1 — the printed sheet keeps its exits (P-1)', () => {
  it('prints the suggestion choices as text, not just as buttons', () => {
    const s = new Schedule({ config: defaultConfig });
    s.tasks.push(new Task({ title: 'A', type: 'fixed', startTime: at(0, 9), endTime: at(0, 10) }));
    persist(s);

    render(<App />);
    openReport();

    // The buttons are hidden in the print block — a printed button lies about
    // being pressable. If a card offers actions, the same choices must survive
    // on paper, or the PDF keeps the diagnostic and drops the graceful exit.
    for (const card of document.querySelectorAll('.rp-sugg')) {
      if (!card.querySelector('.rp-sugg-actions')) continue;
      const onPaper = card.querySelector('.rp-sugg-onpaper');
      expect(onPaper).toBeTruthy();
      expect(onPaper.textContent.trim().length).toBeGreaterThan(0);
    }
  });
});
