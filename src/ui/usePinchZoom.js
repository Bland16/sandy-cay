// usePinchZoom — two fingers zoom the grid (design/GRID-ZOOM.md §5.2).
//
// ⚠️ NONE OF THIS IS VERIFIABLE IN THIS REPO. jsdom has no touch, no
// PointerEvent and no layout, so the tests below it can only prove the maths and
// the bookkeeping. Whether it FEELS right — against the 450ms long-press, on a
// real phone, with a real thumb — is a question only the device answers, and it
// went to the user as a checklist.
import { useEffect, useRef } from 'react';
import { clampZoom, nearestRung } from './zoom.js';

/**
 * @param ref      the element the gesture lives on (the grid's scroll wrapper)
 * @param zoom     the committed rung
 * @param onPreview(z)  called continuously during the gesture with a CONTINUOUS
 *                      value — D-6: the grid follows the fingers
 * @param onCommit(rung) called once when the fingers lift, with the nearest rung
 */
export function usePinchZoom(ref, { zoom, onPreview, onCommit }) {
  // Refs, not state: these change many times per gesture and none of them should
  // cost a render on their own — `onPreview` is what renders.
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const live = useRef(zoom);
  live.current = zoom;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const dist = () => {
      const [a, b] = [...pointers.current.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (e) => {
      // Mouse and pen are not pinch. A second mouse button must not start one.
      if (e.pointerType !== 'touch') return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size !== 2) return;

      // ⚠️ TWO FINGERS CAN ONLY EVER MEAN ZOOM. A long-press may already have
      // armed a drag, or one may be live — either way it must abandon, because a
      // pinch that silently moves a task is the one outcome here that corrupts
      // data rather than merely looking wrong.
      //
      // Dispatching the browser's own abandon signal REUSES the existing path
      // (`useCardInteraction` listens for `pointercancel` on window in both its
      // arming and its dragging branches) rather than growing a second way to
      // cancel that could drift out of step with the first.
      window.dispatchEvent(new Event('pointercancel'));

      gesture.current = { startDist: dist(), startZoom: live.current, latest: live.current };
    };

    const move = (e) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (!g || pointers.current.size !== 2) return;
      // A zero start distance would be a division by zero; two pointers at
      // exactly the same point is not a pinch anyone meant.
      if (!g.startDist) return;
      g.latest = clampZoom(g.startZoom * (dist() / g.startDist));
      onPreview(g.latest);
      // The browser must not also pan or page-zoom while we are scaling. This
      // needs the listener to be NON-PASSIVE, which is why it is attached by
      // hand below rather than through React.
      if (e.cancelable) e.preventDefault();
    };

    const up = (e) => {
      pointers.current.delete(e.pointerId);
      const g = gesture.current;
      if (!g || pointers.current.size >= 2) return;
      // D-6: settle on the nearest rung, so the stored value is always one of
      // ZOOM_LEVELS and the keyboard and the fingers share one model.
      gesture.current = null;
      onCommit(nearestRung(g.latest));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move, { passive: false });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      pointers.current.clear();
      gesture.current = null;
    };
  }, [ref, onPreview, onCommit]);
}

/**
 * The gesture maths, extracted so it can be tested without a touchscreen.
 *
 * Returns the continuous zoom for a pinch that began at `startDist` with the
 * grid at `startZoom` and is now at `currentDist`.
 */
export function pinchZoomFor(startZoom, startDist, currentDist) {
  if (!startDist) return clampZoom(startZoom);
  return clampZoom(startZoom * (currentDist / startDist));
}
