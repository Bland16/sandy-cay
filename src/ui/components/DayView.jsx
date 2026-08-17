// DayView — single day, replaces the main area with its own ✕ back control
// (per the B+C layout: day view is a main-area mode, not the panel).
import { addDays, hhmmToMinutes } from '../../core/index.js';
import { DAY_FULL, DAY_KEYS, MONTHS, hourLabel, gridBounds } from '../format.js';
import { columnItems, layoutDay, layoutRemainders } from '../layout.js';
import { BASE_PXH_DAY, DEFAULT_ZOOM, pxhFor, floorPxFor } from '../zoom.js';
import TaskCard from './TaskCard.jsx';
import { DayNoteList } from './DayNotes.jsx';
import Icon from '../Icon.jsx';

export default function DayView({
  sched, weekStart, dayIndex, onBack, onOpenTask, onToggleComplete, interaction, truncations,
  zoom = DEFAULT_ZOOM,
}) {
  // The day view keeps its OWN base (42px/hour, denser than the week's 34
  // because it has one column to spend the width on). Zoom is a multiplier over
  // that, so at 1× this renders exactly as it always did.
  //
  // ⚠️ One value, used everywhere including `data-pxh` — see WeekGrid's note.
  const pxh = pxhFor(BASE_PXH_DAY, zoom);
  const floorPx = floorPxFor(zoom);
  const date = addDays(weekStart, dayIndex);
  // The grid day runs 05:00 → 05:00, so this column owns the small hours of the
  // next calendar day — and the TAIL of a session that began before the anchor
  // on the previous one. Pull all three days and let `columnItems` decide what
  // this column actually draws.
  const tasks = [...sched.getTasksForDay(addDays(date, -1)), ...sched.getTasksForDay(date), ...sched.getTasksForDay(addDays(date, 1))];
  const { start, end } = gridBounds();
  const colHeight = (end - start) * pxh;
  const hours = [];
  for (let h = start; h < end; h += 1) hours.push(h);
  const laid = layoutDay(columnItems(tasks, date, start), start, pxh, floorPx);

  const bands = [];
  for (const z of sched.zones) {
    // A bounded zone (a summer job, a term) is not in force outside its run —
    // same rule the week grid and the placement engine apply.
    if (!z.activeOn(date)) continue;
    for (const w of z.windowsForDay(DAY_KEYS[dayIndex])) {
      const s = hhmmToMinutes(w.start) / 60;
      const e = hhmmToMinutes(w.end) / 60;
      bands.push({ key: `${z.id}-${w.start}`, label: z.label, top: (s - start) * pxh, height: (e - s) * pxh });
    }
  }

  return (
    <div className="dayview">
      <div className="dvhead">
        {/* On a phone the day IS the layout, so there is no week behind it to
            go back to and the ✕ would be a lie — the picker navigates instead
            (SPEC §11). Everywhere else the day view is a mode, and ✕ leaves it. */}
        {onBack && <button className="px" onClick={onBack} aria-label="Back to week"><Icon name="x" /></button>}
        <div className="dvt">
          {DAY_FULL[dayIndex]}
          <small>{MONTHS[date.getMonth()]} {date.getDate()} · {date.getFullYear()}</small>
        </div>
      </div>
      {/* The full list, not the header's truncated line: this IS §4's "click the
          header to see them all", and on a phone the day view is the whole
          layout, so it is the only place the notes can be read in full. */}
      <DayNoteList sched={sched} date={date} />
      <div className="dvgrid">
        <div className="axis" style={{ position: 'relative' }}>
          {hours.map((h) => <div className="h" key={h} style={{ height: pxh }}><span>{hourLabel(h)}</span></div>)}
        </div>
        <div
          /* Same predicate as the week grid, asked of the engine — see WeekGrid. */
          className={`dvcol${sched.isDayBlocked(date) ? ' blocked' : ''}`}
          /* `--pxh` drives the hour rules, which are a CSS gradient on `.dvcol`
             — see WeekGrid's note on why it has to be emitted. */
          style={{ height: colHeight, '--pxh': `${pxh}px` }}
          /* drop-geometry contract — see useCardInteraction.js. Same `pxh` the
             cards were laid out with, or drops land at the wrong time. */
          data-dropzone=""
          data-day-index={dayIndex}
          data-start-hour={start}
          data-end-hour={end}
          data-pxh={pxh}
        >
          {bands.map((b) => (
            <div className="zone" key={b.key} style={{ top: b.top, height: b.height }}><span className="tag">{b.label}</span></div>
          ))}
          {laid.length === 0 && <div className="empty">Nothing scheduled. A clear shore.</div>}
          {layoutRemainders(laid, truncations, start, pxh).map((r) => (
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
              /* The tail is not draggable — see WeekGrid. */
              onMoveStart={interaction && !continued ? interaction.onMoveStart : undefined}
              onResizeStart={interaction && !continued ? interaction.onResizeStart : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
