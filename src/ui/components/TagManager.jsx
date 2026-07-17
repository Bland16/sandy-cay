// TagManager — the Cabana's buckets, edited as a compact drill-in list
// (design/ACTIVITY-LIBRARY.md). A bucket is one row you click to open; inside,
// you set its colour, role, energy load, and — like a task — add/remove its tags
// with the shared TagEditor. "Protected" (survives auto-eviction) is a
// bucket-level toggle here. Retiring a tag is parked; already-retired tags get a
// recover strip so nothing is stranded.
import { useState } from 'react';
import { BUCKET_ROLES, seedStarterBuckets } from '../../core/index.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import { AXES, AXIS_META } from '../energyMeta.js';
import Icon from '../Icon.jsx';

const ROLE_LABELS = {
  rest: 'Rest', creative: 'Creative', work: 'Work',
  social: 'Social', health: 'Health', neutral: 'Neutral',
};

// A tiny one-line summary of a bucket's non-zero load, e.g. "🐦+2 🦀+1".
function loadSummary(load) {
  if (!load) return '';
  return AXES.filter((a) => load[a]).map((a) => `${AXIS_META[a].glyph}${load[a] > 0 ? '+' : ''}${load[a]}`).join(' ');
}

export default function TagManager({ sched, mutate }) {
  const [editingId, setEditingId] = useState(null);
  const buckets = sched.buckets;
  const retired = sched.retiredTags;
  const protectedTags = sched.config.protectedTags;
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const patchLoad = (id, axis, v) => mutate((s) => {
    const b = s.buckets.find((x) => x.id === id);
    if (!b) return;
    b.load = { ...b.load, [axis]: Math.max(-2, Math.min(2, Math.round(Number(v) || 0))) };
  });
  const addBucket = () => { const b = mutate((s) => s.addBucket({ label: 'New bucket', role: 'neutral', tags: [] })); if (b) setEditingId(b.id); };
  const seed = () => mutate((s) => seedStarterBuckets(s));
  const patchBucket = (id, changes) => mutate((s) => s.updateBucket(id, changes));
  const dropBucket = (id) => mutate((s) => s.removeBucket(id));
  const unretire = (tag) => mutate((s) => s.unretireTag(tag));

  // Set a bucket's tags (from its TagEditor). A tag lives in at most one bucket,
  // so any newly-added tag is pulled out of every other bucket.
  const setBucketTags = (id, newTags) => mutate((s) => {
    const b = s.buckets.find((x) => x.id === id);
    if (!b) return;
    const added = newTags.filter((t) => !b.tags.includes(t));
    if (added.length) for (const other of s.buckets) if (other !== b) other.tags = other.tags.filter((t) => !added.includes(t));
    b.tags = [...newTags];
  });

  // Bucket-level protection: on = all its tags survive auto-eviction.
  const toggleBucketProtected = (bucket) => mutate((s) => {
    const prot = new Set(s.config.protectedTags);
    const allOn = bucket.tags.length > 0 && bucket.tags.every((t) => prot.has(t));
    for (const t of bucket.tags) (allOn ? prot.delete(t) : prot.add(t));
    s.config.protectedTags = [...prot];
  });

  const editing = buckets.find((b) => b.id === editingId) || null;

  // ---- drill-in bucket editor -------------------------------------------
  if (editing) {
    const allProt = editing.tags.length > 0 && editing.tags.every((t) => protectedTags.includes(t));
    return (
      <div className="cabcard">
        <div className="cabsign">Edit bucket</div>
        <button className="btn2 ghost" style={{ marginBottom: 10, padding: '5px 9px' }} onClick={() => setEditingId(null)}>
          <Icon name="back" /> All buckets
        </button>
        <div className="zonewin" style={{ gap: 6 }}>
          <input type="color" value={editing.color} onChange={(e) => patchBucket(editing.id, { color: e.target.value })} aria-label="Bucket colour" style={{ width: 30, padding: 0 }} />
          <input defaultValue={editing.label} onBlur={(e) => patchBucket(editing.id, { label: e.target.value.trim() || editing.label })} aria-label="Bucket name" style={{ flex: 1 }} />
        </div>
        <div className="zonewin" style={{ gap: 6 }}>
          <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44 }}>role</span>
          <select value={editing.role} onChange={(e) => patchBucket(editing.id, { role: e.target.value })} aria-label="Bucket role" style={{ flex: 1 }}>
            {BUCKET_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="zonewin" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44 }}>energy</span>
          {AXES.map((a) => (
            <label key={a} title={AXIS_META[a].label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span aria-hidden="true">{AXIS_META[a].glyph}</span>
              <input type="number" min="-2" max="2" step="1" value={(editing.load && editing.load[a]) ?? 0} onChange={(e) => patchLoad(editing.id, a, e.target.value)} aria-label={`${editing.label} ${AXIS_META[a].label} load`} style={{ width: 46 }} />
            </label>
          ))}
        </div>
        <div className="zonewin" style={{ gap: 6, alignItems: 'flex-start' }}>
          <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44, paddingTop: 6 }}>tags</span>
          <div style={{ flex: 1 }}>
            <TagEditor tags={editing.tags} onChange={(tags) => setBucketTags(editing.id, tags)} suggestions={suggestions} />
          </div>
        </div>
        <label className="zonewin" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={allProt} onChange={() => toggleBucketProtected(editing)} aria-label="Protect this bucket's tags" />
          protected · its tasks survive auto-eviction
        </label>
        <button className="btn2 ghost" style={{ marginTop: 8, padding: '5px 9px' }} onClick={() => { dropBucket(editing.id); setEditingId(null); }} aria-label={`Remove bucket ${editing.label}`}>
          remove bucket
        </button>
      </div>
    );
  }

  // ---- bucket list ------------------------------------------------------
  return (
    <div className="cabcard">
      <div className="cabsign">Tags &amp; buckets</div>
      <p>Click a bucket to set its energy, colour, role and tags.</p>

      {buckets.length === 0 && <p className="insight">No buckets yet.</p>}
      {buckets.map((b) => (
        <button key={b.id} className="zonerow" onClick={() => setEditingId(b.id)} aria-label={`Edit bucket ${b.label}`}>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0, marginRight: 2 }} />
          <b style={{ color: 'var(--cab-accent)' }}>{b.label}</b>
          <span className="zmeta">
            {ROLE_LABELS[b.role]}{loadSummary(b.load) ? ` · ${loadSummary(b.load)}` : ''} · {b.tags.length} tag{b.tags.length === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true">edit ›</span>
        </button>
      ))}
      <div className="chest" style={{ marginTop: 4 }}>
        <button className="btn2 ghost" style={{ padding: '5px 9px' }} onClick={addBucket} aria-label="Add bucket">＋ bucket</button>
        {buckets.length === 0 && (
          <button className="btn2" style={{ padding: '5px 9px' }} onClick={seed} aria-label="Seed starter buckets">＋ starter buckets</button>
        )}
      </div>

      {/* Recover strip — only if some tags are retired (retiring is parked). */}
      {retired.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="insight" style={{ fontWeight: 700 }}>Retired tags</div>
          <div className="zonewin" style={{ gap: 6, flexWrap: 'wrap' }}>
            {retired.map((t) => (
              <span key={t} className="w cabtag">{t}<button className="rm" onClick={() => unretire(t)} aria-label={`Un-retire ${t}`}>×</button></span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
