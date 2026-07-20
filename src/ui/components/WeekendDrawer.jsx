// WeekendDrawer — the tablet layout's Sat+Sun (SPEC §11, FRONTEND-SPEC §5).
//
// Between 768 and 1279 there isn't room for seven honest columns, so the weekend
// moves into a drawer behind a beach-towel tab. It OVERLAYS rather than pushes:
// pushing would reflow Mon–Fri on open, and a column that moves out from under
// your cursor mid-drag is a column that drops your task on the wrong day.
//
// The columns inside are a real <WeekGrid days={[5, 6]}>, not a lookalike — the
// drop-geometry contract (data-dropzone/data-day-index/data-pxh) lives on those
// columns and useCardInteraction reads it at pointer-down. A second
// implementation would drift from that contract and silently mis-place drops.
import Icon from '../Icon.jsx';
import WeekGrid from './WeekGrid.jsx';

export const WEEKEND_DAYS = [5, 6];

export default function WeekendDrawer({ open, onToggle, ...gridProps }) {
  return (
    <>
      {/* The tab lives outside the drawer so it stays reachable when closed —
          it IS the affordance, not decoration on top of one. */}
      <button
        className={`towel${open ? ' open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="weekend-drawer"
        title={open ? 'Hide the weekend' : 'Show the weekend'}
      >
        <span className="towel-grip" aria-hidden="true" />
        <span className="towel-label">{open ? 'Hide' : 'Sat / Sun'}</span>
        <Icon name={open ? 'chev-r' : 'chev-l'} size={13} />
      </button>

      <aside
        id="weekend-drawer"
        className={`wkdrawer${open ? ' open' : ''}`}
        aria-label="Weekend"
        /* Hidden from AT and from hit-testing when closed: a drawer you can't
           see must not still swallow drops behind the weekdays. */
        aria-hidden={!open}
        inert={!open ? '' : undefined}
      >
        <WeekGrid {...gridProps} days={WEEKEND_DAYS} compactHeads />
      </aside>
    </>
  );
}
