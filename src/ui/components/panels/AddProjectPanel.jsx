// AddProjectPanel — a project built bucket by bucket (case 5B). Total/min/max
// hours + a date range; a live bucket preview via the engine's sliceChunks;
// submit materializes chunks through addProject.
import { useState } from 'react';
import { addDays, sliceChunks, dateKey } from '../../../core/index.js';
import PanelHeader from '../PanelHeader.jsx';
import TagEditor from '../TagEditor.jsx';
import Icon from '../../Icon.jsx';

export default function AddProjectPanel({ mutate, weekStart, onClose, showToast }) {
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState(10);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(3);
  const [tags, setTags] = useState([]);
  const [from, setFrom] = useState(dateKey(weekStart));
  const [until, setUntil] = useState(dateKey(addDays(weekStart, 13)));

  const totalMin = Math.round(total * 60);
  const buckets = sliceChunks(totalMin, Math.round(min * 60), Math.round(max * 60));
  const canSubmit = title.trim().length > 0 && totalMin > 0 && buckets.length > 0;
  const maxBucket = Math.max(1, ...buckets);

  const submit = () => {
    if (!canSubmit) return;
    mutate((s) => s.addProject({
      title: title.trim(),
      tags,
      chunking: {
        totalMinutes: totalMin,
        minChunk: Math.round(min * 60),
        maxChunk: Math.round(max * 60),
        range: { from: new Date(from), until: new Date(until) },
      },
    }));
    showToast(`Project "${title.trim()}" built across the weeks`);
    onClose();
  };

  return (
    <>
      <PanelHeader title="Add project" sub="built bucket by bucket" onClose={onClose} />
      <div className="fieldrow">
        <div className="flabel">Title</div>
        <input className="input" autoFocus placeholder="Thesis chapter 2" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="fieldrow split">
        <div style={{ flex: 1 }}>
          <div className="flabel">Total (h)</div>
          <input className="input" type="number" min="1" step="0.5" value={total} onChange={(e) => setTotal(Number(e.target.value))} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="flabel">Min chunk</div>
          <input className="input" type="number" min="0.5" step="0.5" value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="flabel">Max</div>
          <input className="input" type="number" min="0.5" step="0.5" value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
      </div>
      <div className="fieldrow split">
        <div style={{ flex: 1 }}>
          <div className="flabel">From</div>
          <input className="timein" style={{ width: '100%' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="flabel">Until</div>
          <input className="timein" style={{ width: '100%' }} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="flabel">Tags · zone</div>
        <TagEditor tags={tags} onChange={setTags} />
      </div>
      <div className="fieldrow">
        <div className="flabel">Preview · {buckets.length} buckets → castle</div>
        <div className="bucketrow">
          {buckets.map((b, i) => <div className="bucket" key={i} style={{ height: `${Math.round((b / maxBucket) * 100)}%` }} title={`${Math.round(b)}m`} />)}
        </div>
      </div>
      <button type="button" className="btn cta" style={{ marginTop: 8 }} disabled={!canSubmit} onClick={submit}>
        <Icon name="castle" /> Build it across the weeks
      </button>
    </>
  );
}
