// PanelHeader — the contextual panel's title row with the ✕ close.
import Icon from '../Icon.jsx';

export default function PanelHeader({ title, sub, onClose }) {
  return (
    <div className="ph">
      <div>
        <div className="pt">{title}</div>
        {sub && <div className="psub">{sub}</div>}
      </div>
      <button className="px" onClick={onClose} aria-label="Close panel"><Icon name="x" /></button>
    </div>
  );
}
