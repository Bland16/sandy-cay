// Cabana — the full-screen settings page (replaces the schedule). Warm --cab-*
// palette. Sections: Tuning (weights + urgency → re-optimize), Zones editor,
// Tag roles (protected tags), Footlocker (export/import), Insights
// (getTagBreakdown + learned weights read), Retrain.
import { useRef, useState } from 'react';
import {
  exportState, summarizeImport, planBlockerConversion, convertBlockersToDayNotes,
  planLibraryMerge, applyLibraryMerge, applyLibrary,
} from '../../core/index.js';
import { fmtDur } from '../format.js';
import Icon from '../Icon.jsx';
import CalendarCard from './CalendarCard.jsx';
import { SESSION } from '../session.js';
import { isSyncDebug, setSyncDebug } from '../syncLog.js';
import TagManager from './TagManager.jsx';
import EnergyCard from './EnergyCard.jsx';
import ZonesEditor from './ZonesEditor.jsx';
import CommitmentsEditor from './CommitmentsEditor.jsx';
import RoutinesEditor from './RoutinesEditor.jsx';

const WEIGHT_KEYS = [['proximity', 'Proximity'], ['balance', 'Balance'], ['stability', 'Stability'], ['preference', 'Preference (learned)'], ['buffer', 'Finish early']];

// GS-8. The library's own key names for a person to read. Anything without an
// entry falls back to the raw key rather than being hidden — a collection
// missing from this list must still be nameable in the warning, or a device
// could be frozen over something the screen never mentions.
const LIBRARY_LABEL = {
  buckets: 'Tag buckets',
  activities: 'Activities',
  zones: 'Zones',
  retiredTags: 'Retired tags',
  dayNotes: 'Day notes',
  blockedDays: 'Blocked days',
  commitments: 'Commitments',
  routineInstances: 'Routines',
  config: 'Settings',
  model: 'What it has learned',
  snapshots: 'Weekly baselines',
  lastSeenWeek: 'Last week seen',
  dismissed: 'Answered notices',
};

export default function Cabana({
  sched, mutate, weekStart, onBack, onReplace, onReset, showToast,
  session = null, onChangeSession, sync = null,
}) {
  const fileRef = useRef(null);
  const mergeRef = useRef(null);
  const setupRef = useRef(null);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const setWeight = (key, v) => { mutate((s) => { s.config.weights[key] = v; }); };
  const setUrgency = (v) => { mutate((s) => { s.config.urgencyFactor = v; }); };
  const reoptimize = () => { const r = mutate((s) => s.autoSchedule({ weekStart })); showToast(`Re-optimized · ${r.placed.length} placed`); };

  const doExport = () => {
    const { filename, data } = exportState(sched);
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${filename}`);
    } catch { showToast('Export unavailable here'); }
  };
  const doImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const blob = JSON.parse(reader.result);
        const sum = summarizeImport(blob);
        if (!sum.valid) { showToast(sum.reason); return; }
        const extra = [
          sum.dayNoteCount ? `${sum.dayNoteCount} day note${sum.dayNoteCount === 1 ? '' : 's'}` : null,
          sum.blockedDayCount ? `${sum.blockedDayCount} blocked day${sum.blockedDayCount === 1 ? '' : 's'}` : null,
          sum.commitmentCount ? `${sum.commitmentCount} standing commitment${sum.commitmentCount === 1 ? '' : 's'}` : null,
          sum.routineCount ? `${sum.routineCount} routine run${sum.routineCount === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(', ');
        if (window.confirm(`Import ${sum.taskCount} tasks, ${sum.zoneCount} zones, ${sum.ratings} ratings${extra ? `, ${extra}` : ''}? This replaces your current week.`)) {
          onReplace(blob);
          showToast('Footlocker restored');
        }
      } catch { showToast('That file was not valid JSON'); }
    };
    reader.readAsText(file);
  };

  // ── The two OTHER doors into a footlocker file ────────────────────────
  //
  // A file cannot say whether you meant "restore my old setup" or "top up what
  // I have", so both exist and each states what it does BEFORE it does it.
  // Neither touches your tasks; the plain Import above is the one that does.
  const readBlob = (e, then) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // so picking the same file twice works
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { then(JSON.parse(reader.result)); } catch { showToast('That file was not valid JSON'); }
    };
    reader.readAsText(file);
  };

  const doMerge = (e) => readBlob(e, (blob) => {
    const plan = planLibraryMerge(sched, blob);
    if (!plan.valid) { showToast(plan.reason); return; }
    if (!plan.activityCount && !plan.bucketCount) {
      showToast(plan.skippedCount ? `Nothing new — you already have all ${plan.skippedCount}` : 'That file has no activities');
      return;
    }
    // Specific enough to DECLINE. "Import activities?" is not a question
    // anybody can answer; the counts and the skip are.
    const msg = `Add ${plan.activityCount} activit${plan.activityCount === 1 ? 'y' : 'ies'}`
      + `${plan.bucketCount ? ` and ${plan.bucketCount} bucket${plan.bucketCount === 1 ? '' : 's'} they need` : ''}?`
      + `${plan.skippedCount ? ` ${plan.skippedCount} you already have will be skipped.` : ''}`
      + ' Nothing you have is changed or removed.';
    if (!window.confirm(msg)) return;
    const r = mutate((s) => applyLibraryMerge(s, blob));
    showToast(`Added ${r.activitiesAdded} activit${r.activitiesAdded === 1 ? 'y' : 'ies'}`
      + `${r.bucketsAdded ? ` · ${r.bucketsAdded} new bucket${r.bucketsAdded === 1 ? '' : 's'}` : ''}`);
    bump();
  });

  const doRestoreSetup = (e) => readBlob(e, (blob) => {
    const sum = summarizeImport(blob);
    if (!sum.valid) { showToast(sum.reason); return; }
    // ⚠️ This one DOES discard. Say so, and say what survives, because the
    // difference from the button beside it is the whole reason both exist.
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const msg = `Replace your buckets, activities, zones and settings with this file's`
      + ` (${n(sum.bucketCount, 'bucket', 'buckets')}, ${n(sum.activityCount, 'activity', 'activities')},`
      + ` ${n(sum.zoneCount, 'zone', 'zones')})?`
      + ' Your tasks are kept. Anything you have made since is discarded.';
    if (!window.confirm(msg)) return;
    const r = mutate((s) => applyLibrary(s, blob));
    showToast(`Restored ${r.applied.length} collections · your week is untouched`);
    bump();
  });

  const retrain = () => { const n = mutate((s) => s.retrain()); showToast(`Retrained on ${n} ratings`); bump(); };

  // Whole-day blockers modelled as TASKS (DAY-NOTES §1) — offered, never done
  // silently. Stating the counts and the dates before asking is what makes it
  // consentable: an action you cannot preview is one you cannot agree to.
  const blockerPlan = planBlockerConversion(sched);
  const convertBlockers = () => {
    const { notes, taskIds } = blockerPlan;
    const ok = window.confirm(
      `Turn ${taskIds.length} whole-day blocker task${taskIds.length === 1 ? '' : 's'} into `
      + `${notes.length} day note${notes.length === 1 ? '' : 's'}?\n\n`
      + notes.map((n) => `  ${n.label}  ${n.from}${n.to !== n.from ? ` → ${n.to}` : ''}`).join('\n')
      + '\n\nThe cards go and the days keep their names in the header. '
      + 'Each day stays BLOCKED, so the scheduler still keeps off it — but you '
      + 'can now put things there yourself, which the cards used to refuse. '
      + 'Export first if you want the old shape back.',
    );
    if (!ok) return;
    const r = mutate((s) => convertBlockersToDayNotes(s));
    showToast(
      `${r.tasksRemoved} card${r.tasksRemoved === 1 ? '' : 's'} → `
      + `${r.notesAdded} note${r.notesAdded === 1 ? '' : 's'} · ${r.daysBlocked} day${r.daysBlocked === 1 ? '' : 's'} blocked`,
    );
    bump();
  };

  const breakdown = sched.getTagBreakdown(weekStart);
  const maxTag = Math.max(1, ...breakdown.map((r) => r.scheduledMin));
  const learned = sched.learning.trained ? sched.learning.inspect().filter((w) => Math.abs(w.weight) > 0.01).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5) : [];

  return (
    <div className="cabana">
      <div className="cabtop">
        <div className="cabtitle">The Cabana<small>step off the beach · settings</small></div>
        <button className="cabback" onClick={onBack}><Icon name="back" /> Back to week</button>
      </div>
      <div className="cabgrid">
        {/* Tuning */}
        <div className="cabcard">
          <div className="cabsign">Tuning</div>
          <p>Play with the scoring weights against your real week, then re-optimize.</p>
          {WEIGHT_KEYS.map(([k, label]) => (
            <div className="sliderrow" key={k}>
              <div className="sl"><span>{label}</span><span>{sched.config.weights[k].toFixed(2)}</span></div>
              <input type="range" min="0" max="1" step="0.05" value={sched.config.weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
            </div>
          ))}
          <div className="sliderrow">
            <div className="sl"><span>Urgency factor</span><span>{sched.config.urgencyFactor.toFixed(2)}</span></div>
            <input type="range" min="0.5" max="3" step="0.1" value={sched.config.urgencyFactor} onChange={(e) => setUrgency(Number(e.target.value))} />
          </div>
          <button className="btn2" style={{ marginTop: 8 }} onClick={reoptimize}><Icon name="refresh" /> Re-optimize week</button>
        </div>

        {/* Standing commitments — how much a period owes, on the same drill-in
            idiom (design/WEEKLY-PLANNING.md §4). Above zones because it is the
            thing the user comes here to author this term. */}
        <CommitmentsEditor sched={sched} mutate={mutate} weekStart={weekStart} showToast={showToast} />

        {/* Routines — author a procedure with waits in it (design/ROUTINES.md
            R-C). The procedure is the unit: named as a whole, created and
            deleted as a whole, and a step only ever exists inside one. */}
        <RoutinesEditor sched={sched} mutate={mutate} weekStart={weekStart} showToast={showToast} />

        {/* Zones — the shared drill-in editor (design/EDITOR-REDESIGN.md). */}
        <ZonesEditor sched={sched} mutate={mutate} />

        {/* Buckets — the single bucket-centric card: tags, energy, protection,
            AND the activities that live in each bucket (design/EDITOR-REDESIGN.md). */}
        <TagManager sched={sched} mutate={mutate} />

        {/* Energy — today's deterministic budget across the load axes. */}
        <EnergyCard sched={sched} />

        {/* How this browser is signed in, and the way back to the entry screen.
            The choice is NOT one-way (GS-3): without this, switching from guest
            to Google would mean clearing browser storage, which is a terrible
            answer to "actually, I do want this on my phone". */}
        {session && (
          <div className="cabcard">
            <div className="cabsign">Your landing</div>
            <p>
              {session === SESSION.GOOGLE
                ? 'Signed in with Google — your week is meant to live in your own calendar.'
                : 'Sailing without a flag — this week lives in this browser alone, and nothing is sent anywhere.'}
            </p>
            {session === SESSION.GUEST && (
              <p className="cabhint">
                Export from the Footlocker below before you close the tab, or the tide takes it.
              </p>
            )}

            {/* GS-5. Nothing is written until a calendar is chosen AND checked.
                The refusal has to reach the user HERE, because the disaster it
                prevents is a mis-click writing 37 tasks into Class Schedule. */}
            {/* No picker here. Clearing the stored calendar drops you back to
                the CalendarPicker screen, which is the one implementation —
                two would drift, and this one would be the one nobody tested. */}
            {session === SESSION.GOOGLE && sync && sync.calendarId && (
              <div className="syncbox">
                <p className="cabhint">
                  Syncing to <code>{sync.calendarId}</code>
                  {sync.status === 'syncing' ? ' · working…' : ''}
                </p>
                {sync.lastError && <p className="cabwarn">{sync.lastError}</p>}
                {/* GS-8. The sync is FROZEN while this is showing — nothing is
                    written to Google and nothing local is changed. It cannot be
                    dismissed, because dismissing it would leave a device that
                    silently never syncs, which is the failure this whole design
                    is trying to stop being possible. It goes away by being
                    answered. */}
                {sync.libraryState && sync.libraryState.conflict && (
                  <div className="syncconflict">
                    <p className="cabwarn">
                      <b>Sync is paused.</b> This device and the calendar disagree about your
                      setup, and nothing can be written either way until you say which is right.
                    </p>
                    <ul className="synclibdiff">
                      {sync.libraryState.rows.map((r) => (
                        <li key={r.key}>
                          <span className="synclibkey">{LIBRARY_LABEL[r.key] || r.key}</span>
                          <span className="synclibcount">{r.here} here · {r.there} in the calendar</span>
                        </li>
                      ))}
                    </ul>
                    {/* Both are destructive to one side, so both say so plainly
                        and neither is styled as the safe default. */}
                    <div className="chest">
                      <button
                        className="btn2"
                        disabled={sync.status === 'syncing'}
                        onClick={() => sync.pushLibraryNow().catch((e) => showToast(e.message))}
                      >
                        This device is right — replace the calendar
                      </button>
                      <button
                        className="btn2"
                        disabled={sync.status === 'syncing'}
                        onClick={() => sync.deriveLibraryFromCalendar().catch((e) => showToast(e.message))}
                      >
                        The calendar is right — derive from it
                      </button>
                    </div>
                    <p className="cabhint">
                      Your tasks are untouched by either choice. This is about buckets, zones,
                      activities and settings — the things that are not appointments.
                    </p>
                  </div>
                )}
                <div className="chest">
                  <button
                    className="btn2"
                    onClick={() => sync.syncNow()}
                    disabled={sync.status === 'syncing' || !!(sync.libraryState && sync.libraryState.conflict)}
                  >
                    <Icon name="refresh" /> Sync now
                  </button>
                  <button className="btn2 ghost" onClick={sync.forget}>Use a different calendar</button>
                </div>
                {/* Off by default. Logging that is always on stops being read —
                    it becomes noise you scroll past, and the one line that
                    mattered is invisible. */}
                <label className="synclog">
                  <input
                    type="checkbox"
                    defaultChecked={isSyncDebug()}
                    onChange={(e) => { setSyncDebug(e.target.checked); bump(); }}
                  />
                  <span>Log every task to the browser console while syncing</span>
                </label>
              </div>
            )}

            <div className="chest">
              <button className="btn2 ghost" onClick={onChangeSession}>
                <Icon name="compass" /> Change how you sign in
              </button>
            </div>
          </div>
        )}

        <CalendarCard sched={sched} weekStart={weekStart} mutate={mutate} showToast={showToast} />

        {/* Footlocker */}
        <div className="cabcard">
          <div className="cabsign">Footlocker</div>
          <p>Your durable copy — export a versioned <code>schedule.json</code> or import one.</p>
          <div className="chest">
            <button className="btn2" onClick={doExport}><Icon name="chest" /> Export</button>
            <button className="btn2 ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="key" /> Import</button>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={doImport} />
          </div>
          {/* Two narrower doors into the same file. Named by what they DO, not
              by what they are, because "partial import" tells you nothing about
              whether you are about to lose this term's buckets. */}
          <div className="chest" style={{ marginTop: 8 }}>
            <button className="btn2 ghost" onClick={() => mergeRef.current && mergeRef.current.click()}>
              Add missing activities
            </button>
            <input ref={mergeRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={doMerge} />
            <button className="btn2 ghost" onClick={() => setupRef.current && setupRef.current.click()}>
              Restore setup only
            </button>
            <input ref={setupRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={doRestoreSetup} />
          </div>
          <p className="insight" style={{ opacity: 0.75 }}>
            <b>Import</b> replaces everything, your week included. <b>Add missing activities</b>
            {' '}only ever adds — it skips anything you already have by name and leaves your
            buckets alone. <b>Restore setup only</b> takes that file&rsquo;s buckets, activities,
            zones and settings but <b>keeps your tasks</b>.
          </p>
          {blockerPlan.taskIds.length > 0 && (
            <>
              <p className="insight" style={{ marginTop: 10 }}>
                <b>{blockerPlan.taskIds.length} task{blockerPlan.taskIds.length === 1 ? '' : 's'}</b>
                {' '}here cover{blockerPlan.taskIds.length === 1 ? 's' : ''} a whole day, so
                {' '}{blockerPlan.taskIds.length === 1 ? 'it draws' : 'they draw'} as full-height
                cards standing where the day&rsquo;s contents belong. Converted, they become
                {' '}<b>{blockerPlan.notes.length} day note{blockerPlan.notes.length === 1 ? '' : 's'}</b>
                {' '}in the header, and each day stays <b>blocked</b> — the scheduler keeps
                off it, but your own hand is no longer refused.
              </p>
              <button className="btn2 ghost" style={{ marginTop: 6 }} onClick={convertBlockers}>
                Convert to day notes
              </button>
            </>
          )}
          <p className="insight" style={{ opacity: 0.75, marginTop: 10 }}>
            Starting fresh erases every task, zone and rating on this device. Export first
            if you want it back.
          </p>
          <button
            className="btn2 ghost"
            style={{ marginTop: 6 }}
            onClick={() => {
              if (window.confirm('Erase every task, zone and rating on this device? Export first if you want them back.')) {
                onReset();
                showToast('Cleared — an empty week');
              }
            }}
          >
            Start fresh
          </button>
        </div>

        {/* Insights */}
        <div className="cabcard">
          <div className="cabsign">Insights</div>
          <p className="insight">Hours by tag, this week:</p>
          {breakdown.length === 0 && <p className="insight">No tagged tasks yet.</p>}
          {breakdown.slice(0, 6).map((r) => (
            <div className="insight" key={r.tag}>
              <span><b>{r.tag}</b> · {fmtDur(r.scheduledMin)}{r.avgShells != null ? ` · ${r.avgShells.toFixed(1)}★` : ''}</span>
              <div className="bar2"><i style={{ width: `${Math.round((r.scheduledMin / maxTag) * 100)}%` }} /></div>
            </div>
          ))}
          <p className="insight" style={{ marginTop: 8 }}>
            Learned model: <b>{sched.learning.sampleCount}</b> ratings{sched.learning.trained ? ', trained' : ' (cold start)'}.
          </p>
          {learned.map((w) => (
            <div className="insight" key={w.label}>{w.label}: <b>{w.weight >= 0 ? '+' : ''}{w.weight.toFixed(2)}</b></div>
          ))}
          <button className="btn2" style={{ marginTop: 10 }} onClick={retrain}><Icon name="refresh" /> Retrain now · {sched.learning.sampleCount} ratings</button>
        </div>
      </div>
    </div>
  );
}
