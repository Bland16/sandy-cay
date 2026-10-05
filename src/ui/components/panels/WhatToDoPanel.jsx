// WhatToDoPanel — answers "what now?" on demand (never auto-opens, never nags).
// Shows the real opening you have, ranks EXISTING tasks that could actually fill
// it (whatToDo), and can schedule the pick into that opening ("Do it now").
// Tag chips narrow the question — "what should I do in study mode?".
import { useState } from 'react';
import {
  currentOpening, openingLabel, resolveDropConflicts, addMinutes, formatHHMM, waitingTodos, dateKey,
} from '../../../core/index.js';
import { tagsInUse } from '../TagEditor.jsx';
import { fmtDur, todoDueText } from '../../format.js';
import PanelHeader from '../PanelHeader.jsx';
import Icon from '../../Icon.jsx';

export default function WhatToDoPanel({ sched, now, mutate, onOpenTask, onClose, showToast }) {
  const [head, setHead] = useState(0);
  const [tags, setTags] = useState([]);
  // Todos (design/TODO-LIST.md §8.3). Its OWN switch, not a tag in the row
  // below: a pseudo-tag would collide with a real tag called "todos", be handed
  // to both tag filters, and vanish with the row when no task carries a tag.
  const [todosWanted, setTodosWanted] = useState(false);
  const [draft, setDraft] = useState('');
  const todoCount = (sched.todos || []).length;
  // ⚠️ Derived, not the raw switch. Do the last todo with the filter on and the
  // switch itself disappears (there is nothing left to filter) — leaving a panel
  // stuck on "todos only", showing nothing, with no way to turn it off.
  const todosOnly = todosWanted && todoCount > 0;
  const todayKey = dateKey(now);

  const opening = currentOpening(sched, now);
  // ⚠️ Todo tags too. `tagsInUse` reads TASKS, so a tag only a todo carried had
  // no chip — the one filter that could find that todo did not exist.
  const pool = Array.from(new Set([...tagsInUse(sched), ...(sched.todos || []).flatMap((t) => t.tags || [])]));
  const filterTags = tags.length ? tags : null;

  const toggleTag = (t) => {
    setHead(0);
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };

  /**
   * Schedule the pick into the opening — the answer becomes an action.
   *
   * ⚠️ TWO DEFECTS LIVED HERE, and they were the same defect (D-15, fixed
   * 2026-09-01). It moved the task's FULL duration into the opening — no clamp,
   * no split — so a 2-hour sitting went into a 45-minute gap and overflowed
   * whatever bounded it. `resolveDropConflicts` then correctly answered
   * `rejected: true, snapBack: true` … and this function read only
   * `outcome.displaced`, so NOTHING SNAPPED IT BACK and the toast reported
   * success. Measured: an ESF sitting placed 11:15–13:15 straight across a
   * pinned 12:00 Advisor meeting, silently.
   *
   * Splitting is what makes both the same fix — a piece that fits cannot
   * overflow — and honouring the rejection is what makes the remaining cases
   * (a sitting that cannot be split, a plain task, an activity) fail honestly
   * instead of double-booking.
   */
  const doItNow = (task) => {
    if (!opening) return;
    const start = opening.start;
    let outcome = null;
    let split = null;
    let landed = null;
    mutate((s) => {
      const t = s.tasks.find((x) => x.id === task.id);
      if (!t) return;
      const before = { startTime: t.startTime, endTime: t.endTime, placedBy: t.placedBy };
      // D-15 — do the part that fits, keep the rest. Only ever a commitment
      // sitting, and only when both halves clear its `minSitting`.
      split = s.splitSitting(t, opening);
      if (!split) {
        s.updateTask(t.id, { startTime: start, endTime: addMinutes(start, t.getDuration() || 60), placedBy: 'user' });
      }
      outcome = resolveDropConflicts(s, t);
      if (outcome && outcome.rejected) {
        // ⚠️ Put everything back, INCLUDING the sibling the split just created.
        // The split writes before the conflict check runs, so a refusal that
        // undid only the move would leave the sitting shortened and the week
        // quietly owing less than it does.
        //
        // DEFENSIVE, and honestly so: a split piece fits INSIDE the opening,
        // and `currentOpening` already walks past everything
        // `resolveDropConflicts` treats as a blocker (it reads
        // `getTasksForDay`, which includes recurrence occurrences). So the
        // split branch cannot currently be rejected, and no test here proves
        // this line — a first attempt at one passed with the line deleted,
        // which is how the tautology was caught. It stays because the
        // invariant it protects (the commitment's total never changes) is the
        // governing rule of WEEKLY-PLANNING §8, and because the day
        // `currentOpening` and the conflict rules drift apart, this is what
        // stops that becoming lost work.
        if (split) s.removeTask(split.rest.id);
        t.startTime = before.startTime;
        t.endTime = before.endTime;
        t.placedBy = before.placedBy;
        split = null;
      } else {
        landed = t.startTime;
      }
    });
    if (outcome && outcome.rejected) {
      showToast(outcome.reason || `${task.title} would not fit there`);
      return;
    }
    const moved = outcome && outcome.displaced ? outcome.displaced.length : 0;
    const rest = split ? ` · ${fmtDur(split.rest.getDuration())} left for later` : '';
    showToast(
      `${task.title} → ${formatHHMM(landed || start)}${rest}${moved ? ` · ${moved} moved aside` : ''}`,
    );
  };

  // "Do it now" for a library activity: instantiate it into the opening, sized to
  // fill it. The only mutation the picker ever makes — cycling records nothing.
  const doActivityNow = (activity) => {
    if (!opening) return;
    let outcome = null;
    mutate((s) => { outcome = s.placeActivity(activity, opening.start, opening.minutes, { now }); });
    // A todo already done (a second tap, or the other device) made no task.
    if (outcome && outcome.gone) {
      showToast(`${activity.label} is already done`);
      return;
    }
    // Honour a refusal, as `doItNow` does: nothing was placed, so say why.
    if (outcome && outcome.rejected) {
      showToast(outcome.reason || `${activity.label} would not fit there`);
      return;
    }
    const moved = outcome && outcome.displaced ? outcome.displaced.length : 0;
    // Said, because it is not undoable from here: the todo is a task now, and
    // deleting that task does not bring the todo back (D-4).
    const left = activity.isTodo ? ' · moved off your todo list' : '';
    showToast(`${activity.label} → ${formatHHMM(opening.start)}${moved ? ` · ${moved} moved aside` : ''}${left}`);
    setHead(0);
  };

  /** "+ todo": a name is enough. 15–30m and no tags; the Cabana card has the rest. */
  const addTodo = (e) => {
    e.preventDefault();
    const label = draft.trim();
    if (!label) return;
    mutate((s) => s.addTodo({ label }));
    setDraft('');
    setHead(0);
    showToast(`Added to your todos: ${label}`);
  };

  // Real waiting tasks first; library activities are the fallback that surfaces as
  // you cycle past them (or when nothing waiting fits). One combined cycle list.
  // With the todos filter on, waiting tasks step aside: the question asked was
  // "which of my todos", and three tasks ahead of every answer is not an answer.
  const taskPicks = todosOnly ? [] : sched.whatToDo(now, { tags: filterTags });
  // ⚠️ THE FILTER GOES IN, IT IS NOT APPLIED TO WHAT COMES OUT. Taking the top 5
  // and filtering the survivors meant picking a category showed nothing unless
  // one of its activities made an unfiltered top five — measured on the real
  // library, 7 of 9 categories came back empty with 2–7 fitting activities each.
  // See the note on `suggestActivities`.
  const libraryPicks = opening
    ? sched.suggestActivities(now, { opening, limit: 5, tags: filterTags, todosOnly })
    : [];
  // The todos that cannot be done right now — too long for this opening, or no
  // opening at all — so the panel never claims that nothing is waiting over a
  // list that plainly is. ⚠️ Worked out WHETHER OR NOT the filter is on: with it
  // off, an evening with one overdue todo read "Todos · 1" directly above
  // "Nothing waiting. Enjoy the shore."
  const cannotNow = waitingTodos(sched, now, { opening, tags: filterTags });
  const entries = [
    ...taskPicks.map((p) => ({
      type: 'task', key: `t:${p.task.id}`, title: p.task.title, reasons: p.reasons,
      fromLibrary: false, deadline: p.task.deadline,
      onOpen: () => onOpenTask(p.task), onDo: () => doItNow(p.task),
    })),
    ...libraryPicks.map((p) => ({
      type: p.isTodo ? 'todo' : 'activity',
      key: `${p.isTodo ? 'd' : 'a'}:${p.activity.id}`,
      title: p.activity.label,
      reasons: p.reasons,
      fromLibrary: !p.isTodo,
      isTodo: !!p.isTodo,
      // A FACT about a date, in neutral ink — never `.dueno`'s coral (§8.5).
      dueText: p.isTodo ? todoDueText(p.deadline, todayKey) : '',
      deadline: null,
      onOpen: null, onDo: () => doActivityNow(p.activity),
    })),
  ];

  // Listed when you asked for todos — or when there is nothing else to say.
  const waiting = todosOnly || entries.length === 0 ? cannotNow : [];

  const openingLine = opening
    ? opening.startsLater
      ? `Your day starts at ${formatHHMM(opening.start)} — a ${openingLabel(opening.minutes)} opening then.`
      : `You have a ${openingLabel(opening.minutes)} opening${opening.nextTask ? ` until ${opening.nextTask.title} at ${formatHHMM(opening.end)}` : ' left today'}.`
    : "Your day's window is done — nothing to squeeze in.";

  return (
    <>
      <PanelHeader title="Right now" sub="what to do" onClose={onClose} />

      <p className="psub-note" style={{ marginBottom: 10 }}>{openingLine}</p>

      {todoCount > 0 && (
        <div className="todotoggle">
          <button
            type="button"
            className={`pill${todosOnly ? ' on' : ''}`}
            aria-pressed={todosOnly}
            onClick={() => { setTodosWanted((v) => !v); setHead(0); }}
          >
            Todos · {todoCount}
          </button>
        </div>
      )}

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
        // With todos waiting below, the crab would be saying "nothing" over a
        // list of them; the list speaks for itself.
        waiting.length === 0 && (
          <div className="empty">
            <Icon name="crab" style={{ width: 26, height: 26 }} /><br />
            {todosOnly
              ? 'No todos tagged that way.'
              : tags.length ? 'Nothing tagged that way is waiting.' : 'Nothing waiting. Enjoy the shore.'}
          </div>
        )
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
                    {pick.isTodo && <span className="duefact">{pick.dueText || 'a todo'}</span>}
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
                        <span>{a.title}{a.fromLibrary ? ' · library' : ''}{a.isTodo ? ' · todo' : ''}</span>
                        <span className={a.dueText ? 'duefact' : 'why'}>{a.dueText || a.reasons[0]}</span>
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

      {waiting.length > 0 && (
        <>
          <p className="psub-note" style={{ marginTop: 12, marginBottom: 0 }}>
            {opening ? 'Too long for this opening:' : 'Nothing can be done now, but these are waiting:'}
          </p>
          <div className="todolist" aria-label="Todos that cannot be done right now">
            {waiting.map((w) => (
              <div key={w.todo.id} className="alt waiting">
                <span>{w.todo.label}</span>
                <span className="duefact">
                  {[opening ? `needs ${fmtDur(w.needsMin)}+` : '', todoDueText(w.todo.deadline, todayKey)].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* "+ todo" — add one without leaving the week (§8.5, decision 4). */}
      <form className="quickadd" onSubmit={addTodo}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="＋ todo — a one-off thing to do"
          aria-label="New todo"
        />
        <button type="submit" disabled={!draft.trim()}>Add</button>
      </form>

      <p className="psub-note" style={{ marginTop: 12 }}>Never auto-opens, never nags — it just answers &quot;what now?&quot; when you ask. (P-1)</p>
    </>
  );
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
