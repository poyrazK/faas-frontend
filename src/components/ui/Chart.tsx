'use client';

/* ==========================================================================
   Gregale — dependency-free SVG charts.

   The console ships no charting library: these three primitives cover every
   graph in the template (stat-tile sparklines, the invocations area chart,
   the daily cost bars). They size themselves to their container via
   ResizeObserver and draw at real pixel dimensions, so stroke weights and
   label sizes stay honest instead of being scaled by a viewBox.
   ========================================================================== */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Point } from '@/lib/series';

/** Tracks a block element's width so the SVG can be drawn 1:1 in CSS pixels. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Catmull-Rom through the points, emitted as cubic beziers — the template's
 * curves are visibly smoothed rather than polylines. Tension 0 keeps the
 * curve from overshooting into negative territory on spiky series.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function scaleY(values: number[], height: number, pad: number) {
  const max = Math.max(...values, 0);
  const span = max === 0 ? 1 : max;
  return { max, at: (v: number) => height - pad - (v / span) * (height - pad * 2) };
}

/* ───────────────────────────── Sparkline ───────────────────────────────── */

export function Sparkline({
  points,
  height = 40,
  color = 'var(--color-chart)',
  fill = true,
}: {
  points: Point[];
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const values = points.map((p) => p.value);
  const ready = width > 0 && points.length > 1;

  let line = '';
  let area = '';
  if (ready) {
    const y = scaleY(values, height, 3);
    const step = width / (points.length - 1);
    const pts = points.map((p, i) => ({ x: i * step, y: y.at(p.value) }));
    line = smoothPath(pts);
    area = `${line} L${width},${height} L0,${height} Z`;
  }

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {ready && (
        <svg width={width} height={height} aria-hidden="true">
          {fill && <path d={area} fill={color} opacity={0.12} />}
          <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/* ──────────────────────────── Area chart ───────────────────────────────── */

export function AreaChart({
  points,
  height = 260,
  color = 'var(--color-chart)',
  valueLabel = 'Invocations',
  format = (n: number) => n.toLocaleString(),
}: {
  points: Point[];
  height?: number;
  color?: string;
  valueLabel?: string;
  format?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 46;
  const padR = 8;
  const padT = 10;
  const padB = 26;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = Math.max(0, height - padT - padB);
  const ready = width > 0 && points.length > 1;

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  // Round the axis ceiling up to something readable (1-2-5 × 10ⁿ).
  const ceiling = (() => {
    if (max <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(max));
    const norm = max / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  })();

  const xAt = (i: number) => padL + (plotW * i) / (points.length - 1);
  const yAt = (v: number) => padT + plotH - (v / ceiling) * plotH;

  const coords = ready ? points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) })) : [];
  const line = smoothPath(coords);
  const area = ready ? `${line} L${xAt(points.length - 1)},${padT + plotH} L${padL},${padT + plotH} Z` : '';

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!ready) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const i = Math.round(((x - padL) / plotW) * (points.length - 1));
      setHover(i >= 0 && i < points.length ? i : null);
    },
    [ready, plotW, points.length],
  );

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const gradientId = React.useId();

  return (
    <div ref={ref} className="relative" style={{ width: '100%', height }}>
      {ready && (
        <>
          <svg
            width={width}
            height={height}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${valueLabel} over ${points.length} days`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Horizontal grid + y labels */}
            {gridLines.map((g) => {
              const y = padT + plotH * g;
              const v = ceiling * (1 - g);
              return (
                <g key={g}>
                  <line
                    x1={padL}
                    x2={width - padR}
                    y1={y}
                    y2={y}
                    stroke="var(--color-grid)"
                    strokeWidth={1}
                    strokeDasharray={g === 1 ? undefined : '3 3'}
                  />
                  <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
                    {format(Math.round(v))}
                  </text>
                </g>
              );
            })}

            <path d={area} fill={`url(#${gradientId})`} />
            <path d={line} fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />

            {/* x labels — thinned out so they never collide */}
            {points.map((p, i) => {
              const every = Math.ceil(points.length / 8);
              if (i % every !== 0 && i !== points.length - 1) return null;
              return (
                <text
                  key={p.label}
                  x={xAt(i)}
                  y={height - 8}
                  textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                  fontSize={10}
                  fill="var(--color-ink-faint)"
                >
                  {p.label}
                </text>
              );
            })}

            {hover !== null && (
              <g pointerEvents="none">
                <line
                  x1={xAt(hover)}
                  x2={xAt(hover)}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="var(--color-line-strong)"
                  strokeWidth={1}
                />
                <circle cx={xAt(hover)} cy={yAt(points[hover].value)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
              </g>
            )}
          </svg>

          {hover !== null && (
            <div
              className="card pointer-events-none absolute z-10 px-3 py-2 text-xs"
              style={{
                left: Math.min(Math.max(xAt(hover) - 60, 0), Math.max(width - 130, 0)),
                top: Math.max(yAt(points[hover].value) - 62, 0),
                boxShadow: 'var(--shadow-raised)',
                minWidth: 120,
              }}
            >
              <div style={{ color: 'var(--color-ink-muted)' }}>{points[hover].label}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                <span style={{ color: 'var(--color-ink-muted)' }}>{valueLabel}</span>
                <span className="ml-auto font-semibold" style={{ color: 'var(--color-ink)' }}>
                  {format(points[hover].value)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Bar chart ───────────────────────────────── */

export function BarChart({
  points,
  height = 120,
  color = 'var(--color-chart)',
  format = (n: number) => n.toLocaleString(),
}: {
  points: Point[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const ready = width > 0 && points.length > 0;

  const padB = 18;
  const plotH = height - padB;
  const max = Math.max(...points.map((p) => p.value), 0);
  const slot = ready ? width / points.length : 0;
  const barW = Math.max(2, slot * 0.62);

  return (
    <div ref={ref} className="relative" style={{ width: '100%', height }}>
      {ready && (
        <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
          {points.map((p, i) => {
            const h = max === 0 ? 0 : (p.value / max) * plotH;
            const x = i * slot + (slot - barW) / 2;
            return (
              <rect
                key={p.label + i}
                x={x}
                y={plotH - h}
                width={barW}
                height={Math.max(h, p.value > 0 ? 1.5 : 0)}
                rx={2}
                fill={color}
                opacity={hover === null || hover === i ? 0.85 : 0.4}
                onMouseEnter={() => setHover(i)}
              />
            );
          })}
          <line x1={0} x2={width} y1={plotH} y2={plotH} stroke="var(--color-line)" strokeWidth={1} />
          {points.map((p, i) => {
            const every = Math.ceil(points.length / 6);
            if (i % every !== 0 && i !== points.length - 1) return null;
            return (
              <text
                key={p.label + i}
                x={i * slot + slot / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-ink-faint)"
              >
                {p.label}
              </text>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div
          className="card pointer-events-none absolute z-10 px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{
            left: Math.min(Math.max(hover * slot - 20, 0), Math.max(width - 110, 0)),
            top: 0,
            boxShadow: 'var(--shadow-raised)',
          }}
        >
          <span style={{ color: 'var(--color-ink-muted)' }}>{points[hover].label}</span>{' '}
          <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{format(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

/* Re-exported so pages can keep chart imports in one place. */
export type { Point };
