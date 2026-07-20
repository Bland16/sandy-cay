// useViewport.js — the one place that decides which layout we're in (SPEC §11).
//
// Three layouts, and they are genuinely different shapes rather than the same
// grid squeezed:
//   phone   <768   single day + a day-picker strip — the PRIMARY mobile layout
//   tablet  768–1279  Mon–Fri, with the weekend in a drawer
//   desktop ≥1280  the full week
//
// Breakpoints come from the spec. The stylesheet used to say 720px in the two
// places it cared, which matched neither the spec nor anything else; CSS and JS
// now share these numbers, because a layout that disagrees with its own media
// query is a layout that flickers.
//
// matchMedia, not a resize listener: the browser already knows when a breakpoint
// is crossed, and asking it beats re-measuring the window on every resize frame.

import { useEffect, useState } from 'react';

export const PHONE_MAX = 767; // <768
export const TABLET_MAX = 1279; // 768–1279

const QUERIES = {
  phone: `(max-width: ${PHONE_MAX}px)`,
  tablet: `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`,
};

/** 'phone' | 'tablet' | 'desktop' for the current width. */
export function readViewport() {
  // Guarded: the engine's tests run in node, and jsdom hands us a matchMedia
  // that some environments stub. Anything unknown is desktop — the layout this
  // app was built in, and the safest thing to render if we can't tell.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(QUERIES.phone).matches) return 'phone';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'desktop';
}

export function useViewport() {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
    const onChange = () => setViewport(readViewport());
    // addListener is the deprecated spelling; jsdom and older Safari still need
    // it, and a layout hook that throws on mount takes the whole app with it.
    for (const l of lists) {
      if (l.addEventListener) l.addEventListener('change', onChange);
      else if (l.addListener) l.addListener(onChange);
    }
    onChange(); // width may have changed between first render and effect
    return () => {
      for (const l of lists) {
        if (l.removeEventListener) l.removeEventListener('change', onChange);
        else if (l.removeListener) l.removeListener(onChange);
      }
    };
  }, []);

  return viewport;
}
