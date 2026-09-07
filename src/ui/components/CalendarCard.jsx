// CalendarCard — Cabana section for calendar interchange.
//
// Two paths, deliberately:
//   .ics      — works today, no account, no keys. Google/Apple/Outlook all read it.
//   Google    — one-shot push/pull. Needs a Client ID YOU create (free); it's a
//               public identifier, not a secret, so it lives in localStorage.
// Neither is a sync engine: push sends, pull reads. Nothing reconciles.
import { useRef, useState } from 'react';
import {
  addDays, toICS, parseICS, importEvents, toRRULE,
  planImport, applyImport, describeImport,
} from '../../core/index.js';
import {
  getAccessToken, listCalendars, fetchEvents, taskToGoogleEvent, insertEvent, clearRange,
  readClientId, writeClientId, isAppWrittenEvent,
} from '../google.js';
// The store calendar's id, from the ONE place that owns it. Imported rather than
// drilled through props for the same reason `readClientId` lives in google.js:
// two homes for one value is two values that disagree by next session.
import { loadCalendarId } from '../useGoogleSync.js';
import Icon from '../Icon.jsx';

/**
 * ⚠️ THE STORE CALENDAR IS NOT AN INTERCHANGE TARGET, in either direction.
 *
 * It is the app's save file (design/GOOGLE-AS-STORAGE.md GS-2/GS-3), and both
 * doors on this card corrupt it — in opposite directions and for the same
 * reason: neither knows the `sc.*` encoding exists.
 *
 *  - PUSHING into it wrote tasks in the flat `sandycayId` shape, which
 *    `decodeEvent` reports as `notOurs` and GS-5 counts as foreign. The store
 *    ends up holding events the sync cannot read and refuses to trust.
 *  - PULLING from it runs app-authored events through `eventToTask`, which reads
 *    `x.type` / `x.pinned` / `x.priority` and never looks at `sc.*` — so every
 *    routine step, commitment sitting and chunk parent comes back as an
 *    anonymous fixed task at priority 3, duplicated alongside the original.
 *
 * design/CALENDAR-IMPORT.md §2.4 and §2.5. Hiding it from both lists is the
 * cheap half of the fix; `isAppWrittenEvent` and the `importEvents` guard are
 * the half that holds when someone reaches this by another route.
 */
const usableCalendars = (cals, storeId) => (cals || []).filter((c) => c.id !== storeId);

export default function CalendarCard({ sched, weekStart, mutate, showToast }) {
  const fileRef = useRef(null);
  // Read once per mount: the picker only exists after `connect`, and the store
  // calendar cannot change while this card is open without unmounting it.
  const storeCalendarId = loadCalendarId();
  // The client id moved to google.js when the entry screen started needing it
  // too — one home, so the two cannot drift.
  const [clientId, setClientId] = useState(readClientId);
  const [cals, setCals] = useState(null);
  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState(''); // where Export → Google writes
  const [tagFilter, setTagFilter] = useState('');
  const [busy, setBusy] = useState('');
  // A planned import waiting to be looked at, and the removals vetoed in it.
  const [pending, setPending] = useState(null);
  const [keep, setKeep] = useState([]);

  const saveClientId = (v) => {
    setClientId(v);
    writeClientId(v);
  };

  const download = (name, text, mime) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Everything an import learned but used to throw away.
   *
   * ⚠️ `importEvents` computes THREE things beside the tasks and returns them as
   * non-enumerable properties; both doors on this card read the array and
   * ignored all three (design/CALENDAR-IMPORT.md §2.6):
   *
   *  - `dayNotes`  all-day events. They are a fact about a DAY, and importing one
   *                as a task made a 1440-minute anchor that drew in the PREVIOUS
   *                day's column and sterilised it. `importEvents` was fixed to
   *                divert them; nothing was ever taught to plant them.
   *  - `dropped`   repeat rules that could not be read. The event still imports
   *                as a one-off, which is honest — but its own comment calls
   *                silently flattening a repeating commitment "data loss they
   *                have no way to notice", which is what happened here.
   *  - `refused`   store events, per the new guard in `importEvents`.
   *
   * Returns the extra clauses for the toast, so the sentence states what it did.
   *
   * Takes anything carrying the three arrays: the `importEvents` result directly
   * (.ics, one call), or a plain object the Google door accumulates across its
   * per-event calls.
   */
  const applySideEffects = (carried) => {
    const notes = carried.dayNotes || [];
    const dropped = carried.dropped || [];
    const refused = carried.refused || [];
    if (notes.length) mutate((s) => { for (const n of notes) s.addDayNote(n); });
    const bits = [];
    if (notes.length) bits.push(`${notes.length} all-day event${notes.length === 1 ? '' : 's'} became day notes`);
    if (dropped.length) bits.push(`${dropped.length} repeat rule${dropped.length === 1 ? '' : 's'} could not be read — those came in as one-offs`);
    if (refused.length) bits.push(`${refused.length} skipped (that's the app's own save calendar)`);
    return bits;
  };

  /**
   * Carry out a planned import.
   *
   * Everything goes through `applyImport`, so a re-import updates in place
   * instead of laying a second copy on top of the first — the reported bug
   * (design/CALENDAR-IMPORT.md §2.1).
   */
  const commit = (plan, extra, suffix, skipRemovals) => {
    let res = null;
    mutate((s) => { res = applyImport(s, plan, { skipRemovals }); });
    const bits = [describeImport({ ...plan, remove: plan.remove.filter((r) => !skipRemovals.includes(r.id)) })];
    if (res && res.kept) bits.push(`${res.kept} kept`);
    showToast(`Imported ${suffix} · ${bits.join(' · ')}${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
    setPending(null);
    setKeep([]);
  };

  /**
   * Show the plan before it lands — but only when it would REMOVE something.
   *
   * ⚠️ CI-4 asked for "a list remove, like with clear day". `ClearDayPanel`'s
   * contract is stricter than that: commit stays disabled until EVERY row has
   * been resolved, because "what the scope buys you is the obligation to look".
   * That is right for a one-off destructive gesture and wrong for a weekly class
   * refresh, which would make you re-resolve the same rows every Monday until
   * you learned to click through them without reading — which is how the
   * obligation-to-look contract dies of being applied too often.
   *
   * So: the plan is the default, and every removal is a row you can veto.
   * Adding and updating need no confirmation — nothing is lost either way.
   *
   * ⚠️ AND NO PANEL AT ALL WHEN NOTHING WOULD BE REMOVED, so the common case
   * (first import, or a week where nothing was cancelled) stays one click.
   */
  const review = (plan, extra, suffix) => {
    if (!plan.remove.length) { commit(plan, extra, suffix, []); return; }
    setKeep([]);
    setPending({ plan, extra, suffix });
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
        const tasks = importEvents(events, {
          tagFilter: tags.length ? tags : null, importedAt: Date.now(),
        });
        const extra = applySideEffects(tasks);
        if (!tasks.length) {
          // ⚠️ A file of nothing but all-day events is not an empty import — the
          // day notes have already been planted. Saying "no events found" while
          // silently changing the schedule is the surprise P-1 forbids.
          showToast(extra.length
            ? `No timed events — ${extra.join(' · ')}`
            : (tags.length ? `No events tagged ${tags.join(', ')}` : 'No events found in that file'));
          return;
        }
        // ⚠️ A FILE HAS NO CALENDAR AND NO WINDOW, so no removal is possible:
        // `planImport` only removes uids belonging to the calendar it was handed,
        // and `calendarId: null` matches only other file imports. That is
        // deliberate — a file you were handed says nothing about what your week
        // should no longer contain. Re-importing the SAME file still reconciles
        // rather than duplicating, which is the half that was broken.
        review(
          planImport(sched.tasks.map((t) => t.toJSON()), tasks, {
            calendarId: null, seenUids: events.map((ev) => ev.uid),
          }),
          extra,
          `of ${events.length} events`,
        );
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
      //
      // ⚠️ EXCLUDING THE STORE, which this used to select by name. "Sandy Cay"
      // is exactly what a person calls the calendar they pointed the app at, so
      // the default target WAS the save file more often than not — the first
      // step of the path in design/CALENDAR-IMPORT.md §2.5.
      const mine = usableCalendars(list, storeCalendarId)
        .find((c) => c.canWrite && /sandy\s*cay/i.test(c.name));
      setTarget((t) => t || (mine ? mine.id : ''));
      showToast(`Connected · ${list.length} calendars`);
    } catch (err) {
      showToast(err.message);
    } finally { setBusy(''); }
  };

  const pushToGoogle = async () => {
    if (!target) { showToast('Pick a calendar to export into first'); return; }
    // Belt as well as braces: the option is not in the list, but a stale `target`
    // held in state across a re-connect would still reach here.
    if (storeCalendarId && target === storeCalendarId) {
      showToast('That calendar is where the app saves your data — pick another one');
      return;
    }
    setBusy('push');
    try {
      const token = await getAccessToken(clientId.trim());
      const from = weekStart;
      const to = addDays(weekStart, 7);
      // A push is one-shot, not a sync: replace the week rather than duplicate
      // it. ⚠️ ONLY OUR OWN EVENTS — this used to delete everything in the
      // window, on the strength of a comment asserting the target was dedicated
      // to Sandy Cay while the default target was the store calendar itself.
      // Whatever else lives in that week now survives, and is reported.
      const { removed, kept } = await clearRange(token, target, from, to, isAppWrittenEvent);
      const tasks = sched.getTasksForWeek(weekStart).filter((t) => !t.isOccurrence);
      let n = 0;
      for (const t of tasks) {
        await insertEvent(token, target, taskToGoogleEvent(t, toRRULE(t)));
        n += 1;
      }
      const name = (cals.find((c) => c.id === target) || {}).name || 'calendar';
      showToast(`Exported ${n} events to "${name}"${removed ? ` · replaced ${removed}` : ''}`
        + `${kept ? ` · left ${kept} event${kept === 1 ? '' : 's'} alone` : ''}`);
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
        events = events.concat(evs.map((e) => ({
          ...e,
          _source: cal ? cal.name.toLowerCase() : '',
          // Which calendar it came from, so provenance and the per-calendar
          // removal scope both have something true to key on.
          _calendarId: id,
        })));
      }
      // ⚠️ ONE EVENT AT A TIME because each carries its own `_source` tag, so the
      // side-effect arrays come back per-call and have to be accumulated rather
      // than read off the last one.
      const tasks = [];
      const notes = [];
      const dropped = [];
      const refused = [];
      for (const e of events) {
        const got = importEvents([e], {
          tagFilter: tags.length ? tags : null,
          sourceTags: e._source ? [e._source] : [],
          calendarId: e._calendarId,
          importedAt: Date.now(),
        });
        tasks.push(...got);
        notes.push(...(got.dayNotes || []));
        dropped.push(...(got.dropped || []));
        refused.push(...(got.refused || []));
      }
      const extra = applySideEffects({ dayNotes: notes, dropped, refused });
      // ⚠️ ONE PLAN PER CALENDAR, not one across all of them. Removal is scoped
      // to "things I imported from THIS calendar that this calendar no longer
      // has" — merging the pulls would let a tick in Class Schedule delete an
      // import from Work.
      const plans = picked.map((id) => planImport(
        sched.tasks.map((t) => t.toJSON()),
        tasks.filter((t) => t.source && t.source.calendarId === id),
        {
          calendarId: id,
          // CI-5: every uid FETCHED from this calendar, before the tag filter.
          seenUids: events.filter((e) => e._calendarId === id).map((e) => e.uid),
          from,
          to,
        },
      ));
      const merged = {
        create: plans.flatMap((p) => p.create),
        update: plans.flatMap((p) => p.update),
        remove: plans.flatMap((p) => p.remove),
        untouched: plans.flatMap((p) => p.untouched),
        decisions: plans.flatMap((p) => p.decisions),
      };
      if (!merged.create.length && !merged.update.length && !merged.remove.length) {
        showToast(extra.length ? `No timed events — ${extra.join(' · ')}` : 'Nothing matched in that week');
        return;
      }
      review(merged, extra, `of ${events.length} events`);
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

      {pending && (
        <div className="importreview" role="group" aria-label="Review this import">
          <p style={{ margin: '10px 0 4px' }}>
            <b>{pending.plan.remove.length}</b>
            {pending.plan.remove.length === 1 ? ' thing is' : ' things are'} no longer in that
            calendar. Untick anything you want to keep.
          </p>
          <div className="callist">
            {pending.plan.remove.map((r) => {
              const on = !keep.includes(r.id);
              return (
                <label key={r.id} className={`calrow${on ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setKeep((k) => (on ? [...k, r.id] : k.filter((x) => x !== r.id)))}
                  />
                  <span className="calname" title={r.title}>{r.title}</span>
                  <span className="calmeta">remove</span>
                </label>
              );
            })}
          </div>
          {/* Says what ELSE the plan does, so the list is not mistaken for the
              whole of it — the panel exists for removals, but the import is
              also adding and updating. */}
          <p className="insight" style={{ opacity: 0.75 }}>
            {pending.plan.create.length} to add · {pending.plan.update.length} to update ·
            {' '}{pending.plan.remove.length - keep.length} to remove
          </p>
          <div className="chest">
            <button
              className="btn2"
              onClick={() => commit(pending.plan, pending.extra, pending.suffix, keep)}
            >
              Apply
            </button>
            <button className="btn2 ghost" onClick={() => { setPending(null); setKeep([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
              {usableCalendars(cals, storeCalendarId).filter((c) => c.canWrite).map((c) => (
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
            {usableCalendars(cals, storeCalendarId).map((c) => {
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
