// WhatToDoPanel — answers "what now?" on demand (never auto-opens, never nags).
// Shows the real opening you have, ranks EXISTING tasks that could actually fill
// it (whatToDo), and can schedule the pick into that opening ("Do it now").
// Tag chips narrow the question — "what should I do in study mode?".
import { useState } from 'react';
import { currentOpening, openingLabel, resolveDropConflicts, addMinutes, formatHHMM } from '../../../core/index.js';
import { tagsInUse } from '../TagEditor.jsx';
import PanelHeader from '../PanelHeader.jsx';
import Icon from '../../Icon.jsx';

export default function WhatToDoPanel({ sched, now, mutate, onOpenTask, onClose, showToast }) {
  const [head, setHead] = useState(0);
  const [tags, setTags] = useState([]);

  const opening = currentOpening(sched, now);
  const pool = tagsInUse(sched);
  const filterTags = tags.length ? tags : null;

  const toggleTag = (t) => {
    setHead(0);
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };

  // Schedule the pick into the opening — the answer becomes an action.
  const doItNow = (task) => {
    if (!opening) return;
    const start = opening.start;
    const end = addMinutes(start, task.getDuration() || 60);
    let outcome = null;
    mutate((s) => {
      const t = s.tasks.find((x) => x.id === task.id);
      if (!t) return;
      s.updateTask(t.id, { startTime: start, endTime: end, placedBy: 'user' });
      outcome = resolveDropConflicts(s, t);
    });
    const moved = outcome && outcome.displaced ? outcome.displaced.length : 0;
    showToast(
      `${task.title} → ${formatHHMM(start)}${moved ? ` · ${moved} moved aside` : ''}`,
    );
  };

  // "Do it now" for a library activity: instantiate it into the opening, sized to
  // fill it. The only mutation the picker ever makes — cycling records nothing.
  const doActivityNow = (activity) => {
    if (!opening) return;
    let outcome = null;
    mutate((s) => { outcome = s.placeActivity(activity, opening.start, opening.minutes); });
    const moved = outcome && outcome.displaced ? outcome.displaced.length : 0;
    showToast(`${activity.label} → ${formatHHMM(opening.start)}${moved ? ` · ${moved} moved aside` : ''}`);
  };

  // Real waiting tasks first; library activities are the fallback that surfaces as
  // you cycle past them (or when nothing waiting fits). One combined cycle list.
  const taskPicks = sched.whatToDo(now, { tags: filterTags });
  let libraryPicks = opening ? sched.suggestActivities(now, { opening, limit: 5 }) : [];
  if (filterTags) libraryPicks = libraryPicks.filter((p) => (p.activity.tags || []).some((t) => filterTags.includes(t)));
  const entries = [
    ...taskPicks.map((p) => ({
      type: 'task', key: `t:${p.task.id}`, title: p.task.title, reasons: p.reasons,
      fromLibrary: false, deadline: p.task.deadline,
      onOpen: () => onOpenTask(p.task), onDo: () => doItNow(p.task),
    })),
    ...libraryPicks.map((p) => ({
      type: 'activity', key: `a:${p.activity.id}`, title: p.activity.label, reasons: p.reasons,
      fromLibrary: true, deadline: null,
      onOpen: null, onDo: () => doActivityNow(p.activity),
    })),
  ];

  const openingLine = opening
    ? opening.startsLater
      ? `Your day starts at ${formatHHMM(opening.start)} — a ${openingLabel(opening.minutes)} opening then.`
      : `You have a ${openingLabel(opening.minutes)} opening${opening.nextTask ? ` until ${opening.nextTask.title} at ${formatHHMM(opening.end)}` : ' left today'}.`
    : "Your day's window is done — nothing to squeeze in.";

  return (
    <>
      <PanelHeader title="Right now" sub="what to do" onClose={onClose} />

      <p className="psub-note" style={{ marginBottom: 10 }}>{openingLine}</p>

      {pool.length > 0 && (
        <div className="fieldrow">
          <div className="flabel">In the mood for</div>
          <div className="chips">
            {pool.map((t) => (
              <button
                key={t}
                type="button"
                className={`pill tag${tags.includes(t) ? ' on' : ''}`}
                aria-pressed={tags.includes(t)}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            ))}
            {tags.length > 0 && (
              <button type="button" className="linkish soft" onClick={() => { setTags([]); setHead(0); }}>clear</button>
            )}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="empty">
          <Icon name="crab" style={{ width: 26, height: 26 }} /><br />
          {tags.length ? 'Nothing tagged that way is waiting.' : 'Nothing waiting. Enjoy the shore.'}
        </div>
      ) : (
        <>
          {(() => {
            const order = entries.map((_, i) => entries[(i + head) % entries.length]);
            const [pick, ...alts] = order;
            const openProps = pick.onOpen
              ? { role: 'button', tabIndex: 0, onClick: pick.onOpen, onKeyDown: (e) => { if (e.key === 'Enter') pick.onOpen(); } }
              : {};
            return (
              <>
                <div className="pick" {...openProps}>
                  <div className="pt2">
                    <span>{pick.title}</span>
                    {pick.fromLibrary && <span className="dueno">from your library</span>}
                    {pick.deadline && <span className="dueno">has a deadline</span>}
                  </div>
                  <div className="why">{capitalize(pick.reasons.join(' · '))}</div>
                </div>

                {opening && (
                  <button type="button" className="btn cta" style={{ marginTop: 8 }} onClick={pick.onDo}>
                    <Icon name="compass" /> Do it now — {formatHHMM(opening.start)}
                  </button>
                )}

                {alts.length > 0 && (
                  <div className="alts">
                    {alts.map((a) => (
                      <button
                        key={a.key}
                        className="alt"
                        onClick={a.onOpen ? a.onOpen : () => setHead(entries.findIndex((e) => e.key === a.key))}
                      >
                        <span>{a.title}{a.fromLibrary ? ' · library' : ''}</span>
                        <span className="why">{a.reasons[0]}</span>
                      </button>
                    ))}
                  </div>
                )}

                <button type="button" className="btn" style={{ marginTop: 11 }} onClick={() => setHead((h) => (h + 1) % entries.length)} disabled={entries.length < 2}>
                  <Icon name="refresh" /> Another →
                </button>
              </>
            );
          })()}
        </>
      )}

      <p className="psub-note" style={{ marginTop: 12 }}>Never auto-opens, never nags — it just answers &quot;what now?&quot; when you ask. (P-1)</p>
    </>
  );
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
