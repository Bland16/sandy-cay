// App.jsx — Sandy Cay shell + state (Phase 2, M1). The engine (src/core) is the
// single source of truth via useEngine(); every mutation calls an engine method
// then re-reads. Layout is a faithful port of design/layout-interactive.html:
// week grid + contextual right panel (closed by default), day view as a
// main-area mode, Cabana as its own full page.
import { useState, useEffect, useCallback, useRef } from 'react';
import './ui/styles.css';
import {
  weekStart as weekStartOf, addDays, letThemGo,
} from './core/index.js';
import { useEngine } from './ui/useEngine.js';
import TopBar from './ui/components/TopBar.jsx';
import WeekGrid from './ui/components/WeekGrid.jsx';
import DayView from './ui/components/DayView.jsx';
import RightPanel from './ui/components/RightPanel.jsx';
import Cabana from './ui/components/Cabana.jsx';

export default function App() {
  const { sched, version, mutate, replace, persistence, saveState } = useEngine();
  const now = useRef(new Date()).current;
  const [weekStart, setWeekStart] = useState(() => weekStartOf(now));
  const [view, setView] = useState('week'); // 'week' | 0..6 | 'cabana'
  const [selection, setSelection] = useState(null); // null | 'wtd'|'find'|'add-task'|'add-project' | {taskId}
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const closePanel = useCallback(() => setSelection(null), []);

  // Esc: close the panel first, else leave day view / Cabana back to the week.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selection) setSelection(null);
      else if (view !== 'week') setView('week');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, view]);

  const onSelect = useCallback((mode) => {
    if (mode === 'cabana') { setView('cabana'); setSelection(null); return; }
    setSelection((prev) => (prev === mode ? null : mode));
  }, []);

  const openTask = useCallback((task) => setSelection({ taskId: task.id }), []);

  const toggleComplete = useCallback((task) => {
    const wasDone = task.completion === 'done';
    mutate((s) => {
      if (task.isOccurrence) {
        const parent = s.tasks.find((t) => t.id === task.parentId);
        if (!parent) return;
        const key = task.occurrenceDate;
        const prev = parent.occurrenceData[key] || {};
        parent.occurrenceData = { ...parent.occurrenceData, [key]: { ...prev, completion: wasDone ? null : 'done' } };
      } else {
        s.updateTask(task.id, { completion: wasDone ? null : 'done' });
      }
    });
    if (!wasDone) {
      showToast('Done — how did it fit?');
      if (!task.isOccurrence) setSelection({ taskId: task.id });
    }
  }, [mutate, showToast]);

  // Week-level ops.
  const reoptimize = () => { const r = mutate((s) => s.autoSchedule({ weekStart })); showToast(`Re-optimized · ${r.placed.length} placed, ${r.warnings.length} flagged`); };
  const wrapUp = () => { const r = mutate((s) => s.carryOver(weekStart, addDays(weekStart, 7))); showToast(`Wrapped · ${r.carried.length} carried, ${r.missedDeadline.length} missed`); };
  const wrapReport = () => showToast('Wrap report (PDF) — coming in M2');
  const blockDays = (from, to, label) => { const r = mutate((s) => s.blockRange(from, to, label)); showToast(`Blocked ${r.length || ''} day(s)`.trim()); };

  const carryForward = () => { const r = mutate((s) => s.carryOver(weekStart, weekStartOf(now))); showToast(`Carried ${r.carried.length} forward`); };
  const letGo = () => { const r = mutate((s) => letThemGo(s, weekStart)); showToast(`Released ${r.length} — guilt-free`); };

  const gotoWeek = (deltaWeeks) => { setWeekStart((w) => addDays(w, deltaWeeks * 7)); setView('week'); };

  // Reads (version keeps this fresh after every mutation).
  void version;
  const weekTasks = sched.getTasksForWeek(weekStart);
  const resolvedTask = selection && typeof selection === 'object'
    ? weekTasks.find((t) => t.id === selection.taskId) || null
    : null;
  const panelSelection = selection && typeof selection === 'object' ? (resolvedTask ? selection : null) : selection;

  const isPastWeek = weekStart.getTime() < weekStartOf(now).getTime();
  const hasCarryable = isPastWeek && weekTasks.some((t) => t.completion === null && !t.recurrence && !t.chunking && t.endTime.getTime() < now.getTime());

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
                />
              ) : (
                <WeekGrid
                  sched={sched}
                  weekStart={weekStart}
                  today={now}
                  onOpenTask={openTask}
                  onToggleComplete={toggleComplete}
                  onOpenDay={(i) => { setView(i); setSelection(null); }}
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
              />
            )}
          </div>
        )}

        <div className="footer">
          <span className="statusdot">
            <span className={`dot ${persistence}`} />
            {persistence === 'persistent' ? 'Saved to this device' : 'Session only'}
            {saveState === 'dirty' ? ' · saving…' : ''}
          </span>
          <span className="grow" />
          <span>{weekTasks.length} items this week</span>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
