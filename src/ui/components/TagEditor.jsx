// TagEditor — chip list + add-a-tag with an on-brand suggestion list.
// The native <datalist> was replaced: it renders as an unstyled OS dropdown
// that breaks the paper/ink world. Suggestions = tags already in use (passed by
// the caller) + the protected ones (rest/break/recovery), which are flagged so a
// user can see how to make a task survive auto-eviction (case 2B).
// Styles are inline against the design tokens so the list stays self-contained.
import { useState } from 'react';

const PROTECTED = ['rest', 'break', 'recovery'];
const MAX = 6;

/** Tags already in use across the schedule — the useful half of the suggestions. */
export const tagsInUse = (sched) =>
  Array.from(new Set((sched?.tasks || []).flatMap((t) => t.tags || []))).sort();

/**
 * onRetire (optional) turns on the retire affordance — only the bucket editor
 * passes it (EDITOR-REDESIGN §8). The two verbs are deliberately distinct:
 *   ×      remove from this bucket — the tag itself is untouched
 *   retire archive the tag everywhere new work is created; history, zones and
 *          existing tasks keep it. Reversible from the retired-tags strip.
 * Conflating them is the obvious mistake, so both carry explicit labels.
 */
export default function TagEditor({ tags, onChange, suggestions = [], onRetire = null, retired = [] }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [hi, setHi] = useState(-1);

  const q = draft.trim().toLowerCase();
  const pool = Array.from(new Set([...suggestions, ...PROTECTED]));
  const matches = pool
    .filter((t) => !tags.includes(t) && t.includes(q))
    .sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)) || a.localeCompare(b))
    .slice(0, MAX);

  const add = (value) => {
    const t = (value || '').trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    close();
  };
  const close = () => { setDraft(''); setHi(-1); setAdding(false); };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(hi >= 0 && matches[hi] ? matches[hi] : draft);
    } else if (e.key === 'Escape') {
      e.preventDefault(); close();
    } else if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault(); setHi((h) => (h + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault(); setHi((h) => (h <= 0 ? matches.length - 1 : h - 1));
    }
  };

  return (
    <div className="chips">
      {tags.length === 0 && !adding && <span className="psub">no tags</span>}
      {tags.map((t) => (
        <span key={t} className={retired.includes(t) ? 'pill tag on isretired' : 'pill tag on'}>
          {t}
          {retired.includes(t) && <span className="retiredmark" title="retired — hidden from new work">·retired</span>}
          {onRetire && !retired.includes(t) && (
            <button
              type="button"
              className="tagretire"
              aria-label={`Retire ${t}`}
              title={`Retire “${t}” — hide it from new work, keep it on history`}
              onClick={() => onRetire(t)}
            >
              retire
            </button>
          )}
          <button
            type="button"
            className="tagrm"
            aria-label={onRetire ? `Remove ${t} from bucket` : `Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            autoFocus
            style={{ width: 130 }}
            value={draft}
            placeholder="tag…"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-autocomplete="list"
            aria-label="Add a tag"
            onChange={(e) => { setDraft(e.target.value); setHi(-1); }}
            onBlur={() => add(draft)}
            onKeyDown={onKeyDown}
          />
          {matches.length > 0 && (
            <ul
              role="listbox"
              style={{
                position: 'absolute', top: 'calc(100% + 5px)', left: 0, minWidth: 152,
                listStyle: 'none', margin: 0, padding: 4, zIndex: 'var(--z-menu)',
                background: 'var(--paper)', border: '2px solid var(--ink)', borderRadius: 10,
                boxShadow: '0 10px 24px rgba(42,38,32,.28)',
              }}
            >
              {matches.map((m, i) => (
                <li key={m}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    onMouseDown={(e) => { e.preventDefault(); add(m); }}
                    onMouseEnter={() => setHi(i)}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: 'none',
                      textAlign: 'left', font: 'inherit', fontSize: 12, color: 'var(--ink)',
                      background: i === hi ? 'var(--paper-shade)' : 'transparent',
                    }}
                  >
                    <span>{m}</span>
                    {PROTECTED.includes(m) && (
                      <span style={{ fontFamily: 'var(--font-type)', fontSize: 9, opacity: 0.6 }}>protected</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" className="pill tag" onClick={() => setAdding(true)}>＋ tag</button>
      )}
    </div>
  );
}
