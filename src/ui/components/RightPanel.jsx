// RightPanel — the single slim contextual panel. One mode at a time; opening a
// new mode replaces the current (App owns `selection`). Closed by default.
import TaskPanel from './panels/TaskPanel.jsx';
import AddTaskPanel from './panels/AddTaskPanel.jsx';
import AddProjectPanel from './panels/AddProjectPanel.jsx';
import FindPanel from './panels/FindPanel.jsx';
import WhatToDoPanel from './panels/WhatToDoPanel.jsx';
import { DayNotesPanel, dayNotesIndex } from './DayNotes.jsx';
import { addDays } from '../../core/index.js';
import { DAY_FULL } from '../format.js';

export default function RightPanel({ selection, resolvedTask, sched, mutate, weekStart, now, onClose, onOpenTask, showToast, onGapFreed, onJump }) {
  let body = null;
  const notesDay = dayNotesIndex(selection);
  if (notesDay !== null) {
    body = (
      <DayNotesPanel
        sched={sched}
        date={addDays(weekStart, notesDay)}
        dayName={DAY_FULL[notesDay]}
        onClose={onClose}
        onToggleBlock={(d) => {
          const nowBlocked = mutate((s) => (s.isDayBlocked(d) ? !s.unblockDay(d) : s.blockDay(d)));
          showToast(nowBlocked
            ? 'Blocked — the scheduler stays off this day.'
            : 'Unblocked — this day is back in play.');
        }}
      />
    );
  } else if (selection === 'add-task') {
    body = <AddTaskPanel sched={sched} mutate={mutate} weekStart={weekStart} onClose={onClose} showToast={showToast} onJump={onJump} />;
  } else if (selection === 'add-project') {
    body = <AddProjectPanel mutate={mutate} weekStart={weekStart} onClose={onClose} showToast={showToast} />;
  } else if (selection === 'find') {
    body = <FindPanel sched={sched} weekStart={weekStart} onClose={onClose} showToast={showToast} />;
  } else if (selection === 'wtd') {
    body = <WhatToDoPanel sched={sched} now={now} mutate={mutate} onOpenTask={onOpenTask} onClose={onClose} showToast={showToast} />;
  } else if (resolvedTask) {
    body = (
      <TaskPanel
        key={resolvedTask.id}
        task={resolvedTask}
        sched={sched}
        mutate={mutate}
        weekStart={weekStart}
        onClose={onClose}
        showToast={showToast}
        onGapFreed={onGapFreed}
      />
    );
  } else {
    return null;
  }
  return <aside className="panel">{body}</aside>;
}
