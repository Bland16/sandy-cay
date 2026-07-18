// Cabana — the full-screen settings page (replaces the schedule). Warm --cab-*
// palette. Sections: Tuning (weights + urgency → re-optimize), Zones editor,
// Tag roles (protected tags), Footlocker (export/import), Insights
// (getTagBreakdown + learned weights read), Retrain.
import { useRef, useState } from 'react';
import { exportState, summarizeImport } from '../../core/index.js';
import { fmtDur } from '../format.js';
import Icon from '../Icon.jsx';
import CalendarCard from './CalendarCard.jsx';
import TagManager from './TagManager.jsx';
import EnergyCard from './EnergyCard.jsx';
import ZonesEditor from './ZonesEditor.jsx';

const WEIGHT_KEYS = [['proximity', 'Proximity'], ['balance', 'Balance'], ['stability', 'Stability'], ['preference', 'Preference (learned)']];

export default function Cabana({ sched, mutate, weekStart, onBack, onReplace, onReset, showToast }) {
  const fileRef = useRef(null);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const setWeight = (key, v) => { mutate((s) => { s.config.weights[key] = v; }); };
  const setUrgency = (v) => { mutate((s) => { s.config.urgencyFactor = v; }); };
  const reoptimize = () => { const r = mutate((s) => s.autoSchedule({ weekStart })); showToast(`Re-optimized · ${r.placed.length} placed`); };

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

        {/* Zones — the shared drill-in editor (design/EDITOR-REDESIGN.md). */}
        <ZonesEditor sched={sched} mutate={mutate} />

        {/* Buckets — the single bucket-centric card: tags, energy, protection,
            AND the activities that live in each bucket (design/EDITOR-REDESIGN.md). */}
        <TagManager sched={sched} mutate={mutate} />

        {/* Energy — today's deterministic budget across the load axes. */}
        <EnergyCard sched={sched} />

        <CalendarCard sched={sched} weekStart={weekStart} mutate={mutate} showToast={showToast} />

        {/* Footlocker */}
        <div className="cabcard">
          <div className="cabsign">Footlocker</div>
          <p>Your durable copy — export a versioned <code>schedule.json</code> or import one.</p>
          <div className="chest">
            <button className="btn2" onClick={doExport}><Icon name="chest" /> Export</button>
            <button className="btn2 ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="key" /> Import</button>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={doImport} />
          </div>
          <p className="insight" style={{ opacity: 0.75, marginTop: 10 }}>
            Starting fresh erases every task, zone and rating on this device. Export first
            if you want it back.
          </p>
          <button
            className="btn2 ghost"
            style={{ marginTop: 6 }}
            onClick={() => {
              if (window.confirm('Erase every task, zone and rating on this device? Export first if you want them back.')) {
                onReset();
                showToast('Cleared — an empty week');
              }
            }}
          >
            Start fresh
          </button>
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
