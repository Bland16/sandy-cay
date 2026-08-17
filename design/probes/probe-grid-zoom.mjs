// probe-grid-zoom.mjs — what the zoom ACTUALLY does, printed.
//
// The suite cannot see any of this: heights, drop geometry and gridlines are all
// presentation, and 860 green tests have missed exactly this class before. Run:
//     node design/probes/probe-grid-zoom.mjs
import {
  ZOOM_LEVELS, BASE_PXH_WEEK, BASE_PXH_DAY, pxhFor, floorPxFor, zoomIn, zoomOut,
} from '../../src/ui/zoom.js';
import { layoutDay } from '../../src/ui/layout.js';

const seg = (min, startHour) => ({
  task: { id: `t${min}`, title: `${min}m` },
  s: startHour,
  e: startHour + min / 60,
});

console.log('=== 1. HONESTY: what a block of each length renders as ===');
console.log('   (apparent = how long it LOOKS, = height / pxh * 60)\n');
for (const base of [BASE_PXH_WEEK, BASE_PXH_DAY]) {
  console.log(`-- ${base === BASE_PXH_WEEK ? 'WEEK GRID' : 'DAY VIEW'} (base ${base}px/hr) --`);
  console.log('  z     pxh   floor |  2m card  looks like |  15m card looks like |  60m card');
  for (const z of ZOOM_LEVELS) {
    const pxh = pxhFor(base, z);
    const floor = floorPxFor(z);
    const laid = layoutDay([seg(2, 9), seg(15, 12), seg(60, 15)], 5, pxh, floor);
    const h = (i) => parseFloat(laid[i].style.height);
    const app = (i) => (h(i) / pxh) * 60;
    console.log(
      `  ${String(z).padEnd(4)}  ${String(pxh).padStart(3)}   ${String(floor).padStart(3)}   |`
      + ` ${h(0).toFixed(1).padStart(6)}px ${app(0).toFixed(1).padStart(7)}m |`
      + ` ${h(1).toFixed(1).padStart(6)}px ${app(1).toFixed(1).padStart(7)}m |`
      + ` ${h(2).toFixed(1).padStart(6)}px`,
    );
  }
  console.log('');
}

console.log('=== 2. NO-OP AT 1x: both surfaces must be byte-identical to before ===');
{
  const before = { weekPxh: 34, dayPxh: 42, floor: 26 };
  const now = {
    weekPxh: pxhFor(BASE_PXH_WEEK, 1),
    dayPxh: pxhFor(BASE_PXH_DAY, 1),
    floor: floorPxFor(1),
  };
  const same = JSON.stringify(before) === JSON.stringify(now);
  console.log(`   was ${JSON.stringify(before)}`);
  console.log(`   now ${JSON.stringify(now)}`);
  console.log(`   ${same ? 'OK — identical' : 'CHANGED — a "no-op" that is not one'}\n`);
}

console.log('=== 3. THE DROP TRAP: does a drop land on the minute you dropped at? ===');
console.log('   Re-implements useCardInteraction.js:85 exactly:');
console.log('     snapTo(startHour*60 + ((y - top) / col.pxh) * 60)\n');
{
  // The real snap, from interaction.js — 5-minute grid.
  const snapTo = (m) => Math.round(m / 5) * 5;
  const startHour = 5;
  const colTop = 0;
  let allOk = true;
  console.log('   z     pxh | pointer y | resolves to | intended | ');
  for (const z of ZOOM_LEVELS) {
    const pxh = pxhFor(BASE_PXH_WEEK, z);
    // Aim at 14:30 — compute the y the grid would DRAW it at, then read it back.
    const intended = 14 * 60 + 30;
    const y = colTop + (intended / 60 - startHour) * pxh;
    const got = snapTo(startHour * 60 + ((y - colTop) / pxh) * 60);
    const ok = got === intended;
    if (!ok) allOk = false;
    console.log(
      `   ${String(z).padEnd(4)}  ${String(pxh).padStart(3)} | ${y.toFixed(1).padStart(9)} |`
      + ` ${String(got).padStart(11)} | ${String(intended).padStart(8)} | ${ok ? 'OK' : 'WRONG'}`,
    );
  }
  console.log(`   ${allOk ? 'OK — round-trips at every rung' : 'BROKEN'}\n`);

  console.log('   And the failure this guards against — cards drawn at the new');
  console.log('   scale while data-pxh still reports the old 34:');
  const pxhDrawn = pxhFor(BASE_PXH_WEEK, 4);
  const intended = 14 * 60 + 30;
  const y = (intended / 60 - startHour) * pxhDrawn;
  const stale = snapTo(startHour * 60 + (y / 34) * 60);
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  console.log(`     dropped on ${hh(intended)} -> would land on ${hh(stale)}`
    + `  (${((stale - intended) / 60).toFixed(1)}h out, silently)\n`);
}

console.log('=== 4. GRIDLINES: the CSS rule period vs the card scale ===');
console.log('   .day sets --pxh inline; the gradient is calc(var(--pxh) - 1px).');
for (const z of ZOOM_LEVELS) {
  const pxh = pxhFor(BASE_PXH_WEEK, z);
  // A card starting exactly on an hour must land exactly on a rule.
  const laid = layoutDay([seg(60, 14)], 5, pxh, floorPxFor(z));
  const top = parseFloat(laid[0].style.top);
  console.log(`   z=${String(z).padEnd(4)} pxh=${String(pxh).padStart(3)}`
    + ` card top=${top.toFixed(1).padStart(7)}px  rule period=${pxh}px`
    + `  on a line: ${top % pxh === 0 ? 'YES' : 'NO'}`);
}
console.log('');

console.log('=== 5. SCROLL ANCHOR: the hour at the centre must not move ===');
console.log('   WeekGrid: scrollTop = (mid * pxh) / prevPxh - clientHeight/2\n');
{
  const clientHeight = 700;
  const startHour = 5;
  let prevPxh = pxhFor(BASE_PXH_WEEK, 1);
  // Looking at 20:00 in the centre of the viewport.
  let scrollTop = (20 - startHour) * prevPxh - clientHeight / 2;
  const hourAtCentre = (st, pxh) => (st + clientHeight / 2) / pxh + startHour;
  console.log(`   start: z=1   pxh=${prevPxh}  centre hour = ${hourAtCentre(scrollTop, prevPxh).toFixed(2)}`);
  for (const z of ZOOM_LEVELS.slice(1)) {
    const pxh = pxhFor(BASE_PXH_WEEK, z);
    const mid = scrollTop + clientHeight / 2;
    scrollTop = (mid * pxh) / prevPxh - clientHeight / 2;
    prevPxh = pxh;
    console.log(`   zoom to z=${String(z).padEnd(4)} pxh=${String(pxh).padStart(3)}`
      + `  centre hour = ${hourAtCentre(scrollTop, pxh).toFixed(2)}`);
  }
  console.log('   (all five must read 20.00 — anything else is the dawn jump)\n');
  console.log('   Without the correction, for contrast:');
  let st = (20 - startHour) * 34 - clientHeight / 2;
  for (const z of ZOOM_LEVELS.slice(1)) {
    const pxh = pxhFor(BASE_PXH_WEEK, z);
    console.log(`     z=${String(z).padEnd(4)} centre hour = ${hourAtCentre(st, pxh).toFixed(2)}`);
  }
  console.log('');
}

console.log('=== 6. THE RUNGS: stepping saturates, never wraps or goes below 1x ===');
{
  let z = 1;
  const inSeq = [z];
  for (let i = 0; i < 7; i += 1) { z = zoomIn(z); inSeq.push(z); }
  console.log(`   seven presses of +  : ${inSeq.join(' -> ')}`);
  let y = 4;
  const outSeq = [y];
  for (let i = 0; i < 7; i += 1) { y = zoomOut(y); outSeq.push(y); }
  console.log(`   seven presses of -  : ${outSeq.join(' -> ')}`);
  console.log('   (must stop at 4 and at 1 — D-3 says there is nothing below 1x)');
}
