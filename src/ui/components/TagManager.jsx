// TagManager — the Cabana's single place per tag (design/ACTIVITY-LIBRARY.md).
// Absorbs the old "Tag roles" card: for each tag you set its bucket, whether it's
// protected (survives auto-eviction), and whether it's retired. Buckets are a
// compact LIST you drill into to edit (name, colour, role, energy load) — the
// Zones-editor idiom — so nothing is a wall of open controls. Tags list under
// their bucket as tight one-line rows, with an "Unbucketed" group surfacing tags
// that have appeared but aren't sorted yet.
import { useState } from 'react';
import { BUCKET_ROLES, seedStarterBuckets } from '../../core/index.js';
import { tagsInUse } from './TagEditor.jsx';
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

  const allTags = Array.from(new Set([
    ...tagsInUse(sched),
    ...buckets.flatMap((b) => b.tags),
    ...retired,
  ])).sort();
  const bucketOf = (tag) => buckets.find((b) => b.tags.includes(tag)) || null;
  const unbucketed = allTags.filter((t) => !bucketOf(t));

  // A tag lives in at most one bucket: assigning moves it (pull from every other).
  const assign = (tag, bucketId) => mutate((s) => {
    for (const b of s.buckets) if (b.tags.includes(tag)) b.tags = b.tags.filter((t) => t !== tag);
    if (bucketId) {
      const b = s.buckets.find((x) => x.id === bucketId);
      if (b && !b.tags.includes(tag)) b.tags = [...b.tags, tag];
    }
  });
  const toggleProtect = (tag) => mutate((s) => {
    s.config.protectedTags = s.config.protectedTags.includes(tag)
      ? s.config.protectedTags.filter((t) => t !== tag)
      : [...s.config.protectedTags, tag];
  });
  const toggleRetire = (tag) => mutate((s) => (s.isTagRetired(tag) ? s.unretireTag(tag) : s.retireTag(tag)));

  const patchLoad = (id, axis, v) => mutate((s) => {
    const b = s.buckets.find((x) => x.id === id);
    if (!b) return;
    b.load = { ...b.load, [axis]: Math.max(-2, Math.min(2, Math.round(Number(v) || 0))) };
  });
  const addBucket = () => { const b = mutate((s) => s.addBucket({ label: 'New bucket', role: 'neutral', tags: [] })); if (b) setEditingId(b.id); };
  const seed = () => mutate((s) => seedStarterBuckets(s));
  const patchBucket = (id, changes) => mutate((s) => s.updateBucket(id, changes));
  const dropBucket = (id) => mutate((s) => s.removeBucket(id));

  const tagRow = (tag) => {
    const b = bucketOf(tag);
    const isRet = retired.includes(tag);
    const isProt = protectedTags.includes(tag);
    return (
      <div key={tag} className="tagline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0', opacity: isRet ? 0.5 : 1 }}>
        <span className="cabtag" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
        <select value={b ? b.id : ''} onChange={(e) => assign(tag, e.target.value || null)} aria-label={`Bucket for ${tag}`} style={{ maxWidth: 112 }}>
          <option value="">— none —</option>
          {buckets.map((bk) => <option key={bk.id} value={bk.id}>{bk.label}</option>)}
        </select>
        <input type="checkbox" checked={isProt} onChange={() => toggleProtect(tag)} aria-label={`Protect ${tag}`} title="Protected — survives auto-eviction" />
        <button className="btn2 ghost" style={{ padding: '2px 7px', whiteSpace: 'nowrap' }} onClick={() => toggleRetire(tag)} aria-label={`${isRet ? 'Un-retire' : 'Retire'} ${tag}`}>
          {isRet ? 'un-retire' : 'retire'}
        </button>
      </div>
    );
  };

  const editing = buckets.find((b) => b.id === editingId) || null;

  // ---- drill-in bucket editor -------------------------------------------
  if (editing) {
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
        <p className="insight" style={{ opacity: 0.6, marginTop: 2 }}>＋ spends that reserve, − restores it.</p>
        <button className="btn2 ghost" style={{ marginTop: 8, padding: '5px 9px' }} onClick={() => { dropBucket(editing.id); setEditingId(null); }} aria-label={`Remove bucket ${editing.label}`}>
          remove bucket
        </button>
      </div>
    );
  }

  // ---- bucket list + tag list -------------------------------------------
  return (
    <div className="cabcard">
      <div className="cabsign">Tags &amp; buckets</div>
      <p>Click a bucket to set its energy, colour and role. Sort each tag below.</p>

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

      {buckets.map((b) => {
        const tags = [...b.tags].sort();
        if (tags.length === 0) return null;
        return (
          <div key={b.id} style={{ marginTop: 10 }}>
            <div className="insight" style={{ fontWeight: 700, color: 'var(--cab-accent)' }}>{b.label}</div>
            {tags.map((t) => tagRow(t))}
          </div>
        );
      })}

      <div style={{ marginTop: 10 }}>
        <div className="insight" style={{ fontWeight: 700 }}>
          Unbucketed{unbucketed.length ? ` · ${unbucketed.length}` : ''}
        </div>
        {unbucketed.length === 0
          ? <p className="insight" style={{ opacity: 0.7 }}>Every tag is sorted.</p>
          : unbucketed.map((t) => tagRow(t))}
      </div>
    </div>
  );
}
