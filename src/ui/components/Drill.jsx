// Drill.jsx — the one idiom for editing a collection (EDITOR-REDESIGN §3).
//
// Zones, buckets and activities were three different shapes for the same job: a
// list you pick from, and a focused editor for the one you picked. They are now
// one pair of components, so the row, the back affordance and the destructive
// action can't drift apart again.
//
// Selection state stays in the HOST (`editingId`), exactly as before — these are
// presentational. Opening is setEditingId(id); back is setEditingId(null).
import Icon from '../Icon.jsx';

/** One row in a collection list: [swatch?] [name] [·meta·] [open ›]. */
export function DrillRow({ label, meta, swatch, onOpen, ariaLabel, openLabel = 'edit' }) {
  return (
    <button className="editrow" onClick={onOpen} aria-label={ariaLabel}>
      {swatch && <span aria-hidden="true" className="erswatch" style={{ background: swatch }} />}
      <b className="ername">{label}</b>
      {meta && <span className="ermeta">{meta}</span>}
      <span aria-hidden="true" className="erchev">{openLabel} ›</span>
    </button>
  );
}

/**
 * A collection list: sign, blurb, rows, empty state, then the add affordances.
 * `children` is the row area, so a caller that needs grouping, filtering or a
 * pager (the Activity Library does) composes it rather than being forced through
 * a props interface that has to anticipate every case.
 */
export function DrillList({ title, blurb, empty, isEmpty, children, footer, actions }) {
  return (
    <div className="cabcard">
      <div className="cabsign">{title}</div>
      {blurb && <p>{blurb}</p>}
      {isEmpty && <p className="insight">{empty}</p>}
      {children}
      {actions && <div className="chest drillactions">{actions}</div>}
      {footer}
    </div>
  );
}

/**
 * The focused editor for one item: a back button, the fields, and a destructive
 * action pinned to the bottom as a ghost — never adjacent to a save-like control,
 * so "remove" can't be hit while reaching for something benign.
 */
export function DrillEditor({ title, backLabel, onBack, children, onRemove, removeLabel, removeAria }) {
  return (
    <div className="cabcard">
      <div className="cabsign">{title}</div>
      <button className="btn2 ghost editback" onClick={onBack}>
        <Icon name="back" /> {backLabel}
      </button>
      {children}
      {onRemove && (
        <button className="btn2 ghost editremove" onClick={onRemove} aria-label={removeAria || removeLabel}>
          {removeLabel}
        </button>
      )}
    </div>
  );
}

/** A labelled field row (§4). `stack` puts the label above a full-width control. */
export function Field({ label, stack = false, help, children }) {
  return (
    <div className={stack ? 'field stack' : 'field'}>
      <span className="flabel">{label}</span>
      <div className="fctl">{children}</div>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}
