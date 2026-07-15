// CalendarCard — Cabana section for calendar interchange.
//
// Two paths, deliberately:
//   .ics      — works today, no account, no keys. Google/Apple/Outlook all read it.
//   Google    — one-shot push/pull. Needs a Client ID YOU create (free); it's a
//               public identifier, not a secret, so it lives in localStorage.
// Neither is a sync engine: push sends, pull reads. Nothing reconciles.
import { useRef, useState } from 'react';
import { addDays, toICS, parseICS, importEvents, toRRULE } from '../../core/index.js';
import { getAccessToken, listCalendars, fetchEvents, taskToGoogleEvent, insertEvent, clearRange } from '../google.js';
import Icon from '../Icon.jsx';

const CLIENT_ID_KEY = 'sandy-cay:google-client-id';

// An OAuth *Client ID* is a public identifier, not a secret — a static site has
// nowhere to hide one, which is exactly why this uses the token flow. It's
// origin-restricted (localhost:5173 + bland16.github.io), so it is only usable
// from this app. Pre-filled for convenience; override it in the field to point
// at your own Cloud project.
const DEFAULT_CLIENT_ID = '128479595220-bssj6ecsf0mu3jcg359oe0qfki3jerfc.apps.googleusercontent.com';

export default function CalendarCard({ sched, weekStart, mutate, showToast }) {
  const fileRef = useRef(null);
  const [clientId, setClientId] = useState(() => {
    try { return window.localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID; } catch { return DEFAULT_CLIENT_ID; }
  });
  const [cals, setCals] = useState(null);
  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState(''); // where Export → Google writes
  const [tagFilter, setTagFilter] = useState('');
  const [busy, setBusy] = useState('');

  const saveClientId = (v) => {
    setClientId(v);
    try { window.localStorage.setItem(CLIENT_ID_KEY, v.trim()); } catch { /* session only */ }
  };

  const download = (name, text, mime) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- .ics ---------------------------------------------------------------
  const exportIcs = () => {
    const parents = sched.tasks.filter((t) => !t.isOccurrence && !t.chunking);
    download('sandy-cay.ics', toICS(parents), 'text/calendar');
    showToast(`Exported ${parents.length} events — import it in Google Calendar → Settings → Import`);
  };

  const importIcs = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const events = parseICS(String(reader.result));
        const tags = tagFilter.split(',').map((s) => s.trim()).filter(Boolean);
        const tasks = importEvents(events, { tagFilter: tags.length ? tags : null });
        if (!tasks.length) {
          showToast(tags.length ? `No events tagged ${tags.join(', ')}` : 'No events found in that file');
          return;
        }
        mutate((s) => { for (const t of tasks) s.tasks.push(t); });
        showToast(`Imported ${tasks.length} of ${events.length} events`);
      } catch {
        showToast("That file didn't parse as a calendar");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ---- Google -------------------------------------------------------------
  const connect = async () => {
    setBusy('connect');
    try {
      const token = await getAccessToken(clientId.trim());
      const list = await listCalendars(token);
      setCals(list);
      // Default the push target to a calendar that already looks like ours,
      // rather than making a new one every time and spamming the sidebar.
      const mine = list.find((c) => c.canWrite && /sandy\s*cay/i.test(c.name));
      setTarget((t) => t || (mine ? mine.id : ''));
      showToast(`Connected · ${list.length} calendars`);
    } catch (err) {
      showToast(err.message);
    } finally { setBusy(''); }
  };

  const pushToGoogle = async () => {
    if (!target) { showToast('Pick a calendar to export into first'); return; }
    setBusy('push');
    try {
      const token = await getAccessToken(clientId.trim());
      const from = weekStart;
      const to = addDays(weekStart, 7);
      // A push is one-shot, not a sync: replace the week rather than duplicate
      // it. Safe because `target` is a calendar dedicated to Sandy Cay.
      const removed = await clearRange(token, target, from, to);
      const tasks = sched.getTasksForWeek(weekStart).filter((t) => !t.isOccurrence);
      let n = 0;
      for (const t of tasks) {
        await insertEvent(token, target, taskToGoogleEvent(t, toRRULE(t)));
        n += 1;
      }
      const name = (cals.find((c) => c.id === target) || {}).name || 'calendar';
      showToast(`Exported ${n} events to "${name}"${removed ? ` · replaced ${removed}` : ''}`);
    } catch (err) {
      showToast(err.message);
    } finally { setBusy(''); }
  };

  const pullFromGoogle = async () => {
    setBusy('pull');
    try {
      const token = await getAccessToken(clientId.trim());
      const from = weekStart;
      const to = addDays(weekStart, 7);
      const tags = tagFilter.split(',').map((s) => s.trim()).filter(Boolean);
      let events = [];
      for (const id of picked) {
        const cal = cals.find((c) => c.id === id);
        const evs = await fetchEvents(token, id, from, to);
        // The calendar's own name is the honest source tag: "this is my Work calendar".
        events = events.concat(evs.map((e) => ({ ...e, _source: cal ? cal.name.toLowerCase() : '' })));
      }
      const tasks = [];
      for (const e of events) {
        const got = importEvents([e], { tagFilter: tags.length ? tags : null, sourceTags: e._source ? [e._source] : [] });
        tasks.push(...got);
      }
      if (!tasks.length) { showToast('Nothing matched in that week'); return; }
      mutate((s) => { for (const t of tasks) s.tasks.push(t); });
      showToast(`Imported ${tasks.length} of ${events.length} events from Google`);
    } catch (err) {
      showToast(err.message);
    } finally { setBusy(''); }
  };

  const ready = clientId.trim().length > 20;

  return (
    <div className="cabcard">
      <div className="cabsign">Calendar</div>
      <p>Move your week in and out. Neither path syncs — a push sends, a pull reads.</p>

      <div className="chest">
        <button className="btn2" onClick={exportIcs}><Icon name="chest" /> Export .ics</button>
        <button className="btn2 ghost" onClick={() => fileRef.current && fileRef.current.click()}>
          <Icon name="key" /> Import .ics
        </button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" style={{ display: 'none' }} onChange={importIcs} />
      </div>

      <div className="zonewin" style={{ marginTop: 10 }}>
        <span>only tags:</span>
        <input
          value={tagFilter}
          placeholder="study, work — blank = all"
          onChange={(e) => setTagFilter(e.target.value)}
          style={{ flex: 1 }}
          aria-label="Import tag filter"
        />
      </div>
      <p className="insight" style={{ opacity: 0.75 }}>
        Calendars have no tags, so a tag is a <b style={{ color: 'var(--cab-accent)' }}>#hashtag</b> in the title,
        or the name of the calendar it came from.
      </p>

      <div style={{ borderTop: '1px dashed var(--cab-trim)', margin: '12px 0 10px' }} />

      <p style={{ margin: '0 0 6px' }}>Google Calendar <span style={{ opacity: 0.7 }}>— needs a free Client ID you create</span></p>
      <div className="zonewin">
        <input
          value={clientId}
          placeholder="xxxx.apps.googleusercontent.com"
          onChange={(e) => saveClientId(e.target.value)}
          style={{ flex: 1 }}
          aria-label="Google OAuth Client ID"
        />
      </div>

      {!ready && (
        <p className="insight" style={{ opacity: 0.75 }}>
          Google Cloud Console → new project → enable the Calendar API → OAuth consent screen
          (Testing, add yourself) → Credentials → OAuth Client ID (Web) → add this origin.
          Free; no billing. The ID is public, not a secret.
        </p>
      )}

      <div className="chest" style={{ marginTop: 8 }}>
        <button className="btn2 ghost" disabled={!ready || !!busy} onClick={connect}>
          {busy === 'connect' ? 'Connecting…' : cals ? 'Reconnect' : 'Connect'}
        </button>
      </div>

      {cals && (
        <>
          <p style={{ margin: '12px 0 4px' }}>Export this week into:</p>
          <div className="calexport">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Export target calendar"
            >
              <option value="">— pick a calendar —</option>
              {cals.filter((c) => c.canWrite).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn2" disabled={!target || !!busy} onClick={pushToGoogle}>
              {busy === 'push' ? 'Exporting…' : 'Export →'}
            </button>
          </div>
          <p className="insight" style={{ opacity: 0.7 }}>
            Replaces this week in that calendar, so exporting twice doesn&apos;t double it —
            point it at one you keep <b style={{ color: 'var(--cab-accent)' }}>only</b> for Sandy Cay.
          </p>

          <p style={{ margin: '12px 0 4px' }}>Pull this week from:</p>
          <div className="callist">
            {cals.map((c) => {
              const on = picked.includes(c.id);
              return (
                <label key={c.id} className={`calrow${on ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  />
                  <span className="calname" title={c.name}>{c.name}</span>
                  {c.primary && <span className="calmeta">primary</span>}
                </label>
              );
            })}
          </div>
          <button className="btn2" disabled={!picked.length || !!busy} onClick={pullFromGoogle}>
            {busy === 'pull'
              ? 'Importing…'
              : picked.length
                ? `Import ← ${picked.length} calendar${picked.length === 1 ? '' : 's'}`
                : 'Import ← pick a calendar'}
          </button>
          <p className="insight" style={{ opacity: 0.7 }}>
            Each calendar&apos;s name becomes a tag, so events from Class Schedule arrive
            tagged <b style={{ color: 'var(--cab-accent)' }}>class schedule</b>.
          </p>
        </>
      )}
    </div>
  );
}
