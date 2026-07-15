// useCardInteraction.js — the pointer/geometry half of drag-to-move (A),
// border-resize (B) and the ripple/displace chooser (C).
//
// Geometry contract: every droppable column (week day column, day-view column)
// carries `data-dropzone data-day-index data-start-hour data-end-hour data-pxh`.
// We read those rects at pointer-down, so this hook needs no refs from the grid
// components and works identically in both views.
//
// The engine stays the source of truth: nothing here computes a schedule. We
// snap a pointer to a 15-minute slot, call the engine (moveTo / updateTask /
// resolveDropConflicts / rippleShift via interaction.js), then re-read.
// autoSchedule is never called (SPEC §2.4).

import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, addMinutes, minutesBetween, addException, formatHHMM, sameDay } from '../core/index.js';
import { gridDayOf } from './format.js';
import {
  MIN_DURATION_MIN,
  atMinutes,
  blockerKind,
  buildDayState,
  commitDisplace,
  commitRipple,
  findBlockers,
  isHardBlocker,
  restoreSpan,
  snapTo,
  snapshotSpan,
} from './interaction.js';

const DRAG_THRESHOLD_PX = 4;
const SNAP_MS = 150; // SPEC §10 motion: 150ms snap on drop
const SHAKE_MS = 340;
const CLICK_SUPPRESS_MS = 300;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** All drop columns currently on screen, with their time geometry. */
function readColumns() {
  return Array.from(document.querySelectorAll('[data-dropzone]')).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      dayIndex: Number(el.dataset.dayIndex),
      startHour: Number(el.dataset.startHour),
      endHour: Number(el.dataset.endHour),
      pxh: Number(el.dataset.pxh),
      left: r.left,
      right: r.right,
      top: r.top,
      width: r.width,
    };
  });
}

/** The column under x, else the nearest one (so you can drag past the edge). */
function columnAt(cols, x) {
  const hit = cols.find((c) => x >= c.left && x < c.right);
  if (hit) return hit;
  return cols.reduce((best, c) => {
    const d = Math.abs(x - (c.left + c.width / 2));
    return d < Math.abs(x - (best.left + best.width / 2)) ? c : best;
  }, cols[0]);
}

/** Screen y → minute-of-day, snapped to 15 (OD-1 / §3.1). */
function minutesAt(col, y) {
  return snapTo(col.startHour * 60 + ((y - col.top) / col.pxh) * 60);
}

function rectFor(col, startMin, durMin) {
  return {
    left: col.left + 3,
    top: col.top + (startMin / 60 - col.startHour) * col.pxh,
    width: Math.max(24, col.width - 6),
    height: Math.max(18, (durMin / 60) * col.pxh),
  };
}

export function useCardInteraction({ sched, mutate, showToast, weekStart }) {
  const [ghost, setGhost] = useState(null); // { task, compact, mode, rect, phase }
  const [hiddenId, setHiddenId] = useState(null); // real card hidden while its ghost flies
  const [chooser, setChooser] = useState(null);
  const [active, setActive] = useState(false);

  const session = useRef(null);
  const timer = useRef(null);
  const clickGuard = useRef(0);
  // Mirror of `chooser` for the pointer-down guard, which must not re-bind.
  const chooserRef = useRef(null);
  chooserRef.current = chooser;

  const clearGhost = useCallback(() => {
    clearTimeout(timer.current);
    setGhost(null);
    setHiddenId(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Fly the ghost to its landing rect, then reveal the real card. */
  const settleGhost = useCallback(
    (rect) => {
      if (prefersReducedMotion()) return clearGhost();
      setGhost((g) => (g ? { ...g, rect, phase: 'settle' } : g));
      clearTimeout(timer.current);
      timer.current = setTimeout(clearGhost, SNAP_MS);
      return undefined;
    },
    [clearGhost],
  );

  /** Snap back to where the drag started, with a shake (§3.1). */
  const rejectGhost = useCallback(
    (origin) => {
      if (prefersReducedMotion()) return clearGhost();
      setGhost((g) => (g ? { ...g, rect: origin, phase: 'reject' } : g));
      clearTimeout(timer.current);
      timer.current = setTimeout(clearGhost, SHAKE_MS);
      return undefined;
    },
    [clearGhost],
  );

  /**
   * Resize of a recurring occurrence → a per-occurrence `move` exception (§4.4).
   * The occurrence is virtual (regenerated on read), so mutating it would be
   * thrown away; the span has to live on the parent's exception list. Today's
   * session changes, the pattern does not.
   */
  const applyOccurrenceSpan = useCallback(
    (task, newStart, newEnd) => {
      mutate((s) => {
        const parent = s.tasks.find((t) => t.id === task.parentId);
        if (!parent) return;
        addException(parent, task.occurrenceDate, 'move', {
          start: formatHHMM(newStart),
          end: formatHHMM(newEnd),
        });
      });
      showToast('Just this session — the pattern is unchanged');
    },
    [mutate, showToast],
  );

  /**
   * Apply one completed drag/resize.
   *
   * op = { cause, task, applyToTask, scanStart, scanEnd, effEnd, heuristicDelta,
   *        rippleEnabled, targetRect, origin }
   */
  const applyOperation = useCallback(
    (op) => {
      const { task } = op;
      const snap = snapshotSpan(task);
      const blockers = findBlockers(sched, task, op.scanStart, op.scanEnd);
      const hard = blockers.some((b) => isHardBlocker(sched, b));

      // 1) the engine move / resize — always first, always via the engine.
      mutate(() => op.applyToTask(task));

      // 2) rejection (fixed / pinned / protected / recurring) — the engine's
      //    verdict and its reason string. resolveDropConflicts returns before it
      //    displaces anything on this path, so nothing else has moved.
      if (hard || (op.cause === 'drop' && blockers.length === 0)) {
        const res = mutate((s) => s.resolveDropConflicts(task));
        if (res.rejected || res.occurrenceMenu) {
          mutate(() => restoreSpan(task, snap));
          const reason =
            res.reason ||
            `Conflicts with recurring: ${res.occurrence ? res.occurrence.title : 'repeating task'}`;
          showToast(reason);
          rejectGhost(op.origin);
          return;
        }
        settleGhost(op.targetRect);
        if (res.displaced.length) {
          showToast(`Moved · ${res.displaced.length} re-placed`);
        }
        return;
      }

      // 3) no collision → done.
      if (blockers.length === 0) {
        settleGhost(op.targetRect);
        return;
      }

      // 4) flexible ∧ unpinned collision → the chooser decides (OD-8). The
      //    heuristic only pre-highlights; both options stay available.
      settleGhost(op.targetRect);
      const effEnd = op.effEnd(blockers, task);
      const rippleDelta = Math.max(0, minutesBetween(effEnd, task.endTime));
      const dayState = buildDayState(sched, task, effEnd, blockers);
      const heuristicDelta =
        typeof op.heuristicDelta === 'function'
          ? op.heuristicDelta(blockers, task)
          : op.heuristicDelta;
      const heuristic = sched.chooseConflictStrategy(op.cause, heuristicDelta, dayState);
      setChooser({
        task,
        snap,
        effEnd,
        rippleDelta,
        rippleEnabled: op.rippleEnabled,
        blockers,
        dayState,
        // Ripple is meaningless when nothing is downstream of the pivot (a wave
        // resize collides upstream), so the default falls back to displace.
        def: op.rippleEnabled ? heuristic : 'displace',
        anchor: op.targetRect,
      });
    },
    [sched, mutate, showToast, settleGhost, rejectGhost],
  );

  const endSession = useCallback(() => {
    session.current = null;
    setActive(false);
  }, []);

  /** Abort mid-drag (Esc / pointercancel): nothing was committed. */
  const cancelDrag = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.moved) {
      clickGuard.current = Date.now();
      settleGhost(s.origin);
    } else {
      clearGhost();
    }
    endSession();
  }, [settleGhost, clearGhost, endSession]);

  const finish = useCallback(
    (x, y) => {
      const s = session.current;
      if (!s) return;
      if (!s.moved) {
        clearGhost();
        endSession();
        return;
      }
      clickGuard.current = Date.now();
      const { task, cols } = s;
      const dur = task.getDuration();

      if (s.mode === 'move') {
        const col = columnAt(cols, x - s.grab.dx + s.origin.width / 2);
        const startMin = clamp(
          minutesAt(col, y - s.grab.dy),
          col.startHour * 60,
          col.endHour * 60 - MIN_DURATION_MIN,
        );
        const day = addDays(weekStart, col.dayIndex);
        const newStart = atMinutes(day, startMin);
        const newEnd = addMinutes(newStart, dur);
        if (newStart.getTime() === task.startTime.getTime()) {
          settleGhost(s.origin); // no-op drop: land it back where it was
          endSession();
          return;
        }
        if (task.isOccurrence) {
          // A `move` exception is keyed to its own date and carries only times,
          // so "today's gym is at 10:00" is expressible and "today's gym happens
          // Wednesday" is not. Refuse the cross-day move rather than silently
          // rewriting the routine.
          if (!sameDay(gridDayOf(task.startTime), gridDayOf(newStart))) {
            showToast('Repeating sessions move within their own day — edit the pattern to change days');
            rejectGhost(s.origin);
            endSession();
            return;
          }
          applyOccurrenceSpan(task, newStart, newEnd);
          settleGhost(rectFor(col, startMin, dur));
          endSession();
          return;
        }
        applyOperation({
          cause: 'drop',
          task,
          applyToTask: (t) => t.moveTo(newStart), // R-1: manual action wins
          scanStart: newStart,
          scanEnd: newEnd,
          // Ripple pivot = the drop; the chain starts at the first thing hit.
          effEnd: (blockers) =>
            new Date(Math.min(...blockers.map((b) => b.startTime.getTime()))),
          // §3.2's drop cases are sized by the intrusion: dropping a 15-min task
          // onto a task's start pushes 15 min, a 2h task pushes 2h.
          heuristicDelta: (blockers) =>
            Math.max(
              0,
              minutesBetween(
                new Date(Math.min(...blockers.map((b) => b.startTime.getTime()))),
                newEnd,
              ),
            ),
          rippleEnabled: true,
          targetRect: rectFor(col, startMin, dur),
          origin: s.origin,
        });
        endSession();
        return;
      }

      const col = s.col;
      const startMin = s.startMin;
      const endMin = s.endMin;

      if (s.mode === 'resize-end') {
        // Sand strip: endTime moves, start anchored (OD-1).
        const newEndMin = clamp(minutesAt(col, y), startMin + MIN_DURATION_MIN, col.endHour * 60);
        if (newEndMin === endMin) {
          settleGhost(s.origin);
          endSession();
          return;
        }
        const day = addDays(weekStart, col.dayIndex);
        const newEnd = atMinutes(day, newEndMin);
        const oldEnd = new Date(task.endTime.getTime());
        const growth = newEndMin - endMin;
        if (task.isOccurrence) {
          applyOccurrenceSpan(task, task.startTime, newEnd);
          settleGhost(rectFor(col, startMin, newEndMin - startMin));
          endSession();
          return;
        }
        applyOperation({
          cause: 'resize',
          task,
          applyToTask: (t) => {
            mutateEnd(sched, t, newEnd);
          },
          // Only the newly-claimed minutes can collide.
          scanStart: oldEnd,
          scanEnd: newEnd,
          // §3.3: rippleShift's "downstream" is start >= pivot.endTime, so the
          // chain is measured from the pre-resize end.
          effEnd: () => oldEnd,
          heuristicDelta: Math.max(0, growth),
          rippleEnabled: growth > 0,
          targetRect: rectFor(col, startMin, newEndMin - startMin),
          origin: s.origin,
        });
        endSession();
        return;
      }

      // Wave strip: startTime moves, end anchored (OD-1).
      const newStartMin = clamp(minutesAt(col, y), col.startHour * 60, endMin - MIN_DURATION_MIN);
      if (newStartMin === startMin) {
        settleGhost(s.origin);
        endSession();
        return;
      }
      const day = addDays(weekStart, col.dayIndex);
      const newStart = atMinutes(day, newStartMin);
      const oldStart = new Date(task.startTime.getTime());
      if (task.isOccurrence) {
        applyOccurrenceSpan(task, newStart, task.endTime);
        settleGhost(rectFor(col, newStartMin, endMin - newStartMin));
        endSession();
        return;
      }
      applyOperation({
        cause: 'resize',
        task,
        applyToTask: (t) => {
          mutateStart(sched, t, newStart);
        },
        scanStart: newStart,
        scanEnd: oldStart,
        // An earlier start collides upstream; rippleShift only moves things
        // downstream, so ripple is not offered for this edge.
        effEnd: () => new Date(task.endTime.getTime()),
        heuristicDelta: Math.max(0, startMin - newStartMin),
        rippleEnabled: false,
        targetRect: rectFor(col, newStartMin, endMin - newStartMin),
        origin: s.origin,
      });
      endSession();
    },
    [applyOperation, clearGhost, endSession, sched, settleGhost, weekStart],
  );

  // Window-level pointer + Esc handling while a drag is live.
  useEffect(() => {
    if (!active) return undefined;

    const onMove = (e) => {
      const s = session.current;
      if (!s) return;
      if (!s.moved) {
        if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD_PX) return;
        s.moved = true;
        s.cols = readColumns();
        if (s.mode !== 'move') {
          s.col = columnAt(s.cols, s.origin.left + s.origin.width / 2);
        }
        setHiddenId(s.task.id);
        setGhost({
          task: s.task,
          compact: s.compact,
          mode: s.mode,
          rect: s.origin,
          phase: 'drag',
        });
      }
      if (s.mode === 'move') {
        // Ghost follows the pointer raw; the snap happens on drop (§10).
        setGhost((g) =>
          g
            ? {
                ...g,
                rect: {
                  ...g.rect,
                  left: e.clientX - s.grab.dx,
                  top: e.clientY - s.grab.dy,
                },
              }
            : g,
        );
        return;
      }
      // Resize preview is snapped live, so you see the 15-minute steps.
      const col = s.col;
      if (s.mode === 'resize-end') {
        const endMin = clamp(minutesAt(col, e.clientY), s.startMin + MIN_DURATION_MIN, 24 * 60);
        setGhost((g) =>
          g ? { ...g, rect: { ...s.origin, ...rectSpan(col, s.startMin, endMin, s.origin) } } : g,
        );
      } else {
        const startMin = clamp(minutesAt(col, e.clientY), 0, s.endMin - MIN_DURATION_MIN);
        setGhost((g) =>
          g ? { ...g, rect: { ...s.origin, ...rectSpan(col, startMin, s.endMin, s.origin) } } : g,
        );
      }
    };

    const onUp = (e) => finish(e.clientX, e.clientY);
    const onCancel = () => cancelDrag();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelDrag();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    document.body.classList.add('sc-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('sc-dragging');
    };
  }, [active, finish, cancelDrag]);

  const begin = useCallback((e, task, compact, mode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // An open chooser is an unresolved conflict — settle it (or Esc) first.
    if (chooserRef.current) return;
    const rect = e.currentTarget.closest('.card').getBoundingClientRect();
    session.current = {
      mode,
      task,
      compact,
      startX: e.clientX,
      startY: e.clientY,
      grab: { dx: e.clientX - rect.left, dy: e.clientY - rect.top },
      origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      startMin: task.startTime.getHours() * 60 + task.startTime.getMinutes(),
      endMin: task.endTime.getHours() * 60 + task.endTime.getMinutes(),
      moved: false,
      cols: null,
      col: null,
    };
    setActive(true);
  }, []);

  const onMoveStart = useCallback((e, task, compact) => begin(e, task, compact, 'move'), [begin]);
  const onResizeStart = useCallback(
    (e, task, compact, edge) => {
      e.stopPropagation();
      begin(e, task, compact, edge === 'start' ? 'resize-start' : 'resize-end');
    },
    [begin],
  );

  // ---- chooser actions (OD-8) -------------------------------------------
  const chooseRipple = useCallback(() => {
    if (!chooser) return;
    const { task, effEnd, rippleDelta } = chooser;
    const r = mutate((s) => commitRipple(s, task, effEnd, rippleDelta));
    const moved = r.evacuated.length + (r.cleanup ? r.cleanup.displaced.length : 0);
    showToast(
      `Rippled the day · ${r.shifted.length} shifted${moved ? `, ${moved} re-placed` : ''}`,
    );
    setChooser(null);
  }, [chooser, mutate, showToast]);

  const chooseDisplace = useCallback(() => {
    if (!chooser) return;
    const r = mutate((s) => commitDisplace(s, chooser.task));
    showToast(
      r.displaced.length ? `Displaced · ${r.displaced.length} re-placed` : 'Nothing to displace',
    );
    setChooser(null);
  }, [chooser, mutate, showToast]);

  const cancelChooser = useCallback(() => {
    if (!chooser) return;
    mutate(() => restoreSpan(chooser.task, chooser.snap));
    showToast('Snapped back');
    setChooser(null);
  }, [chooser, mutate, showToast]);

  // Esc cancels the whole operation from anywhere while the chooser is open
  // (the chooser autofocuses its default, but focus can wander).
  useEffect(() => {
    if (!chooser) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelChooser();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [chooser, cancelChooser]);

  const chooserLabel = chooser
    ? `${blockerKind(sched, chooser.blockers[0])} conflict: ${chooser.blockers[0].title}`
    : null;

  return {
    ghost,
    hiddenId,
    chooser,
    chooserLabel,
    busy: active || !!chooser,
    onMoveStart,
    onResizeStart,
    chooseRipple,
    chooseDisplace,
    cancelChooser,
    shouldSuppressClick: () => Date.now() - clickGuard.current < CLICK_SUPPRESS_MS,
  };
}

/** Ghost rect for a live resize: x stays put, y/height follow the snapped span. */
function rectSpan(col, startMin, endMin, origin) {
  return {
    left: origin.left,
    width: origin.width,
    top: col.top + (startMin / 60 - col.startHour) * col.pxh,
    height: Math.max(18, ((endMin - startMin) / 60) * col.pxh),
  };
}

// Engine writes go through Schedule.updateTask so placedBy/_touch bookkeeping
// stays the engine's job (the whitelist covers startTime/endTime).
function mutateEnd(sched, task, newEnd) {
  sched.updateTask(task.id, { endTime: newEnd });
}
function mutateStart(sched, task, newStart) {
  sched.updateTask(task.id, { startTime: newStart });
}
