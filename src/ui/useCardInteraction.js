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
import { addDays, addMinutes, minutesBetween, addException, formatHHMM, dateKey } from '../core/index.js';
import { gridHour } from './format.js';
import {
  MIN_DURATION_MIN,
  atMinutes,
  blockerKind,
  buildDayState,
  commitDisplace,
  commitRipple,
  findBlockers,
  isHardBlocker,
  proposeOccurrenceSlot,
  restoreSpan,
  snapTo,
  snapshotSpan,
} from './interaction.js';
import { DAY_NAMES } from './format.js';

const DRAG_THRESHOLD_PX = 4;
const SNAP_MS = 150; // SPEC §10 motion: 150ms snap on drop
const SHAKE_MS = 340;
const CLICK_SUPPRESS_MS = 300;

// Touch needs a gate that a mouse doesn't. A finger on a card is ambiguous —
// "move this" and "scroll the day" look identical for the first few pixels —
// and 4px of slop is nothing on a touchscreen, so every attempt to scroll the
// 24-hour grid would have flung a task somewhere. Hold still and the drag arms;
// move first and the browser keeps the gesture and scrolls, as it should.
const LONG_PRESS_MS = 450;
const TOUCH_SLOP_PX = 10; // moved this far before arming ⇒ you meant to scroll

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

/**
 * A task's span in the column's 5am-anchored grid minutes (300…1740).
 * A task that crosses the 05:00 anchor (04:00–05:00) would otherwise measure its
 * end below its own start, so the end is taken from the duration in that case.
 */
function gridSpanOf(task) {
  const startMin = gridHour(task.startTime) * 60;
  const rawEnd = gridHour(task.endTime) * 60;
  const endMin = rawEnd > startMin ? rawEnd : startMin + task.getDuration();
  return { startMin, endMin };
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
  const [occMenu, setOccMenu] = useState(null); // 4C — drop onto a recurring session
  const [active, setActive] = useState(false);
  // The card being held down on touch, before the drag arms — it gets a visual
  // "winding up" cue, so a long-press is something you can see working rather
  // than a delay that feels like the app ignoring you.
  const [pressingId, setPressingId] = useState(null);

  const session = useRef(null);
  const press = useRef(null); // { timer, taskId } — the touch hold in progress
  const timer = useRef(null);
  const clickGuard = useRef(0);
  // Mirrors for the pointer-down guard, which must not re-bind. Either an open
  // chooser or an open occurrence menu is an unresolved drop.
  const chooserRef = useRef(null);
  chooserRef.current = chooser;
  const occMenuRef = useRef(null);
  occMenuRef.current = occMenu;

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
      const toDate = dateKey(newStart);
      const relocated = toDate !== task.occurrenceDate;
      mutate((s) => {
        const parent = s.tasks.find((t) => t.id === task.parentId);
        if (!parent) return;
        addException(parent, task.occurrenceDate, 'move', {
          start: formatHHMM(newStart),
          end: formatHHMM(newEnd),
          // Keyed to the original date, so lived data follows the session (§4.4).
          ...(relocated ? { toDate } : {}),
        });
      });
      showToast(
        relocated
          ? 'Moved this session — the pattern is unchanged'
          : 'Just this session — the pattern is unchanged',
      );
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

      // 2) rejection (fixed / pinned / protected) — the engine's verdict and its
      //    reason string. resolveDropConflicts returns before it displaces
      //    anything on this path, so nothing else has moved.
      if (hard || (op.cause === 'drop' && blockers.length === 0)) {
        const res = mutate((s) => s.resolveDropConflicts(task));
        // 2a) a recurring session is not a wall — it's a question (§4C). The
        //     engine says so explicitly rather than rejecting, and the menu
        //     asks it with no silent default.
        if (res.occurrenceMenu) {
          settleGhost(op.targetRect);
          const slot = proposeOccurrenceSlot(sched, res.occurrence);
          setOccMenu({
            task,
            snap,
            occurrence: res.occurrence,
            anchor: op.targetRect,
            moveTo: slot
              ? {
                  start: slot.start,
                  end: slot.end,
                  label: `${DAY_NAMES[(slot.start.getDay() + 6) % 7]} ${formatHHMM(slot.start)}`,
                }
              : null,
          });
          return;
        }
        if (res.rejected) {
          mutate(() => restoreSpan(task, snap));
          showToast(res.reason);
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
          // Any date, including another day or week: the exception carries a
          // toDate and keeps the session's identity. The pattern is untouched.
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

    // The card is `touch-action: manipulation`, so the browser is still willing
    // to scroll this gesture. Once a drag is live we have to actively refuse it:
    // a passive listener CANNOT, hence {passive: false}. Without this the first
    // upward drag on a phone scrolls the day instead of moving the task — and
    // moving it vertically IS how you change its time.
    const onTouchMove = (e) => { if (session.current) e.preventDefault(); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKey, true);
    document.body.classList.add('sc-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('sc-dragging');
    };
  }, [active, finish, cancelDrag]);

  const openSession = useCallback((geom, task, compact, mode) => {
    session.current = {
      mode,
      task,
      compact,
      startX: geom.x,
      startY: geom.y,
      grab: { dx: geom.x - geom.rect.left, dy: geom.y - geom.rect.top },
      origin: { left: geom.rect.left, top: geom.rect.top, width: geom.rect.width, height: geom.rect.height },
      // GRID minutes, not calendar minutes. The day is 5am-anchored, so the
      // column's coordinate space runs 300…1740 and a 02:00 task lives at 1560.
      // Reading raw getHours() here put a post-midnight task 24h below its own
      // column: the resize clamp then collapsed and forced it to 05:00.
      ...gridSpanOf(task),
      moved: false,
      cols: null,
      col: null,
    };
    setActive(true);
  }, []);

  const begin = useCallback((e, task, compact, mode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // An open chooser or occurrence menu is an unresolved drop — settle it
    // (or Esc) before starting another one.
    if (chooserRef.current || occMenuRef.current) return;
    const rect = e.currentTarget.closest('.card').getBoundingClientRect();
    const geom = { x: e.clientX, y: e.clientY, rect };

    if (e.pointerType !== 'touch') {
      openSession(geom, task, compact, mode);
      return;
    }

    // ---- touch: hold to pick up -----------------------------------------
    // Read the coordinates NOW; by the time the timer fires this event object
    // may have been recycled.
    let done = false;
    const stop = () => {
      if (done) return;
      done = true;
      clearTimeout(press.current?.timer);
      press.current = null;
      setPressingId(null);
      window.removeEventListener('pointermove', onPreMove);
      window.removeEventListener('pointerup', stop);
      // pointercancel is the browser saying "this gesture is mine now, I'm
      // scrolling" — the clearest possible signal that no drag was meant.
      window.removeEventListener('pointercancel', stop);
    };
    const onPreMove = (ev) => {
      if (Math.hypot(ev.clientX - geom.x, ev.clientY - geom.y) > TOUCH_SLOP_PX) stop();
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', onPreMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      press.current = null;
      setPressingId(null);
      openSession(geom, task, compact, mode);
      // A pick-up you can't feel is a pick-up you don't trust. Optional and
      // silently absent on desktop and iOS.
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    }, LONG_PRESS_MS);

    press.current = { timer, taskId: task.id };
    setPressingId(task.id);
    window.addEventListener('pointermove', onPreMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [openSession]);

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

  // ---- occurrence-drop menu actions (4C) ---------------------------------
  /**
   * Both answers write ONE exception against this date and leave the pattern
   * alone, then hand the slot to the dropped task.
   *
   * The trailing resolveDropConflicts is an integrity pass, not a second
   * strategy: the engine returns the occurrence menu at the FIRST occurrence it
   * meets, so anything else the drop landed on is still unexamined. Once the
   * session is out of the way we ask the engine to finish its own verdict —
   * which may displace a flexible, or reject outright on a pinned task that was
   * also under the drop. Either way it is the engine's call, not ours.
   */
  const settleOccurrence = useCallback(
    (writeException, verb) => {
      const { task, snap } = occMenuRef.current;
      const res = mutate((s) => {
        writeException(s);
        return s.resolveDropConflicts(task);
      });
      setOccMenu(null);
      if (res.rejected) {
        mutate(() => restoreSpan(task, snap));
        showToast(res.reason);
        return;
      }
      const moved = res.displaced.length;
      showToast(`${verb} — the pattern is unchanged${moved ? ` · ${moved} re-placed` : ''}`);
    },
    [mutate, showToast],
  );

  const chooseOccurrenceMove = useCallback(() => {
    const menu = occMenuRef.current;
    if (!menu || !menu.moveTo) return;
    const { occurrence, moveTo } = menu;
    const toDate = dateKey(moveTo.start);
    settleOccurrence((s) => {
      const parent = s.tasks.find((t) => t.id === occurrence.parentId);
      if (!parent) return;
      addException(parent, occurrence.occurrenceDate, 'move', {
        start: formatHHMM(moveTo.start),
        end: formatHHMM(moveTo.end),
        // Keyed to the original date, so lived data follows the session (§4.4).
        ...(toDate !== occurrence.occurrenceDate ? { toDate } : {}),
      });
    }, 'Moved this session');
  }, [settleOccurrence]);

  const chooseOccurrenceSkip = useCallback(() => {
    const menu = occMenuRef.current;
    if (!menu) return;
    const { occurrence } = menu;
    settleOccurrence((s) => {
      const parent = s.tasks.find((t) => t.id === occurrence.parentId);
      if (parent) addException(parent, occurrence.occurrenceDate, 'skip');
    }, 'Skipped this session');
  }, [settleOccurrence]);

  const cancelOccurrenceMenu = useCallback(() => {
    const menu = occMenuRef.current;
    if (!menu) return;
    mutate(() => restoreSpan(menu.task, menu.snap));
    showToast('Snapped back');
    setOccMenu(null);
  }, [mutate, showToast]);

  // Esc cancels the drop from anywhere while the menu is open. The menu holds
  // focus but does not pre-select an answer, so Esc is the only key that acts.
  useEffect(() => {
    if (!occMenu) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelOccurrenceMenu();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [occMenu, cancelOccurrenceMenu]);

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

  // A hold that outlives its card (the week flips, the panel closes) must not
  // fire a drag on a task that is no longer under the finger.
  useEffect(() => () => clearTimeout(press.current?.timer), []);

  return {
    ghost,
    hiddenId,
    chooser,
    chooserLabel,
    occMenu,
    pressingId,
    busy: active || !!chooser || !!occMenu,
    onMoveStart,
    onResizeStart,
    chooseRipple,
    chooseDisplace,
    cancelChooser,
    chooseOccurrenceMove,
    chooseOccurrenceSkip,
    cancelOccurrenceMenu,
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
