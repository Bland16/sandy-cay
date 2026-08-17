// RoutineSteps — the step editor for one routine (design/ROUTINES.md §UI).
//
// ════════════════════════════════════════════════════════════════════════════
// THE KIND COMES FROM WHICH BUTTON YOU PRESSED. IT IS NEVER INFERRED.
// ════════════════════════════════════════════════════════════════════════════
//
// Two buttons, side by side: **＋ timed step** and **＋ wait**. That is the
// user's decision (2026-08-17) and it is error-free by construction — there is
// no text to misread and no word list to be wrong about.
//
// ⚠️ Two earlier attempts inferred the kind from the label and BOTH were wrong,
// which is the argument for not inferring at all:
//
//   1. A keyword list of machine names — wash, dry, run, cook, bake, preheat —
//      classified the oven's "preheat" as a WAIT. Backwards: pressing the
//      button IS the touchpoint.
//   2. A grammar rule ("-ing means the machine is doing it") fixed that case
//      but was invented rather than asked for, contradicted the spec line it
//      claimed to implement ("a wait is the thing with NO verb" — a gerund is a
//      verb), and would have made "folding" a wait.
//
// §UI describes exactly this shape — "add active / add wait rows" — so the two
// buttons were specced and the inference never was.
//
// ════════════════════════════════════════════════════════════════════════════
// THE TWO ROW SHAPES ARE DIFFERENT, because the two things are different
// ════════════════════════════════════════════════════════════════════════════
//
//   TIMED STEP   one time. It is a specific commitment of your attention.
//   WAIT         a period with a MIN and a MAX.
//                min — the machine is not finished. PHYSICS (R-1): the next
//                      touchpoint may never be placed earlier.
//                max — it degrades after this. PREFERENCE: stated, never
//                      enforced. Blank means no ceiling, which is today's
//                      min-only behaviour and leaves appliances alone.
//
// A LIVE PREVIEW of the real touchpoint times sits underneath, because §"the
// bar" says a preview "is what settles an argument the wording cannot" — the
// recurrence editor's preview runs the real engine, and so does this one.
import { RoutineInstance } from '../../core/index.js';
import { fmtDur } from '../format.js';

const clampMin = (v, floor = 1) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= floor ? n : floor;
};

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * @param steps    the routine's steps (may be null for a non-routine activity)
 * @param onChange (nextSteps) => void
 * @param previewFrom a Date to run the live preview from
 */
export default function RoutineSteps({ steps, onChange, previewFrom, travelMin = 0 }) {
  const list = Array.isArray(steps) ? steps : [];

  const patch = (i, delta) => onChange(list.map((s, idx) => (idx === i ? { ...s, ...delta } : s)));
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // The two affordances. Each writes its OWN `kind`, so the kind is a fact
  // about which button was pressed and never a guess about a label.
  const addTimed = () => onChange([...list, {
    label: '', kind: 'active', durationMin: 15, durationMax: 15, maxWaitMin: null,
  }]);
  const addWait = () => onChange([...list, {
    label: '', kind: 'passive', durationMin: 30, durationMax: 30, maxWaitMin: null,
  }]);

  // ---- the live preview, run through the REAL engine ---------------------
  let preview = [];
  if (list.length && previewFrom) {
    const run = RoutineInstance.fromActivity(
      { label: 'preview', id: 'preview', isRoutine: true, steps: list, travelMin, durationMin: 15, durationMax: 15 },
      previewFrom,
    );
    preview = run.offsets().map((o) => ({
      label: o.label,
      from: new Date(previewFrom.getTime() + o.offsetMin * 60000),
      to: new Date(previewFrom.getTime() + (o.offsetMin + o.durationMin) * 60000),
    }));
  }

  return (
    <div className="rsteps">
      {list.length === 0 && (
        <p className="insight">
          No steps yet. A <b>timed step</b> is something you do; a <b>wait</b> is
          time that has to pass while you are free.
        </p>
      )}

      {list.map((s, i) => (
        <div className={s.kind === 'passive' ? 'rstep iswait' : 'rstep'} key={i}>
          <span className="rskind">{s.kind === 'passive' ? 'wait' : 'step'}</span>
          <input
            className="control rsname"
            value={s.label}
            placeholder={s.kind === 'passive' ? 'washing' : 'load the machine'}
            onChange={(e) => patch(i, { label: e.target.value })}
            aria-label={`Step ${i + 1} name`}
          />
          {/* ⚠️ Numbers and buttons are GROUPED so each group wraps as a unit
              rather than one input peeling off onto a line of its own. A Cabana
              card can be as narrow as 250px (`.cabgrid`'s minmax), so wrapping
              is the normal case here, not an edge one. */}
          <span className="rsnums">
          {s.kind === 'passive' ? (
            <>
              <input
                className="control num"
                type="number"
                min="1"
                value={s.durationMin}
                onChange={(e) => {
                  const min = clampMin(e.target.value);
                  // The max never drops below the floor — the floor is physics.
                  patch(i, { durationMin: min, durationMax: min, maxWaitMin: s.maxWaitMin && s.maxWaitMin < min ? min : s.maxWaitMin });
                }}
                aria-label={`Step ${i + 1} wait minimum`}
              />
              <span className="rdash">–</span>
              <input
                className="control num"
                type="number"
                min="1"
                value={s.maxWaitMin ?? ''}
                placeholder="—"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  // Blank is a real answer: NO ceiling, which is min-only
                  // behaviour and leaves the dishwasher's hold alone.
                  patch(i, { maxWaitMin: raw === '' ? null : Math.max(s.durationMin, clampMin(raw)) });
                }}
                aria-label={`Step ${i + 1} wait maximum`}
              />
            </>
          ) : (
            <input
              className="control num"
              type="number"
              min="1"
              value={s.durationMin}
              onChange={(e) => {
                const n = clampMin(e.target.value);
                // A timed step is ONE time, so both ends move together.
                patch(i, { durationMin: n, durationMax: n });
              }}
              aria-label={`Step ${i + 1} minutes`}
            />
          )}
            <span className="runit">min</span>
          </span>
          <span className="rsbtns">
            <button className="rsmove" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>↑</button>
            <button className="rsmove" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move step ${i + 1} down`}>↓</button>
            {/* ⚠️ `rsdel`, not `rm`: the stylesheet scopes `.rm` to `.winrow .rm`
                only, so a bare `.rm` here rendered as a raw browser button —
                big, grey, and enough to break the row on its own. */}
            <button className="rsdel" onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>×</button>
          </span>
        </div>
      ))}

      {/* Two buttons, SIDE BY SIDE. The kind is which one you pressed. */}
      <div className="chest drillactions">
        <button className="btn2 ghost" onClick={addTimed} aria-label="Add timed step">＋ timed step</button>
        <button className="btn2 ghost" onClick={addWait} aria-label="Add wait">＋ wait</button>
      </div>

      {preview.length > 0 && (
        // §"the bar": a preview of the REAL touchpoint times is what settles an
        // argument the wording cannot. Run through RoutineInstance, not a second
        // implementation of the arithmetic.
        <div className="rspreview">
          <span className="rsplabel">starting {hhmm(previewFrom)}</span>
          {preview.map((p, i) => (
            <span className="rspitem" key={i}>
              <b>{hhmm(p.from)}</b> {p.label || `step ${i + 1}`} · {fmtDur(Math.round((p.to - p.from) / 60000))}
            </span>
          ))}
          <span className="rsptotal">
            {(() => {
              const total = list.reduce((n, s) => n + s.durationMin, travelMin);
              const attention = list.filter((s) => s.kind === 'active').reduce((n, s) => n + s.durationMin, travelMin);
              // Elapsed vs attention is the whole point of a passive wait, so
              // the preview says both rather than one number that hides it.
              return `${fmtDur(total)} start to finish · ${fmtDur(attention)} of your attention`;
            })()}
          </span>
        </div>
      )}
    </div>
  );
}
