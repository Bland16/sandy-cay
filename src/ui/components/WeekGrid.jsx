// WeekGrid — 7 day columns + time axis. Real tasks from getTasksForWeek,
// positioned by time; zones drawn as bands; day headers click into a day view.
import { useRef, useEffect } from 'react';
import { addDays, sameDay, hhmmToMinutes, dayStart, routineWaits } from '../../core/index.js';
import { DAY_NAMES, DAY_KEYS, hourLabel, gridBounds, windowForDay } from '../format.js';
import { columnItems, layoutDay, layoutRemainders } from '../layout.js';
import TaskCard from './TaskCard.jsx';
import { DayNoteBar } from './DayNotes.jsx';
import Icon from '../Icon.jsx';

const PXH = 34;
const WAKE_HOUR = 7; // the grid opens just before the working window, not at 5am

/** Hours outside the day's auto-placement window: shaded, still droppable. */
function offWindowBands(config, dayKey, startHour, endHour) {
  const win = windowForDay(config, dayKey);
  const ws = hhmmToMinutes(win.start) / 60;
  const we = hhmmToMinutes(win.end) / 60;
  const bands = [];
  if (ws > startHour) bands.push({ key: 'pre', top: 0, height: (ws - startHour) * PXH });
  if (we < endHour) bands.push({ key: 'post', top: (we - startHour) * PXH, height: (endHour - we) * PXH });
  return bands;
}

/**
 * Zone bands for one day column.
 *
 * `date` is not optional bookkeeping: a zone can be bounded (a summer job, a
 * term) via effectiveFrom/effectiveUntil, and this used to take no date at all —
 * so it painted every zone into every week, past and future, however narrow the
 * zone's actual run. The engine has always honoured the bounds when PLACING
 * (placement.js checks `activeOn`), which made it worse than cosmetic: the grid
 * showed reserved time in weeks where the scheduler correctly saw none.
 */
function zoneBands(zones, dayKey, startHour, date) {
  const bands = [];
  for (const z of zones) {
    if (date && !z.activeOn(date)) continue;
    for (const w of z.windowsForDay(dayKey)) {
      const s = hhmmToMinutes(w.start) / 60;
      const e = hhmmToMinutes(w.end) / 60;
      bands.push({
        key: `${z.id}-${w.day}-${w.start}`,
        label: z.label,
        top: (s - startHour) * PXH,
        height: (e - s) * PXH,
      });
    }
  }
  return bands;
}

/**
 * A routine's WAITS as bands on one day column (ROUTINES §UI: "passive waits
 * optionally show as a non-blocking tinted band").
 *
 * ⚠️ NON-BLOCKING is the whole point. A wait consumes no capacity and reserves
 * nothing — it is ordinary open time, and you may drop work straight into it.
 * The band exists so you can SEE "washing 08:02-08:47" rather than a mysterious
 * hole between two two-minute cards. `pointer-events: none` in the CSS is what
 * keeps it out of the way of the drop it must not intercept.
 *
 * The intervals come from `routineWaits` in core, DERIVED from the touchpoints
 * actually on the grid — so the band cannot claim a wait the grid does not have,
 * and it follows a dragged touchpoint for free.
 */
function waitBands(waits, date, startHour) {
  const dayFrom = dayStart(date);
  const dayTo = addDays(dayFrom, 1);
  return waits
    .filter((w) => w.to > dayFrom && w.from < dayTo)
    .map((w, i) => {
      // Clipped to the column, so a wait that runs past midnight draws to the
      // day's edge rather than off the end of it.
      const s = Math.max(w.from.getTime(), dayFrom.getTime());
      const e = Math.min(w.to.getTime(), dayTo.getTime());
      const sh = (s - dayFrom.getTime()) / 3600000;
      const eh = (e - dayFrom.getTime()) / 3600000;
      return {
        key: `${w.routineId}-${i}`,
        label: w.label,
        overrun: w.overrun,
        top: (sh - startHour) * PXH,
        height: Math.max(4, (eh - sh) * PXH),
      };
    });
}

/**
 * The week grid, or any slice of it.
 *
 * `days` is which day indices to render (0=Mon … 6=Sun), defaulting to all
 * seven. The tablet layout (SPEC §11) draws Mon–Fri here and Sat–Sun in the
 * weekend drawer — two instances of THIS component, not a second grid
 * implementation. A day column carries a drop-geometry contract
 * (`data-dropzone`/`data-day-index`/…) that `useCardInteraction` reads at
 * pointer-down; a reimplementation would silently drift out of that contract and
 * drags into the weekend would land on the wrong day.
 */
export default function WeekGrid({
  sched, weekStart, today, onOpenTask, onToggleComplete, onOpenDay, onDayMenu, onOpenNotes,
  notesDay = null, interaction, truncations, notice,
  days = [0, 1, 2, 3, 4, 5, 6], compactHeads = false,
}) {
  // ⚠️ The grid day is 5am-anchored (sharp edge #5), so the WEEK it draws runs
  // Mon 05:00 → next Mon 05:00 — which is NOT the calendar week
  // `getTasksForWeek` selects. The two disagree for the 00:00–05:00 band, and a
  // session in it fell straight through the crack: a Monday 04:15 belongs to the
  // PREVIOUS Sunday's column, which is not among this week's days, while the
  // previous week's own calendar-based selection never contained it either. It
  // rendered nowhere at all — not on Sunday, not on Monday, nowhere.
  //
  // So take the next week too and let the grid-day filter below place them. The
  // day view already works exactly this way (it pulls `date` and `date + 1` and
  // keeps what the grid-day owns); this is the week-shaped version of the same
  // correction. Nothing double-counts: a task belongs to one calendar week, and
  // `gridDayOf` then puts it in exactly one column.
  const weekTasks = sched.getTasksForWeek(weekStart)
    .concat(sched.getTasksForWeek(addDays(weekStart, 7)));
  const { start, end } = gridBounds();
  const colHeight = (end - start) * PXH;
  const hours = [];
  for (let h = start; h < end; h += 1) hours.push(h);

  // A 24h grid opens on the working day rather than on 3am. Mount-only, so it
  // never fights the user's scroll.
  const wrapRef = useRef(null);
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = (WAKE_HOUR - start) * PXH;
  }, [start]);

  return (
    <>
      {/* §7.3's one grid-side notice. In flow, above the grid: non-modal by
          construction rather than by z-index, so it cannot overlap anything. */}
      {notice}
      <div className="gridwrap" ref={wrapRef}>
      {/* The column count drives the template, so a five-day grid isn't a
          seven-day grid with two columns hidden — the remaining days share the
          full width instead of leaving a gap where the weekend was. */}
      <div className="grid" style={{ '--cols': days.length }}>
        <div className="axis-head" />
        {days.map((i) => {
          const dn = DAY_NAMES[i];
          const date = addDays(weekStart, i);
          const isToday = today && sameDay(date, today);
          return (
            /* Two controls, so two buttons — a ⋯ nested inside the open-day
               button would be invalid HTML and unreachable by keyboard. */
            <div key={dn} className={`dayhead${i >= 5 ? ' wknd' : ''}${isToday ? ' today' : ''}${compactHeads ? ' compact' : ''}`}>
              <button className="dhopen" onClick={() => onOpenDay(i)}>
                <div className="dn">{dn}</div>
                <div className="dd">{date.getDate()}</div>
                <div className="open">open ↓</div>
              </button>
              {/* A SIBLING of .dhopen, never a child — same reason as the ⋯
                  above: a button inside a button is invalid HTML and
                  unreachable by keyboard. Full-bleed along the header's bottom
                  edge, so neighbouring days' bars touch and a multi-day note
                  reads as one run (DAY-NOTES §4, treatment C). */}
              {onOpenNotes && (
                <DayNoteBar
                  sched={sched}
                  date={date}
                  dayIndex={i}
                  onOpenNotes={onOpenNotes}
                  selected={notesDay === i}
                />
              )}
              {onDayMenu && (
                <button
                  className="dhdots"
                  title={`${dn} menu`}
                  aria-label={`${dn} ${date.getDate()} menu`}
                  onClick={(e) => onDayMenu(i, e.currentTarget.getBoundingClientRect())}
                >
                  <Icon name="dots" />
                </button>
              )}
            </div>
          );
        })}

        <div className="axis" style={{ position: 'relative' }}>
          {hours.map((h) => (
            <div className="h" key={h} style={{ height: PXH }}><span>{hourLabel(h)}</span></div>
          ))}
        </div>

        {days.map((i) => {
          const dn = DAY_NAMES[i];
          const date = addDays(weekStart, i);
          // Grid-day, not calendar-day: a 02:00 task belongs to the night
          // before, and a 04:15–06:15 one is CUT across two columns.
          const bands = zoneBands(sched.zones, DAY_KEYS[i], start, date);
          const waits = waitBands(routineWaits(sched), date, start);
          const laid = layoutDay(columnItems(weekTasks, date, start), start, PXH);
          return (
            <div
              /* The tint IS the statement that the scheduler stays out (D-6) —
                 it replaced a full-height card that said the same thing and
                 also, wrongly, refused your own hand. `isDayBlocked` lives on
                 the engine so this and `computeWindows` can never disagree;
                 `zoneBands` is the cautionary tale (sharp edge #14). */
              className={`day${i >= 5 ? ' wknd' : ''}${sched.isDayBlocked(date) ? ' blocked' : ''}`}
              key={dn}
              style={{ height: colHeight }}
              /* drop-geometry contract — see useCardInteraction.js */
              data-dropzone=""
              data-day-index={i}
              data-start-hour={start}
              data-end-hour={end}
              data-pxh={PXH}
            >
              {offWindowBands(sched.config, DAY_KEYS[i], start, end).map((b) => (
                <div className="offwindow" key={b.key} style={{ top: b.top, height: b.height }} aria-hidden="true" />
              ))}
              {waits.map((b) => (
                /* Drawn BEFORE the cards and behind them, and inert to the
                   pointer — a band that ate a drop would be a reservation, and
                   a wait reserves nothing. */
                <div
                  className={b.overrun ? 'waitband over' : 'waitband'}
                  key={b.key}
                  style={{ top: b.top, height: b.height }}
                  aria-hidden="true"
                >
                  <span className="tag">{b.label}</span>
                </div>
              ))}
              {bands.map((b) => (
                <div className="zone" key={b.key} style={{ top: b.top, height: b.height }}>
                  <span className="tag">{b.label}</span>
                </div>
              ))}
              {layoutRemainders(laid, truncations, start, PXH).map((r) => (
                <div
                  className="remainder"
                  key={r.key}
                  style={r.style}
                  aria-hidden="true"
                  title={`${r.title} — finished early, this time is free`}
                />
              ))}
              {laid.map(({ task, style, compact, key, continued, continues }) => (
                <TaskCard
                  key={key}
                  task={task}
                  tint={sched.tintForTask(task)}
                  style={style}
                  compact={compact}
                  continued={continued}
                  continues={continues}
                  onOpen={onOpenTask}
                  onToggleComplete={onToggleComplete}
                  dragging={interaction ? interaction.hiddenId === task.id : false}
                  pressing={interaction ? interaction.pressingId === task.id : false}
                  /* ⚠️ The TAIL is not draggable. Drag geometry reads a card's
                     top as the task's start, which is false for a continuation
                     — dragging it would rewrite the time to whatever the tail
                     was pointing at. Open it and edit, or drag the head. */
                  onMoveStart={interaction && !continued ? interaction.onMoveStart : undefined}
                  onResizeStart={interaction && !continued ? interaction.onResizeStart : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </>
  );
}
