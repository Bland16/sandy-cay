// RecurrenceEditor — the repeat control (SPEC §4). Controlled by a model (see
// recurrenceModel.js). Covers weekly day rows, monthly by position ("the first
// Tuesday") and by date ("the 15th"), yearly, "every Nth" intervals (4D), the
// "from now on / including past" scope (4B), and a bounded "temporary from…
// until" period (4E). Used in both Add-task and edit panels.
//
// NO MODE PICKER. The first design of the monthly control asked you to choose
// "on a date" or "on the …" before showing anything, and the user rightly called
// it confusing: it forces you to hold the by-date/by-position distinction in
// your head before you can say a thing you already know ("it's the first
// Monday"). Since a date has already been chosen, that date answers BOTH
// questions — so every option is written out of it as a finished sentence, and
// a live preview of the real dates settles whatever the wording can't.
import { DAY_NAMES, DAY_KEYS, MONTHS } from '../format.js';
import {
  isWeekdayPattern, toWeekdayWindows, optionsForDate, previewDates, optionOfModel,
  TOP_FREQUENCIES, monthlyModesForDate, uiChoiceOf, choiceToOption,
} from '../recurrenceModel.js';

const fmtDate = (d) => `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

export default function RecurrenceEditor({ model, onChange, anchorDate, allowScope = false }) {
  const patch = (delta) => onChange({ ...model, ...delta });
  const setWindow = (i, delta) => {
    const windows = model.windows.map((w, idx) => (idx === i ? { ...w, ...delta } : w));
    patch({ windows });
  };
  const addWindow = () => patch({ windows: [...model.windows, { day: 'mon', start: '09:00', end: '10:00' }] });
  const removeWindow = (i) => patch({ windows: model.windows.filter((_, idx) => idx !== i) });

  const date = anchorDate instanceof Date ? anchorDate : new Date();
  const options = optionsForDate(date);
  const monthModes = monthlyModesForDate(date);
  // Fall back rather than show a blank select: an option can vanish when the
  // date moves (there is no "last Tuesday" in the middle of a month).
  const derived = optionOfModel(model);
  const option = options.some((o) => o.value === derived) ? derived : '1';
  const choice = uiChoiceOf({ ...model, option });
  // Day rows belong to "every week" (and to "other → every N weeks"), because
  // "Mon AND Wed" is a real thing to want. Everything else needs only a time:
  // "every weekday" is Mon–Fri by definition, and the monthly and yearly
  // sentences already said which day.
  const showDayRows = choice.top === 'week' || (choice.top === 'other' && choice.unit === 'weeks');

  /** Apply a change to the two-level choice, writing option + interval. */
  const setChoice = (delta) => {
    const next = { ...choice, ...delta };
    const { option: opt, interval } = choiceToOption(next);
    const patchObj = { option: opt, interval };
    // The weekday preset WRITES the five windows rather than storing a mode, so
    // changing one day's time later makes the pattern honestly stop calling
    // itself "every weekday" (§4.3 readback).
    if (opt === 'weekday') patchObj.windows = toWeekdayWindows(model.windows);
    onChange({ ...model, ...patchObj });
  };

  const preview = model.enabled
    ? previewDates({ ...model, option, interval: model.interval }, date)
    : { dates: [], skipped: [] };

  return (
    <div className="recbox">
      <label className="toggle" style={{ marginBottom: 6 }}>
        <button
          type="button"
          className={`tw${model.enabled ? ' on' : ''}`}
          role="switch"
          aria-checked={model.enabled}
          aria-label="Repeat this task"
          onClick={() => patch({ enabled: !model.enabled })}
        >
          <span className="knob" />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Repeats</span>
      </label>

      {model.enabled && (
        <>
          <div className="fieldrow" style={{ margin: '0 0 6px' }}>
            <div className="flabel">How often</div>
            <select
              className="input"
              value={choice.top}
              onChange={(e) => setChoice({ top: e.target.value })}
              aria-label="Repeat frequency"
            >
              {TOP_FREQUENCIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* "every month" — the only branch with a real choice inside it, and
              both readings are offered as sentences so neither has to be
              understood in the abstract. */}
          {choice.top === 'month' && (
            <div className="fieldrow" style={{ margin: '0 0 6px' }}>
              <select
                className="input"
                value={choice.monthMode}
                onChange={(e) => setChoice({ monthMode: e.target.value })}
                aria-label="Which day of the month"
              >
                {monthModes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* "other…" — the uncommon cadences, out of the main list but one
              click away. "Every other week" lives here. */}
          {choice.top === 'other' && (
            <div className="winrow" style={{ marginBottom: 6 }}>
              <span className="flabel" style={{ margin: 0 }}>every</span>
              <select
                className="daysel"
                style={{ width: 56 }}
                value={choice.n}
                onChange={(e) => setChoice({ n: Number(e.target.value) })}
                aria-label="Every how many"
              >
                {[2, 3, 4, 5, 6, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select
                className="daysel"
                style={{ width: 78 }}
                value={choice.unit}
                onChange={(e) => setChoice({ unit: e.target.value })}
                aria-label="Weeks or months"
              >
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
              {choice.unit === 'months' && (
                <select
                  className="input"
                  style={{ width: '100%', marginTop: 5 }}
                  value={choice.monthMode}
                  onChange={(e) => setChoice({ monthMode: e.target.value })}
                  aria-label="Which day of the month"
                >
                  {monthModes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Weekly patterns carry day rows, because "Mon AND Wed" is real.
              Monthly and yearly need no rows — the sentence said it all — so
              they show only the time the session runs at. */}
          {showDayRows && model.windows.map((w, i) => (
            <div className="winrow" key={i}>
              <select
                className="daysel"
                value={w.day}
                onChange={(e) => setWindow(i, { day: e.target.value })}
                aria-label="Day"
              >
                {DAY_KEYS.map((k, idx) => <option key={k} value={k}>{DAY_NAMES[idx]}</option>)}
              </select>
              <input className="timein" type="time" value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} aria-label="Start" />
              <span className="arr">→</span>
              <input className="timein" type="time" value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} aria-label="End" />
              {model.windows.length > 1 && (
                <button type="button" className="rm" onClick={() => removeWindow(i)} aria-label="Remove window">×</button>
              )}
            </div>
          ))}
          {showDayRows && (
            <button type="button" className="pill tag sm" onClick={addWindow}>＋ also on another day</button>
          )}

          {!showDayRows && (
            <div className="winrow">
              <input className="timein" type="time" value={model.windows[0]?.start || '09:00'} onChange={(e) => setWindow(0, { start: e.target.value })} aria-label="Start" />
              <span className="arr">→</span>
              <input className="timein" type="time" value={model.windows[0]?.end || '10:00'} onChange={(e) => setWindow(0, { end: e.target.value })} aria-label="End" />
            </div>
          )}

          {/* The preview is the feature: four real dates remove every doubt the
              wording can't, including which months a pattern skips. Computed by
              running the actual engine, so it cannot disagree with reality. */}
          <div className="recpreview">
            <span className="lbl">It will run on</span>
            {preview.dates.length
              ? preview.dates.map((d) => <b key={d.getTime()}>{fmtDate(d)}</b>)
                .reduce((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])
              : <span>nothing yet — check the day and times</span>}
            {preview.skipped.length > 0 && (
              <span className="warn">
                Skips {preview.skipped.slice(0, 3).join(', ')} — {option === 'y' ? 'not a leap year' : 'those months have no such day'}.
                {option === 'mdate' && ' Pick "the last day" if you mean the end of the month.'}
              </span>
            )}
            {choice.top === 'other' && (
              <span className="from">Counted from the date you picked, not the start of the month.</span>
            )}
          </div>

          {allowScope && (
            <div className="fieldrow">
              <div className="flabel">Apply changes</div>
              <div className="chips">
                <button type="button" className={`pill sm${model.scope === 'future' ? ' on' : ''}`} onClick={() => patch({ scope: 'future' })}>from now on</button>
                <button type="button" className={`pill sm${model.scope === 'all' ? ' on' : ''}`} onClick={() => patch({ scope: 'all' })}>including past</button>
              </div>
            </div>
          )}

          <div className="fieldrow">
            <label className="toggle">
              <button
                type="button"
                className={`tw${model.temporary ? ' on' : ''}`}
                role="switch"
                aria-checked={!!model.temporary}
                aria-label="Temporary change"
                onClick={() => patch({ temporary: model.temporary ? null : { from: '', until: '' } })}
              >
                <span className="knob" />
              </button>
              <span style={{ fontSize: 11.5 }}>Temporary only</span>
            </label>
            {model.temporary && (
              <div className="winrow" style={{ marginTop: 6 }}>
                <span className="flabel" style={{ margin: 0 }}>first day</span>
                <input className="timein" style={{ width: 128 }} type="date" value={model.temporary.from} onChange={(e) => patch({ temporary: { ...model.temporary, from: e.target.value } })} aria-label="First day" />
                {/* "until" invites the exact off-by-one this now avoids: people
                    read it as inclusive, half-open ranges mean it exclusively.
                    Naming the field for what you'd say out loud settles it. */}
                <span className="flabel" style={{ margin: 0 }}>last day</span>
                <input className="timein" style={{ width: 128 }} type="date" value={model.temporary.until} onChange={(e) => patch({ temporary: { ...model.temporary, until: e.target.value } })} aria-label="Last day" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { isWeekdayPattern };
