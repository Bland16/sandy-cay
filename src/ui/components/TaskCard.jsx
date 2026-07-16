// TaskCard — a placed task on the grid. Type tint + icon badges (icon carries
// meaning, tint reinforces — FRONTEND-SPEC §9). Clicking the body opens the task
// panel; the bottom-left check control cycles completion (case 3D).
import Icon from '../Icon.jsx';
import { fmtRange } from '../format.js';

const PROTECTED = ['rest', 'break', 'recovery'];

export function isProtected(task) {
  return task.tags.some((t) => PROTECTED.includes(t));
}
export function isChunk(task) {
  return !!task.parentId && !task.isOccurrence;
}

export function cardKind(task) {
  if (isProtected(task)) return 'protected';
  if (task.pinned) return 'pinned';
  return task.type === 'fixed' ? 'fixed' : 'flexible';
}

function Badges({ task }) {
  const b = [];
  if (task.type === 'fixed' && !task.isOccurrence) b.push(<span key="a" className="b" title="Fixed"><Icon name="anchor" /></span>);
  if (task.isOccurrence || task.recurrence) b.push(<span key="l" className="b" title="Recurring"><Icon name="loop" /></span>);
  if (task.pinned) b.push(<span key="p" className="b pin" title="Pinned"><Icon name="lock" /></span>);
  if (isProtected(task)) b.push(<span key="h" className="b" title="Protected"><Icon name="hammock" /></span>);
  if (isChunk(task)) b.push(<span key="c" className="b" title="Project chunk"><Icon name="castle" /></span>);
  if (task.schedulingWarning) b.push(<span key="w" className="b flag" title="Won't fit"><Icon name="flag" /></span>);
  if (task.completion === 'partial') b.push(<span key="s" className="b" title="Partial"><Icon name="starfish" /></span>);
  if (task.completion === 'done') b.push(<span key="d" className="b done" title="Done"><Icon name="check" /></span>);
  if (!b.length) return null;
  return <div className="badges">{b}</div>;
}

/**
 * A placed task.
 *
 * Drag modes (OD-1): the body is always *move*; the wave strip (top) and sand
 * strip (bottom) are the only resize handles. `ghost` renders the drag preview —
 * same visual, no handles, no hit testing.
 */
export default function TaskCard({
  task, style, compact, onOpen, onToggleComplete,
  ghost = false, dragging = false, pressing = false, phase, onMoveStart, onResizeStart,
}) {
  const kind = cardKind(task);
  // Recurrence occurrences are virtual (§4.4): moving one writes an exception,
  // which is not part of M2.1, so they stay click-to-open only.
  // Occurrences drag and resize like anything else — a session that ran long or
  // shifted is one session, and writes a per-occurrence exception (§4.4). Only a
  // cross-day move is refused (the exception is keyed to its own date).
  const interactive = !ghost && !!onMoveStart;
  const movable = interactive;
  const cls = [
    'card', kind,
    task.schedulingWarning ? 'warn' : '',
    task.completion === 'done' ? 'done' : '',
    task.completion === 'skipped' ? 'skipped' : '',
    compact ? 'compact' : '',
    ghost ? 'ghost' : '',
    ghost && phase ? `ghost-${phase}` : '',
    !ghost && dragging ? 'dragging' : '',
    // Touch hold in progress — the drag hasn't armed yet (see LONG_PRESS_MS).
    !ghost && !dragging && pressing ? 'pressing' : '',
  ].filter(Boolean).join(' ');

  const deadlineChip = task.deadline && !task.isOccurrence;

  if (ghost) {
    return (
      <div className={cls} style={style} aria-hidden="true">
        <CardFace task={task} compact={compact} deadlineChip={deadlineChip} />
      </div>
    );
  }

  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      /* compact cards hide the .tm line, so the span lives in the name */
      aria-label={`${task.title} · ${fmtRange(task)}`}
      aria-grabbed={dragging ? 'true' : undefined}
      onPointerDown={movable ? (e) => onMoveStart(e, task, compact) : undefined}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task); } }}
    >
      {interactive && (
        <>
          <div
            className="wave"
            title="Drag to change the start time"
            onPointerDown={(e) => onResizeStart(e, task, compact, 'start')}
          />
          <div
            className="sand"
            title="Drag to change the end time"
            onPointerDown={(e) => onResizeStart(e, task, compact, 'end')}
          />
        </>
      )}
      <CardFace task={task} compact={compact} deadlineChip={deadlineChip} />
      <button
        type="button"
        className="checkctl"
        title="Mark done"
        aria-label={`Mark "${task.title}" done`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggleComplete(task); }}
      >
        {task.completion === 'done' && <Icon name="check" />}
      </button>
    </div>
  );
}

/** The card's contents — shared by the real card and its drag ghost. */
function CardFace({ task, compact, deadlineChip }) {
  return (
    <>
      <Badges task={task} />
      <div className="t">{task.title}</div>
      {!compact && <div className="tm">{fmtRange(task)}</div>}
      {!compact && isChunk(task) && <div className="sub">project chunk</div>}
      {!compact && task.schedulingInfo && <div className="sub">{task.schedulingInfo}</div>}
      {!compact && deadlineChip && (
        <span className="chip info"><Icon name="pennant" style={{ width: 8, height: 8 }} /> due {shortDay(task.deadline)}</span>
      )}
    </>
  );
}

function shortDay(d) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}
