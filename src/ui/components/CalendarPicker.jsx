// CalendarPicker — which calendar IS the app's storage (GOOGLE-AS-STORAGE GS-5).
//
// A step in the sign-in flow, between the entry screen and the app: you have
// said you want a Google account, and this is where you say WHERE it lives.
//
// It is a screen rather than a setting because nothing can sync until it is
// answered, and a signed-in app that silently saves nothing until you find a
// panel in the Cabana is worse than one that asks. The gate in App.jsx also
// brings you back here whenever a signed-in session has no calendar — which is
// how "Use a different calendar" works, so there is only ONE picker.
//
// ⚠️ The refusal is the point of this screen, not a detail of it. Pointing the
// app at a real calendar would write dozens of events into it, so a calendar
// holding anything Sandy Cay did not write is refused BY NAME. The app cannot
// create a calendar for you — that needs the broad `auth/calendar` scope
// google.js deliberately never asks for — so it tells you to make one instead.
import { useCallback, useEffect, useState } from 'react';
import { listCalendars, getAccessToken, readClientId } from '../google.js';
import chest from '../../assets/icons/treasure-chest.png';
import bottle from '../../assets/icons/message-bottle.png';

export default function CalendarPicker({ onPick, onBack, busyLabel = null }) {
  const [cals, setCals] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listCalendars(await getAccessToken(readClientId()));
      // Only ones we could actually write to — offering the rest is offering a
      // choice that fails later, which is worse than not offering it.
      setCals(all.filter((c) => c.canWrite));
    } catch (e) {
      setError(e?.message || 'Could not reach Google.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const choose = async (cal) => {
    setError(null);
    setPicking(cal.id);
    try {
      await onPick(cal.id);
    } catch (e) {
      // The GS-5 refusal, or anything else Google objected to. Said in full.
      setError(e?.message || 'That calendar cannot be used.');
    } finally {
      setPicking(null);
    }
  };

  return (
    <section className="lz">
      <div className="lz-layer lz-wood" aria-hidden="true" />
      <div className="lz-layer lz-lamp" aria-hidden="true" />
      <div className="lz-layer lz-vignette" aria-hidden="true" />

      <div className="lz-chart cp-chart">
        <div className="lz-parchment" aria-hidden="true" />
        <div className="lz-content">
          <div className="lz-brand">
            <h1>Where to bury it</h1>
            <div className="lz-rule"><span>pick a calendar</span></div>
          </div>

          <p className="cp-lead">
            Sandy Cay keeps your week inside one of your own Google calendars.
            Pick an <b>empty</b> one — make a new calendar in Google Calendar if
            you need to, since this app can&rsquo;t create one for you.
          </p>

          {error && <p className="lz-error" role="alert">{error}</p>}

          {loading && <p className="cp-note">Asking Google…</p>}

          {!loading && cals && cals.length === 0 && (
            <p className="cp-note">
              No calendars you can write to. Make one in Google Calendar, then refresh.
            </p>
          )}

          {!loading && cals && cals.length > 0 && (
            <div className="cp-list">
              {cals.map((c) => (
                <button
                  key={c.id}
                  className="cp-row"
                  type="button"
                  disabled={!!picking}
                  onClick={() => choose(c)}
                >
                  <img className="lz-px" src={chest} alt="" aria-hidden="true" />
                  <span>
                    <span className="cp-name">{c.name}</span>
                    {c.primary && <span className="cp-tag">your main calendar — probably not this one</span>}
                  </span>
                  {picking === c.id && <span className="cp-busy">{busyLabel || 'checking…'}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="cp-actions">
            <button className="cp-alt" type="button" onClick={load} disabled={loading}>
              Made a new one? Refresh
            </button>
            {/* Never a dead end: if none of this works, the guest door is still
                a real way to use the app. */}
            <button className="cp-alt" type="button" onClick={onBack}>
              <img className="lz-px cp-mini" src={bottle} alt="" aria-hidden="true" />
              Go back
            </button>
          </div>

          <p className="lz-smallprint">
            Sandy Cay will refuse a calendar that already has other events in it,
            so it can never write over something you care about.
          </p>
        </div>
      </div>
    </section>
  );
}
