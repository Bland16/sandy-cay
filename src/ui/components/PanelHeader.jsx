// PanelHeader — the contextual panel's title row with the ✕ close, and an
// optional `action` slot beside it for a panel's own one-tap affordance.
import Icon from '../Icon.jsx';

export default function PanelHeader({ title, sub, onClose, action = null }) {
  return (
    <div className="ph">
      <div>
        <div className="pt">{title}</div>
        {sub && <div className="psub">{sub}</div>}
      </div>
      {action}
      <button className="px" onClick={onClose} aria-label="Close panel"><Icon name="x" /></button>
    </div>
  );
}
