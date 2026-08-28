// LandingScreen — the way in (design/GOOGLE-AS-STORAGE.md §5).
//
// Ported from design/login-mockup.html, treatment A, chosen by eye. The visual
// reasoning lives in that file and in styles.css; the rules worth repeating
// where someone will edit them:
//
//   - THE PAPER IS FILTERED, THE WORDS ARE NOT. `.lz-parchment` carries the
//     torn edge; the content sits above it, crisp. Putting the filter on the
//     card smears every glyph, which is what the first version did.
//   - No flicker, ever (FRONTEND-SPEC, photosensitivity). The motion here is
//     parallax, a slow lamp sway and drifting dust — all smooth and monotonic.
//   - Ambient stays near-ink so the gold door is the only saturated thing on
//     screen ("function is color").
//   - Both doors are the same size and weight. A guest is a real way to use
//     this app, not a lesser one, and the gold is not doing that work alone —
//     the words and the sprite say it too (§10, never meaning by colour alone).
import { useEffect, useRef, useState } from 'react';
import { SESSION } from '../session.js';
import seagull from '../../assets/icons/seagull.png';
import chest from '../../assets/icons/treasure-chest.png';
import bottle from '../../assets/icons/message-bottle.png';
import compass from '../../assets/icons/compass.png';

const MOTES = 16;

export default function LandingScreen({ onChoose, busy = false, error = null, notice = null }) {
  const motesRef = useRef(null);
  const layersRef = useRef(null);
  const [still] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });

  // Dust. Positions vary so the field never reads as a repeating pattern.
  useEffect(() => {
    if (still || !motesRef.current) return undefined;
    const host = motesRef.current;
    for (let i = 0; i < MOTES; i += 1) {
      const m = document.createElement('span');
      m.className = 'lz-mote';
      m.style.left = `${8 + Math.random() * 84}%`;
      m.style.top = `${48 + Math.random() * 46}%`;
      m.style.animationDuration = `${11 + Math.random() * 12}s`;
      m.style.animationDelay = `${-Math.random() * 18}s`;
      host.appendChild(m);
    }
    return () => { host.replaceChildren(); };
  }, [still]);

  // Parallax. Layers move by different amounts, so the table reads as a surface
  // under a hanging light. Pointer only — device tilt is a motion-sickness trap.
  useEffect(() => {
    if (still || !layersRef.current) return undefined;
    let fine = true;
    try { fine = window.matchMedia('(pointer: fine)').matches; } catch { fine = false; }
    if (!fine) return undefined;
    const layers = [...layersRef.current.querySelectorAll('[data-depth]')];
    let tx = 0; let ty = 0; let cx = 0; let cy = 0; let raf = null;
    const frame = () => {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      for (const el of layers) {
        const d = Number(el.dataset.depth) || 0;
        // The lamp keeps its own sway keyframe; writing transform would kill it.
        if (!d || el.classList.contains('lz-lamp')) continue;
        el.style.transform = `translate3d(${(cx * d).toFixed(2)}px,${(cy * d).toFixed(2)}px,0)`;
      }
      raf = (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) ? requestAnimationFrame(frame) : null;
    };
    const onMove = (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [still]);

  return (
    <section className="lz" ref={layersRef}>
      {/* The filters. Inline rather than in CSS because an SVG filter has to be
          in the document to be referenced by url(#…). */}
      <svg width="0" height="0" className="lz-defs" aria-hidden="true">
        <filter id="lz-deckle">
          <feTurbulence type="fractalNoise" baseFrequency="0.026" numOctaves="4" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="lz-wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.021" numOctaves="2" seed="4" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* High frequency, LOW scale: fine noise nibbles an edge (scratchy).
            Coarse noise with a big displacement makes it wobble like a flag. */}
        <filter id="lz-scratch">
          <feTurbulence type="fractalNoise" baseFrequency="0.075" numOctaves="3" seed="9" result="s" />
          <feDisplacementMap in="SourceGraphic" in2="s" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="lz-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>

      <div className="lz-layer lz-wood" data-depth="6" aria-hidden="true" />
      <div className="lz-layer lz-lamp" data-depth="16" aria-hidden="true" />
      <div className="lz-layer lz-motes" data-depth="26" ref={motesRef} aria-hidden="true" />
      <div className="lz-layer lz-vignette" aria-hidden="true" />
      <svg className="lz-layer lz-grainfx" aria-hidden="true">
        <rect width="100%" height="100%" filter="url(#lz-grain)" />
      </svg>

      <div className="lz-chart">
        <div className="lz-parchment" aria-hidden="true">
          <svg className="lz-coast" viewBox="0 0 580 400" preserveAspectRatio="none" filter="url(#lz-wobble)">
            <path
              d="M20,306 C96,274 128,326 198,302 C258,281 276,238 340,246 C412,256 436,306 522,286"
              fill="none" stroke="#3d2f1c" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round"
            />
            <path
              d="M58,352 C142,332 206,364 276,340 C352,314 414,354 540,328"
              fill="none" stroke="#3d2f1c" strokeWidth="1.5" strokeDasharray="1 9" strokeLinecap="round"
            />
            {/* INK, not coral: P-1 reserves --warning for scheduling physics. */}
            <circle cx="340" cy="246" r="8" fill="none" stroke="#2A2620" strokeWidth="2.5" />
            <path d="M332,238 L348,254 M348,238 L332,254" stroke="#2A2620" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <img className="lz-px lz-rose" src={compass} alt="" />
        </div>

        {/* Outside the parchment so it stays crisp — it is pixel art, which is
            exactly what a displacement map must not touch. */}
        <img className="lz-px lz-gull" src={seagull} alt="" aria-hidden="true" />

        <div className="lz-content">
          <div className="lz-brand">
            <h1>Sandy&nbsp;Cay</h1>
            <div className="lz-rule"><span>make yer landing</span></div>
          </div>

          <div className="lz-doors">
            <button
              className="lz-door lz-primary"
              type="button"
              disabled={busy}
              onClick={() => onChoose(SESSION.GOOGLE)}
            >
              <img className="lz-px" src={chest} alt="" aria-hidden="true" />
              <span>
                <span className="lz-t">Bury it in the chest</span>
                <span className="lz-s">
                  {busy ? 'Asking Google…' : 'Launches a Google Calendar API to log in to your current schedule'}
                </span>
              </span>
            </button>

            <button
              className="lz-door"
              type="button"
              disabled={busy}
              onClick={() => onChoose(SESSION.GUEST)}
            >
              <img className="lz-px" src={bottle} alt="" aria-hidden="true" />
              <span>
                <span className="lz-t">Sail without a flag</span>
              </span>
            </button>
          </div>

          {/* A refusal has to be SAID. A door that silently does nothing is the
              disabled-button-that-swallows-clicks bug this project already had.

              ⚠️ A NOTICE IS NOT A REFUSAL, and they are deliberately two props.
              "Reconnect to Google" is the ordinary state of a reload — coral
              would tell the user something had gone wrong, and P-1 reserves
              that colour for scheduling physics. An error outranks a notice,
              because if Google has just refused you that is the newer news. */}
          {error && <p className="lz-error" role="alert">{error}</p>}
          {!error && notice && <p className="lz-notice" role="status">{notice}</p>}

          <p className="lz-smallprint">
            A guest&rsquo;s week is kept in this browser alone.<br />
            <b>Export before you close the tab</b>, or the tide takes it.
          </p>
        </div>
      </div>
    </section>
  );
}
