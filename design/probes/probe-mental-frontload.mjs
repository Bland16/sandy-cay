// The isolated version: front days are mentally HEAVY but time-FREE, back days
// are mentally LIGHT and equally time-free. Identical occupancy, opposite load.
// If placement is energy-blind, the project piles onto the heavy front anyway.
import { Schedule } from '../../src/core/Schedule.js';
import { energyTrajectory, loadForTask } from '../../src/core/energy.js';

const D = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi, 0, 0);
const from = D(9, 7);
const until = D(9, 21, 18, 0);
const DAY = 86400000;
const off = (dt) => Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - from) / DAY);

const s = new Schedule({});
// Two buckets, deliberately opposite on the mental axis. Load is a per-hour RATE.
s.addBucket({ label: 'Deep work', tags: ['deep'], color: '#2E8C99', load: { mental: 2, physical: 0, social: 0, creative: 1 } });
s.addBucket({ label: 'Errands', tags: ['errand'], color: '#7FBE8B', load: { mental: 0, physical: 1, social: 0, creative: 0 } });
s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 2, physical: 0, social: 0, creative: 0 } });

// Every one of the 14 days carries exactly ONE 2-hour block, same time of day.
// Days 0-3: mentally brutal. Days 4-13: mentally free.
for (let d = 0; d < 14; d++) {
  const heavy = d < 4;
  s.addFixed({
    title: heavy ? `Deep work ${d}` : `Errand ${d}`,
    tags: [heavy ? 'deep' : 'errand'],
    startTime: D(9, 7 + d, 9, 0), endTime: D(9, 7 + d, 11, 0),
  });
}

const dip = (d) => energyTrajectory(s, new Date(from.getTime() + d * DAY)).low.mental;
const before = Array.from({ length: 14 }, (_, d) => dip(d));

const { parent } = s.addProject({
  title: 'Thesis', tags: ['study'],
  chunking: { totalMinutes: 1200, minChunk: 60, maxChunk: 240, range: { from, until } },
});
const kids = s.tasks.filter((t) => t.parentId === parent.id);
const perDay = new Map();
for (const k of kids) perDay.set(off(k.startTime), (perDay.get(off(k.startTime)) || 0) + k.getDuration());
const after = Array.from({ length: 14 }, (_, d) => dip(d));

console.log('Identical time occupancy every day (one 2h block at 09:00).');
console.log('Days 0-3 mentally heavy (load.mental +2/h); days 4-13 mentally light (0/h).');
console.log('Task load the engine computes for a thesis chunk:', JSON.stringify(loadForTask(s, kids[0])));
console.log('');
const row = (label, arr, fmt) => console.log(`  ${label.padEnd(9)}` + arr.map(fmt).join(''));
console.log('  day      ' + Array.from({ length: 14 }, (_, i) => `d+${i}`.padStart(6)).join(''));
row('before', before, (v) => v.toFixed(1).padStart(6));
row('after', after, (v) => v.toFixed(1).padStart(6));
row('project', Array.from({ length: 14 }, (_, i) => perDay.get(i) || 0), (v) => (v ? `${v}m`.padStart(6) : '     .'));
console.log('');
const heavyMin = [0, 1, 2, 3].reduce((n, d) => n + (perDay.get(d) || 0), 0);
const lightMin = [...perDay.entries()].filter(([d]) => d >= 4).reduce((n, [, v]) => n + v, 0);
console.log(`  minutes placed on the 4 mentally-heavy days: ${heavyMin}`);
console.log(`  minutes placed on the 10 mentally-light days: ${lightMin}`);
console.log(`  deepest dip anywhere BEFORE: ${Math.min(...before).toFixed(1)}   AFTER: ${Math.min(...after).toFixed(1)}`);
