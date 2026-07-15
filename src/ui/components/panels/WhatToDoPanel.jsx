// WhatToDoPanel — answers "what now?" on demand (never auto-opens, never nags).
// Ranks EXISTING tasks via whatToDo(now); shows the top pick + reasons +
// alternates + "another" to advance through the ranking. Cold-start aware (the
// engine drops the learned term until ≥10 ratings).
import { useState } from 'react';
import PanelHeader from '../PanelHeader.jsx';
import Icon from '../../Icon.jsx';

export default function WhatToDoPanel({ sched, now, onOpenTask, onClose }) {
  const ranked = sched.whatToDo(now);
  const [head, setHead] = useState(0);

  if (ranked.length === 0) {
    return (
      <>
        <PanelHeader title="Right now" sub="what to do" onClose={onClose} />
        <div className="empty"><Icon name="crab" style={{ width: 26, height: 26 }} /><br />Nothing waiting. Enjoy the shore.</div>
      </>
    );
  }

  const order = ranked.map((_, i) => ranked[(i + head) % ranked.length]);
  const [pick, ...alts] = order;
  const due = pick.task.deadline;

  return (
    <>
      <PanelHeader title="Right now" sub="what to do" onClose={onClose} />
      <div className="pick" role="button" tabIndex={0} onClick={() => onOpenTask(pick.task)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenTask(pick.task); }}>
        <div className="pt2">
          <span>{pick.task.title}</span>
          {due && <span className="dueno">has a deadline</span>}
        </div>
        <div className="why">{pick.reasons.length ? capitalize(pick.reasons.join(' · ')) : 'Highest-scoring pick for right now.'}</div>
      </div>
      {alts.length > 0 && (
        <div className="alts">
          {alts.map((a) => (
            <button key={a.task.id} className="alt" onClick={() => onOpenTask(a.task)}>
              <span>{a.task.title}</span>
              <span className="why">{a.reasons[0] || `priority ${a.task.priority}`}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn" style={{ marginTop: 11 }} onClick={() => setHead((h) => (h + 1) % ranked.length)} disabled={ranked.length < 2}>
        <Icon name="refresh" /> Another →
      </button>
      <p className="psub-note" style={{ marginTop: 12 }}>Never auto-opens, never nags — it just answers "what now?" when you ask. (P-1)</p>
    </>
  );
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
