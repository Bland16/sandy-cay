// TagManager — the Cabana's single bucket-centric editor (design/EDITOR-REDESIGN.md).
// A bucket owns BOTH its tags/energy AND its activities, so they live in one card,
// not two (which would each open on the same bucket list). Three drill-in levels:
//   0 — the buckets (name · N tags · N activities);
//   1 — one bucket: colour · name · energy wave · tags · protected, then its
//       Activities (add / paste-many); plus an "Unbucketed activities" entry;
//   2 — one activity's focused editor (ActivityEditor).
// No `role` enum — a bucket's character is its load vector (design/RECONCILIATION.md).
import { useState, useMemo } from 'react';
import { seedStarterBuckets, activityUsage, activityPage, activityCfg, parseBulkBlock, dedupeBulk, SORTS, SORT_LABELS } from '../../core/index.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import EnergyControl from './EnergyControl.jsx';
import ActivityEditor from './ActivityEditor.jsx';
import Icon from '../Icon.jsx';

const ORPHANS = '__orphans__';
const countActs = (n) => `${n} activit${n === 1 ? 'y' : 'ies'}`;

/** Commit bar for the paste sheet. Everything that will NOT land is named before
 *  you press the button — a bulk import that silently drops rows is how you end
 *  up trusting a library that isn't what you pasted. */
function BulkPreview({ draft, onCommit, onCancel }) {
  const { fresh, duplicates, unknownBuckets, unassigned } = draft;
  const buckets = new Set(fresh.map((d) => d.bucketId));
  return (
    <>
      <div className="chest">
        <button className="btn2 bulkbtn" onClick={onCommit} disabled={fresh.length === 0}>
          Add {fresh.length || ''} activit{fresh.length === 1 ? 'y' : 'ies'}
          {buckets.size > 1 ? ` to ${buckets.size} buckets` : ''}
        </button>
        <button className="btn2 ghost bulkbtn" onClick={onCancel}>Cancel</button>
      </div>
      {duplicates.length > 0 && (
        <div className="field-help">
          skipping {duplicates.length} duplicate{duplicates.length === 1 ? '' : 's'}: {duplicates.map((d) => d.label).join(', ')}
        </div>
      )}
      {unknownBuckets.length > 0 && (
        <div className="field-help">
          no bucket named {unknownBuckets.map((b) => `“${b}”`).join(', ')} — those rows are skipped. Rename the heading or make the bucket first.
        </div>
      )}
      {unassigned.length > 0 && (
        <div className="field-help">
          {unassigned.length} row{unassigned.length === 1 ? '' : 's'} before the first “# bucket” heading, with no bucket to put them in — skipped.
        </div>
      )}
    </>
  );
}
// Below this many, a bucket needs no filter/sort machinery — showing it would be
// clutter in service of a problem you don't have (EDITOR-REDESIGN §7.1).
const SIMPLE_LIST_MAX = 3;

export default function TagManager({ sched, mutate }) {
  const [editingId, setEditingId] = useState(null); // bucket id or ORPHANS
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  // Activity list ergonomics (EDITOR-REDESIGN §7.1)
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('az');
  const [page, setPage] = useState(1);
  const buckets = sched.buckets;
  const activities = sched.activities;
  const retired = sched.retiredTags;
  const protectedTags = sched.config.protectedTags;
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const inBucket = (id) => activities.filter((a) => a.bucketId === id);
  const orphans = activities.filter((a) => !a.bucketId || !buckets.some((b) => b.id === a.bucketId));

  // Enter/leave a bucket (or the orphans view). Always resets the paste-many sheet
  // so a half-open bulk box never leaks from one bucket into the next — and the
  // filter/page with it, so you don't walk into a bucket already filtered to
  // nothing by a query you typed somewhere else.
  const openBucket = (id) => { setEditingId(id); setBulkOpen(false); setBulkText(''); setQuery(''); setPage(1); };
  // Typing MUST reset to page 1: filtering down to 3 results while stranded on
  // page 4 shows an empty list (EDITOR-REDESIGN §7.1, the one real hazard of
  // having a filter and a pager together).
  const onQuery = (v) => { setQuery(v); setPage(1); };
  const onSort = (v) => { setSort(v); setPage(1); };
  const usage = useMemo(() => activityUsage(sched), [sched, sched.rev]);

  // bucket ops
  const setLoad = (id, load) => mutate((s) => { const b = s.buckets.find((x) => x.id === id); if (b) b.load = load; });
  const addBucket = () => { const b = mutate((s) => s.addBucket({ label: 'New bucket', tags: [] })); if (b) openBucket(b.id); };
  const seed = () => mutate((s) => seedStarterBuckets(s));
  const patchBucket = (id, changes) => mutate((s) => s.updateBucket(id, changes));
  const dropBucket = (id) => mutate((s) => s.removeBucket(id));
  const unretire = (tag) => mutate((s) => s.unretireTag(tag));

  // A tag lives in at most one bucket, so a newly-added tag leaves every other.
  const setBucketTags = (id, newTags) => mutate((s) => {
    const b = s.buckets.find((x) => x.id === id);
    if (!b) return;
    const added = newTags.filter((t) => !b.tags.includes(t));
    if (added.length) for (const other of s.buckets) if (other !== b) other.tags = other.tags.filter((t) => !added.includes(t));
    b.tags = [...newTags];
  });
  const toggleBucketProtected = (bucket) => mutate((s) => {
    const prot = new Set(s.config.protectedTags);
    const allOn = bucket.tags.length > 0 && bucket.tags.every((t) => prot.has(t));
    for (const t of bucket.tags) (allOn ? prot.delete(t) : prot.add(t));
    s.config.protectedTags = [...prot];
  });

  // activity ops
  const addActivity = (bucket) => {
    const a = mutate((s) => s.addActivity({
      bucketId: bucket ? bucket.id : null,
      label: 'New activity',
      tags: bucket ? [...bucket.tags] : [],
      durationMin: 15,
      durationMax: 60,
    }));
    if (a) setEditingActivityId(a.id);
  };
  // Parse the paste sheet, honouring "# Bucket" headers, then drop duplicates —
  // repeats within the paste AND things a bucket already has, so pasting the same
  // block twice is idempotent. Dedupe is scoped per bucket: the same label in two
  // different buckets is legitimate.
  const bulkDrafts = (bucket) => {
    const parsed = parseBulkBlock(bulkText, { buckets, defaultBucket: bucket });
    const existingByBucket = {};
    for (const b of buckets) existingByBucket[b.id] = inBucket(b.id);
    existingByBucket[''] = orphans;
    const { fresh, duplicates } = dedupeBulk(parsed.drafts, existingByBucket);
    return { ...parsed, fresh, duplicates };
  };
  const commitBulk = (bucket) => {
    const { fresh } = bulkDrafts(bucket);
    mutate((s) => { for (const d of fresh) s.addActivity(d); });
    setBulkText(''); setBulkOpen(false);
  };

  const activityRow = (a) => (
    <button key={a.id} className="zonerow" onClick={() => setEditingActivityId(a.id)} aria-label={`Edit activity ${a.label}`}>
      <b style={{ color: 'var(--cab-accent)' }}>{a.label}</b>
      <span className="zmeta">
        {a.durationMin === a.durationMax ? `${a.durationMin} min` : `${a.durationMin}–${a.durationMax} min`}
        {a.priority ? ` · P${a.priority}` : ''}
      </span>
      <span aria-hidden="true">edit ›</span>
    </button>
  );

  // ---- level 2: focused activity editor ---------------------------------
  if (editingActivityId) {
    return <ActivityEditor sched={sched} mutate={mutate} activityId={editingActivityId} suggestions={suggestions} onBack={() => setEditingActivityId(null)} />;
  }

  // ---- level 1: a bucket (settings + its activities), or the orphans view -
  if (editingId) {
    const isOrphans = editingId === ORPHANS;
    const editing = isOrphans ? null : buckets.find((b) => b.id === editingId);
    if (!isOrphans && !editing) { setEditingId(null); return null; }
    const list = isOrphans ? orphans : inBucket(editingId);
    const name = isOrphans ? 'No bucket' : editing.label;
    // filter → sort → paginate (§7.1). paginate clamps, so a filter that shrinks
    // the list can't strand us on a page that no longer exists.
    const shown = activityPage(list, { query, sort, page, usage, pageSize: activityCfg(sched.config).pageSize });
    const allProt = !isOrphans && editing.tags.length > 0 && editing.tags.every((t) => protectedTags.includes(t));
    return (
      <div className="cabcard">
        <div className="cabsign">{isOrphans ? 'Unbucketed activities' : 'Edit bucket'}</div>
        <button className="btn2 ghost" style={{ marginBottom: 10, padding: '5px 9px' }} onClick={() => openBucket(null)}>
          <Icon name="back" /> All buckets
        </button>

        {!isOrphans && (
          <>
            <div className="zonewin" style={{ gap: 6 }}>
              <input type="color" value={editing.color} onChange={(e) => patchBucket(editing.id, { color: e.target.value })} aria-label="Bucket colour" style={{ width: 30, padding: 0 }} />
              <input defaultValue={editing.label} onBlur={(e) => patchBucket(editing.id, { label: e.target.value.trim() || editing.label })} aria-label="Bucket name" style={{ flex: 1 }} />
            </div>
            <div className="zonewin" style={{ gap: 6, alignItems: 'flex-start' }}>
              <span style={{ opacity: 0.6, fontSize: 12, minWidth: 44, paddingTop: 6 }}>energy</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <EnergyControl value={editing.load} onChange={(load) => setLoad(editing.id, load)} />
              </div>
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
          </>
        )}

        {/* Activities section — the consolidation: activities live in their bucket */}
        <div className="insight" style={{ fontWeight: 700, color: 'var(--cab-accent)', marginTop: isOrphans ? 0 : 12 }}>
          Activities <span style={{ opacity: 0.6, fontWeight: 400 }}>· {countActs(list.length)}</span>
        </div>
        {/* Filter + sort appear only once the list is long enough to need them —
            a bucket with three activities stays as calm as it is today. */}
        {list.length > SIMPLE_LIST_MAX && (
          <div className="listtools">
            <input
              className="control grow"
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="filter…"
              aria-label={`Filter activities in ${name}`}
            />
            <select className="control" value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Sort activities">
              {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </div>
        )}
        {list.length === 0 && <p className="insight">No activities here yet.</p>}
        {list.length > 0 && shown.total === 0 && (
          <p className="insight">
            Nothing matches “{query}”. <button className="linklike" onClick={() => onQuery('')}>clear the filter</button>
          </p>
        )}
        {shown.items.map((a) => activityRow(a))}
        {shown.pageCount > 1 && (
          <div className="pager">
            <button className="btn2 ghost" onClick={() => setPage(shown.page - 1)} disabled={shown.page <= 1} aria-label="Previous page of activities">‹ prev</button>
            <span className="pagerat" aria-live="polite">{shown.page} of {shown.pageCount}</span>
            <button className="btn2 ghost" onClick={() => setPage(shown.page + 1)} disabled={shown.page >= shown.pageCount} aria-label="Next page of activities">next ›</button>
          </div>
        )}
        {bulkOpen && !isOrphans ? (
          <div className="zonewin" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <textarea
              className="cabinput"
              rows={4}
              autoFocus
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={`One activity per line, e.g.\nRead\nSketch | 30-90 | art, calm\n\n# Creative\n…starts a run for another bucket`}
              aria-label={`Bulk add activities to ${name}`}
              style={{ resize: 'vertical', minHeight: 74 }}
            />
            {/* Live count of what will actually land, and what won't — the skip is
                stated before you commit, never silently swallowed. */}
            <BulkPreview draft={bulkDrafts(isOrphans ? null : editing)} onCommit={() => commitBulk(isOrphans ? null : editing)} onCancel={() => { setBulkText(''); setBulkOpen(false); }} />
          </div>
        ) : (
          <div className="chest" style={{ marginTop: 4 }}>
            <button className="btn2 ghost" style={{ padding: '5px 9px' }} onClick={() => addActivity(isOrphans ? null : editing)} aria-label={`Add activity to ${name}`}>＋ activity</button>
            {!isOrphans && <button className="btn2 ghost" style={{ padding: '5px 9px' }} onClick={() => { setBulkText(''); setBulkOpen(true); }} aria-label={`Paste many activities to ${name}`}>⤓ paste many</button>}
          </div>
        )}

        {!isOrphans && (
          <button className="btn2 ghost" style={{ marginTop: 12, padding: '5px 9px' }} onClick={() => { dropBucket(editing.id); openBucket(null); }} aria-label={`Remove bucket ${editing.label}`}>
            remove bucket
          </button>
        )}
      </div>
    );
  }

  // ---- level 0: the buckets (bounded height, however many activities) ----
  return (
    <div className="cabcard">
      <div className="cabsign">Tags &amp; buckets</div>
      <p>A bucket groups tags and holds its activities. Open one to set its energy, colour, tags, and the things you do in it.</p>

      {buckets.length === 0 && <p className="insight">No buckets yet.</p>}
      {buckets.map((b) => (
        <button key={b.id} className="zonerow" onClick={() => openBucket(b.id)} aria-label={`Edit bucket ${b.label}`}>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0, marginRight: 2 }} />
          <b style={{ color: 'var(--cab-accent)' }}>{b.label}</b>
          <span className="zmeta">
            {b.tags.length} tag{b.tags.length === 1 ? '' : 's'} · {countActs(inBucket(b.id).length)}
          </span>
          <span aria-hidden="true">edit ›</span>
        </button>
      ))}

      {orphans.length > 0 && (
        <button className="zonerow" onClick={() => openBucket(ORPHANS)} aria-label="Open unbucketed activities">
          <b>No bucket</b>
          <span className="zmeta">{countActs(orphans.length)}</span>
          <span aria-hidden="true">open ›</span>
        </button>
      )}

      {/* Cross-bucket paste lives HERE, at the list, because that's the level it
          operates on — seeding a whole library in one go rather than six. */}
      {bulkOpen ? (
        <div className="zonewin" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <textarea
            className="cabinput"
            rows={6}
            autoFocus
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'# Rest\nnap | 20-45\nread a book | 15-90\n\n# Creative\nwrite poetry | 15-60'}
            aria-label="Bulk add activities across buckets"
            style={{ resize: 'vertical', minHeight: 110 }}
          />
          <BulkPreview draft={bulkDrafts(null)} onCommit={() => commitBulk(null)} onCancel={() => { setBulkText(''); setBulkOpen(false); }} />
        </div>
      ) : (
        <div className="chest" style={{ marginTop: 4 }}>
          <button className="btn2 ghost" style={{ padding: '5px 9px' }} onClick={addBucket} aria-label="Add bucket">＋ bucket</button>
          {buckets.length > 0 && (
            <button className="btn2 ghost" style={{ padding: '5px 9px' }} onClick={() => { setBulkText(''); setBulkOpen(true); }} aria-label="Paste many activities across buckets">⤓ paste many</button>
          )}
          {buckets.length === 0 && (
            <button className="btn2" style={{ padding: '5px 9px' }} onClick={seed} aria-label="Seed starter buckets">＋ starter buckets</button>
          )}
        </div>
      )}

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
