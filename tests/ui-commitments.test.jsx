// @vitest-environment jsdom
// The Cabana commitments card (design/WEEKLY-PLANNING.md §4).
//
// ⚠️ Behaviour tests CANNOT see a missing field. Three defects once shipped past
// 484 green tests, including a field that vanished entirely and a label reading
// "Whenpick a time". So this file DUMPS what the panel actually renders in every
// state and asserts against the dump, rather than only driving it.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Schedule, defaultConfig, resetIds, weekStart as weekStartOf } from '../src/core/index.js';
import CommitmentsEditor, { commitmentMeta } from '../src/ui/components/CommitmentsEditor.jsx';
import Cabana from '../src/ui/components/Cabana.jsx';

afterEach(cleanup);

function Harness({ sched }) {
  const [, setV] = useState(0);
  const mutate = (fn) => { const r = fn(sched); setV((v) => v + 1); return r; };
  return <CommitmentsEditor sched={sched} mutate={mutate} />;
}

const fresh = () => {
  resetIds();
  return new Schedule({ config: { ...defaultConfig, protectedTags: [] } });
};

/** Every labelled control the card is showing, as `label = value` lines. This is
 *  the thing a behaviour test cannot do: it sees fields that are ABSENT. */
function dumpFields() {
  const card = document.querySelector('.cabcard');
  const rows = [...card.querySelectorAll('.field')].map((f) => {
    const label = f.querySelector('.flabel').textContent;
    const vals = [...f.querySelectorAll('input, select')]
      .map((el) => (el.type === 'checkbox' ? String(el.checked) : el.value))
      .filter((v) => v !== '');
    const units = [...f.querySelectorAll('.runit, .rdash')].map((u) => u.textContent).join(' ');
    return `  ${label.padEnd(10)} ${vals.join(' / ') || '—'}${units ? `   [${units}]` : ''}`;
  });
  return rows.join('\n');
}

const dumpRows = () => [...document.querySelectorAll('.editrow')]
  .map((r) => `  ${r.querySelector('.ername').textContent}  ·  ${(r.querySelector('.ermeta') || {}).textContent || ''}`)
  .join('\n');

describe('the card, in every state it has', () => {
  it('STATE 1 — empty: says so, and offers exactly one way in', () => {
    const s = fresh();
    render(<Harness sched={s} />);
    const text = document.querySelector('.cabcard').textContent;
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 1 — EMPTY\n  ${text}\n`);

    expect(screen.getByText('Standing commitments')).toBeTruthy();
    expect(screen.getByText('No commitments yet.')).toBeTruthy();
    expect(screen.getByLabelText('Add commitment')).toBeTruthy();
    expect(document.querySelectorAll('.editrow').length).toBe(0);
  });

  it('STATE 2 — a list: every row states its amount, period and bounds', () => {
    const s = fresh();
    s.addCommitment({
      title: 'ENGR project', tags: ['study'], amountMin: 480,
      from: '2026-09-07', until: '2026-10-03', minSitting: 60, maxSitting: 180, maxPerDay: 1,
    });
    s.addCommitment({
      title: 'Reading', tags: ['reading'], amountMin: 180,
      from: '2026-09-07', until: '2026-09-13', minSitting: 45, maxSitting: 90, maxPerDay: 2,
    });
    render(<Harness sched={s} />);
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 2 — LIST\n${dumpRows()}\n`);

    const rows = [...document.querySelectorAll('.editrow')];
    expect(rows.length).toBe(2);
    // HOURS, not sessions (D-1) — and the meta must not be empty, which is the
    // shape the vanished-field defect took.
    expect(rows[0].textContent).toContain('ENGR project');
    // "3 Oct", not "2026-10-03". A storage key is not a label, and this test
    // read the key back happily until the row was DUMPED and looked at.
    expect(rows[0].textContent).toContain('8h by 3 Oct');
    expect(rows[0].textContent).toContain('sittings 1h–3h');
    expect(rows[0].textContent).toContain('max 1/day');
    expect(rows[1].textContent).toContain('3h by 13 Sep');
    expect(rows[1].textContent).toContain('max 2/day');
  });

  it('STATE 3 — the editor: every field the brief names is PRESENT and filled', () => {
    const s = fresh();
    s.addCommitment({
      title: 'ENGR project', tags: ['study'], amountMin: 480,
      from: '2026-09-07', until: '2026-10-03', minSitting: 60, maxSitting: 180, maxPerDay: 1,
    });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit commitment ENGR project'));
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 3 — EDITOR\n${dumpFields()}\n`);

    // The four the brief asks for, by their VALUES — a field that rendered but
    // lost its value is the same defect as one that vanished.
    expect(screen.getByLabelText('Commitment name').value).toBe('ENGR project');
    expect(screen.getByLabelText('Commitment hours').value).toBe('8');
    expect(screen.getByLabelText('Commitment start date').value).toBe('2026-09-07');
    expect(screen.getByLabelText('Commitment end date').value).toBe('2026-10-03');
    expect(screen.getByLabelText('Commitment minimum sitting minutes').value).toBe('60');
    expect(screen.getByLabelText('Commitment maximum sitting minutes').value).toBe('180');
    expect(screen.getByLabelText('Commitment sittings per day').value).toBe('1');

    // The labels themselves, in order — this is what catches "Whenpick a time".
    const labels = [...document.querySelectorAll('.flabel')].map((l) => l.textContent);
    expect(labels).toEqual(['name', 'tags', 'how much', 'between', 'sittings', 'at most']);
    // And the units, which are the difference between "8" and "8 hours".
    const units = [...document.querySelectorAll('.runit')].map((u) => u.textContent);
    expect(units).toEqual(['hours', 'min', 'a day']);
  });

  it('STATE 4 — a brand-new commitment opens straight into its editor', () => {
    const s = fresh();
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Add commitment'));
    // eslint-disable-next-line no-console
    console.log(`\nSTATE 4 — NEW\n${dumpFields()}\n`);

    // Adding something and being left on the list, guessing which row is yours,
    // is the thing the drill idiom exists to avoid.
    expect(screen.getByLabelText('Commitment name').value).toBe('New commitment');
    expect(screen.getByLabelText('Commitment hours').value).toBe('2');
    expect(s.commitments.length).toBe(1);
  });
});

describe('the controls do what they say', () => {
  const withOne = () => {
    const s = fresh();
    s.addCommitment({
      title: 'ENGR project', tags: [], amountMin: 480,
      from: '2026-09-07', until: '2026-10-03', minSitting: 60, maxSitting: 180, maxPerDay: 1,
    });
    return s;
  };
  const open = (s) => {
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit commitment ENGR project'));
  };

  it('types HOURS and stores MINUTES (D-1)', () => {
    const s = withOne();
    open(s);
    fireEvent.change(screen.getByLabelText('Commitment hours'), { target: { value: '2.5' } });
    expect(s.commitments[0].amountMin).toBe(150);
  });

  it('reads a date as a day key, never through `new Date(string)`', () => {
    // Sharp edge #4: `new Date('2026-10-05')` is UTC midnight, which lands a day
    // early west of Greenwich. The key goes to the model verbatim.
    const s = withOne();
    open(s);
    fireEvent.change(screen.getByLabelText('Commitment end date'), { target: { value: '2026-10-05' } });
    expect(s.commitments[0].until).toBe('2026-10-05');
  });

  it('cannot store a minimum above its maximum — the MODEL is what stops it', () => {
    // ⚠️ This was written as a UI test and was VACUOUS: deleting the editor's
    // `Math.max(...)` left it green, because `Commitment`'s constructor already
    // clamps. The redundant UI line is gone and the test now says where the
    // guarantee actually lives. A min above the max generates nothing at all,
    // silently — no gap is both ≥ 240 and ≤ 180.
    const s = withOne();
    open(s);
    fireEvent.change(screen.getByLabelText('Commitment minimum sitting minutes'), { target: { value: '240' } });
    expect(s.commitments[0].minSitting).toBe(240);
    expect(s.commitments[0].maxSitting).toBe(240);
    // And the editor SHOWS the clamped pair rather than a stale 180.
    expect(screen.getByLabelText('Commitment maximum sitting minutes').value).toBe('240');
  });

  it('refuses a sitting under the grid floor instead of silently rounding', () => {
    const s = withOne();
    open(s);
    fireEvent.change(screen.getByLabelText('Commitment minimum sitting minutes'), { target: { value: '5' } });
    expect(s.commitments[0].minSitting).toBe(15);
  });

  it('renames, and the row follows', () => {
    const s = withOne();
    open(s);
    const name = screen.getByLabelText('Commitment name');
    fireEvent.blur(name, { target: { value: 'ENGR pset' } });
    fireEvent.click(screen.getByText(/All commitments/));
    expect(document.querySelector('.ername').textContent).toBe('ENGR pset');
  });

  it('removes, and returns to the list', () => {
    const s = withOne();
    open(s);
    fireEvent.click(screen.getByLabelText('Remove commitment ENGR project'));
    expect(s.commitments.length).toBe(0);
    expect(screen.getByText('No commitments yet.')).toBeTruthy();
  });
});

describe('tags are OFFERED, never free text (§4.6)', () => {
  it('suggests the tags already in use, because transfer is string-exact', () => {
    // `maths` and `math` are two different worlds and nothing else in the app
    // would report the difference — the margin, ratings, energy character and
    // zone routing all just silently stop transferring.
    const s = fresh();
    s.addFixed({ title: 'CHEM', tags: ['classes'], startTime: new Date(2026, 8, 7, 9), endTime: new Date(2026, 8, 7, 10) });
    s.addFixed({ title: 'Gym', tags: ['gym'], startTime: new Date(2026, 8, 7, 17), endTime: new Date(2026, 8, 7, 18) });
    s.addCommitment({ title: 'ENGR project', tags: [], amountMin: 480, from: '2026-09-07', until: '2026-10-03' });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit commitment ENGR project'));

    // TagEditor deliberately does NOT use a native <datalist> — it renders as an
    // unstyled OS dropdown that breaks the paper/ink world — so the suggestions
    // are a custom listbox that appears once you open the field. My first
    // version of this test queried `datalist option`, found nothing, and would
    // have "passed" the moment I asserted the wrong thing.
    fireEvent.click(screen.getByText('＋ tag'));
    const offered = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    // eslint-disable-next-line no-console
    console.log(`\nTAGS OFFERED: ${offered.join(', ') || '(none)'}\n`);
    expect(offered).toContain('classes');
    expect(offered).toContain('gym');
  });

  it('adds the offered tag verbatim, so the string-exact link actually holds', () => {
    const s = fresh();
    s.addFixed({ title: 'CHEM', tags: ['classes'], startTime: new Date(2026, 8, 7, 9), endTime: new Date(2026, 8, 7, 10) });
    s.addCommitment({ title: 'ENGR project', tags: [], amountMin: 480, from: '2026-09-07', until: '2026-10-03' });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit commitment ENGR project'));
    fireEvent.click(screen.getByText('＋ tag'));
    fireEvent.mouseDown(screen.getByText('classes'));
    expect(s.commitments[0].tags).toEqual(['classes']);
  });
});

describe('it is actually MOUNTED, not merely written', () => {
  it('appears on the real Cabana page, beside the other drill-in cards', () => {
    // A component that exists and is never rendered is the card-sized version of
    // the field that vanished. Only rendering the real page can tell.
    const s = fresh();
    s.addCommitment({ title: 'ENGR project', amountMin: 480, from: '2026-09-07', until: '2026-10-03' });
    render(
      <Cabana
        sched={s}
        mutate={(fn) => fn(s)}
        weekStart={weekStartOf(new Date(2026, 8, 7))}
        onBack={() => {}}
        onReplace={() => {}}
        onReset={() => {}}
        showToast={() => {}}
      />,
    );
    const signs = [...document.querySelectorAll('.cabsign')].map((x) => x.textContent);
    // eslint-disable-next-line no-console
    console.log(`\nCABANA CARDS: ${signs.join(' | ')}\n`);
    expect(signs).toContain('Standing commitments');
    expect(screen.getByText(/8h by 3 Oct/)).toBeTruthy();
  });
});

describe('the layout rules the DOM cannot show you', () => {
  // ⚠️ Reported by the user from a SCREENSHOT, with the suite fully green:
  // the "sittings" row rendered as two number boxes crushed to slivers with the
  // help text sprawled across them. jsdom has no layout engine, so no amount of
  // rendering here can see it — the defect lives entirely in CSS.
  //
  // So this asserts the two rules the fix depends on. Testing stylesheet text is
  // blunt, and it is honestly what it is: a guard against someone deleting a
  // rule whose absence is invisible to every other test in this suite.
  // `import.meta.url` is not a file: URL under this jsdom environment, so the
  // path comes off the project root vitest already runs from.
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');

  it('lets a field WRAP, so help cannot become a third column', () => {
    // `.field` is a flex row. Without wrap, `help` sits BESIDE the label and the
    // control, and a paragraph next to `flex:1` leaves the control nothing.
    expect(css).toMatch(/\.field\s*\{\s*flex-wrap:\s*wrap/);
  });

  it('gives help in a non-stacked field a full row of its own', () => {
    expect(css).toMatch(/\.field:not\(\.stack\)\s*>\s*\.field-help\s*\{[^}]*flex:\s*0 0 100%/);
  });

  it('lets a date pair shrink to share one line', () => {
    // Intrinsic width of a date input is ~200px, so two of them overflowed a
    // narrow card and wrapped between the arrow and the second date — stranding
    // the "→" in mid-air.
    expect(css).toMatch(/\.field \.control\[type="date"\]\s*\{[^}]*flex:\s*1 1 130px/);
  });

  it('never lets a row NAME shrink away — it is the row identity', () => {
    // Reported from a screenshot: the commitment's name vanished completely and
    // "edit ›" was pushed outside the card, because `.ername` was the only item
    // allowed to shrink while `.ermeta` was `flex:none`. A commitment's meta is
    // 42 characters where a zone's is "study · 3 windows".
    expect(css).toMatch(/\.editrow \.ername \{[^}]*min-width:\s*6em/);
    expect(css).not.toMatch(/\.editrow \.ername \{[^}]*min-width:\s*0/);
  });

  it('lets the META yield instead, and the chevron never shrink', () => {
    expect(css).toMatch(/\.editrow \.ermeta \{[^}]*flex:\s*0 1 auto/);
    expect(css).toMatch(/\.editrow \.erchev \{[^}]*flex:\s*none/);
    expect(css).toMatch(/\.editrow \{\s*flex-wrap:\s*wrap/);
  });

  it('stacks every field that carries help — the shape all four callers use', () => {
    // The CSS above makes a non-stacked help SAFE; this keeps them CONSISTENT.
    // A long explanation reads better under a left-aligned label than squeezed
    // beside a 54px right-aligned one.
    const s = fresh();
    s.addCommitment({ title: 'ENGR project', amountMin: 480, from: '2026-09-07', until: '2026-10-03' });
    render(<Harness sched={s} />);
    fireEvent.click(screen.getByLabelText('Edit commitment ENGR project'));
    const withHelp = [...document.querySelectorAll('.field')].filter((f) => f.querySelector('.field-help'));
    expect(withHelp.length).toBe(2);
    for (const f of withHelp) expect(f.classList.contains('stack')).toBe(true);
  });
});

describe('commitmentMeta — the one-line summary', () => {
  it('says "on" rather than "by" for a single-day period', () => {
    expect(commitmentMeta({
      amountMin: 60, from: '2026-09-07', until: '2026-09-07', minSitting: 60, maxSitting: 60, maxPerDay: 1,
    })).toBe('1h on 7 Sep · sittings 1h–1h · max 1/day');
  });
});
