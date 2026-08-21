// phone-shot.mjs — look at the real app at a real width, from the terminal.
//
// ⚠️ WHY. This project's worst-caught bugs are the ones a test cannot see. The
// suite has been green through a collapsed energy-control track, a "sittings"
// row that rendered as garbage, a label reading "Whenpick a time", and — the one
// that prompted this file — a phone panel pinned to 280px because a wider media
// query sat lower in the stylesheet. 1069 tests were green for every one of
// them, because no BEHAVIOUR changed.
//
// A desktop cannot reach the widths where those break. This can.
//
//   node tools/phone-shot.mjs                    # 500px, the day view, seeded
//   node tools/phone-shot.mjs --width 820        # tablet
//   node tools/phone-shot.mjs --landing          # the entry screen, no seed
//   node tools/phone-shot.mjs --out shots/x.png
//
// NO NEW DEPENDENCIES: it drives the Chrome or Edge already on the machine in
// headless mode. `npm run build` first, or pass --skip-build if dist is fresh.
//
// ⚠⚠ THE LIMIT THAT MATTERS, AND IT ALREADY FOOLED ME ONCE.
//
// **Chrome will not open a window narrower than about 500 CSS px on Windows.**
// `--window-size=390` is accepted and silently clamped: the SCREENSHOT comes out
// 390px wide while the page is laid out at ~500px, so you are looking at a
// 390px CROP of a 500px layout. Everything near the right edge appears cut off.
//
// I read that crop as a real overflow bug on the entry screen, wrote a fix for
// it, and only caught it by measuring `window.innerWidth` — which said 518,
// then 500 with the scale factor pinned, and never 390. There was no bug.
//
// So: 500 is the floor, it is enforced below rather than hoped for, and a
// genuine 390px viewport needs CDP `Emulation.setDeviceMetricsOverride` (what
// Puppeteer does) which needs a WebSocket client this project does not carry.
// 500 still lands inside the PHONE breakpoint (<768), so the phone LAYOUT is
// testable here — just not a phone's exact width.
//
// ⚠️ SECOND LIMIT: this screenshots what renders ON LOAD. It cannot click, so a
// surface that appears only after an interaction — the task edit panel, any
// drill-in — will not be in the picture. An iframe harness that clicks for you
// was tried and does not paint under headless screenshotting. For those, reason
// about the cascade with `design/probes/probe-css-cascade.mjs`, which answers
// "which rule wins at this width" directly and needs no pixels at all.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : fallback;
};

// Chrome's own floor. Asking for less does not fail — it silently crops, which
// is how a non-existent bug got "found". Refuse instead.
const MIN_WIDTH = 500;
const WIDTH = Number(flag('width', MIN_WIDTH));
const HEIGHT = Number(flag('height', 844));
const LANDING = !!flag('landing', false);
const OUT = resolve(String(flag('out', `shots/phone-${WIDTH}.png`)));
const PORT = Number(flag('port', 4173));

if (WIDTH < MIN_WIDTH) {
  console.error(`Chrome cannot lay out below ~${MIN_WIDTH}px; it would crop a ${MIN_WIDTH}px page`);
  console.error(`to ${WIDTH}px and everything would look clipped. Use --width ${MIN_WIDTH} or more.`);
  console.error('(Still inside the phone breakpoint, so the phone LAYOUT is what you get.)');
  process.exit(1);
}

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge found. Add its path to BROWSERS in this file.');
  process.exit(1);
}

if (!flag('skip-build', false)) {
  console.log('building…');
  const r = spawnSync('npm', ['run', 'build'], { shell: true, stdio: 'ignore' });
  if (r.status !== 0) { console.error('build failed — run `npm run build` to see why'); process.exit(1); }
}

// A seeded schedule, so the grid has something in it. Written into dist/ (which
// is gitignored) rather than into the app, so nothing about this tool can ship.
if (!LANDING) {
  const { Schedule, defaultConfig, seedStarterBuckets } = await import('../src/core/index.js');
  const s = new Schedule({ config: defaultConfig });
  seedStarterBuckets(s);
  const now = new Date();
  const at = (h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  s.addFixed({ title: 'CHEM1109 General Chemistry I', startTime: at(10), endTime: at(10, 50), tags: ['study'] });
  s.addFixed({ title: 'Meet Kevin at Park Potomac', startTime: at(13), endTime: at(14), tags: ['people'] });
  s.addFixed({ title: 'Gym', startTime: at(16, 15), endTime: at(17, 15), tags: ['body'] });
  s.addFlexible({ title: 'Read for seminar', durationMin: 90, tags: ['study'] });

  // Inlined, NOT fetched: an async fetch does not survive Chrome's virtual-time
  // budget, and the screenshot comes back blank with no explanation.
  writeFileSync('dist/phone-shot.html', `<!doctype html>
<meta charset="utf-8"><title>seeding</title>
<script>
localStorage.setItem('sandy-cay:schedule:v1', ${JSON.stringify(JSON.stringify(s.toJSON()))});
localStorage.setItem('sandycay.session', 'guest');
location.replace('./');
</script>`);
}

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT)], { shell: true, stdio: 'ignore' });
const url = `http://localhost:${PORT}/sandy-cay/${LANDING ? '' : 'phone-shot.html'}`;

const ready = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/sandy-cay/`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => { setTimeout(r, 250); });
  }
  return false;
};

if (!await ready()) { console.error('preview server never came up'); server.kill(); process.exit(1); }
mkdirSync(dirname(OUT), { recursive: true });

const profile = resolve(tmpdir(), `sandy-shot-${process.pid}`);

const shot = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  // Pinned, so CSS pixels are device pixels. Without it Chrome inherits the
  // desktop's display scaling and the layout viewport silently differs from the
  // size you asked for.
  '--force-device-scale-factor=1',
  `--window-size=${WIDTH},${HEIGHT}`,
  '--virtual-time-budget=10000',
  // ⚠️ A FRESH PROFILE EVERY RUN. Reusing one keeps localStorage between runs,
  // so `--landing` quietly rendered the DAY VIEW instead of the entry screen —
  // the previous run had already stored a guest session. A screenshot tool that
  // silently shows you the wrong screen is worse than no tool.
  `--user-data-dir=${profile}`,
  `--screenshot=${OUT}`,
  url,
], { stdio: 'ignore' });

server.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
if (shot.status !== 0 || !existsSync(OUT)) { console.error('screenshot failed'); process.exit(1); }
const bytes = readFileSync(OUT).length;
console.log(`${OUT}  ${WIDTH}x${HEIGHT}  ${(bytes / 1024).toFixed(0)} kB`);
// A near-empty PNG means the page never painted — usually something async that
// virtual time skipped past. Say so, rather than leaving a blank file to puzzle over.
if (bytes < 6000) console.log('⚠️ that is suspiciously small — the page probably never painted');
