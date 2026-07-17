// ActivitiesEditor — the Cabana's activity library (design/ACTIVITY-LIBRARY.md):
// your own menu of things to do, grouped under their bucket, each with an elastic
// duration min..max (it fills whatever opening you drop it into), tags, and an
// optional default priority. Same inline-edit idiom as the Zones editor.
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import { AXES, AXIS_META } from '../energyMeta.js';

const ZERO = { mental: 0, physical: 0, social: 0, creative: 0 };
const linkBtn = { background: 'none', border: 'none', color: 'var(--cab-accent)', cursor: 'pointer', fontSize: 12, padding: 0 };

// Number inputs hand back strings — coerce before guarding (else every edit
// silently floored to the 15-min minimum).
const clampMin = (v) => {
  const n = Number(v);
  return Math.max(15, Math.round(Number.isFinite(n) ? n : 15));
};

export default function ActivitiesEditor({ sched, mutate }) {
  const buckets = sched.buckets;
  const activities = sched.activities;
  // Suggestions exclude retired tags (design: retired tags leave new-work pickers).
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const inBucket = (id) => activities.filter((a) => a.bucketId === id);
  const orphans = activities.filter((a) => !a.bucketId || !buckets.some((b) => b.id === a.bucketId));

  const add = (bucket) => mutate((s) => s.addActivity({
    bucketId: bucket ? bucket.id : null,
    label: 'New activity',
    tags: bucket ? [...bucket.tags] : [], // defaults to the bucket's tags
    durationMin: 15,
    durationMax: 60,
  }));
  const patch = (id, changes) => mutate((s) => s.updateActivity(id, changes));
  const drop = (id) => mutate((s) => s.removeActivity(id));

  const setMin = (a, v) => {
    const min = clampMin(v);
    patch(a.id, { durationMin: min, durationMax: Math.max(min, a.durationMax) });
  };
  const setMax = (a, v) => patch(a.id, { durationMax: Math.max(a.durationMin, clampMin(v)) });

  // Per-activity energy override (design/ENERGY-MODEL.md): most inherit their
  // bucket; a specific activity can spend/restore differently.
  const bucketOf = (a) => buckets.find((b) => b.id === a.bucketId) || null;
  const effLoad = (a) => a.load ?? (bucketOf(a) && bucketOf(a).load) ?? ZERO;
  const customize = (a) => patch(a.id, { load: { ...effLoad(a) } });
  const inherit = (a) => patch(a.id, { load: null });
  const setLoad = (a, axis, v) => {
    const base = a.load ?? effLoad(a);
    patch(a.id, { load: { ...base, [axis]: Math.max(-2, Math.min(2, Math.round(Number(v) || 0))) } });
  };

  const row = (a) => (
    <div className="zonewin" key={a.id} style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <input
        defaultValue={a.label}
        onBlur={(e) => patch(a.id, { label: e.target.value.trim() || a.label })}
        aria-label="Activity name"
        style={{ flex: 1, minWidth: 130 }}
      />
      <span style={{ fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>min</span>
      <input type="number" min="15" step="5" value={a.durationMin} onChange={(e) => setMin(a, e.target.value)} aria-label={`${a.label} minimum minutes`} style={{ width: 58 }} />
      <span style={{ fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>max</span>
      <input type="number" min="15" step="5" value={a.durationMax} onChange={(e) => setMax(a, e.target.value)} aria-label={`${a.label} maximum minutes`} style={{ width: 58 }} />
      <select value={a.priority ?? ''} onChange={(e) => patch(a.id, { priority: e.target.value ? Number(e.target.value) : null })} aria-label={`${a.label} priority`}>
        <option value="">P—</option>
        {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
      </select>
      <button className="rm" style={{ alignSelf: 'center' }} onClick={() => drop(a.id)} aria-label={`Remove ${a.label}`}>×</button>
      <div style={{ flexBasis: '100%' }}>
        <TagEditor tags={a.tags} onChange={(tags) => patch(a.id, { tags })} suggestions={suggestions} />
      </div>
      <div style={{ flexBasis: '100%', fontSize: 12 }}>
        {a.load ? (
          <div className="zonewin" style={{ gap: 8 }}>
            <span style={{ opacity: 0.6 }}>energy</span>
            {AXES.map((ax) => (
              <label key={ax} title={AXIS_META[ax].label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span aria-hidden="true">{AXIS_META[ax].glyph}</span>
                <input type="number" min="-2" max="2" step="1" value={a.load[ax] ?? 0} onChange={(e) => setLoad(a, ax, e.target.value)} aria-label={`${a.label} ${AXIS_META[ax].label} load`} style={{ width: 40 }} />
              </label>
            ))}
            <button style={linkBtn} onClick={() => inherit(a)} aria-label={`${a.label} inherit bucket energy`}>↺ inherit</button>
          </div>
        ) : (
          <span style={{ opacity: 0.6 }}>
            energy: inherits its bucket ·{' '}
            <button style={linkBtn} onClick={() => customize(a)} aria-label={`Customise ${a.label} energy`}>customise</button>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="cabcard">
      <div className="cabsign">Activities</div>
      <p>Your menu of things to do. Each has a min–max length — dropping one into a free slot sizes it to fill the gap.</p>

      {buckets.length === 0 && (
        <p className="insight">Make a bucket in <b>Tags &amp; buckets</b> first — activities live inside one.</p>
      )}

      {buckets.map((b) => (
        <div key={b.id} style={{ marginTop: 10 }}>
          <div className="insight" style={{ fontWeight: 700, color: 'var(--cab-accent)' }}>{b.label}</div>
          {inBucket(b.id).map((a) => row(a))}
          <button className="btn2 ghost" style={{ marginTop: 4, padding: '5px 9px' }} onClick={() => add(b)} aria-label={`Add activity to ${b.label}`}>＋ activity</button>
        </div>
      ))}

      {orphans.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="insight" style={{ fontWeight: 700 }}>No bucket</div>
          {orphans.map((a) => row(a))}
        </div>
      )}
    </div>
  );
}
