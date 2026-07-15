// TopBar — week sign, ‹ Today › + date-jump, sand-fill load meter (with
// adjacent-week hover preview), and the action cluster (Add task / project /
// Find / What-To-Do / Week ⋯ / Cabana). Week ⋯ holds Re-optimize, Wrap up,
// Wrap report (stub), Block days…
import { useState } from 'react';
import { addDays, weekStart as weekStartOf, dateKey } from '../../core/index.js';
import { weekSign, DAY_NAMES, MONTHS, pct } from '../format.js';
import Icon from '../Icon.jsx';

export default function TopBar({ sched, weekStart, selection, onSelect, onPrev, onNext, onToday, onJump, onReoptimize, onWrapUp, onWrapReport, onBlock }) {
  const [menu, setMenu] = useState(null); // 'week' | 'jump' | 'block' | null
  const [hoverWeek, setHoverWeek] = useState(null); // -1 | 1 | null
  const sign = weekSign(weekStart);

  const load = sched.getWeekLoad(weekStart);
  const hovered = hoverWeek ? sched.getWeekLoad(addDays(weekStart, hoverWeek * 7)) : null;

  const close = () => setMenu(null);

  return (
    <div className="topbar">
      <div className="weeksign">{sign.range}<small>{sign.sub}</small></div>

      <div className="nav">
        <button className="iconbtn round" aria-label="Previous week" onClick={onPrev}><Icon name="chev-l" /></button>
        <button className="iconbtn wide" style={{ borderRadius: 9 }} onClick={onToday}>Today</button>
        <button className="iconbtn round" aria-label="Next week" onClick={onNext}><Icon name="chev-r" /></button>
        <button className="iconbtn" aria-label="Jump to date" onClick={() => setMenu(menu === 'jump' ? null : 'jump')}><Icon name="cal" /></button>
        {menu === 'jump' && <DateJump weekStart={weekStart} onPick={(d) => { onJump(d); close(); }} onClose={close} />}
      </div>

      <div
        className="load"
        onMouseEnter={() => setHoverWeek(1)}
        onMouseLeave={() => setHoverWeek(null)}
        title="Hover to preview next week"
      >
        <div className="lab"><span>This week</span><span>{pct(load.fillRatio)}</span></div>
        <div className="bar"><div className="fill" style={{ right: `${Math.round((1 - Math.min(1, load.fillRatio)) * 100)}%` }} /></div>
        {hovered && <div className="adj">next wk · {pct(hovered.fillRatio)}</div>}
      </div>

      <div className="spacer" />

      <div className="cluster">
        <button className={`iconbtn cta${selection === 'add-task' ? ' active' : ''}`} title="Add task" aria-label="Add task" onClick={() => onSelect('add-task')}><Icon name="plus" /></button>
        <button className={`iconbtn${selection === 'add-project' ? ' active' : ''}`} title="Add project" aria-label="Add project" onClick={() => onSelect('add-project')}><Icon name="castle" /></button>
        <button className={`iconbtn${selection === 'find' ? ' active' : ''}`} title="Find times" aria-label="Find times" onClick={() => onSelect('find')}><Icon name="spyglass" /></button>
        <span className="sep" />
        <button className={`iconbtn${selection === 'wtd' ? ' hot' : ''}`} title="What to do now" aria-label="What to do now" onClick={() => onSelect('wtd')}><Icon name="compass" /></button>
        <div style={{ position: 'relative' }}>
          <button className="iconbtn" title="Week menu" aria-label="Week menu" onClick={() => setMenu(menu === 'week' ? null : 'week')}><Icon name="dots" /></button>
          {menu === 'week' && (
            <div className="dropdown weekmenu">
              <button onClick={() => { onReoptimize(); close(); }}><Icon name="refresh" size={15} /> Re-optimize week</button>
              <button onClick={() => { onWrapUp(); close(); }}><Icon name="loop" size={15} /> Wrap up week</button>
              <button onClick={() => { onWrapReport(); close(); }}><Icon name="pennant" size={15} /> Wrap report (PDF)</button>
              <button onClick={() => setMenu('block')}><Icon name="flag" size={15} /> Block days…</button>
            </div>
          )}
          {menu === 'block' && <BlockForm weekStart={weekStart} onClose={close} onBlock={onBlock} />}
        </div>
        <button className="iconbtn" title="Cabana — settings" aria-label="Cabana settings" onClick={() => onSelect('cabana')}><Icon name="cabana" /></button>
      </div>
    </div>
  );
}

function BlockForm({ weekStart, onClose, onBlock }) {
  const [from, setFrom] = useState(dateKey(addDays(weekStart, 5)));
  const [to, setTo] = useState(dateKey(addDays(weekStart, 6)));
  const [label, setLabel] = useState('Blocked');
  return (
    <div className="dropdown weekmenu miniform" style={{ width: 220 }}>
      <div className="flabel">Block a range of days</div>
      <div className="flabel">From</div>
      <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <div className="flabel">To</div>
      <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <div className="flabel">Label</div>
      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="rowbtns" style={{ marginTop: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn cta" onClick={() => { onBlock(new Date(from), new Date(to), label); onClose(); }}>Block</button>
      </div>
    </div>
  );
}

function DateJump({ weekStart, onPick, onClose }) {
  const [cursor, setCursor] = useState(() => new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const wsKey = dateKey(weekStartOf(weekStart));
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));

  return (
    <div className="dropdown datejump" onMouseLeave={onClose}>
      <div className="mm-head">
        <button className="iconbtn round" style={{ width: 24, height: 24 }} onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month"><Icon name="chev-l" /></button>
        <span>{MONTHS[month]} {year}</span>
        <button className="iconbtn round" style={{ width: 24, height: 24 }} onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month"><Icon name="chev-r" /></button>
      </div>
      <div className="mm-grid">
        {DAY_NAMES.map((d) => <span key={d}>{d[0]}</span>)}
        {cells.map((date, i) => date ? (
          <button
            key={i}
            className={dateKey(weekStartOf(date)) === wsKey ? 'inwk' : ''}
            onClick={() => onPick(date)}
          >{date.getDate()}</button>
        ) : <span key={i} />)}
      </div>
    </div>
  );
}
