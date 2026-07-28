/* ==========================================================================
   Hero illustration — an isometric view of the request path: a parked
   snapshot on NVMe, the microVM it restores into, and the gateway holding
   the request. Hand-rolled SVG so the marketing page pulls in no image
   weight and re-tones with the brand variables.
   ========================================================================== */

import React from 'react';

export function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 420" className={className} role="img" aria-label="Isometric diagram of a Firecracker microVM waking from a snapshot">
      <defs>
        <linearGradient id="ha-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id="ha-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-hover)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-brand-hover)" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="ha-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Ambient wash */}
      <ellipse cx="260" cy="250" rx="240" ry="150" fill="url(#ha-glow)" />

      {/* Ground plates */}
      {[
        { x: 130, y: 300, w: 120 },
        { x: 270, y: 330, w: 120 },
        { x: 270, y: 250, w: 120 },
      ].map((p, i) => (
        <g key={i} opacity={0.5}>
          <path
            d={`M${p.x},${p.y} L${p.x + p.w / 2},${p.y - p.w / 4} L${p.x + p.w},${p.y} L${p.x + p.w / 2},${p.y + p.w / 4} Z`}
            fill="var(--color-surface)"
            stroke="var(--color-brand-line)"
            strokeWidth="1.4"
          />
        </g>
      ))}

      {/* Snapshot slab on NVMe (left, dormant) */}
      <g>
        <path d="M70,236 L130,206 L190,236 L130,266 Z" fill="var(--color-surface)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        <path d="M70,236 L70,258 L130,288 L130,266 Z" fill="var(--color-surface-subtle)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        <path d="M190,236 L190,258 L130,288 L130,266 Z" fill="var(--color-line)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        {[0, 1, 2].map((i) => (
          <line
            key={i}
            x1={96 + i * 18}
            y1={236 + i * 2}
            x2={126 + i * 18}
            y2={221 + i * 2}
            stroke="var(--color-brand-line)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* Live microVM cube (centre) */}
      <g>
        <path d="M190,150 L270,105 L350,150 L270,195 Z" fill="url(#ha-face)" />
        <path d="M190,150 L190,215 L270,260 L270,195 Z" fill="url(#ha-side)" />
        <path d="M350,150 L350,215 L270,260 L270,195 Z" fill="var(--color-brand-hover)" opacity="0.55" />
        {/* Code glyph on the top face */}
        <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.92">
          <path d="M252,146 L240,152 L252,158" />
          <path d="M288,146 L300,152 L288,158" />
          <path d="M276,140 L264,164" />
        </g>
      </g>

      {/* Restore arc: snapshot → microVM */}
      <path
        d="M150,214 C170,170 200,150 210,152"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="2"
        strokeDasharray="5 5"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="210" cy="152" r="3.5" fill="var(--color-brand)" />

      {/* Request arrow in, response arrow out */}
      <g stroke="var(--color-brand)" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M400,120 L340,150" strokeDasharray="5 5" opacity="0.75" />
        <path d="M340,196 L400,226" strokeDasharray="5 5" opacity="0.75" />
      </g>

      {/* Gateway node (right) */}
      <g>
        <rect x="398" y="96" width="96" height="52" rx="10" fill="var(--color-surface)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        <circle cx="418" cy="122" r="7" fill="none" stroke="var(--color-brand)" strokeWidth="1.8" />
        <path d="M411,122 h14 M418,115 a10 10 0 010 14 a10 10 0 010 -14" stroke="var(--color-brand)" strokeWidth="1.4" fill="none" />
        <text x="434" y="119" fontSize="11" fontWeight="600" fill="var(--color-ink)">Gateway</text>
        <text x="434" y="133" fontSize="9.5" fill="var(--color-ink-muted)">holds request</text>
      </g>

      {/* Served response chip */}
      <g>
        <rect x="398" y="200" width="96" height="52" rx="10" fill="var(--color-surface)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        <path d="M414,226 l5,5 l9,-11" stroke="var(--color-brand)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="434" y="223" fontSize="11" fontWeight="600" fill="var(--color-ink)">200 OK</text>
        <text x="434" y="237" fontSize="9.5" fill="var(--color-ink-muted)">p50 &lt; 350ms</text>
      </g>

      {/* Parked label */}
      <g>
        <rect x="46" y="300" width="128" height="44" rx="10" fill="var(--color-surface)" stroke="var(--color-brand-line)" strokeWidth="1.6" />
        <circle cx="66" cy="322" r="5" fill="var(--color-line-strong)" />
        <text x="80" y="319" fontSize="11" fontWeight="600" fill="var(--color-ink)">Parked</text>
        <text x="80" y="332" fontSize="9.5" fill="var(--color-ink-muted)">0 MB resident</text>
      </g>
    </svg>
  );
}
