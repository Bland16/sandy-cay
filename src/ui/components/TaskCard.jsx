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

export default function TaskCard({ task, style, compact, onOpen, onToggleComplete }) {
  const kind = cardKind(task);
  const cls = [
    'card', kind,
    task.schedulingWarning ? 'warn' : '',
    task.completion === 'done' ? 'done' : '',
    task.completion === 'skipped' ? 'skipped' : '',
    compact ? 'compact' : '',
  ].filter(Boolean).join(' ');

  const deadlineChip = task.deadline && !task.isOccurrence;

  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task); } }}
    >
      <Badges task={task} />
      <div className="t">{task.title}</div>
      {!compact && <div className="tm">{fmtRange(task)}</div>}
      {!compact && isChunk(task) && <div className="sub">project chunk</div>}
      {!compact && task.schedulingInfo && <div className="sub">{task.schedulingInfo}</div>}
      {!compact && deadlineChip && (
        <span className="chip info"><Icon name="pennant" style={{ width: 8, height: 8 }} /> due {shortDay(task.deadline)}</span>
      )}
      <button
        type="button"
        className="checkctl"
        title="Mark done"
        aria-label={`Mark "${task.title}" done`}
        onClick={(e) => { e.stopPropagation(); onToggleComplete(task); }}
      >
        {task.completion === 'done' && <Icon name="check" />}
      </button>
    </div>
  );
}

function shortDay(d) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}
