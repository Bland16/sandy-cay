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

function zoneBands(zones, dayKey, startHour) {
  const bands = [];
  for (const z of zones) {
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

export default function WeekGrid({
  sched, weekStart, today, onOpenTask, onToggleComplete, onOpenDay, onDayMenu,
  interaction, truncations, notice,
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
      <div className="grid">
        <div className="axis-head" />
        {DAY_NAMES.map((dn, i) => {
          const date = addDays(weekStart, i);
          const isToday = today && sameDay(date, today);
          return (
            /* Two controls, so two buttons — a ⋯ nested inside the open-day
               button would be invalid HTML and unreachable by keyboard. */
            <div key={dn} className={`dayhead${i >= 5 ? ' wknd' : ''}${isToday ? ' today' : ''}`}>
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

        {DAY_NAMES.map((dn, i) => {
          const date = addDays(weekStart, i);
          // Grid-day, not calendar-day: a 02:00 task belongs to the night before.
          const dayTasks = weekTasks.filter((t) => sameDay(gridDayOf(t.startTime), date));
          const bands = zoneBands(sched.zones, DAY_KEYS[i], start);
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
                  style={style}
                  compact={compact}
                  onOpen={onOpenTask}
                  onToggleComplete={onToggleComplete}
                  dragging={interaction ? interaction.hiddenId === task.id : false}
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
