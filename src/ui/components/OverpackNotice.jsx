// OverpackNotice — the ONE grid-side notice (SPEC §7.3).
//
// The P-1 boundary is physics-yes / morality-no. "Your breaks are compressed"
// is a fact about the shape of the week, the same kind of fact as "this task
// doesn't fit" — so it is allowed on the grid. "You're overcommitted" would be
// a judgement, and is not. Everything about this line follows from that:
//   · one line, in flow, above the grid — non-modal, nothing overlaps
//   · no red, no --warning, no imperative, no exclamation
//   · at most ONE suggestion, and it is mechanical (§7.3)
//   · dismissible, and it does not come back until the next full autoSchedule
// Detectors otherwise live in the report and the Cabana only (§7.2).
import Icon from '../Icon.jsx';

export default function OverpackNotice({ packedDays, onProtect, onDismiss }) {
  return (
    <div className="overpack" role="status">
      <Icon name="hammock" />
      <span className="grow">
        This week is packed — breaks are compressed on {packedDays} day{packedDays === 1 ? '' : 's'}.
      </span>
      <button type="button" className="opl" onClick={onProtect}>Block some recovery time?</button>
      <button type="button" className="px" onClick={onDismiss} aria-label="Dismiss this notice">
        <Icon name="x" />
      </button>
    </div>
  );
}
