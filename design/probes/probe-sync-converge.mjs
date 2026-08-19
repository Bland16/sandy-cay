// Does repeated syncing SETTLE, or does it churn forever?
// A sync that never reaches "nothing to do" keeps bumping the app's version,
// which keeps re-triggering the debounce — the app would say "syncing" forever.
import { Task } from '../../src/core/index.js';
import { planSync, advanceState, emptyState, describePlan, taskHash } from '../../src/core/syncPlan.js';
import { pull, applyPlan } from '../../src/ui/googleSync.js';
import { Schedule, defaultConfig } from '../../src/core/index.js';

function fakeGoogle() {
  const events = new Map();
  let seq = 0; let clock = 1_000_000;
  const api = {
    listAll: async () => [...events.values()].map((e) => ({ ...e })),
    insert: async (_c, body) => {
      seq += 1; clock += 1;
      const id = `ev${seq}`;
      events.set(id, { ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    patch: async (_c, id, body) => {
      clock += 1;
      events.set(id, { ...events.get(id), ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    remove: async (_c, id) => { events.delete(id); return null; },
    _events: events,
    _now: () => clock,
  };
  return api;
}

const gym = Task.fromJSON({
  id: 'gym-0001',
  title: 'Gym',
  startTime: new Date(2026, 8, 7, 16, 15).getTime(),
  endTime: new Date(2026, 8, 7, 17, 15).getTime(),
  recurrence: {
    anchorDate: null,
    exceptions: [],
    periods: [{
      windows: [
        { day: 'mon', start: '16:15', end: '17:15' },
        { day: 'wed', start: '19:00', end: '20:00' },
        { day: 'sat', start: '14:00', end: '15:00' },
      ],
      interval: 1, effectiveFrom: null, effectiveUntil: null,
    }],
  },
}).toJSON();

const simple = Task.fromJSON({
  id: 'one-0001', title: 'Orientation',
  startTime: new Date(2026, 8, 7, 9).getTime(),
  endTime: new Date(2026, 8, 7, 10).getTime(),
}).toJSON();

async function run(label, startingTasks) {
  console.log(`\n=== ${label} ===\n`);
  const api = fakeGoogle();
  let state = emptyState();
  let local = startingTasks;

  for (let i = 1; i <= 6; i += 1) {
    const remote = await pull(api, 'cal');
    const plan = planSync(local, remote.tasks, state, { unreadable: remote.unreadable });
    const applied = await applyPlan(api, 'cal', plan, {});
    // AFTER the writes, as the hook now does — Google stamps `updated` on
    // everything we just wrote, so a sync point from before them makes our own
    // writes look like somebody else's edit.
    const t = api._now();

    // Adopt through the REAL path: applyLocal -> upsertTaskFromJSON, which
    // runs Task.fromJSON and normalises. Modelling it as a raw object swap
    // invents churn the app does not have.
    if (plan.adopt.length) {
      const sc = new Schedule({ config: defaultConfig, tasks: local });
      for (const adopted of plan.adopt) sc.upsertTaskFromJSON(adopted);
      local = sc.toJSON().tasks;
    }
    state = advanceState(state, applied, t);

    const summary = describePlan(plan);
    console.log(`  pass ${i}: ${summary}`
      + `${plan.conflicts.length ? `  (+${plan.conflicts.length} conflict)` : ''}`
      + `  events=${api._events.size}`);
    if (summary === 'nothing to do' && !plan.conflicts.length) {
      console.log(`\n  SETTLED after ${i} pass(es).`);
      return;
    }
  }
  console.log('\n  *** NEVER SETTLED — this is an endless sync loop ***');
}

await run('a plain task', [simple]);
await run('a SPLIT repeating task (the gym)', [gym]);
