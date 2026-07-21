// WeekGrid — 7 day columns + time axis. Real tasks from getTasksForWeek,
// positioned by time; zones drawn as bands; day headers click into a day view.
import { useRef, useEffect } from 'react';
import { addDays, sameDay, hhmmToMinutes } from '../../core/index.js';
import { DAY_NAMES, DAY_KEYS, hourLabel, gridBounds, windowForDay, gridDayOf } from '../format.js';
import { layoutDay, layoutRemainders } from '../layout.js';
import TaskCard from './TaskCard.jsx';
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
  sched, weekStart, today, onOpenTask, onToggleComplete, onOpenDay, onDayMenu,
  interaction, truncations, notice, days = [0, 1, 2, 3, 4, 5, 6], compactHeads = false,
}) {
  const weekTasks = sched.getTasksForWeek(weekStart);
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
          // Grid-day, not calendar-day: a 02:00 task belongs to the night before.
          const dayTasks = weekTasks.filter((t) => sameDay(gridDayOf(t.startTime), date));
          const bands = zoneBands(sched.zones, DAY_KEYS[i], start, date);
          const laid = layoutDay(dayTasks, start, PXH);
          return (
            <div
              className={`day${i >= 5 ? ' wknd' : ''}`}
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
              {laid.map(({ task, style, compact }) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  tint={sched.tintForTask(task)}
                  style={style}
                  compact={compact}
                  onOpen={onOpenTask}
                  onToggleComplete={onToggleComplete}
                  dragging={interaction ? interaction.hiddenId === task.id : false}
                  pressing={interaction ? interaction.pressingId === task.id : false}
                  onMoveStart={interaction ? interaction.onMoveStart : undefined}
                  onResizeStart={interaction ? interaction.onResizeStart : undefined}
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
