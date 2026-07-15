/**
 * Phase 2 frontend placeholder.
 *
 * Per SPEC §13 / FRONTEND-SPEC §10, the UI is built after the layout is signed
 * off. The scheduling engine lives in `src/core` (pure JS, fully tested) and is
 * ready for the UI to bind to. This shell exists so the repo builds and deploys
 * from day one; it is replaced module-by-module in Phase 2.
 */
export default function App() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        background: '#F1E9D8',
        color: '#2A2620',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Sandy Cay</h1>
        <p style={{ color: '#6E665A', lineHeight: 1.5 }}>
          The scheduling engine (Phase 1) is built and tested in <code>src/core</code>.
          The frontend (Phase 2) lands here once a layout is signed off.
        </p>
      </div>
    </main>
  );
}
