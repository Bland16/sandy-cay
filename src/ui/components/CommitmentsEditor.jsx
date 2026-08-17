// CommitmentsEditor — "2 hours of maths a week, all term", authored.
//
// design/WEEKLY-PLANNING.md §4. The SAME drill-in idiom as zones, buckets and
// activities (EDITOR-REDESIGN §3/§4): a list you pick from, a focused editor for
// the one you picked. That is the whole reason it is built this way — a fourth
// shape for "edit one of a collection" is a fourth thing to learn and a fourth
// thing to drift.
//
// ⚠️ HOURS PER WEEK, not sessions and not a term total (PLAN D-1 + §2's model,
// "what each PERIOD owes"). "3 × 1h" is already expressible through the sitting
// bounds, and hours are what a week actually spends. The store is minutes,
// because every other duration in the engine is; the conversion lives here and
// nothing downstream knows about it.
//
// `between` is therefore the TERM the commitment stands for, not a deadline.
// The deadline is per-week and optional — the `due by` field, defaulting to the
// week's end, which is §2's implicit deadline left where it was.
//
// ⚠️ Tags come from the EXISTING set, never free text (§4.6). The duration
// margin, ratings, energy character and zone routing all transfer through tags
// and the transfer is STRING-EXACT — `maths` and `math` are two different
// worlds, and a typo severs the link with no symptom at all. `TagEditor`'s
// suggestions are what stop that, so they are not a convenience here.
import { useState } from 'react';
import { dateKey, dateFromKey } from '../../core/index.js';
import { fmtDur, MONTHS, DAY_KEYS, DAY_FULL } from '../format.js';
import TagEditor, { tagsInUse } from './TagEditor.jsx';
import { DrillList, DrillEditor, DrillRow, Field } from './Drill.jsx';

/** Minutes ⇄ hours, for the one field the user types in hours. */
const toHours = (min) => Math.round((min / 60) * 100) / 100;
const fromHours = (h) => {
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
};
/** 15 minutes is the shortest block the grid can hold (OD-1) — a grid FACT, not
 *  a preference, so it is stated rather than silently rounding someone's 5 up. */
const clampSitting = (v) => {
  const n = Number(v);
  return Math.max(15, Math.round(Number.isFinite(n) ? n : 15));
};

/** "3 Oct" — the house style everywhere a date is shown to a person
 *  (`DayNotes`, `AddTaskPanel`, `RecurrenceEditor` all read this way). The row
 *  said "2026-10-03" until it was rendered and looked at; a storage key is not
 *  a label, and only a dump of the real row could show that. */
const fmtDay = (key) => {
  const d = dateFromKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/**
 * The one-line summary a row shows. Read it aloud: "2h a week, due Thursday,
 * 31 Aug – 12 Dec, sittings 30m–3h, at most one a day."
 *
 * The amount reads "/week" here for the same reason the field does — this was
 * briefly a total across the term, and a row that still said "8h by 3 Oct"
 * would be describing a model that no longer exists.
 */
export function commitmentMeta(c) {
  const due = c.dueDay ? ` · due ${DAY_FULL[DAY_KEYS.indexOf(c.dueDay)]}` : '';
  const term = c.from === c.until ? fmtDay(c.until) : `${fmtDay(c.from)} – ${fmtDay(c.until)}`;
  return `${fmtDur(c.amountMinPerWeek)}/week${due} · ${term}`
    + ` · sittings ${fmtDur(c.minSitting)}–${fmtDur(c.maxSitting)} · max ${c.maxPerDay}/day`;
}

export default function CommitmentsEditor({ sched, mutate }) {
  const [editingId, setEditingId] = useState(null);
  const commitments = sched.commitments;
  const suggestions = tagsInUse(sched).filter((t) => !sched.isTagRetired(t));

  const addCommitment = () => {
    const c = mutate((s) => s.addCommitment({
      title: 'New commitment',
      // The TERM this stands for. A fortnight from today: long enough to be a
      // real span of weeks, short enough to be obviously a placeholder you are
      // meant to edit. Deliberately not "a term" — the app has no idea how long
      // yours is, and guessing thirteen weeks would be it asserting one.
      from: dateKey(new Date()),
      until: dateKey(new Date(Date.now() + 13 * 86400000)),
      amountMinPerWeek: 120,
      dueDay: null, // end of the week (§2's implicit deadline) until you say otherwise
      minSitting: 30,
      maxSitting: 180,
      maxPerDay: 1,
    }));
    if (c) setEditingId(c.id);
  };
  const patch = (id, changes) => mutate((s) => s.updateCommitment(id, changes));
  const remove = (id) => mutate((s) => s.removeCommitment(id));

  const editing = commitments.find((c) => c.id === editingId) || null;

  // ---- drill-in commitment editor ---------------------------------------
  if (editing) {
    const c = editing;
    return (
      <DrillEditor
        title="Edit commitment"
        backLabel="All commitments"
        onBack={() => setEditingId(null)}
        onRemove={() => { remove(c.id); setEditingId(null); }}
        removeLabel="remove commitment"
        removeAria={`Remove commitment ${c.title}`}
      >
        <Field label="name">
          <input
            className="control grow"
            defaultValue={c.title}
            onBlur={(e) => patch(c.id, { title: e.target.value.trim() || c.title })}
            aria-label="Commitment name"
          />
        </Field>

        {/* Every field here shares ONE label column — none is `stack`. That is
            what EDITOR-REDESIGN §4 built the vocabulary for ("a fixed label
            column + a control area, so editors stop hand-styling"), and mixing
            the two modes was making the labels ragged: NAME and AT MOST
            right-aligned in the column while TAGS, BETWEEN and SITTINGS started
            at the card's left edge. */}
        <Field label="tags">
          <TagEditor tags={c.tags} onChange={(tags) => patch(c.id, { tags })} suggestions={suggestions} />
        </Field>

        {/* HOW MUCH — what EACH WEEK owes, in hours (D-1, §2). */}
        <Field label="how much">
          <input
            className="control num"
            type="number"
            min="0.25"
            step="0.25"
            value={toHours(c.amountMinPerWeek)}
            onChange={(e) => { const m = fromHours(e.target.value); if (m) patch(c.id, { amountMinPerWeek: m }); }}
            aria-label="Commitment hours per week"
          />
          <span className="runit">hours/week</span>
        </Field>

        {/* DUE BY — the per-week deadline, OPTIONAL, week's end by default.
            §2 says "the period's end is the implicit deadline"; this moves that
            end from Sunday to a weekday you pick, which is why it is one value
            and not the per-occurrence machinery §1 rejected. It needs no engine
            change: it becomes the week's `until`, so §4.4's buffer shortens
            with it and §4.1.1 step 2 stops offering the days after it. */}
        <Field label="due by">
          <select
            className="control"
            value={c.dueDay || ''}
            onChange={(e) => patch(c.id, { dueDay: e.target.value || null })}
            aria-label="Commitment due day"
          >
            <option value="">end of the week</option>
            {DAY_KEYS.map((k, i) => <option key={k} value={k}>{DAY_FULL[i]}</option>)}
          </select>
        </Field>

        {/* THE PERIOD. Both dates are INCLUSIVE — days you can work on — the
            same reading the zone editor gives "runs", and
            `engineInputForWeek()` converts each week's far edge to the
            half-open bound the placer wants (sharp #11). This is the TERM, not
            a deadline. That used to be spelled out in a help paragraph; the
            paragraph is gone by request, and the behaviour is unchanged and
            still locked by `tests/commitments-model.test.jsx`, which proves the
            last day is usable by PLACING on it. */}
        <Field label="between">
          <input
            className="control"
            type="date"
            value={c.from}
            onChange={(e) => { if (e.target.value) patch(c.id, { from: e.target.value }); }}
            aria-label="Commitment start date"
          />
          <span className="rdash">→</span>
          <input
            className="control"
            type="date"
            value={c.until}
            onChange={(e) => { if (e.target.value) patch(c.id, { until: e.target.value }); }}
            aria-label="Commitment end date"
          />
        </Field>

        {/* SITTINGS — BOUNDS, not a size. The week decides the actual length
            (§4.1), which is the entire point of the generator: it asks the
            calendar what it has rather than booking a number it invented.

            Minutes on both ends, not the spec sketch's "30 min … 4 h": this is
            the SAME `.rangefield` the activity editor uses, and §4's own
            argument for these knobs is that it is "a control that exists".
            Mixed units in two adjacent number boxes is a misread waiting to
            happen.

            ⚠️ These do NOT drag each other. `Commitment`'s constructor already
            guarantees `maxSitting ≥ minSitting`, so the version of this that
            also passed `Math.max(...)` was dead weight — proven by deleting it
            and watching the test still pass, which is what a vacuous test looks
            like from the inside. ONE enforcement point, in the model, where
            every writer reaches it (`isDayBlocked`'s lesson). The 15-minute
            floor stays here, because it is a GRID fact the model has no opinion
            about — the same split `ActivityEditor` makes. */}
        <Field label="sittings" ctlClass="rangefield">
          <input
            className="control num"
            type="number"
            min="15"
            step="5"
            value={c.minSitting}
            onChange={(e) => patch(c.id, { minSitting: clampSitting(e.target.value) })}
            aria-label="Commitment minimum sitting minutes"
          />
          <span className="rdash">–</span>
          <input
            className="control num"
            type="number"
            min="15"
            step="5"
            value={c.maxSitting}
            onChange={(e) => patch(c.id, { maxSitting: clampSitting(e.target.value) })}
            aria-label="Commitment maximum sitting minutes"
          />
          <span className="runit">min</span>
        </Field>

        {/* maxPerDay stops "2h of maths" becoming two sessions on one evening. */}
        <Field label="at most">
          <input
            className="control num"
            type="number"
            min="1"
            max="6"
            step="1"
            value={c.maxPerDay}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n) && n >= 1) patch(c.id, { maxPerDay: Math.min(6, n) });
            }}
            aria-label="Commitment sittings per day"
          />
          <span className="runit">a day</span>
        </Field>
      </DrillEditor>
    );
  }

  // ---- commitment list --------------------------------------------------
  return (
    <DrillList
      title="Standing commitments"
      blurb="How much each week owes — the week decides when."
      isEmpty={commitments.length === 0}
      empty="No commitments yet."
      actions={<button className="btn2" onClick={addCommitment} aria-label="Add commitment">＋ Add commitment</button>}
    >
      {commitments.map((c) => (
        <DrillRow
          key={c.id}
          label={c.title}
          meta={commitmentMeta(c)}
          onOpen={() => setEditingId(c.id)}
          ariaLabel={`Edit commitment ${c.title}`}
        />
      ))}
    </DrillList>
  );
}
