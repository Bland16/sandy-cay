// Does an occurrence exception survive a save?
//
// `resolveTime` accepts 'HH:MM', a Date, or an epoch number. But
// `recurrenceToJSON` shallow-copies exceptions (`{...e}`), so a Date lands in
// the file as a full ISO string — and `reviveRecurrence` shallow-copies it back,
// so nothing turns it into a Date again. resolveTime then falls through to its
// `atTime(date, 'HH:MM')` branch holding "2026-09-08T11:00:00.000Z".
//
// The UI stores Dates: useCardInteraction's applyOccurrenceSpan passes
// newStart/newEnd straight in. So: drag a recurring session to a new time,
// reload, and what comes back?
import { Schedule } from '../../src/core/Schedule.js';

const MON = new Date(2026, 8, 7, 0, 0, 0, 0);
const D = (d, h, mi = 0) => new Date(2026, 8, d, h, mi, 0, 0);

function build(exception) {
  const s = new Schedule({});
  s.addFixed({
    title: 'Gym', tags: ['gym'],
    startTime: D(8, 7, 0), endTime: D(8, 8, 0),
    recurrence: {
      periods: [{ windows: [{ day: 'tue', start: '07:00', end: '08:00' }], interval: 1, effectiveFrom: MON }],
      anchorDate: MON,
      exceptions: [exception],
    },
  });
  return s;
}

const show = (s, label) => {
  const occ = s.getTasksForWeek(MON).filter((t) => t.isOccurrence);
  const times = occ.map((t) => `${t.startTime.toTimeString().slice(0, 5)}–${t.endTime.toTimeString().slice(0, 5)}`);
  console.log(`  ${label.padEnd(28)} ${times.join(', ') || '(none)'}`);
};

console.log("A 'move' exception written the way the UI writes it — Date objects:");
const asDates = { date: '2026-09-08', action: 'move', start: D(8, 11, 0), end: D(8, 12, 0) };
const a = build(asDates);
show(a, 'in memory');
show(Schedule.fromJSON(JSON.parse(JSON.stringify(a.toJSON()))), 'after save + reload');

console.log("\nThe same exception written as 'HH:MM' strings:");
const asStrings = { date: '2026-09-08', action: 'move', start: '11:00', end: '12:00' };
const b = build(asStrings);
show(b, 'in memory');
show(Schedule.fromJSON(JSON.parse(JSON.stringify(b.toJSON()))), 'after save + reload');

console.log('\nWhat the exception looks like in the saved file:');
const saved = JSON.parse(JSON.stringify(a.toJSON()));
console.log('  ', JSON.stringify(saved.tasks[0].recurrence.exceptions[0]));
