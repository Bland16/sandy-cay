// probe-learn-fit.mjs — is the shipped fit the ridge regression SPEC §5 names?
//
// Three questions, all measured, none taken on trust:
//   1. What does the model claim to have learned from a user with NO preference?
//   2. How far is the 400-epoch fit from the ridge optimum it approximates?
//   3. Does lambda do anything at its configured value?
//
// Run: node design/probes/probe-learn-fit.mjs
import { Schedule, Bucket, Task, resetIds, addDays, weekStart } from '../../src/core/index.js';
import { defaultConfig } from '../../src/core/config.js';

const line = (s = '') => console.log(s);
const fx = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const MON = weekStart(new Date(2026, 8, 7));
const at = (o, h) => { const d = addDays(MON, o); d.setHours(h, 0, 0, 0); return d; };

function rated(title, o, h, overall) {
  const t = new Task({
    title, tags: ['study'], type: 'fixed',
    startTime: at(o, h), endTime: at(o, h + 1),
  });
  t.completion = 'done';
  t.satisfaction = { overall };
  return t;
}

function trainOn(tasks, cfg = {}) {
  resetIds();
  const s = new Schedule({ config: { ...defaultConfig, learning: { ...defaultConfig.learning, ...cfg } } });
  s.buckets.push(new Bucket({ label: 'Study', tags: ['study'] }));
  s.tasks.push(...tasks);
  s.retrain();
  return s;
}

const top = (s, n = 6) => s.learning.inspect()
  .filter((w) => Math.abs(w.weight) > 1e-6)
  .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
  .slice(0, n);

// ---------------------------------------------------------------- 1. flat data
line('=== 1. a user with NO preference at all ===');
line('  30 ratings, every one a 3. There is nothing to learn. Anything the model');
line('  reports here it invented, and both narration surfaces rank on |weight|.');
line();
{
  const FLAT = Array.from({ length: 30 }, (_, i) => rated(`f${i}`, i % 5, 9 + (i % 4), 3));
  const s = trainOn(FLAT);
  line(`  bias  ${fx(s.learning.bias)}`);
  for (const w of top(s)) {
    line(`  ${w.label.padEnd(16)} ${fx(w.weight)}   obs=${w.observations}`);
  }
  const spoken = top(s).filter((w) => Math.abs(w.weight) > 0.01).length;
  line();
  line(`  columns above the 0.01 display floor: ${spoken}`);
  line('  The honest answer is bias = 0.5 (a 3 of 5) and every weight 0.000.');
}

// ------------------------------------------------------- 2. epochs vs the optimum
line();
line('=== 2. how converged is the shipped fit? ===');
line('  The intercept is unpenalised and each one-hot block sums to 1, so the');
line('  block is collinear with the bias. Nothing identifies the split, and the');
line('  null-space direction converges far slower than the signal directions.');
line();
{
  const FLAT = Array.from({ length: 30 }, (_, i) => rated(`f${i}`, i % 5, 9 + (i % 4), 3));
  line('  epochs      bias   largest |weight|   what it would print');
  for (const epochs of [400, 5000, 50000, 200000]) {
    const s = trainOn(FLAT, { epochs });
    const t = top(s, 1)[0];
    const claim = t && Math.abs(t.weight) > 0.01 ? `"${t.label}"` : '(nothing)';
    line(`  ${String(epochs).padStart(7)}   ${fx(s.learning.bias, 3)}   ${fx(t ? Math.abs(t.weight) : 0, 3).padStart(8)}          ${claim}`);
  }
  line();
  line('  400 is the shipped value. If the bias is short of 0.5 there, the');
  line('  missing mass is sitting in the one-hot columns as invented preference.');
}

// -------------------------------------------------------------- 3. does λ bite?
line();
line('=== 3. does lambda do anything at 0.1? ===');
line('  Shrinkage for a column with k observations is k/(k+lambda).');
line();
{
  const SIGNAL = [
    ...Array.from({ length: 24 }, (_, i) => rated(`am${i}`, i % 5, [9, 12, 15, 19][i % 4], 4)),
    ...Array.from({ length: 12 }, (_, i) => rated(`pm${i}`, i % 5, 22, 1)),
  ];
  line('  lambda   bias   spread of time weights   night weight');
  for (const lambda of [0.1, 1, 4, 8, 16]) {
    const s = trainOn(SIGNAL, { lambda });
    const times = s.learning.inspect().filter((w) => w.label.startsWith('time:'));
    const vals = times.map((w) => w.weight);
    const night = times.find((w) => w.label === 'time:night');
    line(`  ${String(lambda).padStart(5)}    ${fx(s.learning.bias, 3)}   ${fx(Math.max(...vals) - Math.min(...vals), 3).padStart(10)}              ${fx(night ? night.weight : 0, 3)}`);
  }
  line();
  line('  A lambda that is doing nothing leaves the spread unchanged as it rises.');
}
