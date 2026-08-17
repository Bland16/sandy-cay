// Verify PROBE-A finding 1 independently: does layOutWeek schedule straight
// through a RECURRING pinned gym? The user has exactly this shape — a gym they
// deliberately hand-placed Mon/Wed/Sat.
import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { defaultConfig } from '../../src/core/config.js';
import { layOutWeek } from '../../src/core/commitmentWeek.js';
import { recurrenceIntervals } from '../../src/core/placement.js';
import { weekStart, addDays, dateKey } from '../../src/core/time.js';

const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h) => { const d = addDays(MON, o); d.setHours(h, 0, 0, 0); return d; };
const s = new Schedule({ config: defaultConfig });

s.tasks.push(new Task({
  title: 'Gym',
  tags: ['gym'],
  type: 'fixed',
  pinned: true,
  startTime: at(0, 8),
  endTime: at(0, 17),
  recurrence: {
    periods: [{
      windows: [
        // Deliberately covering the MORNINGS, which is where the generator
        // wants to go — otherwise a clash is avoided by luck, not correctness.
        { day: 'mon', start: '08:00', end: '17:00' },
        { day: 'wed', start: '08:00', end: '17:00' },
        { day: 'sat', start: '08:00', end: '17:00' },
      ],
      interval: 1,
      effectiveFrom: null,
      effectiveUntil: null,
    }],
    anchorDate: MON,
    exceptions: [],
  },
}));

s.addCommitment({
  title: 'Math',
  tags: ['study'],
  from: dateKey(MON),
  until: dateKey(addDays(MON, 27)),
  amountMinPerWeek: 600,
  minSitting: 60,
  maxSitting: 180,
  maxPerDay: 1,
});

const occ = recurrenceIntervals(s, MON, addDays(MON, 7));
console.log('gym this week:');
for (const o of occ) console.log(`   ${dateKey(o.start)} ${o.start.getHours()}:00-${o.end.getHours()}:00`);

const rs = layOutWeek(s, MON, at(0, 6));
console.log('\nlaid out:');
let clash = 0;
for (const r of rs) {
  for (const t of r.sittings) {
    const hit = occ.find((o) => t.startTime < o.end && o.start < t.endTime);
    console.log(`   ${dateKey(t.startTime)} ${String(t.startTime.getHours()).padStart(2, '0')}:00 ${t.getDuration()}m${hit ? '   *** ON TOP OF THE GYM ***' : ''}`);
    if (hit) clash += 1;
  }
}
console.log(`\n${clash} sitting(s) overlap the recurring gym`);
