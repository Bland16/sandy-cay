// TagManager — the Cabana's single place per tag (design/ACTIVITY-LIBRARY.md).
// Absorbs the old "Tag roles" card: for each tag you set its bucket, whether it's
// protected (survives auto-eviction), and whether it's retired. Buckets are
// created/renamed/recoloured/roled here too, and the six starter buckets can be
// seeded when there are none. Tags group under their bucket, with an "Unbucketed"
// group that surfaces tags that have appeared but aren't sorted yet.
import { BUCKET_ROLES, seedStarterBuckets } from '../../core/index.js';
import { tagsInUse } from './TagEditor.jsx';

const ROLE_LABELS = {
  rest: 'Rest', creative: 'Creative', work: 'Work',
  social: 'Social', health: 'Health', neutral: 'Neutral',
};

export default function TagManager({ sched, mutate }) {
  const buckets = sched.buckets;
  const retired = sched.retiredTags;
  const protectedTags = sched.config.protectedTags;

  // Every tag the app knows about: on tasks (current or historical), assigned to a
  // bucket, or retired. A retired tag stays listed here so it can be un-retired.
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

  const addBucket = () => mutate((s) => s.addBucket({ label: 'New bucket', role: 'neutral', tags: [] }));
  const seed = () => mutate((s) => seedStarterBuckets(s));
  const patchBucket = (id, changes) => mutate((s) => s.updateBucket(id, changes));
  const dropBucket = (id) => mutate((s) => s.removeBucket(id));

  const tagRow = (tag) => {
    const b = bucketOf(tag);
    const isRet = retired.includes(tag);
    const isProt = protectedTags.includes(tag);
    return (
      <div className="zonewin" key={tag} style={{ gap: 6, opacity: isRet ? 0.55 : 1 }}>
        <span className="cabtag" style={{ minWidth: 84 }}>{tag}</span>
        <select
          value={b ? b.id : ''}
          onChange={(e) => assign(tag, e.target.value || null)}
          aria-label={`Bucket for ${tag}`}
        >
          <option value="">— unbucketed —</option>
          {buckets.map((bk) => <option key={bk.id} value={bk.id}>{bk.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
          <input type="checkbox" checked={isProt} onChange={() => toggleProtect(tag)} aria-label={`Protect ${tag}`} />
          protected
        </label>
        <button
          className="btn2 ghost"
          style={{ padding: '4px 8px', maxWidth: 92 }}
          onClick={() => toggleRetire(tag)}
          aria-label={`${isRet ? 'Un-retire' : 'Retire'} ${tag}`}
        >
          {isRet ? 'un-retire' : 'retire'}
        </button>
      </div>
    );
  };

  return (
    <div className="cabcard">
      <div className="cabsign">Tags &amp; buckets</div>
      <p>Sort tags into buckets, mark the protected ones (they survive auto-eviction), and retire tags you&apos;re done with.</p>

      {buckets.length === 0 && <p className="insight">No buckets yet.</p>}
      {buckets.map((b) => (
        <div className="zonewin" key={b.id} style={{ gap: 6 }}>
          <input
            type="color"
            value={b.color}
            onChange={(e) => patchBucket(b.id, { color: e.target.value })}
            aria-label={`${b.label} colour`}
            style={{ width: 30, padding: 0 }}
          />
          <input
            defaultValue={b.label}
            onBlur={(e) => patchBucket(b.id, { label: e.target.value.trim() || b.label })}
            aria-label="Bucket name"
            style={{ flex: 1 }}
          />
          <select value={b.role} onChange={(e) => patchBucket(b.id, { role: e.target.value })} aria-label={`${b.label} role`}>
            {BUCKET_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button className="rm" onClick={() => dropBucket(b.id)} aria-label={`Remove bucket ${b.label}`}>×</button>
        </div>
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
