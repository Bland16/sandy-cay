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
// TREATMENT C, chosen by eye 2026-08-13 from design/day-header-mockups.html: a
// tinted bar, full-bleed along the bottom edge of the day header. The bleed is
// the point rather than decoration — adjacent days' bars touch, so a multi-day
// note reads as ONE RUN across the week without any span machinery, which is
// what §4 asks for ("a band across the week rather than a mark on its first
// day"). It also cannot stack: a day with five notes shows one label and "+4"
// and stays exactly as tall as a quiet day.
//
// The bar is a BUTTON, and it opens the day's notes in the right panel
// (design/day-note-panel-mockups.html). That is what keeps the bar honest: it
// only ever has to say HOW MANY, because the panel says WHAT.
//
// Tinting the BAR is the allowed half of D-1, not a reversal of it. D-1 refuses
// a tint on the COLUMN — that is reserved for a real scheduling state — but
// keeps tags available for tinting "its own chip", and the bar is the note's
// chip. Nothing here is coral: a holiday is a fact, not a scheduling problem.
//
// Multi-day notes come out right for free, because `notesForDate` asks each note
// whether it COVERS the date: Thanksgiving 25–27 Nov draws on all three days.

import { useState } from 'react';
import { MONTHS } from '../format.js';
import { dateFromKey } from '../../core/index.js';
import PanelHeader from './PanelHeader.jsx';
import Icon from '../Icon.jsx';

/** The one place the UI asks which notes cover a day. Nothing else may ask. */
function notesFor(sched, date) {
  return sched.notesForDate(date);
}

/**
 * The panel-mode string, and its reader. Both live here so `App` (which writes
 * the mode) and `RightPanel` (which reads it) cannot drift apart — a literal
 * `'day-notes:'` typed in two files is a silent no-panel bug the moment one of
 * them is edited.
 */
export const DAY_NOTES_MODE = 'day-notes:';
export function dayNotesIndex(selection) {
  if (typeof selection !== 'string' || !selection.startsWith(DAY_NOTES_MODE)) return null;
  const i = Number(selection.slice(DAY_NOTES_MODE.length));
  return Number.isInteger(i) && i >= 0 && i <= 6 ? i : null;
}

/**
 * Which note gives the bar its name and its tint. A holiday wins, because it is
 * the one a glance most needs to catch; otherwise the first note on the day.
 */
function leadNote(notes) {
  return notes.find((n) => n.kind === 'holiday') || notes[0];
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
 * The header bar (§4, treatment C). The first label, truncated by CSS, and a
 * count when there are several — never a second row.
 *
 * Renders NOTHING on a clear day, so an ordinary day header keeps exactly the
 * shape it has always had.
 *
 * ⚠️ It must be a SIBLING of `.dhopen`, never a child: a button nested inside
 * the open-day button would be invalid HTML and unreachable by keyboard, which
 * is the same reason `.dhdots` is a sibling rather than a nested control.
 */
export function DayNoteBar({ sched, date, dayIndex, onOpenNotes, selected = false }) {
  const notes = notesFor(sched, date);
  if (notes.length === 0) return null;
  const lead = leadNote(notes);
  const more = notes.length - 1;
  const all = notes.map((n) => n.label).join(' · ');
  return (
    <button
      type="button"
      className={`dnline ${lead.kind}${selected ? ' sel' : ''}`}
      title={all}
      aria-label={`${notes.length} note${notes.length === 1 ? '' : 's'} on this day: ${all}`}
      onClick={(e) => { e.stopPropagation(); onOpenNotes(dayIndex); }}
    >
      <span className="dnlabel">{lead.label}</span>
      {more > 0 && <span className="dnmore">+{more}</span>}
    </button>
  );
}

/**
 * The day view's full list — §4's "click the header to see them all". The day
 * view has the room, so it states them outright instead of making you open a
 * panel to read what is already on screen.
 */
export function DayNoteList({ sched, date }) {
  const notes = notesFor(sched, date);
  if (notes.length === 0) return null;
  return (
    <ul className="dnlist" aria-label="Notes on this day">
      {notes.map((n) => (
        <li key={n.id} className={`dnitem ${n.kind}`}>
          <span className="dnswatch" aria-hidden="true" />
          <span className="dnlabel">{n.label}</span>
          <span className="dnmeta">{rangeLabel(n)}{n.source ? ` · ${n.source}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The right panel behind the bar: each note, its range, where it came from —
 * and the one action §3 always specified.
 *
 * "Block this day" is here because the FACT and the DECISION are deliberately
 * one click apart. A holiday does not decide for you that you aren't working —
 * plenty of people study on Thanksgiving — so the note states the day and you
 * choose what it means. It could only be built once `blockedDays` existed
 * (D-6); before that there was nothing honest for the button to do.
 */
export function DayNotesPanel({ sched, date, dayName, onClose, onToggleBlock, onClearDay, onAddNote }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const notes = notesFor(sched, date);
  const blocked = sched.isDayBlocked(date);
  const dayTasks = sched.getTasksForDay(date);
  const sub = [
    `${dayTasks.length} thing${dayTasks.length === 1 ? '' : 's'}`,
    notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : null,
    blocked ? 'blocked' : null,
  ].filter(Boolean).join(' · ');
  return (
    <>
      <PanelHeader
        title={`${dayName} ${date.getDate()}`}
        sub={sub}
        onClose={onClose}
        action={onAddNote ? (
          <button
            type="button"
            className="dnadd"
            aria-label={`Add a note on ${dayName} ${date.getDate()}`}
            title="Add a note on this day"
            onClick={() => setAdding((v) => !v)}
          >
            <Icon name="plus" />
          </button>
        ) : null}
      />
      {adding && (
        <form
          className="dnnew"
          onSubmit={(e) => {
            e.preventDefault();
            const text = label.trim();
            if (!text) return;          // a blank adds nothing — §8.3's rule
            onAddNote(text);
            setLabel('');
            setAdding(false);
          }}
        >
          <input
            className="input"
            autoFocus
            value={label}
            aria-label="Note label"
            placeholder="Reading week, Mum visiting…"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }}
          />
          <button type="submit" className="dnblock">Add</button>
        </form>
      )}
      {notes.length === 0
        ? null
        : (
          <ul className="dnpanel" aria-label="Notes on this day">
            {notes.map((n) => (
              <li key={n.id} className={`dnrow ${n.kind}`}>
                <span className="dnswatch" aria-hidden="true" />
                <span className="dntxt">
                  <span className="dnlabel">{n.label}</span>
                  <span className="dnmeta">{rangeLabel(n)}{n.source ? ` · ${n.source}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      {(onToggleBlock || onClearDay) && (
        <div className="dnact">
          {/* The day's two actions, together, and deliberately NOT alike:
              blocking is non-destructive (the scheduler stays off, nothing
              moves) while clearing evacuates what is already there. Clear is
              the secondary treatment for that reason, and it opens the Clear
              Day panel rather than acting on the spot — OD-7 requires a scope
              choice and a row per anchor, and this is a way in, not a shortcut
              past it. */}
          {onToggleBlock && (
            <button type="button" className="dnblock" onClick={() => onToggleBlock(date)}>
              {blocked ? 'Unblock this day' : 'Block this day'}
            </button>
          )}
          {onClearDay && (
            <button
              type="button"
              className="dnclear"
              onClick={(e) => onClearDay(e.currentTarget.getBoundingClientRect())}
            >
              Clear this day…
            </button>
          )}
          <p className="dnhint">
            {blocked
              ? 'Nothing is scheduled here automatically. You can still put things here yourself.'
              : 'Blocking keeps the scheduler off this day; you could still put things here yourself.'}
          </p>
        </div>
      )}
    </>
  );
}
