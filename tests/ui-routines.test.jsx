// @vitest-environment jsdom
// R-C — authoring a routine in the Cabana (design/ROUTINES.md §UI).
//
// ⚠️ THE KIND COMES FROM WHICH BUTTON YOU PRESSED, and is never inferred. Two
// earlier attempts inferred it from the label and both were wrong — a keyword
// list made the oven's "preheat" a WAIT, and a grammar rule was invented rather
// than asked for. These tests lock the affordance, not a heuristic.
//
// Dumped, not only driven: behaviour tests cannot see a missing field.
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import {
  Schedule, defaultConfig, resetIds, weekStart as weekStartOf,
} from '../src/core/index.js';
import RoutinesEditor, { routineMeta } from '../src/ui/components/RoutinesEditor.jsx';
import Cabana from '../src/ui/components/Cabana.jsx';

afterEach(cleanup);

const WS = weekStartOf(new Date(2026, 8, 7));

function Harness({ sched }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <RoutinesEditor sched={sched} mutate={mutate} weekStart={WS} />;
}

const LAUNDRY_STEPS = [
  { label: 'load', kind: 'active', durationMin: 2, durationMax: 2, maxWaitMin: null },
  { label: 'washing', kind: 'passive', durationMin: 45, durationMax: 45, maxWaitMin: null },
  { label: 'switch', kind: 'active', durationMin: 2, durationMax: 2, maxWaitMin: null },
  { label: 'drying', kind: 'passive', durationMin: 60, durationMax: 60, maxWaitMin: null },
  { label: 'fold', kind: 'active', durationMin: 10, durationMax: 10, maxWaitMin: null },
];

const withLaundry = () => {
  resetIds();
  const s = new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
  s.addActivity({ label: 'Laundry', tags: ['chores'], steps: LAUNDRY_STEPS });
  return s;
};

/** Every step row as `kind label min[-max]`. Sees rows that are ABSENT. */
const dumpSteps = () => [...document.querySelectorAll('.rstep')].map((r) => {
  const kind = r.querySelector('.rskind').textContent;
  const nums = [...r.querySelectorAll('input.num')].map((i) => i.value || '—');
  return `  ${kind.padEnd(5)} ${(r.querySelector('input.grow').value || '(unnamed)').padEnd(12)} ${nums.join('-')}`;
}).join('\n');

describe('the card, in every state', () => {
  it('STATE 1 — empty', () => {
    resetIds();
    render(<Harness sched={new Schedule({ config: defaultConfig })} />);
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 1 — EMPTY\n  ${document.querySelector('.cabcard').textContent}\n`);
    expect(screen.getByText('Routines')).toBeTruthy();
    expect(screen.getByText('No routines yet.')).toBeTruthy();
    expect(screen.getByLabelText('Add routine')).toBeTruthy();
  });

  it('STATE 2 — a list, stating elapsed AND attention', () => {
    render(<Harness sched={withLaundry()} />);
    const row = document.querySelector('.editrow');
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 2 — LIST\n  ${row.textContent}\n`);
    // Elapsed 119m vs 14m of attention is the whole point of a passive wait, so
    // the row says both rather than one number that hides it.
    expect(row.textContent).toContain('3 touchpoints');
    expect(row.textContent).toContain('1h 59m start to finish');
    expect(row.textContent).toContain('14m of your attention');
  });

  it('STATE 3 — the editor: two row shapes, and a live preview', () => {
    const s = withLaundry();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 3 — EDITOR\n${dumpSteps()}\n  PREVIEW\n    ${
      [...document.querySelectorAll('.rspreview span')].map((x) => x.textContent).join('\n    ')}\n`);

    expect([...document.querySelectorAll('.flabel')].map((l) => l.textContent))
      .toEqual(['name', 'tags', 'travel', 'steps']);
    expect(document.querySelectorAll('.rstep').length).toBe(5);
    // A WAIT row has TWO number fields (min and max); a timed step has one.
    const rows = [...document.querySelectorAll('.rstep')];
    expect(rows[0].querySelectorAll('input.num').length).toBe(1); // load
    expect(rows[1].querySelectorAll('input.num').length).toBe(2); // washing
    expect(rows[1].classList.contains('iswait')).toBe(true);
  });
});

describe('the kind comes from the BUTTON, never from the label', () => {
  it('offers exactly two add affordances, side by side', () => {
    const s = withLaundry();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
    expect(screen.getByLabelText('Add timed step')).toBeTruthy();
    expect(screen.getByLabelText('Add wait')).toBeTruthy();
  });

  it('＋ timed step makes an ACTIVE step whatever it is called', () => {
    // "washing" would have been inferred as a wait by the deleted grammar rule.
    const s = withLaundry();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
    fireEvent.click(screen.getByLabelText('Add timed step'));
    const i = s.activities[0].steps.length - 1;
    fireEvent.change(screen.getByLabelText(`Step ${i + 1} name`), { target: { value: 'washing' } });
    expect(s.activities[0].steps[i].kind).toBe('active');
  });

  it('＋ wait makes a WAIT whatever it is called', () => {
    // "preheat" would have been inferred as a wait by the deleted keyword list.
    const s = withLaundry();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
    fireEvent.click(screen.getByLabelText('Add wait'));
    const i = s.activities[0].steps.length - 1;
    fireEvent.change(screen.getByLabelText(`Step ${i + 1} name`), { target: { value: 'preheat' } });
    expect(s.activities[0].steps[i].kind).toBe('passive');
  });
});

describe('a timed step is ONE time; a wait is a min and a max', () => {
  const open = (s) => {
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
  };

  it('moves both ends of a timed step together', () => {
    const s = withLaundry();
    open(s);
    fireEvent.change(screen.getByLabelText('Step 1 minutes'), { target: { value: '7' } });
    expect(s.activities[0].steps[0].durationMin).toBe(7);
    expect(s.activities[0].steps[0].durationMax).toBe(7);
  });

  it('stores a wait\'s max as the CEILING, not as its length', () => {
    // R-1: the min drives the offsets (physics); the max is a preference and
    // must never reach `durationMax`, or it would move the anchors.
    const s = withLaundry();
    open(s);
    fireEvent.change(screen.getByLabelText('Step 2 wait maximum'), { target: { value: '60' } });
    const w = s.activities[0].steps[1];
    expect(w.maxWaitMin).toBe(60);
    expect(w.durationMin).toBe(45);
    expect(w.durationMax).toBe(45);
  });

  it('treats a BLANK max as no ceiling — min-only, appliances unchanged', () => {
    const s = withLaundry();
    open(s);
    fireEvent.change(screen.getByLabelText('Step 2 wait maximum'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Step 2 wait maximum'), { target: { value: '' } });
    expect(s.activities[0].steps[1].maxWaitMin).toBe(null);
  });

  it('never lets the ceiling fall below the floor', () => {
    const s = withLaundry();
    open(s);
    fireEvent.change(screen.getByLabelText('Step 2 wait maximum'), { target: { value: '10' } });
    expect(s.activities[0].steps[1].maxWaitMin).toBe(45); // the floor is physics
  });
});

describe('the procedure is the unit', () => {
  it('a new routine arrives WITH a step — a procedure with no parts is not one', () => {
    resetIds();
    const s = new Schedule({ config: defaultConfig });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Add routine'));
    expect(s.activities[0].steps.length).toBe(1);
    expect(s.activities[0].isRoutine).toBe(true);
  });

  it('removes as a whole', () => {
    const s = withLaundry();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit routine Laundry'));
    fireEvent.click(screen.getByLabelText('Remove routine Laundry'));
    expect(s.activities.length).toBe(0);
    expect(screen.getByText('No routines yet.')).toBeTruthy();
  });

  it('is MOUNTED on the real Cabana page', () => {
    const s = withLaundry();
    render(
      <Cabana
        sched={s} mutate={(fn) => fn(s)} weekStart={WS}
        onBack={() => {}} onReplace={() => {}} onReset={() => {}} showToast={() => {}}
      />,
    );
    const signs = [...document.querySelectorAll('.cabsign')].map((x) => x.textContent);
    // eslint-disable-next-line no-console
    console.log(`\nCABANA CARDS: ${signs.join(' | ')}\n`);
    expect(signs).toContain('Routines');
  });
});

describe('routineMeta', () => {
  it('says "no steps yet" rather than a row of zeroes', () => {
    expect(routineMeta({ steps: [], travelMin: 0 })).toBe('no steps yet');
  });

  it('counts travel into both totals', () => {
    expect(routineMeta({ travelMin: 15, steps: [{ label: 'gym', kind: 'active', durationMin: 45 }] }))
      .toBe('1 touchpoint · 1h start to finish · 1h of your attention');
  });
});
