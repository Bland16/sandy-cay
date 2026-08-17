// probe-b-tz.mjs — scenario 44: a term laid out in one zone, opened in another.
// Two modes so each half runs in its own process with its own TZ:
//   TZ=America/New_York node design/probes/probe-b-tz.mjs write
//   TZ=Europe/London    node design/probes/probe-b-tz.mjs read

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Schedule } from '../../src/core/Schedule.js';
import { layOutWeek, previewWeek } from '../../src/core/commitmentWeek.js';
import { dateFromKey, dateKey, formatHHMM, weekStart } from '../../src/core/time.js';

const FILE = path.join(os.tmpdir(), 'probe-b-tz-footlocker.json');
const line = (s = '') => console.log(s);
const dow = (k) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateFromKey(k).getDay()];
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const mode = process.argv[2] || 'write';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const offset = -new Date(2026, 8, 7).getTimezoneOffset() / 60;
line(`[${mode}] TZ=${TZ} (UTC${offset >= 0 ? '+' : ''}${offset} on 7 Sep 2026)`);

const WS = dateFromKey('2026-09-07');
const NOW = at('2026-09-07', '08:00');

if (mode === 'write') {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 }, windows: { monFri: { start: '08:00', end: '23:00' } } } });
  s.addZone({ label: 'Evening study', matchTags: ['study'], exclusive: true, windows: ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => ({ day: d, start: '20:00', end: '23:00' })) });
  s.addFixed({ title: 'Seminar', tags: ['class'], pinned: true, startTime: at('2026-09-09', '09:00'), durationMin: 120 });
  s.addCommitment({ title: 'Maths', tags: ['study'], from: '2026-09-01', until: '2026-12-20', amountMinPerWeek: 300, minSitting: 60, maxSitting: 180, maxPerDay: 1 });
  s.addDayNote({ label: 'Term starts', from: '2026-09-07', to: '2026-09-07', kind: 'note' });
  s.blockDay(dateFromKey('2026-09-12'));
  layOutWeek(s, WS, NOW);
  // A Sunday-EVENING sitting is the one that can change which WEEK owes.
  const cid = s.commitments[0].id;
  s.addFixed({ title: 'Maths', tags: ['study'], parentId: cid, startTime: at('2026-09-13', '20:00'), durationMin: 120 });
  fs.writeFileSync(FILE, JSON.stringify(s.toJSON()));
  line('  laid out in this zone:');
  for (const t of s.tasks) line(`    ${t.title.padEnd(10)} ${dow(dateKey(t.startTime))} ${dateKey(t.startTime)} ${formatHHMM(t.startTime)}-${formatHHMM(t.endTime)}  epoch=${t.startTime.getTime()}`);
  line(`  sittingsFor(week of 7 Sep) = ${s.sittingsFor(s.commitments[0].id, WS).length}`);
  line(`  preview = ${previewWeek(s, WS, NOW).map((p) => `${p.state} placed=${p.placedMin}m`).join()}`);
  line(`  wrote ${FILE}`);
} else {
  const s = Schedule.fromJSON(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  line('  the SAME file, opened here:');
  for (const t of s.tasks) line(`    ${t.title.padEnd(10)} ${dow(dateKey(t.startTime))} ${dateKey(t.startTime)} ${formatHHMM(t.startTime)}-${formatHHMM(t.endTime)}  epoch=${t.startTime.getTime()}`);
  const c = s.commitments[0];
  line(`  sittingsFor(week of 7 Sep) = ${s.sittingsFor(c.id, WS).length}  (dates: ${s.sittingsFor(c.id, WS).map((t) => dateKey(t.startTime)).join(', ')})`);
  line(`  sittingsFor(week of 14 Sep) = ${s.sittingsFor(c.id, dateFromKey('2026-09-14')).length}`);
  line(`  preview week of 7 Sep = ${previewWeek(s, WS, NOW).map((p) => `${p.state} placed=${p.placedMin}m`).join()}`);
  // Do the sittings still sit inside the zone they were routed into?
  const z = s.zones[0];
  const inZone = s.tasks.filter((t) => t.parentId === c.id)
    .map((t) => `${dateKey(t.startTime)} ${formatHHMM(t.startTime)}->${formatHHMM(t.endTime)} inZone=${z.containsRange(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][t.startTime.getDay()], formatHHMM(t.startTime), formatHHMM(t.endTime))}`);
  line(`  zone 20:00-23:00 Mon-Fri; sittings now: ${inZone.join(' | ')}`);
  line(`  day note 'Term starts' still on 7 Sep? ${s.notesForDate(dateFromKey('2026-09-07')).length > 0}`);
  line(`  blocked day still 12 Sep? ${s.isDayBlocked(dateFromKey('2026-09-12'))} (blockedDays=${s.blockedDays.join()})`);
  line(`  Seminar (a pinned 09:00 class) now starts ${formatHHMM(s.tasks.find((t) => t.title === 'Seminar').startTime)}`);
  line(`  weekStart of the first sitting = ${dateKey(weekStart(s.tasks.find((t) => t.parentId === c.id).startTime))}`);
}
