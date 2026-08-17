// probe-date-edit-bug.mjs — reported 2026-08-16.
//
// "I set math homework from 8/31 to 9/30 and hit lay out the week. It should
// not have scheduled anything. Instead it scheduled one task for 10:21pm
// Sunday August 16th (so right now)."
//
// The week of 10–16 Aug does not overlap 31 Aug – 30 Sep, so `coversWeek` should
// have said `outside` and the button should have been disabled. Something in
// the EDIT path is not storing what was typed.
//
//   node design/probes/probe-date-edit-bug.mjs

import { Schedule } from '../../src/core/Schedule.js';
import { defaultConfig } from '../../src/core/config.js';
import { previewWeek } from '../../src/core/commitmentWeek.js';
import { weekStart, dateKey } from '../../src/core/time.js';

const NOW = new Date(2026, 7, 16, 22, 21, 0); // Sun 16 Aug 2026, 22:21
const WS = weekStart(NOW); // Mon 10 Aug
console.log(`now ${dateKey(NOW)} 22:21 · viewing week of ${dateKey(WS)}\n`);

/** Exactly what the card does when you press ＋ Add commitment. */
function addAsTheCardDoes(s) {
  return s.addCommitment({
    title: 'Math homework',
    from: dateKey(NOW),
    until: dateKey(new Date(NOW.getTime() + 13 * 86400000)),
    amountMinPerWeek: 120,
    dueDay: null,
    minSitting: 30,
    maxSitting: 180,
    maxPerDay: 1,
  });
}

function show(label, s, c) {
  const p = previewWeek(s, WS, NOW)[0];
  console.log(`${label}`);
  console.log(`   stored   from ${c.from}  until ${c.until}`);
  console.log(`   preview  ${p.state.toUpperCase()}${p.state === 'owes' ? `  ← WOULD SCHEDULE ${p.owedMin}m` : ''}`);
  console.log('');
}

console.log('='.repeat(70));
console.log('ORDER A — set the START date first, then the end date');
console.log('(the natural order: you read the fields left to right)');
console.log('='.repeat(70));
{
  const s = new Schedule({ config: defaultConfig });
  const c = addAsTheCardDoes(s);
  show('after ＋ Add commitment', s, c);
  s.updateCommitment(c.id, { from: '2026-08-31' });
  show('typed START = 2026-08-31', s, s.commitments[0]);
  s.updateCommitment(c.id, { until: '2026-09-30' });
  show('typed END   = 2026-09-30', s, s.commitments[0]);
}

console.log('='.repeat(70));
console.log('ORDER B — set the END date first, then the start date');
console.log('='.repeat(70));
{
  const s = new Schedule({ config: defaultConfig });
  const c = addAsTheCardDoes(s);
  s.updateCommitment(c.id, { until: '2026-09-30' });
  show('typed END   = 2026-09-30', s, s.commitments[0]);
  s.updateCommitment(c.id, { from: '2026-08-31' });
  show('typed START = 2026-08-31', s, s.commitments[0]);
}

console.log('='.repeat(70));
console.log('ORDER C — a real date input edits SEGMENT BY SEGMENT.');
console.log('Changing the day of 08/16 to 08/31 passes through 08/03 first,');
console.log('and every intermediate value is a complete, valid date that fires');
console.log('onChange. This is what typing actually looks like.');
console.log('='.repeat(70));
{
  const s = new Schedule({ config: defaultConfig });
  const c = addAsTheCardDoes(s);
  for (const v of ['2026-08-03', '2026-08-31']) {
    s.updateCommitment(c.id, { from: v });
    console.log(`   typed START -> ${v}   stored from ${s.commitments[0].from} until ${s.commitments[0].until}`);
  }
  console.log('');
  show('after finishing the start date', s, s.commitments[0]);
  s.updateCommitment(c.id, { until: '2026-09-30' });
  show('then the end date', s, s.commitments[0]);
}
