'use client';

/* ==========================================================================
   Last-resort boundary: catches failures in the root layout itself, where the
   normal error.tsx cannot mount. It replaces the entire document, so it must
   render its own <html> and <body> — and it cannot rely on the app's CSS
   variables being loaded, hence the literal colours below.
   ========================================================================== */

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7f7f4',
          color: '#1a1c19',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: 32,
            textAlign: 'center',
            background: '#fff',
            border: '1px solid #e8e8e2',
            borderRadius: 12,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Gregale failed to load</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#8b8d84' }}>
            Something went wrong before the console could start.
          </p>
          {error.digest && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#a8aaa1', fontFamily: 'ui-monospace, monospace' }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              color: '#fff',
              background: '#107c41',
              border: 0,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
