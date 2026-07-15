// Cabana — the full-screen settings page (replaces the schedule). Warm --cab-*
// palette. Sections: Tuning (weights + urgency → re-optimize), Zones editor,
// Tag roles (protected tags), Footlocker (export/import), Insights
// (getTagBreakdown + learned weights read), Retrain.
import { useRef, useState } from 'react';
import { exportState, summarizeImport } from '../../core/index.js';
import { DAY_NAMES, DAY_KEYS, fmtDur } from '../format.js';
import Icon from '../Icon.jsx';

const WEIGHT_KEYS = [['proximity', 'Proximity'], ['balance', 'Balance'], ['stability', 'Stability'], ['preference', 'Preference (learned)']];

export default function Cabana({ sched, mutate, weekStart, onBack, onReplace, showToast }) {
  const fileRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const setWeight = (key, v) => { mutate((s) => { s.config.weights[key] = v; }); };
  const setUrgency = (v) => { mutate((s) => { s.config.urgencyFactor = v; }); };
  const reoptimize = () => { const r = mutate((s) => s.autoSchedule({ weekStart })); showToast(`Re-optimized · ${r.placed.length} placed`); };

  const handleAddZone = () => {
    mutate((s) => s.addZone({ label: 'New zone', matchTags: [], windows: [{ day: 'tue', start: '18:00', end: '21:00' }], exclusive: true }));
    const z = sched.zones[sched.zones.length - 1];
    if (z) setEditingId(z.id);
  };
  const addZoneWindow = (id) => mutate((s) => { const z = s.zones.find((x) => x.id === id); z.windows = [...z.windows, { day: 'mon', start: '18:00', end: '20:00' }]; });
  const patchWindow = (id, i, delta) => mutate((s) => { const z = s.zones.find((x) => x.id === id); z.windows = z.windows.map((w, idx) => (idx === i ? { ...w, ...delta } : w)); });
  const removeWindow = (id, i) => mutate((s) => { const z = s.zones.find((x) => x.id === id); z.windows = z.windows.filter((_, idx) => idx !== i); });
  const setZoneTags = (id, val) => mutate((s) => s.updateZone(id, { matchTags: val.split(',').map((t) => t.trim()).filter(Boolean) }));
  const removeZone = (id) => mutate((s) => s.removeZone(id));

  const addProtected = () => { const t = newTag.trim().toLowerCase(); if (!t) return; mutate((s) => { if (!s.config.protectedTags.includes(t)) s.config.protectedTags.push(t); }); setNewTag(''); };
  const removeProtected = (t) => mutate((s) => { s.config.protectedTags = s.config.protectedTags.filter((x) => x !== t); });

  const doExport = () => {
    const { filename, data } = exportState(sched);
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${filename}`);
    } catch { showToast('Export unavailable here'); }
  };
  const doImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const blob = JSON.parse(reader.result);
        const sum = summarizeImport(blob);
        if (!sum.valid) { showToast(sum.reason); return; }
        if (window.confirm(`Import ${sum.taskCount} tasks, ${sum.zoneCount} zones, ${sum.ratings} ratings? This replaces your current week.`)) {
          onReplace(blob);
          showToast('Footlocker restored');
        }
      } catch { showToast('That file was not valid JSON'); }
    };
    reader.readAsText(file);
  };

  const retrain = () => { const n = mutate((s) => s.retrain()); showToast(`Retrained on ${n} ratings`); bump(); };

  const breakdown = sched.getTagBreakdown(weekStart);
  const maxTag = Math.max(1, ...breakdown.map((r) => r.scheduledMin));
  const learned = sched.learning.trained ? sched.learning.inspect().filter((w) => Math.abs(w.weight) > 0.01).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5) : [];

  return (
    <div className="cabana">
      <div className="cabtop">
        <div className="cabtitle">The Cabana<small>step off the beach · settings</small></div>
        <button className="cabback" onClick={onBack}><Icon name="back" /> Back to week</button>
      </div>
      <div className="cabgrid">
        {/* Tuning */}
        <div className="cabcard">
          <div className="cabsign">Tuning</div>
          <p>Play with the scoring weights against your real week, then re-optimize.</p>
          {WEIGHT_KEYS.map(([k, label]) => (
            <div className="sliderrow" key={k}>
              <div className="sl"><span>{label}</span><span>{sched.config.weights[k].toFixed(2)}</span></div>
              <input type="range" min="0" max="1" step="0.05" value={sched.config.weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
            </div>
          ))}
          <div className="sliderrow">
            <div className="sl"><span>Urgency factor</span><span>{sched.config.urgencyFactor.toFixed(2)}</span></div>
            <input type="range" min="0.5" max="3" step="0.1" value={sched.config.urgencyFactor} onChange={(e) => setUrgency(Number(e.target.value))} />
          </div>
          <button className="btn2" style={{ marginTop: 8 }} onClick={reoptimize}><Icon name="refresh" /> Re-optimize week</button>
        </div>

        {/* Zones — list; click a zone (or Add) to open its options */}
        <div className="cabcard">
          <div className="cabsign">Zones</div>
          {editingId == null ? (
            <>
              <p>Route tagged work into set windows.</p>
              {sched.zones.length === 0 && <p className="insight">No zones yet.</p>}
              {sched.zones.map((z) => (
                <button
                  key={z.id}
                  className="zonerow"
                  onClick={() => setEditingId(z.id)}
                >
                  <b style={{ color: 'var(--cab-accent)' }}>{z.label}</b>
                  <span className="zmeta">{z.matchTags.join(', ') || 'no tags'} · {z.windows.length} window{z.windows.length === 1 ? '' : 's'}</span>
                  <span aria-hidden="true">edit ›</span>
                </button>
              ))}
              <button className="btn2" style={{ marginTop: 8 }} onClick={handleAddZone}>＋ Add zone</button>
            </>
          ) : (() => {
            const z = sched.zones.find((x) => x.id === editingId);
            if (!z) return null;
            return (
              <>
                <button className="btn2 ghost" style={{ marginBottom: 10, padding: '5px 9px' }} onClick={() => setEditingId(null)}>
                  <Icon name="back" /> All zones
                </button>
                <div className="zonewin">
                  <span>name:</span>
                  <input defaultValue={z.label} onBlur={(e) => mutate((s) => s.updateZone(z.id, { label: e.target.value.trim() || z.label }))} style={{ flex: 1 }} aria-label="Zone name" />
                </div>
                <div className="zonewin">
                  <span>tags:</span>
                  <input defaultValue={z.matchTags.join(', ')} onBlur={(e) => setZoneTags(z.id, e.target.value)} style={{ flex: 1 }} aria-label="Zone tags" />
                </div>
                {z.windows.map((w, i) => (
                  <div className="zonewin" key={i}>
                    <select value={w.day} onChange={(e) => patchWindow(z.id, i, { day: e.target.value })} aria-label="Zone day">
                      {DAY_KEYS.map((k, idx) => <option key={k} value={k}>{DAY_NAMES[idx]}</option>)}
                    </select>
                    <input type="time" value={w.start} onChange={(e) => patchWindow(z.id, i, { start: e.target.value })} aria-label="Zone start" />
                    →
                    <input type="time" value={w.end} onChange={(e) => patchWindow(z.id, i, { end: e.target.value })} aria-label="Zone end" />
                    <button className="rm" onClick={() => removeWindow(z.id, i)} aria-label="Remove window">×</button>
                  </div>
                ))}
                <button className="btn2 ghost" style={{ marginTop: 4, padding: '5px 8px' }} onClick={() => addZoneWindow(z.id)}>＋ window</button>
                <label className="zonewin" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={z.exclusive} onChange={(e) => mutate((s) => s.updateZone(z.id, { exclusive: e.target.checked }))} />
                  exclusive · reserve this time
                </label>
                <button className="btn2 ghost" style={{ marginTop: 8, padding: '5px 9px' }} onClick={() => { removeZone(z.id); setEditingId(null); }}>remove zone</button>
              </>
            );
          })()}
        </div>

        {/* Tag roles */}
        <div className="cabcard">
          <div className="cabsign">Tag roles</div>
          <p>Protected tags survive auto-eviction (the hammock badge).</p>
          <div className="zonewin" style={{ gap: 6 }}>
            {sched.config.protectedTags.map((t) => (
              <span className="w cabtag" key={t}>{t}<button className="rm" onClick={() => removeProtected(t)} aria-label={`Remove ${t}`}>×</button></span>
            ))}
          </div>
          <div className="zonewin">
            <input value={newTag} placeholder="add protected tag…" onChange={(e) => setNewTag(e.target.value)} style={{ flex: 1 }} aria-label="New protected tag" />
            <button className="btn2" style={{ maxWidth: 90 }} onClick={addProtected}>＋ tag</button>
          </div>
        </div>

        {/* Footlocker */}
        <div className="cabcard">
          <div className="cabsign">Footlocker</div>
          <p>Your durable copy — export a versioned <code>schedule.json</code> or import one.</p>
          <div className="chest">
            <button className="btn2" onClick={doExport}><Icon name="chest" /> Export</button>
            <button className="btn2 ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="key" /> Import</button>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={doImport} />
          </div>
        </div>

        {/* Insights */}
        <div className="cabcard">
          <div className="cabsign">Insights</div>
          <p className="insight">Hours by tag, this week:</p>
          {breakdown.length === 0 && <p className="insight">No tagged tasks yet.</p>}
          {breakdown.slice(0, 6).map((r) => (
            <div className="insight" key={r.tag}>
              <span><b>{r.tag}</b> · {fmtDur(r.scheduledMin)}{r.avgShells != null ? ` · ${r.avgShells.toFixed(1)}★` : ''}</span>
              <div className="bar2"><i style={{ width: `${Math.round((r.scheduledMin / maxTag) * 100)}%` }} /></div>
            </div>
          ))}
          <p className="insight" style={{ marginTop: 8 }}>
            Learned model: <b>{sched.learning.sampleCount}</b> ratings{sched.learning.trained ? ', trained' : ' (cold start)'}.
          </p>
          {learned.map((w) => (
            <div className="insight" key={w.label}>{w.label}: <b>{w.weight >= 0 ? '+' : ''}{w.weight.toFixed(2)}</b></div>
          ))}
          <button className="btn2" style={{ marginTop: 10 }} onClick={retrain}><Icon name="refresh" /> Retrain now · {sched.learning.sampleCount} ratings</button>
        </div>
      </div>
    </div>
  );
}
