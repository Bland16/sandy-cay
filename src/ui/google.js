// google.js — one-shot push/pull with Google Calendar. NOT a sync engine: no
// sync tokens, no tombstones, no conflict resolution. You finalize a week and
// push it; you pull events in and they become tasks. That's the whole contract.
//
// This lives in src/ui, not src/core: it touches the network and the DOM, and
// core is DOM-free by lint rule (§12).
//
// Auth: GitHub Pages is static, so there is no server and no client secret.
// This is a public client using Google Identity Services' token flow — you get
// an in-memory access token that expires in ~an hour, and re-consent silently.
// Nothing is persisted except your Client ID (which is public by design).
//
// The mapping deliberately reuses src/core/ical.js: a Google event is
// normalized into the SAME record shape parseICS produces, so tag derivation,
// filtering and Task construction are the tested code path, not a second one.

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Two scopes, because they cover different things and `calendar.events` alone
// does NOT let you list calendars:
//   calendar.readonly — read the calendarList ("which calendars do I have?")
//   calendar.events   — read AND write events on them
// Deliberately NOT the blanket `auth/calendar`: we never create or delete a
// calendar, only events on one you picked, so we don't ask for that power.
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const API = 'https://www.googleapis.com/calendar/v3';

let gisPromise = null;

/** Load Google Identity Services once. */
export function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no DOM')); return; }
    if (window.google && window.google.accounts) { resolve(window.google); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Couldn't reach Google — check your connection."));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Ask Google for an access token. Opens the consent popup the first time.
 * @returns {Promise<string>} access token (in memory only, ~1h)
 */
export async function getAccessToken(clientId, { prompt = '' } = {}) {
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt,
      callback: (res) => {
        if (res && res.access_token) resolve(res.access_token);
        else reject(new Error(res?.error_description || 'Google declined the request.'));
      },
      error_callback: (err) => reject(new Error(err?.message || 'Consent was cancelled.')),
    });
    client.requestAccessToken();
  });
}

/**
 * Google's errors are JSON blobs; a toast is one line. Say what happened and
 * what to do, and keep the raw reason for anything we haven't met yet.
 */
function explainGoogleError(status, body) {
  let reason = '';
  try {
    reason = (JSON.parse(body).error || {}).message || '';
  } catch {
    reason = String(body || '').slice(0, 120);
  }
  if (status === 401) return 'Google sign-in expired — hit Connect again.';
  if (status === 403 && /insufficient authentication scopes/i.test(reason)) {
    return 'Google needs re-consent for calendar access — hit Connect and accept both boxes.';
  }
  if (status === 403 && /calendarUsageLimits|rateLimit|quota/i.test(reason)) {
    return 'Google is rate-limiting this account — wait a minute and retry.';
  }
  if (status === 403) return `Google refused: ${reason || 'access denied'}`;
  if (status === 404) return "That calendar isn't there any more — hit Connect to refresh the list.";
  return `Google said ${status}: ${reason || 'unknown error'}`;
}

async function call(token, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(explainGoogleError(res.status, body));
  }
  return res.status === 204 ? null : res.json();
}

/** The user's calendars — this is the real "tag": Work, Study, Personal… */
export async function listCalendars(token) {
  const data = await call(token, '/users/me/calendarList?minAccessRole=reader');
  return (data.items || []).map((c) => ({
    id: c.id,
    name: c.summaryOverride || c.summary,
    primary: !!c.primary,
    canWrite: c.accessRole === 'owner' || c.accessRole === 'writer',
  }));
}

/** Local Date → RFC3339 with offset, so 09:00 means 09:00 where you are. */
function rfc3339(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${oh}:${om}`;
}

/**
 * A Google event → the record shape src/core/ical.js#parseICS emits, so the
 * tested mapping/filtering path is reused rather than duplicated.
 */
export function normalizeGoogleEvent(ev) {
  const startRaw = ev.start && (ev.start.dateTime || ev.start.date);
  const endRaw = ev.end && (ev.end.dateTime || ev.end.date);
  if (!startRaw) return null;
  const rrule = (ev.recurrence || []).find((r) => r.startsWith('RRULE:'));
  return {
    uid: ev.id,
    summary: ev.summary || 'Untitled',
    description: ev.description || '',
    categories: [], // Google has no categories — tags come from #hashtags / the calendar
    start: new Date(startRaw),
    end: endRaw ? new Date(endRaw) : null,
    rrule: rrule ? rrule.slice(6) : undefined,
    recurrenceId: ev.recurringEventId ? new Date(startRaw) : undefined,
    x: (ev.extendedProperties && ev.extendedProperties.private) || {},
  };
}

/** Pull a window of events from one calendar (singleEvents: recurrence expanded). */
export async function fetchEvents(token, calendarId, from, to) {
  const q = new URLSearchParams({
    timeMin: rfc3339(from),
    timeMax: rfc3339(to),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const out = [];
  let pageToken = '';
  do {
    const url = `/calendars/${encodeURIComponent(calendarId)}/events?${q}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await call(token, url);
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled') continue;
      const rec = normalizeGoogleEvent(ev);
      if (rec) out.push(rec);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** A Task → a Google event body. Our extras ride in extendedProperties. */
export function taskToGoogleEvent(task, rrule) {
  const body = {
    summary: task.title,
    description: task.details || undefined,
    start: { dateTime: rfc3339(task.startTime) },
    end: { dateTime: rfc3339(task.endTime) },
    extendedProperties: {
      private: {
        sandycayId: String(task.id),
        type: task.type,
        pinned: task.pinned ? 'TRUE' : 'FALSE',
        priority: String(task.priority),
        ...(task.tags && task.tags.length ? { tags: task.tags.join(',') } : {}),
      },
    },
  };
  if (rrule) body.recurrence = [`RRULE:${rrule}`];
  return body;
}

/** Create one event. */
export function insertEvent(token, calendarId, body) {
  return call(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// NB: no createCalendar. We write events into a calendar you already made and
// picked, which needs only calendar.events — creating one would need the
// blanket `auth/calendar` scope, and that's a lot of power to hold for a
// convenience. Make the calendar in Google; point us at it.

export function deleteEvent(token, calendarId, eventId) {
  return call(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

/**
 * Raw (unexpanded) events overlapping a window — recurring series come back as
 * ONE event, which is what you want to delete.
 */
export async function listRawEvents(token, calendarId, from, to) {
  const q = new URLSearchParams({
    timeMin: rfc3339(from),
    timeMax: rfc3339(to),
    singleEvents: 'false',
    maxResults: '250',
  });
  const data = await call(token, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return (data.items || []).filter((e) => e.status !== 'cancelled');
}

/**
 * Empty a window on OUR calendar before re-pushing it.
 *
 * A push is one-shot, not a sync: without this, pushing the same week twice
 * gives you two of everything. Replacing the window makes a re-push idempotent.
 * Only ever call this against a calendar dedicated to Sandy Cay — it deletes
 * whatever it finds.
 * @returns {Promise<number>} how many were removed
 */
export async function clearRange(token, calendarId, from, to) {
  const events = await listRawEvents(token, calendarId, from, to);
  let n = 0;
  for (const ev of events) {
    await deleteEvent(token, calendarId, ev.id);
    n += 1;
  }
  return n;
}
