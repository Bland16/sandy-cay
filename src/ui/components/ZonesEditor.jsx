// ZonesEditor — route tagged work into set windows (SPEC §2.2). Same drill-in
// idiom as buckets/activities (design/EDITOR-REDESIGN.md): a list of zones, each
// opening a focused editor. Uses the shared TagEditor for match tags (replacing
// the bespoke ZoneTags). Effective dates read as the LAST DAY IT RUNS — the
// engine stores a half-open bound, so the edge converts (sharp edge #11 / time.js).
import { useState } from 'react';
import { dateKey, dateFromKey, lastRunDay, untilAfterLastRun } from '../../core/index.js';
import { DAY_NAMES, DAY_KEYS } from '../format.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import Icon from '../Icon.jsx';

export default function ZonesEditor({ sched, mutate }) {
  const [editingId, setEditingId] = useState(null);
  const zones = sched.zones;
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const addZone = () => {
    const z = mutate((s) => s.addZone({ label: 'New zone', matchTags: [], windows: [{ day: 'tue', start: '18:00', end: '21:00' }], exclusive: true }));
    if (z) setEditingId(z.id);
  };
  const patchZone = (id, changes) => mutate((s) => s.updateZone(id, changes));
  const removeZone = (id) => mutate((s) => s.removeZone(id));
  const addWindow = (z) => patchZone(z.id, { windows: [...z.windows, { day: 'mon', start: '18:00', end: '20:00' }] });
  /** Most real zones are "every weekday, these hours" — five identical rows is a
   *  silly thing to make someone build by hand. */
  const addWeekdayWindows = (z) => {
    const [start, end] = z.windows.length ? [z.windows[0].start, z.windows[0].end] : ['09:00', '17:00'];
    const have = new Set(z.windows.map((w) => `${w.day}${w.start}${w.end}`));
    const add = ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({ day, start, end })).filter((w) => !have.has(`${w.day}${w.start}${w.end}`));
    patchZone(z.id, { windows: [...z.windows, ...add] });
  };
  const patchWindow = (z, i, delta) => patchZone(z.id, { windows: z.windows.map((w, idx) => (idx === i ? { ...w, ...delta } : w)) });
  const removeWindow = (z, i) => patchZone(z.id, { windows: z.windows.filter((_, idx) => idx !== i) });

  const editing = zones.find((z) => z.id === editingId) || null;

  // ---- drill-in zone editor ---------------------------------------------
  if (editing) {
    const z = editing;
    return (
      <div className="cabcard">
        <div className="cabsign">Edit zone</div>
        <button className="btn2 ghost" style={{ marginBottom: 10, padding: '5px 9px' }} onClick={() => setEditingId(null)}>
          <Icon name="back" /> All zones
        </button>
        <div className="zonewin" style={{ gap: 6 }}>
          <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44 }}>name</span>
          <input defaultValue={z.label} onBlur={(e) => patchZone(z.id, { label: e.target.value.trim() || z.label })} style={{ flex: 1 }} aria-label="Zone name" />
        </div>
        <div className="zonewin" style={{ gap: 6, alignItems: 'flex-start' }}>
          <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44, paddingTop: 6 }}>tags</span>
          <div style={{ flex: 1 }}>
            <TagEditor tags={z.matchTags} onChange={(tags) => patchZone(z.id, { matchTags: tags })} suggestions={suggestions} />
          </div>
        </div>
        {z.windows.map((w, i) => (
          <div className="zonewin" key={i}>
            <select value={w.day} onChange={(e) => patchWindow(z, i, { day: e.target.value })} aria-label="Zone day">
              {DAY_KEYS.map((k, idx) => <option key={k} value={k}>{DAY_NAMES[idx]}</option>)}
            </select>
            <input type="time" value={w.start} onChange={(e) => patchWindow(z, i, { start: e.target.value })} aria-label="Zone start" />
            →
            <input type="time" value={w.end} onChange={(e) => patchWindow(z, i, { end: e.target.value })} aria-label="Zone end" />
            <button className="rm" onClick={() => removeWindow(z, i)} aria-label="Remove window">×</button>
          </div>
        ))}
        <div className="chest" style={{ marginTop: 4 }}>
          <button className="btn2 ghost" style={{ padding: '5px 8px' }} onClick={() => addWindow(z)}>＋ window</button>
          <button className="btn2 ghost" style={{ padding: '5px 8px' }} onClick={() => addWeekdayWindows(z)} title="Add Mon–Fri at the first window's hours">＋ every weekday</button>
        </div>
        <label className="zonewin" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={z.exclusive} onChange={(e) => patchZone(z.id, { exclusive: e.target.checked })} aria-label="Exclusive · reserve this time" />
          exclusive · reserve this time
        </label>

        {/* A zone can be temporary — a summer job, a term. Blank = always. */}
        <div className="zonewin">
          <span>runs:</span>
          <input
            type="date"
            value={z.effectiveFrom ? dateKey(z.effectiveFrom) : ''}
            onChange={(e) => patchZone(z.id, { effectiveFrom: e.target.value ? dateFromKey(e.target.value) : null })}
            aria-label="Zone start date"
          />
          →
          {/* Shown and read as the LAST DAY IT RUNS. The engine stores a half-open
              bound, so the edge converts — see time.js (sharp edge #11). */}
          <input
            type="date"
            value={z.effectiveUntil ? dateKey(lastRunDay(z.effectiveUntil)) : ''}
            onChange={(e) => patchZone(z.id, { effectiveUntil: e.target.value ? untilAfterLastRun(dateFromKey(e.target.value)) : null })}
            aria-label="Zone end date"
          />
        </div>
        <p className="insight" style={{ opacity: 0.7 }}>
          Leave blank for always. Both dates are days it runs — a summer job ending Fri the 24th ends on the 24th.
        </p>
        <button className="btn2 ghost" style={{ marginTop: 8, padding: '5px 9px' }} onClick={() => { removeZone(z.id); setEditingId(null); }} aria-label={`Remove zone ${z.label}`}>
          remove zone
        </button>
      </div>
    );
  }

  // ---- zone list --------------------------------------------------------
  return (
    <div className="cabcard">
      <div className="cabsign">Zones</div>
      <p>Route tagged work into set windows.</p>
      {zones.length === 0 && <p className="insight">No zones yet.</p>}
      {zones.map((z) => (
        <button key={z.id} className="zonerow" onClick={() => setEditingId(z.id)} aria-label={`Edit zone ${z.label}`}>
          <b style={{ color: 'var(--cab-accent)' }}>{z.label}</b>
          <span className="zmeta">{z.matchTags.join(', ') || 'no tags'} · {z.windows.length} window{z.windows.length === 1 ? '' : 's'}</span>
          <span aria-hidden="true">edit ›</span>
        </button>
      ))}
      <button className="btn2" style={{ marginTop: 8 }} onClick={addZone} aria-label="Add zone">＋ Add zone</button>
    </div>
  );
}
