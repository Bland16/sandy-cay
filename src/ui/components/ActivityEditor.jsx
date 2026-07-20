// ActivityEditor — the focused editor for one activity (level 2 of the bucket
// drill-in; design/EDITOR-REDESIGN.md). An activity is a thin task template:
// label, bucket, elastic duration, priority, tags, and a load edited with the
// SAME wave control (inherits its bucket by default). Full-card; back returns to
// the bucket.
import TagEditor from './TagEditor.jsx';
import EnergyControl from './EnergyControl.jsx';
import Icon from '../Icon.jsx';

const ZERO = { mental: 0, physical: 0, social: 0, creative: 0 };
const clampMin = (v) => { const n = Number(v); return Math.max(15, Math.round(Number.isFinite(n) ? n : 15)); };

export default function ActivityEditor({ sched, mutate, activityId, onBack, suggestions = [] }) {
  const buckets = sched.buckets;
  const a = sched.activities.find((x) => x.id === activityId);
  if (!a) { onBack(); return null; }
  const patch = (changes) => mutate((s) => s.updateActivity(a.id, changes));
  const bucket = buckets.find((b) => b.id === a.bucketId) || null;
  const inheritLoad = (bucket && bucket.load) || ZERO;
  const overriding = a.load != null;

  return (
    <div className="cabcard">
      <div className="cabsign">Edit activity</div>
      <button className="btn2 ghost editback" onClick={onBack}>
        <Icon name="back" /> {bucket ? bucket.label : 'Activities'}
      </button>
      <div className="field">
        <span className="flabel">name</span>
        <div className="fctl">
          <input className="control grow" defaultValue={a.label} onBlur={(e) => patch({ label: e.target.value.trim() || a.label })} aria-label="Activity name" />
        </div>
      </div>
      <div className="field">
        <span className="flabel">bucket</span>
        <div className="fctl">
          <select className="control grow" value={a.bucketId ?? ''} onChange={(e) => patch({ bucketId: e.target.value || null })} aria-label="Activity bucket">
            <option value="">No bucket</option>
            {buckets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <span className="flabel">length</span>
        <div className="fctl rangefield">
          <input className="control num" type="number" min="15" step="5" value={a.durationMin} onChange={(e) => { const min = clampMin(e.target.value); patch({ durationMin: min, durationMax: Math.max(min, a.durationMax) }); }} aria-label={`${a.label} minimum minutes`} />
          <span className="rdash">–</span>
          <input className="control num" type="number" min="15" step="5" value={a.durationMax} onChange={(e) => patch({ durationMax: Math.max(a.durationMin, clampMin(e.target.value)) })} aria-label={`${a.label} maximum minutes`} />
          <span className="runit">min · fills the opening</span>
        </div>
      </div>
      <div className="field">
        <span className="flabel">priority</span>
        <div className="fctl">
          <select className="control" value={a.priority ?? ''} onChange={(e) => patch({ priority: e.target.value ? Number(e.target.value) : null })} aria-label={`${a.label} priority`}>
            <option value="">P—</option>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field stack">
        <span className="flabel">tags</span>
        <div className="fctl">
          <TagEditor tags={a.tags} onChange={(tags) => patch({ tags })} suggestions={suggestions} />
        </div>
      </div>
      <div className="field stack">
        <span className="flabel">energy</span>
        <div className="fctl">
          <EnergyControl
            value={overriding ? a.load : inheritLoad}
            onChange={(load) => patch({ load })}
            inheritedFrom={bucket ? bucket.label : null}
            inheriting={!overriding}
            onInherit={overriding ? () => patch({ load: null }) : null}
          />
        </div>
      </div>
      <button className="btn2 ghost" onClick={() => { mutate((s) => s.removeActivity(a.id)); onBack(); }} aria-label={`Remove activity ${a.label}`}>
        remove activity
      </button>
    </div>
  );
}
