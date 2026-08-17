// probe-routine-parse.mjs — what the typed line ACTUALLY parses to.
//
// Parsing is where "Whenpick a time"-class bugs live, so this prints every
// case rather than asserting it. Read the output; do not trust the code.
//
//   node design/probes/probe-routine-parse.mjs

import { parseRoutineLine, routineToLine } from '../../src/core/routineParse.js';

const CASES = [
  'load 2m, wait 45m, switch 2m, wait 60m, fold 10-15m',
  'waffles in the air fryer 2m then wait 5-10m then eat 10m',
  'put the dishwasher on 5m, wait 90m, unload 5m',
  'put the dishwasher on 5m, running 90m, unload 5m',
  'preheat 2m then heating 15m then food in 3m then cooking 40m then take out 3m',
  'travel 15m, workout 45-60m',
  'wait 1h30',
  'wait 1h 30m',
  'soaking 8h, rinse 5m',
  'soak 8h, rinse 5m',
  'brew 4 min, drink 10 min',
  'wait 90',
  'stretch 10 to 20m',
  'x 0m',
  'just a label with no time',
  '',
  '   ',
  'load 2m,,, wait 45m',
];

for (const line of CASES) {
  const { steps, errors } = parseRoutineLine(line);
  console.log(`\nIN   "${line}"`);
  if (!steps.length && !errors.length) { console.log('     (nothing)'); continue; }
  for (const s of steps) {
    const kind = s.kind === 'passive' ? 'WAIT  ' : 'do    ';
    const range = s.durationMax > s.durationMin ? `${s.durationMin}-${s.durationMax}m` : `${s.durationMin}m`;
    const ceil = s.maxWaitMin ? `  ceiling ${s.maxWaitMin}m` : '';
    console.log(`     ${kind}${String(s.label).padEnd(24)} ${range}${ceil}`);
  }
  for (const e of errors) console.log(`     ✗ "${e.chunk}" — ${e.reason}`);
  const back = routineToLine(steps);
  const re = parseRoutineLine(back);
  const same = JSON.stringify(re.steps) === JSON.stringify(steps);
  console.log(`     OUT  "${back}"   round-trips: ${same ? 'yes' : '*** NO ***'}`);
}
