// DayNotes — the day's notes, drawn on the day (design/DAY-NOTES.md §4).
//
// ⚠️ D-5's rule is the reason this file exists at all: ONE `notesForDate` call
// site, rendered by ONE component, dropped into each surface. Three surfaces
// draw a day header — the week grid, the day view, and the weekend drawer's own
// <WeekGrid> — and this codebase has twice proved that a third copy of a
// day-walk drifts from the other two: `zoneBands` had to be added to WeekGrid
// and DayView separately and painted zones into weeks the zone did not run
// (sharp edge #14), and SPEC §4.3's window-row exists twice and has already
// diverged. So no surface may filter `sched.dayNotes` itself.
//
// A note NEVER tints the day, and is never coral. It is a FACT about the day,
// not a scheduling problem, and P-1 reserves colour for physics. A tint means
// BLOCKED, which is a genuinely different state (D-1, D-6) and a different item
// of work.
//
// Multi-day notes come out right for free: `notesForDate` asks each note whether
// it COVERS the date, so Thanksgiving 25–27 Nov draws on all three days rather
// than as a mark on the 25th.

import { MONTHS } from '../format.js';
import { dateFromKey } from '../../core/index.js';
import Icon from '../Icon.jsx';

/** The one place the UI asks which notes cover a day. Nothing else may ask. */
function notesFor(sched, date) {
  return sched.notesForDate(date);
}

/**
 * "26 Nov" · "23–27 Nov" · "25 Nov – 2 Dec" · "every year".
 *
 * Ranges read INCLUSIVE because that is what a day note's `to` means — "spring
 * break 9–13 Mar" covers the 13th (sharp edge #11: the engine's interiors are
 * half-open and the edges convert; a note is an edge).
 */
export function rangeLabel(note) {
  if (note.recurrence) {
    const freq = note.recurrence.periods?.[0]?.freq;
    if (freq === 'yearly') return 'every year';
    if (freq === 'monthly') return 'every month';
    if (freq === 'daily') return 'every day';
    return 'every week'; // absent freq means weekly, as it does for a task
  }
  const from = dateFromKey(note.from);
  const to = dateFromKey(note.to);
  const full = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (note.from === note.to) return full(from);
  if (from.getMonth() === to.getMonth()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS[to.getMonth()]}`;
  }
  return `${full(from)} – ${full(to)}`;
}

/**
 * The header line (§4). Compact by necessity — a day column is ~74px wide on the
 * phone's week overview — so: the first label, truncated by CSS, and a count
 * when there are several ("Thanksgiving +1"). The full set is in the `title` and
 * in the day view's list.
 *
 * Renders NOTHING on a clear day, so an ordinary day header keeps exactly the
 * shape it has always had.
 */
export function DayNoteLine({ sched, date }) {
  const notes = notesFor(sched, date);
  if (notes.length === 0) return null;
  const [first, ...rest] = notes;
  return (
    <div className={`dnline ${first.kind}`} title={notes.map((n) => n.label).join(' · ')}>
      <Icon name="pennant" size={9} />
      <span className="dnlabel">{first.label}</span>
      {rest.length > 0 && <span className="dnmore">+{rest.length}</span>}
    </div>
  );
}

/**
 * The day view's full list — §4's "click the header to see them all": each note,
 * its range, and where it came from.
 *
 * "Block this day" is deliberately absent. Blocking is a MODEL change (D-6: a
 * `blockedDays` collection subtracted in `computeWindows`), not a rendering one,
 * and it is its own piece of work.
 */
export function DayNoteList({ sched, date }) {
  const notes = notesFor(sched, date);
  if (notes.length === 0) return null;
  return (
    <ul className="dnlist" aria-label="Notes on this day">
      {notes.map((n) => (
        <li key={n.id} className={`dnitem ${n.kind}`}>
          <Icon name="pennant" size={11} />
          <span className="dnlabel">{n.label}</span>
          <span className="dnmeta">{rangeLabel(n)}{n.source ? ` · ${n.source}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}
