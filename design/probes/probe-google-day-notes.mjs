// probe-google-day-notes.mjs — GS-11. A day note is an ALL-DAY EVENT now.
//
// The thing to prove is not "it encodes". It is the DATE ARITHMETIC, because
// `end.date` is exclusive and `DayNote.to` is inclusive, and getting that wrong
// does not error — it silently lengthens or shortens every holiday by a day,
// on every sync, in a direction nobody notices until a reading week is six days.
//
//     node design/probes/probe-google-day-notes.mjs
import { Schedule, defaultConfig, dateKey } from '../../src/core/index.js';
import {
  encodeDayNote, encodeBlockedDay, decodeDayEvent, allDayRRULE,
  KIND_DAYNOTE, KIND_BLOCKED,
} from '../../src/core/googleDayNotes.js';
import { LIBRARY_KEYS, libraryFrom } from '../../src/core/googleLibrary.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

const s = new Schedule({ config: defaultConfig });

console.log('=== 1. A ONE-DAY NOTE. The whole bug lives in this line. ===\n');
const oneDay = s.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26', kind: 'holiday' });
const ev1 = encodeDayNote(oneDay);
console.log(`  start.date  ${ev1.start.date}`);
console.log(`  end.date    ${ev1.end.date}   <- EXCLUSIVE, so one day later\n`);
check('starts on the day itself', ev1.start.date === '2026-11-26');
check('ends the NEXT day, because Google\'s end is exclusive', ev1.end.date === '2026-11-27',
  'the .ics side already converts this way (eventToDayNote)');

const back1 = decodeDayEvent({ ...ev1, id: 'g1' });
check('decodes', back1.ok, back1.error || '');
check('comes back covering ONE day, not two', back1.note.from === '2026-11-26' && back1.note.to === '2026-11-26',
  `${back1.note.from} → ${back1.note.to}`);

console.log('\n=== 2. A RANGE — a reading week must not grow or shrink ===\n');
const week = s.addDayNote({ label: 'Reading week', from: '2026-11-23', to: '2026-11-27', kind: 'note', tags: ['term'] });
const ev2 = encodeDayNote(week);
const back2 = decodeDayEvent({ ...ev2, id: 'g2' });
console.log(`  out: ${ev2.start.date} → ${ev2.end.date} (exclusive)`);
console.log(`  in:  ${back2.note.from} → ${back2.note.to} (inclusive)\n`);
check('the range survives exactly', back2.note.from === week.from && back2.note.to === week.to,
  `${back2.note.from}..${back2.note.to} vs ${week.from}..${week.to}`);
check('five days out, five days back', back2.note.from === '2026-11-23' && back2.note.to === '2026-11-27');
check('tags ride in the payload', JSON.stringify(back2.note.tags) === JSON.stringify(['term']));
check('kind survives', back2.note.kind === 'note');

console.log('\n=== 3. WHAT GOOGLE OWNS — a hand edit must LAND (GS-4) ===\n');
// The user drags Thanksgiving to the 27th and renames it, in Google.
const handEdited = {
  ...ev1,
  id: 'g1',
  summary: 'Thanksgiving (moved)',
  start: { date: '2026-11-27' },
  end: { date: '2026-11-28' },
};
const back3 = decodeDayEvent(handEdited);
check('the rename lands', back3.note.label === 'Thanksgiving (moved)', back3.note.label);
check('the move lands', back3.note.from === '2026-11-27' && back3.note.to === '2026-11-27',
  `${back3.note.from} → ${back3.note.to}`);
console.log('  ↑ label/from/to are NATIVE fields, so your own hand outranks the app.\n');

console.log('=== 4. A REPEATING NOTE — a birthday is FREQ=YEARLY, all day ===\n');
const bday = s.addDayNote({
  label: 'Ada birthday',
  from: '2026-12-10',
  to: '2026-12-10',
  recurrence: {
    periods: [{
      freq: 'yearly',
      windows: [{ month: 12, monthDay: 10 }],
      interval: 1,
      effectiveFrom: new Date(2026, 11, 10).getTime(),
      effectiveUntil: null,
    }],
    anchorDate: new Date(2026, 11, 10).getTime(),
    exceptions: [],
  },
});
const ev4 = encodeDayNote(bday);
console.log(`  ${(ev4.recurrence || ['(none)'])[0]}\n`);
check('repeats yearly', /FREQ=YEARLY/.test((ev4.recurrence || [])[0] || ''));

// The bounded case is where the all-day rule differs from a task's.
const bounded = allDayRRULE({
  periods: [{
    windows: [{ day: 'mon', start: '00:00', end: '23:59' }],
    interval: 1,
    effectiveFrom: new Date(2026, 8, 7).getTime(),
    effectiveUntil: new Date(2026, 11, 12).getTime(),
  }],
  anchorDate: new Date(2026, 8, 7).getTime(),
  exceptions: [],
});
console.log(`  bounded: ${bounded}`);
check('UNTIL is a DATE, not a date-time', /UNTIL=\d{8}(;|$)/.test(bounded),
  'RFC 5545 §3.3.10: DTSTART is a DATE here, so UNTIL must be one too');
check('no stray Z or time part', !/UNTIL=\d{8}T/.test(bounded), bounded);

console.log('\n=== 5. A BLOCKED DAY ===\n');
const evB = encodeBlockedDay('2026-12-24');
const backB = decodeDayEvent({ ...evB, id: 'g5' });
console.log(`  ${evB.summary}  ${evB.start.date} → ${evB.end.date}`);
check('reads back as a blocked day, not a note', backB.ok && backB.kind === KIND_BLOCKED, backB.kind);
check('the day survives', backB.day === '2026-12-24', backB.day);
check('a note is not mistaken for one', decodeDayEvent({ ...ev1, id: 'x' }).kind === KIND_DAYNOTE);

console.log('\n=== 6. AND THEY ARE GONE FROM THE LIBRARY ===\n');
// The divergence note in googleLibrary.js demanded these two land together:
// leaving a copy in the blob would resurrect a note deleted in Google.
const lib = libraryFrom(s.toJSON());
console.log(`  library keys: ${LIBRARY_KEYS.join(', ')}\n`);
check('dayNotes is NOT a library key', !LIBRARY_KEYS.includes('dayNotes'));
check('blockedDays is NOT a library key', !LIBRARY_KEYS.includes('blockedDays'));
check('and the blob really does not carry them', lib.dayNotes === undefined && lib.blockedDays === undefined,
  `dayNotes=${JSON.stringify(lib.dayNotes)} blockedDays=${JSON.stringify(lib.blockedDays)}`);
check('the notes still exist in the schedule itself', s.dayNotes.length === 3, `${s.dayNotes.length}`);

console.log('\n=== 7. THE ROUND TRIP THROUGH THE REAL SCHEDULE ===\n');
const other = new Schedule({ config: defaultConfig });
for (const n of s.dayNotes) {
  const r = decodeDayEvent({ ...encodeDayNote(n), id: `e-${n.id}` });
  other.upsertDayNoteFromJSON(r.note);
}
check('every note arrives on the far side', other.dayNotes.length === s.dayNotes.length,
  `${other.dayNotes.length} of ${s.dayNotes.length}`);
const same = s.dayNotes.every((n) => {
  const m = other.dayNotes.find((x) => x.id === n.id);
  return m && JSON.stringify(m.toJSON()) === JSON.stringify(n.toJSON());
});
check('and arrives IDENTICAL, field for field', same);
// A note covering today must still cover today on the far side — the check a
// user would actually make.
const covering = s.dayNotes.filter((n) => n.coversDate(new Date(2026, 10, 25))).map((n) => n.label);
const coveringFar = other.dayNotes.filter((n) => n.coversDate(new Date(2026, 10, 25))).map((n) => n.label);
console.log(`\n  25 Nov 2026 is covered by: ${covering.join(', ') || '(nothing)'}`);
check('the far side agrees about which days are covered',
  JSON.stringify(covering) === JSON.stringify(coveringFar), coveringFar.join(', '));

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`);
void dateKey;
