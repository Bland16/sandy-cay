// probe-event-note.mjs — what an event's note actually SAYS in Google.
//
// The whole value of this note is that a person reading their calendar can tell
// what an event is and what it belongs to. That is not a property any assertion
// really captures, so this prints the notes and you read them.
//
//     node design/probes/probe-event-note.mjs
import { Schedule, defaultConfig } from '../../src/core/index.js';
import { encodeTask, encodeTaskParts, kindOf, eventNote } from '../../src/core/googleEncode.js';
import { groupNamesFor } from '../../src/ui/useGoogleSync.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

const s = new Schedule({ config: defaultConfig });
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m, 0, 0);

// Three "Wash" steps from two different routines — the case the note exists for.
s.routineInstances.push({
  id: 'laundry-1-run',
  label: 'Laundry',
  toJSON() { return { id: this.id, label: this.label }; },
});
s.routineInstances.push({
  id: 'dishes-1-run',
  label: 'Dishwasher',
  toJSON() { return { id: this.id, label: this.label }; },
});

const wash1 = s.addFixed({ title: 'Wash', startTime: at(7, 9), endTime: at(7, 9, 30) });
wash1.routineId = 'laundry-1-run';
wash1.stepIndex = 1;
const wash2 = s.addFixed({ title: 'Wash', startTime: at(7, 18), endTime: at(7, 18, 30) });
wash2.routineId = 'dishes-1-run';
wash2.stepIndex = 0;

const plain = s.addFixed({ title: 'Dentist', startTime: at(8, 14), endTime: at(8, 15) });

const gym = s.addFixed({
  title: 'Gym',
  startTime: at(7, 16),
  endTime: at(7, 17),
  recurrence: {
    periods: [{
      windows: [{ day: 'mon', start: '16:00', end: '17:00' }],
      interval: 1,
      effectiveFrom: at(7, 0).getTime(),
      effectiveUntil: null,
    }],
    anchorDate: at(7, 0).getTime(),
    exceptions: [],
  },
});

const names = groupNamesFor(s);
const noteFor = (t) => encodeTask(t, { timeZone: 'America/New_York', groupNames: names }).description;

console.log('=== TWO IDENTICAL "Wash" EVENTS, TOLD APART ===\n');
for (const t of [wash1, wash2]) {
  console.log(`  summary: ${t.title}`);
  for (const line of noteFor(t).split('\n')) console.log(`    ${line}`);
  console.log('');
}
check('each names its OWN routine', noteFor(wash1).includes('Laundry') && noteFor(wash2).includes('Dishwasher'));
check('and they are not the same note', noteFor(wash1) !== noteFor(wash2));
check('the step number is human, counting from 1', noteFor(wash1).includes('step 2'), 'stepIndex 1 → "step 2"');
check('the code is there to search on', noteFor(wash1).includes(wash1.id), wash1.id);

console.log('=== AN ORDINARY TASK STAYS ORDINARY ===\n');
for (const line of noteFor(plain).split('\n')) console.log(`    ${line}`);
console.log('');
check('no group line invented for something that belongs to nothing', !noteFor(plain).includes('of “'));
check('still carries its code', noteFor(plain).includes(plain.id));

console.log('=== GS-10, SAID OUT LOUD ON THE EVENT ITSELF ===\n');
for (const line of noteFor(gym).split('\n')) console.log(`    ${line}`);
console.log('');
check('a repeating task explains that repeats are edited in the app',
  /repeat here will not carry back/i.test(noteFor(gym)));
check('a NON-repeating task does not say it', !/carry back/i.test(noteFor(plain)),
  'the line would be noise on something that never repeats');
check('and it still says you may move or rename it freely',
  /move or rename/i.test(noteFor(gym)),
  'because a TIME edit IS honoured — that is the asymmetry being named');

console.log('=== WITHOUT NAMES, IT FALLS BACK TO THE ID ===\n');
// The encoder must not depend on the caller remembering to pass names.
const bare = encodeTask(wash1, { timeZone: 'UTC' }).description;
for (const line of bare.split('\n')) console.log(`    ${line}`);
console.log('');
check('degrades to the raw id rather than saying nothing', bare.includes('laundry-1-run'));

console.log('=== EVERY PART OF A SPLIT TASK CARRIES IT ===\n');
const split = s.addFixed({
  title: 'Seminar',
  startTime: at(7, 9),
  endTime: at(7, 10),
  recurrence: {
    periods: [{
      windows: [
        { day: 'tue', start: '09:00', end: '10:00' },
        { day: 'thu', start: '14:00', end: '16:00' },
      ],
      interval: 1,
      effectiveFrom: at(7, 0).getTime(),
      effectiveUntil: null,
    }],
    anchorDate: at(7, 0).getTime(),
    exceptions: [],
  },
});
const parts = encodeTaskParts(split, { timeZone: 'America/New_York', groupNames: names });
for (const p of parts) console.log(`    ${p.description.split('\n')[0]}`);
console.log('');
check('both parts exist', parts.length === 2);
check('both carry the code, not just the first',
  parts.every((p) => p.description.includes(split.id)));
check('each says which part it is', parts.every((p, i) => p.description.includes(`part ${i + 1} of 2`)));

void kindOf; void eventNote;
console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
