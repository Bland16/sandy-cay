// DayPicker — the phone's primary navigation (SPEC §11, FRONTEND-SPEC §5).
//
// On a phone the single day IS the layout, not a mode you escape from, so this
// strip replaces the day view's ✕: there is no week behind it to go back to.
// The week stays reachable as an overview via the last control, because "which
// day is emptiest" is a real question a day view can't answer.
//
// Each day carries a dot when it has anything scheduled — the one bit of the
// week's shape worth keeping when six columns are gone. It is a COUNT of
// something existing, never a judgement about it (P-1): no colour for "too
// full", no red for "empty".
import { addDays, sameDay } from '../../core/index.js';
import { DAY_NAMES } from '../format.js';
import Icon from '../Icon.jsx';

export default function DayPicker({ sched, weekStart, active, today, onPick, onWeek }) {
  return (
    <div className="daypick" role="tablist" aria-label="Day of week">
      {DAY_NAMES.map((dn, i) => {
        const date = addDays(weekStart, i);
        const count = sched.getTasksForDay(date).length;
        const isToday = sameDay(date, today);
        const selected = active === i;
        return (
          <button
            key={dn}
            role="tab"
            aria-selected={selected}
            aria-label={`${dn} ${date.getDate()}${count ? `, ${count} scheduled` : ', nothing scheduled'}`}
            className={`dp${selected ? ' on' : ''}${isToday ? ' today' : ''}`}
            onClick={() => onPick(i)}
          >
            <span className="dpd">{dn[0]}</span>
            <span className="dpn">{date.getDate()}</span>
            {/* Presence, not pressure. */}
            <span className={`dpdot${count ? ' has' : ''}`} aria-hidden="true" />
          </button>
        );
      })}
      <button className="dp dpweek" onClick={onWeek} aria-label="Week overview" title="Week overview">
        <Icon name="cal" size={14} />
      </button>
    </div>
  );
}
