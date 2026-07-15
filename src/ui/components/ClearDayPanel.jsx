// ClearDayPanel — "Clear this day" (SPEC §3.4, OD-7). A panel, not a confirm.
//
// OD-7's three rules, made structural rather than advisory:
//   1. Scope is a choice: flexibles only, or a full clear.
//   2. A full clear NEVER batch-moves a pinned/fixed/protected task. Each one
//      gets its own row and its own Reschedule control, and the commit button
//      stays disabled until every row is resolved. The engine call is the same
//      either way — what the scope buys you is the obligation to look.
//   3. Block-day defaults ON: an evacuated day left unblocked silently refills,
//      because the balance weight loves an empty day.
//
// Nothing here schedules. It builds a plan; App commits it through the engine.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatHHMM } from '../../core/index.js';
import { DAY_FULL, DAY_NAMES, MONTHS, fmtDur } from '../format.js';
import { needsReviewFor, movableFor, occurrencesFor, nextSameWeekday, nextFreeSlot } from '../gapActions.js';
import Icon from '../Icon.jsx';

const W = 306;
const PAD = 8;

const RESOLUTIONS = [
  { value: 'next-weekday', label: 'Move to next same weekday' },
  { value: 'next-free', label: 'Move to the next free slot' },
  { value: 'leave', label: 'Leave it in place' },
  { value: 'skip', label: 'Skip it this week' },
];

const kindOf = (sched, t) => {
  if (t.pinned) return 'pinned';
  if (t.hasProtectedTag(sched.config.protectedTags)) return 'protected';
  return 'fixed';
};

/** What a chosen resolution actually does, in words the row can show. */
function previewOf(sched, task, date, choice) {
  if (choice === 'next-weekday') {
    const { start } = nextSameWeekday(task);
    return `${DAY_NAMES[(start.getDay() + 6) % 7]} ${MONTHS[start.getMonth()]} ${start.getDate()} · ${formatHHMM(start)}`;
  }
  if (choice === 'next-free') {
    const slot = nextFreeSlot(sched, task, date);
    return slot
      ? `${DAY_NAMES[(slot.start.getDay() + 6) % 7]} ${MONTHS[slot.start.getMonth()]} ${slot.start.getDate()} · ${formatHHMM(slot.start)}`
      : 'no free slot in the next few days';
  }
  if (choice === 'leave') return 'stays where it is';
  if (choice === 'skip') return 'marked skipped — no guilt attached';
  return null;
}

export default function ClearDayPanel({ sched, date, dayIndex, anchor, onCommit, onCancel }) {
  const ref = useRef(null);
  const firstRef = useRef(null);
  const [scope, setScope] = useState('flexibles'); // 'flexibles' | 'full'
  const [blockDay, setBlockDay] = useState(true); // OD-7: default ON
  const [resolutions, setResolutions] = useState({});
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top + anchor.height + 6 });

  const review = useMemo(() => needsReviewFor(sched, date), [sched, date]);
  const movable = useMemo(() => movableFor(sched, date), [sched, date]);
  const occurrences = useMemo(() => occurrencesFor(sched, date), [sched, date]);

  // Anchored to the day header, never off-screen (nothing may spill the viewport).
  useLayoutEffect(() => {
    const h = ref.current ? ref.current.offsetHeight : 240;
    const left = Math.min(Math.max(PAD, anchor.left), Math.max(PAD, window.innerWidth - W - PAD));
    let top = anchor.top + anchor.height + 6;
    if (top + h > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - h - PAD);
    setPos({ left, top });
  }, [anchor, scope, review.length]);

  useEffect(() => {
    if (firstRef.current) firstRef.current.focus();
  }, []);

  const unresolved = scope === 'full' ? review.filter((t) => !resolutions[t.id]) : [];
  const canCommit = unresolved.length === 0;

  const commit = () => {
    if (!canCommit) return;
    onCommit({
      scope,
      blockDay,
      // Only a full clear acts on the anchored rows; flexibles-only leaves them
      // exactly as they are, which is the whole point of the narrower scope.
      resolutions: scope === 'full' ? { ...resolutions } : {},
    });
  };

  return (
    <div
      className="claripanel"
      ref={ref}
      role="dialog"
      aria-label={`Clear ${DAY_FULL[dayIndex]}`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
    >
      <div className="cdhead">
        <div className="cdt">
          Clear {DAY_FULL[dayIndex]}
          <small>{MONTHS[date.getMonth()]} {date.getDate()}</small>
        </div>
        <button type="button" className="px" onClick={onCancel} aria-label="Close"><Icon name="x" /></button>
      </div>

      <div className="cdscope" role="radiogroup" aria-label="What to clear">
        <button
          type="button"
          ref={firstRef}
          role="radio"
          aria-checked={scope === 'flexibles'}
          className={`cdopt${scope === 'flexibles' ? ' pick' : ''}`}
          onClick={() => setScope('flexibles')}
        >
          Flexibles only
          <small>{movable.length} move{movable.length === 1 ? 's' : ''} · the rest stays</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'full'}
          className={`cdopt${scope === 'full' ? ' pick' : ''}`}
          onClick={() => setScope('full')}
        >
          Full clear
          <small>{movable.length + review.length} to settle</small>
        </button>
      </div>

      <p className="cdnote">
        Flexible tasks relocate forward only — to the days after this one, never before.
      </p>

      {scope === 'full' && (
        <div className="cdrows">
          <div className="flabel">
            {review.length === 0 ? 'Nothing needs your call' : `${review.length} need${review.length === 1 ? 's' : ''} your call`}
          </div>
          {review.length === 0 && (
            <p className="cdnote">No pinned or fixed tasks today — the day clears cleanly.</p>
          )}
          {review.map((t) => (
            <div className="cdrow" key={t.id}>
              <div className="cdrowhead">
                <span className="cdname">{t.title}</span>
                <span className={`cdkind ${kindOf(sched, t)}`}>{kindOf(sched, t)}</span>
              </div>
              <div className="cdwhen">{formatHHMM(t.startTime)}–{formatHHMM(t.endTime)} · {fmtDur(t.getDuration())}</div>
              <select
                className="input"
                aria-label={`Reschedule ${t.title}`}
                value={resolutions[t.id] || ''}
                onChange={(e) => setResolutions((r) => ({ ...r, [t.id]: e.target.value || undefined }))}
              >
                <option value="">Choose…</option>
                {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {resolutions[t.id] && (
                <div className="cdpreview">{previewOf(sched, t, date, resolutions[t.id])}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {occurrences.length > 0 && (
        <p className="cdnote">
          {occurrences.length} repeating session{occurrences.length === 1 ? '' : 's'} today stay
          {occurrences.length === 1 ? 's' : ''} put — skip {occurrences.length === 1 ? 'it' : 'them'} from
          {occurrences.length === 1 ? ' its' : ' their'} own card.
        </p>
      )}

      <div className="cdblock">
        <button
          type="button"
          className={`tw${blockDay ? ' on' : ''}`}
          role="switch"
          aria-checked={blockDay}
          aria-label="Block this day"
          onClick={() => setBlockDay((b) => !b)}
        >
          <span className="knob" />
        </button>
        <div className="cdblocktext">
          <b>Block the day</b>
          <small>{blockDay
            ? 'Nothing flows back in. Turn this off to clear the day but keep it available.'
            : 'The day stays open — later placement may fill it again.'}</small>
        </div>
      </div>

      <div className="cdbtns">
        <button type="button" className="btn" onClick={onCancel}>Not now</button>
        <button
          type="button"
          className="btn cta"
          disabled={!canCommit}
          title={canCommit ? 'Clear this day' : `${unresolved.length} still need a decision`}
          onClick={commit}
        >
          Clear day
        </button>
      </div>
      {!canCommit && (
        <p className="cdnote">
          Pick what happens to {unresolved.length === 1 ? 'the last one' : `each of the ${unresolved.length}`} above first — nothing pinned moves on its own.
        </p>
      )}
      <div className="chint">Esc · leave the day alone</div>
    </div>
  );
}

/** The plan a ClearDayPanel commit produces, applied through the engine.
 *  Resolutions run BEFORE evacuateDay so a rescheduled anchor has already left
 *  the day by the time the engine looks at it. */
export function applyClearDay(sched, date, plan) {
  const resolved = { moved: 0, left: 0, skipped: 0 };
  for (const [taskId, choice] of Object.entries(plan.resolutions || {})) {
    const task = sched.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    if (choice === 'next-weekday') {
      const { start, end } = nextSameWeekday(task);
      sched.updateTask(task.id, { startTime: start, endTime: end });
      resolved.moved += 1;
    } else if (choice === 'next-free') {
      const slot = nextFreeSlot(sched, task, date);
      if (slot) {
        sched.updateTask(task.id, { startTime: slot.start, endTime: slot.end });
        resolved.moved += 1;
      } else {
        resolved.left += 1; // nowhere to go — leaving it beats parking it badly
      }
    } else if (choice === 'skip') {
      sched.updateTask(task.id, { completion: 'skipped' });
      resolved.skipped += 1;
    } else {
      resolved.left += 1;
    }
  }
  const res = sched.evacuateDay(date, { blockDay: !!plan.blockDay });
  return { ...res, resolved };
}
