// RightPanel — the single slim contextual panel. One mode at a time; opening a
// new mode replaces the current (App owns `selection`). Closed by default.
import TaskPanel from './panels/TaskPanel.jsx';
import AddTaskPanel from './panels/AddTaskPanel.jsx';
import AddProjectPanel from './panels/AddProjectPanel.jsx';
import FindPanel from './panels/FindPanel.jsx';
import WhatToDoPanel from './panels/WhatToDoPanel.jsx';

export default function RightPanel({ selection, resolvedTask, sched, mutate, weekStart, now, onClose, onOpenTask, showToast }) {
  let body = null;
  if (selection === 'add-task') {
    body = <AddTaskPanel sched={sched} mutate={mutate} weekStart={weekStart} onClose={onClose} showToast={showToast} />;
  } else if (selection === 'add-project') {
    body = <AddProjectPanel mutate={mutate} weekStart={weekStart} onClose={onClose} showToast={showToast} />;
  } else if (selection === 'find') {
    body = <FindPanel sched={sched} weekStart={weekStart} onClose={onClose} showToast={showToast} />;
  } else if (selection === 'wtd') {
    body = <WhatToDoPanel sched={sched} now={now} onOpenTask={onOpenTask} onClose={onClose} />;
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
      />
    );
  } else {
    return null;
  }
  return <aside className="panel">{body}</aside>;
}
