// Icon.jsx — inline SVG line-art fallbacks (ported from the mockup's <symbol>
// sheet). Structured so segmented sprite art can later swap in via a manifest
// without touching call sites: every icon is referenced by <Icon name="…"/>.
// When real sprites arrive, this map becomes a manifest lookup — call sites
// (name-based) stay unchanged.

const PATHS = {
  anchor: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2" /><path d="M12 7v13M5 12a7 7 0 0 0 14 0M8 12H5m14 0h-3" /></g>,
  lock: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></g>,
  hammock: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6v6M21 6v6M3 9c6 6 12 6 18 0" /></g>,
  loop: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" /><path d="M20 4v4h-4M4 20v-4h4" /></g>,
  flag: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 22V3" /><path d="M7 4h10l-2.5 3.5L17 11H7" fill="currentColor" stroke="none" /><path d="M7 4h10l-2.5 3.5L17 11H7" /></g>,
  pennant: <path d="M5 4h13l-4 4 4 4H5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  castle: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18M4 20v-8l3-2v-3l2 2 3-3 3 3 2-2v3l3 2v8M12 20v-4" /></g>,
  compass: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" fill="currentColor" stroke="none" /><path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" /></g>,
  cabana: <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 26 32 10l24 16M12 26v26h40V26M12 26h40M26 52V36h12v16" /></g>,
  'chev-l': <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  'chev-r': <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  cal: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></g>,
  dots: <g fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></g>,
  plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  spyglass: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></g>,
  x: <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  check: <path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  shell: <g fill="currentColor"><path d="M12 3c5 0 8 4 8 8 0 5-4 9-8 9S4 16 4 11c0-4 3-8 8-8z" opacity=".22" /><path d="M12 20c-1-4-1-11 0-17M12 20c2-4 3-9 5-13M12 20c-2-4-3-9-5-13" fill="none" stroke="currentColor" strokeWidth="1.4" /></g>,
  starfish: <path d="M12 3l2.4 5.6 6 .5-4.6 3.9 1.5 5.9L12 16.5 6.7 18.8l1.5-5.9L3.6 9.1l6-.5z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />,
  chest: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="11" rx="1.5" /><path d="M3 9l2-4h14l2 4M12 9v3" /></g>,
  key: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="4" /><path d="M11 11l8 8M16 16l2-2M18 18l2-2" /></g>,
  back: <path d="M11 6l-6 6 6 6M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  refresh: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-1 5" /><path d="M20 4v6h-6" /></g>,
  umbrella: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v2M4 12a8 8 0 0 1 16 0zM12 12v7a2 2 0 0 0 4 0" /></g>,
  crab: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13a6 6 0 0 1 12 0v3H6zM3 10l3 3M21 10l-3 3M9 16l-2 4M15 16l2 4" /></g>,
};

const VIEWBOX = { cabana: '0 0 64 60' };

// Segmented sprite art (src/assets, green-keyed). Deliberately a SHORT list.
//
// The sheets have 57 sprites; almost none belong here. Badges render at ~11px
// inside .b chips, where hand-drawn art turns to mud and the line-art SVG is
// simply more legible — and chevrons/x/plus/check aren't beach metaphors at all.
// Art earns its place only where it's big enough to read AND carries the app's
// identity: the mascot on an empty state, the shells you rate with, and the
// cabana you step into. Everything else stays SVG.
//
// Sprites are decorative (aria-hidden) with an SVG fallback behind them, so a
// missing file degrades rather than breaks (FRONTEND-SPEC §10, hard rule).
const SPRITES = {
  crab: new URL('../assets/icons/crab.png', import.meta.url).href,
  shell: new URL('../assets/icons/seashell.png', import.meta.url).href,
  cabana: new URL('../assets/icons/cabana-hut.png', import.meta.url).href,
};

export default function Icon({ name, size, className, style }) {
  const s = size ? { width: size, height: size } : undefined;

  const sprite = SPRITES[name];
  if (sprite) {
    return (
      <img
        src={sprite}
        alt=""
        aria-hidden="true"
        draggable="false"
        className={`sprite ${className || ''}`.trim()}
        style={{ ...s, ...style }}
      />
    );
  }

  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg
      viewBox={VIEWBOX[name] || '0 0 24 24'}
      className={className}
      style={{ ...s, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
}
