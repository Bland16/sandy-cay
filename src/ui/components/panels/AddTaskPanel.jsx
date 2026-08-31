// AddTaskPanel — quick capture. Title is the only required field (submit blocked
// on empty, case 7A).
//
// Two ways in, and the type decides which:
//   FIXED    — you say when. "Dentist, Friday 2pm" (7B) is the whole point of a
//              fixed task; auto-placing one would be nonsense.
//   FLEXIBLE — placed immediately by score, no unscheduled tray (7A) — unless
//              you tick "pick a time" and say where it goes yourself.
// A time you chose means placedBy:'user', so re-optimize prefers to leave it be.
//
// WHEN IS A DATE, NOT A WEEKDAY (DATES-AND-RECURRENCE P1). This used to be a
// weekday <select> resolved against `addDays(weekStart, day)`, which meant the
// date was implicit in whichever week the grid happened to show — so a September
// event could not be added from an August view without navigating there first.
// The date now says which week to search, which is why a flexible task shows it
// too even when you haven't picked a time.
import { useState } from 'react';
import {
  addDays, addMinutes, atTime, dateFromKey, dateKey, formatHHMM, placementFrom,
  weekStart as weekStartOf, weekdayIndex,
} from '../../../core/index.js';
import { buildRecurrence, emptyRecurrence, seedForDate } from '../../recurrenceModel.js';
import { DAY_NAMES, DAY_FULL, MONTHS } from '../../format.js';
import PanelHeader from '../PanelHeader.jsx';
import DurationControl from '../DurationControl.jsx';
import TagEditor, { tagsInUse } from '../TagEditor.jsx';
import RecurrenceEditor from '../RecurrenceEditor.jsx';

/** Today if it's in the viewed week, else that week's Monday — the likeliest day
 *  you mean, and the rule the old weekday <select> already used. */
function defaultDateKey(weekStart, now = new Date()) {
  const end = addDays(weekStart, 7);
  return dateKey(now >= weekStart && now < end ? now : weekStart);
}

/** The next quarter-hour — a sane "when", not 00:00. */
function defaultStart() {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return formatHHMM(d);
}

/** "Thu 3 Sep" — for toasts, where the week sign isn't there to give context. */
export function fmtDay(d) {
  return `${DAY_NAMES[weekdayIndex(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * "Thursday · 3 weeks ahead" — the readback under the date field.
 *
 * A bare ISO date doesn't tell you which day of the week it is, and that is what
 * a person is actually thinking in. The distance catches the fat-fingered year
 * and the wrong-month slip before you submit.
 */
export function whenNote(key, now = new Date()) {
  if (!key) return '';
  const d = dateFromKey(key);
  if (Number.isNaN(d.getTime())) return '';
  const weeks = Math.round((weekStartOf(d).getTime() - weekStartOf(now).getTime()) / 604800000);
  const dist = weeks === 0 ? 'this week'
    : weeks === 1 ? 'next week'
      : weeks === -1 ? 'last week'
        : weeks > 0 ? `${weeks} weeks ahead` : `${Math.abs(weeks)} weeks ago`;
  return `${DAY_FULL[weekdayIndex(d)]} · ${dist}`;
}

export default function AddTaskPanel({ sched, mutate, weekStart, onClose, showToast, onJump, onRunRoutine }) {
  const [type, setType] = useState('flexible');
  const [title, setTitle] = useState('');
  const [dur, setDur] = useState(60);
  const [tags, setTags] = useState([]);
  const [priority, setPriority] = useState(3);
  const [pinned, setPinned] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [recModel, setRecModel] = useState(emptyRecurrence);
  // "pick a date" opts a flexible task out of "somewhere this week" and onto a
  // specific day. The TIME is then optional on top of it — blank means "that
  // day, you choose when", which is the whole point of a flexible task.
  const [pickDate, setPickDate] = useState(false);
  const [dateStr, setDateStr] = useState(() => defaultDateKey(weekStart));
  const [start, setStart] = useState(''); // '' = any time on that day
  // P4 — the wider placement range, behind a disclosure so the common case stays
  // one field. 'week' is today's behaviour and stays the default.
  const [moreOpen, setMoreOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState('week'); // 'week' | 'until'
  const [rangeUntil, setRangeUntil] = useState('');

  const repeats = !!recModel.enabled;
  // Who shows what:
  //   repeating  — a date, meaning the first week the pattern runs. NEVER
  //                hidden: making the field disappear is what made this look
  //                unbuilt, and the value still drives effectiveFrom either way.
  //   fixed      — a date AND a time. A fixed task IS a time (7B).
  //   flexible   — nothing, until you tick "pick a date"; then a date, and a
  //                time only if you want one.
  const showDate = repeats || type === 'fixed' || pickDate;
  const showTime = !repeats && (type === 'fixed' || pickDate);
  // Pinned only when a time was actually given. A date on its own still goes
  // through scored placement — just bounded to that day.
  const timed = showTime && !!start;
  const chosen = dateStr ? dateFromKey(dateStr) : weekStart;
  // The range only means something for a task the scorer is still placing.
  const canRange = !repeats && type === 'flexible' && !timed;
  const canSubmit = title.trim().length > 0
    && (!showDate || !!dateStr)
    && !(type === 'fixed' && !repeats && !start); // a fixed task without a time isn't fixed

  /**
   * A task whose name IS a routine's name is probably that routine.
   *
   * ⚠️ IT ASKS. Typing "Laundry" and pressing add offers to run the procedure
   * instead of making a bare task — and then does whichever you say. The user's
   * shape (2026-08-17): "when you click add it asks if this is part of a
   * routine." Never automatic: a name collision is a guess, and this app does
   * not act on guesses (the same offer-never-impose rule as the ritual, the
   * rollover and D-3).
   *
   * Matched on the ROUTINE'S OWN NAME, exactly — "a part of a procedure is
   * nothing without the procedure itself", so a step name is never matched.
   * Case- and space-insensitive, because "laundry" and "Laundry " are the same
   * intent; nothing looser, because a fuzzy match would fire on work that has
   * nothing to do with it.
   */
  const matchingRoutine = (name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    return (sched.activities || []).find((a) => a.isRoutine && a.label.trim().toLowerCase() === key) || null;
  };

  const submit = () => {
    if (!canSubmit) return;
    const routine = matchingRoutine(title);
    if (routine && onRunRoutine) {
      const span = routine.steps.reduce((n, x) => n + x.durationMin, routine.travelMin || 0);
      const touch = routine.steps.filter((x) => x.kind === 'active').length;
      const hrs = span >= 60 ? `${Math.floor(span / 60)}h${span % 60 ? ` ${span % 60}m` : ''}` : `${span}m`;
      const ok = window.confirm(
        `"${routine.label}" is a routine — ${touch} step${touch === 1 ? '' : 's'} `
        + `over ${hrs}, with the waits left free.\n\n`
        + 'Run the routine? Cancel to add it as an ordinary task instead.',
      );
      if (ok) { onRunRoutine(routine); onClose(); return; }
      // Declining is a real answer: fall through and add the plain task.
    }
    const now = new Date();
    const data = {
      title: title.trim(),
      tags,
      priority,
      pinned,
      deadline: deadline ? dateFromKey(deadline) : null,
    };

    // Bound the scored search. Three cases, and the default is byte-identical to
    // what the panel did before there was a date field at all.
    //   picked a date  → THAT DAY (`to` is inclusive of its own day, which is
    //                    why from === to means exactly one day — proven by probe)
    //   no date        → the viewed week, from now if we're living in it
    //   "before <date>"→ from the start point out to that bound
    const until = rangeMode === 'until' && rangeUntil ? dateFromKey(rangeUntil) : null;
    const searchStart = pickDate ? (chosen > now ? chosen : now) : placementFrom(weekStart, now);
    if (canRange && until && until >= chosen) {
      data.from = searchStart;
      data.to = until;
    } else if (pickDate) {
      data.from = searchStart;
      data.to = chosen;
    } else {
      data.from = placementFrom(weekStart, now);
      data.to = addDays(weekStart, 6);
    }

    // The pattern starts the week of the date you chose, not the week you happen
    // to be looking at — "gym every Tuesday, starting the week of the 8th".
    const rec = buildRecurrence(recModel, chosen);
    if (rec) data.recurrence = rec;

    if (timed) {
      // dateFromKey, never new Date(str): an ISO date string parses as UTC
      // midnight and lands a day early west of Greenwich (sharp edge #4).
      const s = atTime(chosen, start);
      data.startTime = s;
      data.endTime = addMinutes(s, dur);
      data.placedBy = 'user'; // you chose it; don't let re-optimize wander it
    } else if (!rec) {
      // Deliberately no slot pre-computation here. This used to call the
      // UNSCORED findFreeSlot({from: weekStart}) and assign its result — which
      // handed back the week's first gap (Monday 08:00, already two days gone)
      // and, by setting startTime, made addFlexible skip scored placement
      // altogether. 7A says a new task is "placed immediately via scored
      // placement"; leaving startTime unset is what lets that actually happen.
      // durationMin carries the length you chose without pinning a time.
      data.durationMin = dur;
    }

    const added = mutate((s) => (type === 'fixed' ? s.addFixed(data) : s.addFlexible(data)));

    // A time you picked can land on something. R-1 says your action wins, so
    // flexibles move aside; an anchor won't, and you're told rather than left
    // with a silent overlap.
    let note = '';
    if (timed && added) {
      const res = mutate((s) => s.resolveDropConflicts(added));
      if (res && res.rejected) note = ` · overlaps ${res.reason ? res.reason.split(': ').pop() : 'something fixed'}`;
      else if (res && res.displaced.length) note = ` · ${res.displaced.length} moved aside`;
    }

    // Where it actually ended up — a flexible task is placed by score, so the
    // date you gave is a hint, not the answer.
    const landed = added && added.startTime ? added.startTime : chosen;
    const offWeek = weekStartOf(landed).getTime() !== weekStartOf(weekStart).getTime();
    // Adding something into a week you can't see, silently, is the same class of
    // surprise as a dropped import. Name the day and offer to go there.
    showToast(
      `Added "${data.title}" · ${fmtDay(landed)}${timed ? ` at ${start}` : ''}${note}`,
      offWeek && onJump ? { label: 'Go there', onClick: () => onJump(landed) } : null,
    );
    onClose();
  };

  return (
    <>
      <PanelHeader title="Add task" sub="quick capture" onClose={onClose} />
      <div className="fieldrow">
        <div className="chips">
          {/* A fixed task is a time, so give it one rather than making the
              person discover a disabled button. */}
          <button type="button" className={`pill${type === 'fixed' ? ' on' : ''}`} onClick={() => { setType('fixed'); if (!start) setStart(defaultStart()); }}>Fixed</button>
          <button type="button" className={`pill${type === 'flexible' ? ' on' : ''}`} onClick={() => setType('flexible')}>Flexible</button>
        </div>
      </div>
      <div className="fieldrow">
        <div className="flabel">Title <span className="lc">(only required field)</span></div>
        <input className="input" autoFocus placeholder="Call plumber…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </div>
      <div className="fieldrow">
        <div className="flabel">Duration</div>
        <DurationControl minutes={dur} onChange={setDur} />
      </div>

      {/* When. Always present — a repeating task shows the date as the week the
          pattern starts rather than hiding it, because a field that disappears
          reads as a feature that was never built. */}
      <div className="fieldrow">
        <div className="flabel">
          <span>{repeats ? 'Starts' : 'When'}</span>
          {/* A flexible task is placed by score; a date opts it onto one day.
              The <span> above matters: without it the label and this control
              concatenated into "Whenpick a time". */}
          {!repeats && type !== 'fixed' && (
            <label className="inlinecheck">
              <input
                type="checkbox"
                checked={pickDate}
                onChange={(e) => setPickDate(e.target.checked)}
              />
              pick a date
            </label>
          )}
        </div>

        {showDate ? (
          <>
            <div className="winrow">
              <input
                className="datein"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                aria-label="Date"
              />
              {showTime && (
                <input
                  className="timein"
                  type="time"
                  step="900"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  aria-label="Start time"
                />
              )}
            </div>
            <div className="whennote">{whenNote(dateStr)}</div>
            {repeats && <p className="psub-note">The first week the pattern runs.</p>}
            {!repeats && type !== 'fixed' && !start && (
              <p className="psub-note">Placed by score on that day — leave the time blank for any time.</p>
            )}
            {!repeats && type === 'fixed' && !start && (
              <p className="psub-note">A fixed task needs a time — that&rsquo;s what makes it fixed.</p>
            )}
          </>
        ) : (
          <p className="psub-note">Placed by score this week — no unscheduled tray.</p>
        )}

        {/* P4 — the wider range, collapsed. Default behaviour is unchanged, so
            the panel stays one field until you ask for more. */}
        {canRange && (
          <div className="moreopts">
            <button type="button" className="disclose" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              {moreOpen ? '－ fewer options' : '＋ more options'}
            </button>
            {moreOpen && (
              <div className="optbody">
                <div className="flabel">Place it</div>
                <label className="radiorow">
                  <input type="radio" name="addrange" checked={rangeMode === 'week'} onChange={() => setRangeMode('week')} />
                  {pickDate ? 'that day' : 'that week'}
                </label>
                <label className="radiorow">
                  <input type="radio" name="addrange" checked={rangeMode === 'until'} onChange={() => setRangeMode('until')} />
                  any time before
                  <input
                    className="datein sm"
                    type="date"
                    value={rangeUntil}
                    onChange={(e) => { setRangeUntil(e.target.value); setRangeMode('until'); }}
                    aria-label="Place it before"
                  />
                </label>
                {/* A search window is not a promise. Conflating the two would
                    make the report claim a deadline you never set. */}
                <p className="psub-note">A search window, not a deadline — it only says where to look.</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="fieldrow">
        <div className="flabel">Tags</div>
        <TagEditor tags={tags} onChange={setTags} suggestions={tagsInUse(sched).filter((t) => !sched.isTagRetired(t))} />
      </div>
      <div className="fieldrow split">
        <div>
          <div className="flabel">Priority</div>
          <select className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
        </div>
        <div>
          <div className="flabel">Pin</div>
          <button type="button" className={`tw${pinned ? ' on' : ''}`} role="switch" aria-checked={pinned} aria-label="Pin" onClick={() => setPinned(!pinned)}><span className="knob" /></button>
        </div>
        <div>
          <div className="flabel">Deadline</div>
          <input className="timein" style={{ width: 140 }} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="flabel">Repeat?</div>
        {/* The options are written out of the chosen date — "the first Tuesday"
            only means anything relative to it. */}
        <RecurrenceEditor
          model={recModel}
          anchorDate={chosen}
          // Turning Repeats on assumes the day already chosen, not Monday.
          onChange={(m) => setRecModel(m.enabled && !recModel.enabled ? seedForDate(m, chosen) : m)}
        />
      </div>
      <button type="button" className="btn cta" style={{ marginTop: 8 }} disabled={!canSubmit} onClick={submit}>Add</button>
    </>
  );
}
