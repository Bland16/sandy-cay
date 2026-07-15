// TagEditor — chip list + add-a-tag. Protected tags (rest/break/recovery) are
// hinted so a user can make a task survive auto-eviction (case 2B).
import { useState } from 'react';

const PROTECTED = ['rest', 'break', 'recovery'];

export default function TagEditor({ tags, onChange }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const t = draft.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="chips">
      {tags.length === 0 && !adding && <span className="psub">no tags</span>}
      {tags.map((t) => (
        <span key={t} className={`pill tag on`}>
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 4, fontWeight: 800 }}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="input"
          autoFocus
          style={{ width: 120 }}
          value={draft}
          list="protected-tags"
          placeholder="tag…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(''); setAdding(false); }
          }}
        />
      ) : (
        <button type="button" className="pill tag" onClick={() => setAdding(true)}>＋ tag</button>
      )}
      <datalist id="protected-tags">
        {PROTECTED.map((p) => <option key={p} value={p} />)}
      </datalist>
    </div>
  );
}
