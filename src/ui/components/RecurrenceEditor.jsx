// RecurrenceEditor — the shared window-row component (SPEC §4). Controlled by a
// model (see recurrenceModel.js). Covers: day+start+end rows, "every N weeks"
// interval (4D), "from now on / including past" scope (4B), and a bounded
// "temporary from…until" period (4E). Used in both Add-task and edit panels.
import { DAY_NAMES, DAY_KEYS } from '../format.js';
import { isWeekdayPattern, toWeekdayWindows } from '../recurrenceModel.js';

export default function RecurrenceEditor({ model, onChange, allowScope = false }) {
  const patch = (delta) => onChange({ ...model, ...delta });
  const setWindow = (i, delta) => {
    const windows = model.windows.map((w, idx) => (idx === i ? { ...w, ...delta } : w));
    patch({ windows });
  };
  const addWindow = () => patch({ windows: [...model.windows, { day: 'mon', start: '09:00', end: '10:00' }] });
  const removeWindow = (i) => patch({ windows: model.windows.filter((_, idx) => idx !== i) });

  // The frequency control reads the pattern back rather than storing a mode, so
  // hand-editing one day out of a weekday set is honestly no longer "weekdays".
  const repeatValue = Number(model.interval) === 1 && isWeekdayPattern(model.windows)
    ? 'weekday'
    : String(model.interval);
  const setRepeat = (v) => {
    if (v === 'weekday') patch({ interval: 1, windows: toWeekdayWindows(model.windows) });
    else patch({ interval: Number(v) });
  };

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
          {model.windows.map((w, i) => (
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
          <button type="button" className="pill tag sm" onClick={addWindow}>＋ add window</button>

          <div className="fieldrow">
            <div className="flabel">Every</div>
            {/* "every weekday" is a preset, not a stored mode: picking it writes
                the five Mon–Fri windows at the time already on the first row.
                Saying "lunch at noon, every weekday" used to mean adding four
                more rows by hand, each one resetting to mon 09:00–10:00. */}
            <select className="input" value={repeatValue} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat frequency">
              <option value="1">every week</option>
              <option value="weekday">every weekday (Mon–Fri)</option>
              <option value="2">every 2nd week</option>
              <option value="3">every 3rd week</option>
              <option value="4">every 4th week</option>
            </select>
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
