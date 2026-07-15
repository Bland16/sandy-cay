// DayView — single day, replaces the main area with its own ✕ back control
// (per the B+C layout: day view is a main-area mode, not the panel).
import { addDays, sameDay, hhmmToMinutes } from '../../core/index.js';
import { DAY_FULL, DAY_KEYS, MONTHS, hourLabel, gridBounds, gridDayOf } from '../format.js';
import { layoutDay } from '../layout.js';
import TaskCard from './TaskCard.jsx';
import Icon from '../Icon.jsx';

const PXH = 42;

export default function DayView({
  sched, weekStart, dayIndex, onBack, onOpenTask, onToggleComplete, interaction,
}) {
  const date = addDays(weekStart, dayIndex);
  // The grid day runs 05:00 → 05:00, so this column owns the small hours of the
  // NEXT calendar day. Pull both and keep what this grid-day actually holds.
  const tasks = [...sched.getTasksForDay(date), ...sched.getTasksForDay(addDays(date, 1))]
    .filter((t) => sameDay(gridDayOf(t.startTime), date));
  const { start, end } = gridBounds();
  const colHeight = (end - start) * PXH;
  const hours = [];
  for (let h = start; h < end; h += 1) hours.push(h);
  const laid = layoutDay(tasks, start, PXH);

  const bands = [];
  for (const z of sched.zones) {
    for (const w of z.windowsForDay(DAY_KEYS[dayIndex])) {
      const s = hhmmToMinutes(w.start) / 60;
      const e = hhmmToMinutes(w.end) / 60;
      bands.push({ key: `${z.id}-${w.start}`, label: z.label, top: (s - start) * PXH, height: (e - s) * PXH });
    }
  }

  return (
    <div className="dayview">
      <div className="dvhead">
        <button className="px" onClick={onBack} aria-label="Back to week"><Icon name="x" /></button>
        <div className="dvt">
          {DAY_FULL[dayIndex]}
          <small>{MONTHS[date.getMonth()]} {date.getDate()} · {date.getFullYear()}</small>
        </div>
      </div>
      <div className="dvgrid">
        <div className="axis" style={{ position: 'relative' }}>
          {hours.map((h) => <div className="h" key={h} style={{ height: PXH }}><span>{hourLabel(h)}</span></div>)}
        </div>
        <div
          className="dvcol"
          style={{ height: colHeight }}
          /* drop-geometry contract — see useCardInteraction.js */
          data-dropzone=""
          data-day-index={dayIndex}
          data-start-hour={start}
          data-end-hour={end}
          data-pxh={PXH}
        >
          {bands.map((b) => (
            <div className="zone" key={b.key} style={{ top: b.top, height: b.height }}><span className="tag">{b.label}</span></div>
          ))}
          {tasks.length === 0 && <div className="empty">Nothing scheduled. A clear shore.</div>}
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
      </div>
    </div>
  );
}
