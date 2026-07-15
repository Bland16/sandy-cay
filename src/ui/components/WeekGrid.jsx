// WeekGrid — 7 day columns + time axis. Real tasks from getTasksForWeek,
// positioned by time; zones drawn as bands; day headers click into a day view.
import { addDays, sameDay, hhmmToMinutes } from '../../core/index.js';
import { DAY_NAMES, DAY_KEYS, hourLabel, gridBounds } from '../format.js';
import { layoutDay } from '../layout.js';
import TaskCard from './TaskCard.jsx';

const PXH = 34;

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

export default function WeekGrid({ sched, weekStart, today, onOpenTask, onToggleComplete, onOpenDay }) {
  const weekTasks = sched.getTasksForWeek(weekStart);
  const { start, end } = gridBounds(weekTasks);
  const colHeight = (end - start) * PXH;
  const hours = [];
  for (let h = start; h < end; h += 1) hours.push(h);

  return (
    <div className="gridwrap">
      <div className="grid">
        <div className="axis-head" />
        {DAY_NAMES.map((dn, i) => {
          const date = addDays(weekStart, i);
          const isToday = today && sameDay(date, today);
          return (
            <button
              key={dn}
              className={`dayhead${i >= 5 ? ' wknd' : ''}${isToday ? ' today' : ''}`}
              onClick={() => onOpenDay(i)}
            >
              <div className="dn">{dn}</div>
              <div className="dd">{date.getDate()}</div>
              <div className="open">open ↓</div>
            </button>
          );
        })}

        <div className="axis" style={{ position: 'relative' }}>
          {hours.map((h) => (
            <div className="h" key={h} style={{ height: PXH }}><span>{hourLabel(h)}</span></div>
          ))}
        </div>

        {DAY_NAMES.map((dn, i) => {
          const date = addDays(weekStart, i);
          const dayTasks = weekTasks.filter((t) => sameDay(t.startTime, date));
          const bands = zoneBands(sched.zones, DAY_KEYS[i], start);
          const laid = layoutDay(dayTasks, start, PXH);
          return (
            <div className={`day${i >= 5 ? ' wknd' : ''}`} key={dn} style={{ height: colHeight }}>
              {bands.map((b) => (
                <div className="zone" key={b.key} style={{ top: b.top, height: b.height }}>
                  <span className="tag">{b.label}</span>
                </div>
              ))}
              {laid.map(({ task, style, compact }) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  style={style}
                  compact={compact}
                  onOpen={onOpenTask}
                  onToggleComplete={onToggleComplete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
