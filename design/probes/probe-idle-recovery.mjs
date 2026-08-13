// Does an EMPTY gap restore anything? The forward-looking candidate rests on the
// intuition that a gap between two demanding blocks has recovery value — the
// user's "it hit during my break times and I needed rest". Check whether the
// model can represent that at all.
import { Schedule } from '../../src/core/Schedule.js';
import { energyTrajectory } from '../../src/core/energy.js';

const D = (d, h, mi = 0) => new Date(2026, 8, d, h, mi, 0, 0);

const mk = (gapHours) => {
  const s = new Schedule({});
  s.addBucket({ label: 'Class', tags: ['class'], color: '#E2685F', load: { mental: 3, physical: 0, social: 0, creative: 0 } });
  s.addFixed({ title: 'Class 1', tags: ['class'], startTime: D(7, 9), endTime: D(7, 12) });
  const second = 12 + gapHours;
  s.addFixed({ title: 'Class 2', tags: ['class'], startTime: D(7, second), endTime: D(7, second + 3) });
  return s;
};

console.log('Two 3-hour classes at mental +3/h, separated by a gap of N hours:');
for (const gap of [0, 1, 3, 6]) {
  const low = energyTrajectory(mk(gap), D(7, 0)).low.mental;
  console.log(`  gap ${gap}h  ->  deepest dip ${low.toFixed(1)}`);
}

// and with the gap actually FILLED by a restorative task
const s = new Schedule({});
s.addBucket({ label: 'Class', tags: ['class'], color: '#E2685F', load: { mental: 3, physical: 0, social: 0, creative: 0 } });
s.addBucket({ label: 'Rest', tags: ['rest'], color: '#7FBE8B', load: { mental: -3, physical: 0, social: 0, creative: 0 } });
s.addFixed({ title: 'Class 1', tags: ['class'], startTime: D(7, 9), endTime: D(7, 12) });
s.addFixed({ title: 'Nap', tags: ['rest'], startTime: D(7, 12), endTime: D(7, 14) });
s.addFixed({ title: 'Class 2', tags: ['class'], startTime: D(7, 15), endTime: D(7, 18) });
console.log(`\n  3h gap left EMPTY        -> dip ${energyTrajectory(mk(3), D(7, 0)).low.mental.toFixed(1)}`);
console.log(`  3h gap with a 2h REST task -> dip ${energyTrajectory(s, D(7, 0)).low.mental.toFixed(1)}`);
console.log('\n  => Idle time is invisible to the battery. Only a task with negative load');
console.log('     repays the reserve. "The gap was my break" has NO representation.');
