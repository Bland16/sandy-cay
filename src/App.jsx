// App.jsx — Sandy Cay shell + state (Phase 2, M1 + M2). The engine (src/core) is
// the single source of truth via useEngine(); every mutation calls an engine
// method then re-reads. Layout is a faithful port of design/layout-interactive.html:
// week grid + contextual right panel (closed by default), day view as a
// main-area mode, Cabana as its own full page.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './ui/styles.css';
import {
  weekStart as weekStartOf, addDays, letThemGo, dateKey, addException, formatHHMM,
  minutesBetween,
} from './core/index.js';
import { useEngine } from './ui/useEngine.js';
import { useCardInteraction } from './ui/useCardInteraction.js';
import { MIN_DURATION_MIN } from './ui/interaction.js';
import { backfillCandidates, backfillGap, protectGap, protectSomeRecovery, worthOffering } from './ui/gapActions.js';
import { fmtDur, DAY_NAMES } from './ui/format.js';
import TopBar from './ui/components/TopBar.jsx';
import WeekGrid from './ui/components/WeekGrid.jsx';
import DayView from './ui/components/DayView.jsx';
import RightPanel from './ui/components/RightPanel.jsx';
import Cabana from './ui/components/Cabana.jsx';
import TaskCard from './ui/components/TaskCard.jsx';
import ConflictChooser from './ui/components/ConflictChooser.jsx';
import ClearDayPanel, { applyClearDay } from './ui/components/ClearDayPanel.jsx';
import GapToast from './ui/components/GapToast.jsx';
import OccurrenceMenu from './ui/components/OccurrenceMenu.jsx';
import OverpackNotice from './ui/components/OverpackNotice.jsx';
import Icon from './ui/Icon.jsx';

const GAP_OFFER_MS = 9000; // long enough to read three options and choose one

/**
 * Where a task finished early should be cut (§3.9 / 3D), or null if there's
 * nothing to truncate. "Early" means genuinely mid-session: finishing something
 * that hasn't started frees nothing that was ever yours, and finishing after
 * the end is just finishing. The 15-minute floor is OD-1's, the same one the
 * resize borders enforce.
 */
function truncationFor(task, at) {
  const start = task.startTime.getTime();
  const end = task.endTime.getTime();
  const t = at.getTime();
  if (t <= start || t >= end) return null;
  const cut = new Date(Math.max(t, start + MIN_DURATION_MIN * 60000));
  return cut.getTime() < end ? cut : null;
}

export default function App() {
  const { sched, version, mutate, replace, persistence, saveState } = useEngine();
  const now = useRef(new Date()).current;
  const [weekStart, setWeekStart] = useState(() => weekStartOf(now));
  const [view, setView] = useState('week'); // 'week' | 0..6 | 'cabana'
  const [selection, setSelection] = useState(null); // null | 'wtd'|'find'|'add-task'|'add-project' | {taskId}
  const [toast, setToast] = useState(null);
  const [dayMenu, setDayMenu] = useState(null); // { dayIndex, anchor } — the day-header ⋯
  const [clearDay, setClearDay] = useState(null); // { dayIndex, anchor } — OD-7 panel
  const [gapOffer, setGapOffer] = useState(null); // { gap, label } — 3C / 3D
  const [truncations, setTruncations] = useState({}); // taskId → original end (session-only)
  const [overpack, setOverpack] = useState(null); // { weekKey, packedDays } — §7.3
  const toastTimer = useRef(null);
  const gapTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(gapTimer.current); }, []);

  const closePanel = useCallback(() => setSelection(null), []);

  // Drag / resize / conflict-chooser / occurrence-menu physics (M2.1 + M2.2).
  const interaction = useCardInteraction({ sched, mutate, showToast, weekStart });

  // ---- 3C / 3D — the freed-gap offer ------------------------------------
  /** Leave open is the default AND the auto-dismiss, so ignoring this is a real
   *  answer rather than a decision deferred (P-1). */
  const dismissGap = useCallback(() => {
    clearTimeout(gapTimer.current);
    setGapOffer(null);
  }, []);

  const offerGap = useCallback((gap, label) => {
    if (!worthOffering(sched, gap)) return; // §3.8: under 45 min, say nothing
    setGapOffer({ gap, label });
    clearTimeout(gapTimer.current);
    gapTimer.current = setTimeout(() => setGapOffer(null), GAP_OFFER_MS);
  }, [sched]);

  const doBackfill = useCallback(() => {
    const r = mutate((s) => backfillGap(s, gapOffer.gap));
    dismissGap();
    showToast(r ? `Backfilled · ${r.task.title} moved in` : 'Nothing fits that gap on its own');
  }, [gapOffer, mutate, dismissGap, showToast]);

  const doProtect = useCallback(() => {
    mutate((s) => protectGap(s, gapOffer.gap));
    dismissGap();
    showToast('Protected as recovery time');
  }, [gapOffer, mutate, dismissGap, showToast]);

  // ---- 3D — completion ---------------------------------------------------
  const toggleComplete = useCallback((task) => {
    const wasDone = task.completion === 'done';
    const cut = wasDone ? null : truncationFor(task, new Date());
    const originalEnd = new Date(task.endTime.getTime());
    // Un-completing restores the span the early finish truncated — a mis-click
    // must not permanently shorten a task.
    const restore = wasDone ? truncations[task.id] : null;

    mutate((s) => {
      if (task.isOccurrence) {
        const parent = s.tasks.find((t) => t.id === task.parentId);
        if (!parent) return;
        const key = task.occurrenceDate;
        const prev = parent.occurrenceData[key] || {};
        parent.occurrenceData = { ...parent.occurrenceData, [key]: { ...prev, completion: wasDone ? null : 'done' } };
        // §4.4: a session that ended early is one session, not a new routine —
        // so the truncation is an exception, never a change to the pattern.
        //
        // addException REPLACES the whole exception for a date, so an existing
        // relocation has to be carried across explicitly: a session already
        // moved to another day must not snap back to its pattern day just
        // because it finished early.
        const newEnd = cut || restore;
        if (newEnd) {
          const prevEx = (parent.recurrence.exceptions || []).find((e) => e.date === key);
          addException(parent, key, 'move', {
            start: formatHHMM(task.startTime),
            end: formatHHMM(newEnd),
            ...(prevEx && prevEx.toDate ? { toDate: prevEx.toDate } : {}),
          });
        }
      } else {
        s.updateTask(task.id, {
          completion: wasDone ? null : 'done',
          ...(cut ? { endTime: cut } : {}),
          ...(restore ? { endTime: restore } : {}),
        });
      }
    });

    if (wasDone) {
      if (restore) setTruncations((m) => { const next = { ...m }; delete next[task.id]; return next; });
      return;
    }
    if (cut) {
      setTruncations((m) => ({ ...m, [task.id]: originalEnd }));
      offerGap({ start: cut, end: originalEnd }, `${task.title} finished early`);
      if (!worthOffering(sched, { start: cut, end: originalEnd })) showToast('Done — how did it fit?');
    } else {
      showToast('Done — how did it fit?');
    }
    if (!task.isOccurrence) setSelection({ taskId: task.id });
  }, [mutate, showToast, offerGap, truncations, sched]);

  /** A task (or a session) whose time just came free — §3.8's other entry. */
  const onGapFreed = useCallback((gap, label) => offerGap(gap, label), [offerGap]);

  // ---- OD-7 — Clear Day --------------------------------------------------
  const commitClearDay = useCallback((plan) => {
    const date = addDays(weekStart, clearDay.dayIndex);
    const r = mutate((s) => applyClearDay(s, date, plan));
    setClearDay(null);
    const bits = [`${r.relocated.length} relocated`];
    if (r.resolved.moved) bits.push(`${r.resolved.moved} rescheduled`);
    if (r.resolved.skipped) bits.push(`${r.resolved.skipped} skipped`);
    if (plan.scope === 'flexibles' && r.needsReview.length) bits.push(`${r.needsReview.length} left in place`);
    if (plan.blockDay) bits.push('day blocked');
    showToast(`${DAY_NAMES[clearDay.dayIndex]} cleared · ${bits.join(', ')}`);
  }, [clearDay, weekStart, mutate, showToast]);

  // ---- §7.3 — overpack ---------------------------------------------------
  const weekKey = dateKey(weekStart);
  const showOverpack = overpack && overpack.weekKey === weekKey;
  const doRecovery = useCallback(() => {
    const blocker = mutate((s) => protectSomeRecovery(s, weekStart, now));
    setOverpack(null);
    showToast(
      blocker
        ? `Recovery time blocked · ${DAY_NAMES[(blocker.startTime.getDay() + 6) % 7]} ${formatHHMM(blocker.startTime)}`
        : 'No opening this week to protect — the week is genuinely full',
    );
  }, [mutate, weekStart, now, showToast]);

  // Esc: a live drag, an open chooser or an open occurrence menu owns Escape
  // first (they cancel their own operation); then the transient overlays,
  // newest-first; then the panel; then the view.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (interaction.busy) return;
      if (clearDay) setClearDay(null);
      else if (dayMenu) setDayMenu(null);
      else if (gapOffer) dismissGap();
      else if (selection) setSelection(null);
      else if (view !== 'week') setView('week');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, view, interaction.busy, clearDay, dayMenu, gapOffer, dismissGap]);

  const onSelect = useCallback((mode) => {
    if (mode === 'cabana') { setView('cabana'); setSelection(null); return; }
    setSelection((prev) => (prev === mode ? null : mode));
  }, []);

  // A drag ends with a click event on the card; that must not also open the panel.
  const openTask = useCallback((task) => {
    if (interaction.shouldSuppressClick()) return;
    setSelection({ taskId: task.id });
  }, [interaction]);

  // Week-level ops.
  const reoptimize = () => {
    const r = mutate((s) => s.autoSchedule({ weekStart }));
    showToast(`Re-optimized · ${r.placed.length} placed, ${r.warnings.length} flagged`);
    // §7.3: the notice fires on full autoSchedule runs ONLY, never on a drag,
    // and a fresh run replaces (or clears) whatever the last one said.
    setOverpack(
      r.overpack && r.overpack.overpacked
        ? { weekKey: dateKey(weekStart), packedDays: r.overpack.packedDays }
        : null,
    );
  };
  const wrapUp = () => { const r = mutate((s) => s.carryOver(weekStart, addDays(weekStart, 7))); showToast(`Wrapped · ${r.carried.length} carried, ${r.missedDeadline.length} missed`); };
  const wrapReport = () => showToast('Wrap report (PDF) — coming in M2');
  const blockDays = (from, to, label) => { const r = mutate((s) => s.blockRange(from, to, label)); showToast(`Blocked ${r.length || ''} day(s)`.trim()); };

  const carryForward = () => { const r = mutate((s) => s.carryOver(weekStart, weekStartOf(now))); showToast(`Carried ${r.carried.length} forward`); };
  const letGo = () => { const r = mutate((s) => letThemGo(s, weekStart)); showToast(`Released ${r.length} — guilt-free`); };

  const gotoWeek = (deltaWeeks) => {
    setWeekStart((w) => addDays(w, deltaWeeks * 7));
    setView('week');
    setDayMenu(null);
    setClearDay(null);
  };

  // Reads (version keeps this fresh after every mutation).
  void version;
  const weekTasks = sched.getTasksForWeek(weekStart);
  const resolvedTask = selection && typeof selection === 'object'
    ? weekTasks.find((t) => t.id === selection.taskId) || null
    : null;
  const panelSelection = selection && typeof selection === 'object' ? (resolvedTask ? selection : null) : selection;

  const isPastWeek = weekStart.getTime() < weekStartOf(now).getTime();
  const hasCarryable = isPastWeek && weekTasks.some((t) => t.completion === null && !t.recurrence && !t.chunking && t.endTime.getTime() < now.getTime());

  // What Backfill would actually do, named before it's clicked (P-1: an action
  // that can't be previewed is an action you can't consent to).
  // `version` is a real dependency, not a cache-buster: sched is a mutable
  // instance held in a ref, so the bump is the only signal that its contents
  // changed and the candidate list needs recomputing.
  const backfillPick = useMemo(
    () => (gapOffer ? backfillCandidates(sched, gapOffer.gap)[0] : null),
    [gapOffer, sched, version],
  );

  const notice = showOverpack ? (
    <OverpackNotice
      packedDays={overpack.packedDays}
      onProtect={doRecovery}
      onDismiss={() => setOverpack(null)}
    />
  ) : null;

  return (
    <div className="stage">
      <header className="masthead">
        <h1>Sandy&nbsp;Cay</h1>
        <p>A schedule that never guilts — week grid, a panel that opens on what you pick, day views, and the Cabana.</p>
      </header>

      <div className="frame">
        <div className="filmstrip" aria-hidden="true" />

        {view !== 'cabana' && (
          <TopBar
            sched={sched}
            weekStart={weekStart}
            now={now}
            selection={panelSelection}
            onSelect={onSelect}
            onPrev={() => gotoWeek(-1)}
            onNext={() => gotoWeek(1)}
            onToday={() => { setWeekStart(weekStartOf(now)); setView('week'); }}
            onJump={(d) => { setWeekStart(weekStartOf(d)); setView('week'); }}
            onReoptimize={reoptimize}
            onWrapUp={wrapUp}
            onWrapReport={wrapReport}
            onBlock={blockDays}
          />
        )}

        {isPastWeek && hasCarryable && view !== 'cabana' && (
          <div className="banner">
            <span className="grow">This week has passed. Carry unfinished tasks forward, or let them go?</span>
            <button className="cta" onClick={carryForward}>Carry forward</button>
            <button onClick={letGo}>Let them go</button>
          </div>
        )}

        {view === 'cabana' ? (
          <Cabana
            sched={sched}
            mutate={mutate}
            weekStart={weekStart}
            onBack={() => setView('week')}
            onReplace={replace}
            showToast={showToast}
          />
        ) : (
          <div className="body">
            <div className="main">
              {typeof view === 'number' ? (
                <DayView
                  sched={sched}
                  weekStart={weekStart}
                  dayIndex={view}
                  onBack={() => setView('week')}
                  onOpenTask={openTask}
                  onToggleComplete={toggleComplete}
                  interaction={interaction}
                  truncations={truncations}
                />
              ) : (
                <WeekGrid
                  sched={sched}
                  weekStart={weekStart}
                  today={now}
                  onOpenTask={openTask}
                  onToggleComplete={toggleComplete}
                  onOpenDay={(i) => { setView(i); setSelection(null); }}
                  onDayMenu={(dayIndex, anchor) => {
                    setClearDay(null);
                    setDayMenu((m) => (m && m.dayIndex === dayIndex ? null : { dayIndex, anchor }));
                  }}
                  interaction={interaction}
                  truncations={truncations}
                  notice={notice}
                />
              )}
            </div>
            {panelSelection && (
              <RightPanel
                selection={typeof panelSelection === 'string' ? panelSelection : null}
                resolvedTask={resolvedTask}
                sched={sched}
                mutate={mutate}
                weekStart={weekStart}
                now={now}
                onClose={closePanel}
                onOpenTask={openTask}
                showToast={showToast}
                onGapFreed={onGapFreed}
              />
            )}
          </div>
        )}

        <div className="footer">
          <span className="statusdot">
            <span className={`dot ${persistence}`} />
            {persistence === 'persistent' ? 'Saved to this device' : 'Session only'}
            {saveState === 'dirty' ? ' · saving…' : ''}
            {/* A write failed after startup (quota, private mode). Say so, and
                point at the durable copy rather than quietly losing the week. */}
            {saveState === 'unsaved' ? ' · couldn’t save — export from the Cabana to keep it' : ''}
          </span>
          <span className="grow" />
          <span>{weekTasks.length} items this week</span>
        </div>
      </div>

      {/* Day-header ⋯ (3A / OD-7). Fixed to the viewport: the grid scrolls, and
          a menu clipped by its own scroll container is a menu you can't use. */}
      {dayMenu && (
        <div
          className="dropdown daymenu"
          role="menu"
          style={{ left: Math.min(dayMenu.anchor.left, window.innerWidth - 188), top: dayMenu.anchor.bottom + 4 }}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => { setClearDay({ dayIndex: dayMenu.dayIndex, anchor: dayMenu.anchor }); setDayMenu(null); }}
          >
            <Icon name="umbrella" size={15} /> Clear this day…
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => { setView(dayMenu.dayIndex); setSelection(null); setDayMenu(null); }}
          >
            <Icon name="cal" size={15} /> Open day view
          </button>
        </div>
      )}

      {clearDay && (
        <ClearDayPanel
          sched={sched}
          date={addDays(weekStart, clearDay.dayIndex)}
          dayIndex={clearDay.dayIndex}
          anchor={clearDay.anchor}
          onCommit={commitClearDay}
          onCancel={() => setClearDay(null)}
        />
      )}

      {/* Drag ghost — fixed to the viewport, above the grid, solid card face. */}
      {interaction.ghost && (
        <TaskCard
          ghost
          task={interaction.ghost.task}
          compact={interaction.ghost.compact}
          style={{
            position: 'fixed',
            left: `${interaction.ghost.rect.left}px`,
            top: `${interaction.ghost.rect.top}px`,
            width: `${interaction.ghost.rect.width}px`,
            height: `${interaction.ghost.rect.height}px`,
          }}
          phase={interaction.ghost.phase}
        />
      )}

      {/* Ripple ⟺ Displace chooser (OD-8) — anchored to the card that landed. */}
      {interaction.chooser && (
        <ConflictChooser
          anchor={interaction.chooser.anchor}
          def={interaction.chooser.def}
          rippleEnabled={interaction.chooser.rippleEnabled}
          label={interaction.chooserLabel}
          deltaMin={interaction.chooser.rippleDelta}
          downstreamCount={interaction.chooser.dayState.downstreamCount}
          onRipple={interaction.chooseRipple}
          onDisplace={interaction.chooseDisplace}
          onCancel={interaction.cancelChooser}
        />
      )}

      {/* Drop onto a recurring session (4C) — mutually exclusive with the
          chooser: a drop is one question at a time. */}
      {interaction.occMenu && (
        <OccurrenceMenu
          anchor={interaction.occMenu.anchor}
          occurrence={interaction.occMenu.occurrence}
          moveTo={interaction.occMenu.moveTo}
          onMove={interaction.chooseOccurrenceMove}
          onSkip={interaction.chooseOccurrenceSkip}
          onCancel={interaction.cancelOccurrenceMenu}
        />
      )}

      {/* One fixed stack, so a gap offer and a plain toast can never land on
          top of each other. */}
      {(toast || gapOffer) && (
        <div className="toastwrap">
          {gapOffer && (
            <GapToast
              label={gapOffer.label}
              minutes={minutesBetween(gapOffer.gap.start, gapOffer.gap.end)}
              canBackfill={!!backfillPick}
              backfillHint={backfillPick ? `${backfillPick.task.title} · ${fmtDur(backfillPick.task.getDuration())}` : ''}
              onLeave={dismissGap}
              onBackfill={doBackfill}
              onProtect={doProtect}
            />
          )}
          {toast && <div className="toast" role="status">{toast}</div>}
        </div>
      )}
    </div>
  );
}
