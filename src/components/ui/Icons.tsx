/* ==========================================================================
   Gregale — one stroked icon set for the whole console.

   Every glyph is a 24×24 stroke path, so they all share weight and optical
   size. Paths are split on '|' into separate <path> elements. Keeping them in
   one map (rather than pulling an icon package) keeps the bundle dependency
   free, which matters for a console that ships on every dashboard route.
   ========================================================================== */

import React from 'react';

export const ICONS = {
  /* Navigation */
  overview: 'M3 13h8V3H3z|M13 21h8v-8h-8z|M3 21h8v-6H3z|M13 9h8V3h-8z',
  workflows: 'M12 2 3 7l9 5 9-5-9-5z|M3 17l9 5 9-5|M3 12l9 5 9-5',
  apis: 'M8 6 2 12l6 6|M16 6l6 6-6 6|M14 4l-4 16',
  crons: 'M12 7v5l3 2|M12 3a9 9 0 100 18 9 9 0 000-18z',
  queues: 'M3 8h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M3 8l2.5-4h13L21 8|M9 12h6',
  workers: 'M6 6h12v12H6z|M9 2v4|M15 2v4|M9 18v4|M15 18v4|M2 9h4|M2 15h4|M18 9h4|M18 15h4',
  deployments: 'M12 19V5|M5 12l7-7 7 7|M4 21h16',
  domains: 'M12 3a9 9 0 100 18 9 9 0 000-18z|M3 12h18|M12 3a14 14 0 010 18 14 14 0 010-18z',
  secrets: 'M5 11h14v10H5z|M8 11V7a4 4 0 018 0v4|M12 15v2',
  env: 'M4 6h16|M4 12h16|M4 18h16|M9 3v6|M15 9v6|M7 15v6',
  storage: 'M3 6h18v5H3z|M3 13h18v5H3z|M7 8.5h.01|M7 15.5h.01',
  databases: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z|M20 6v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6|M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3',
  logs: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M8 13h8|M8 17h5',
  metrics: 'M3 3v18h18|M7 15l4-4 3 3 5-6',
  traces: 'M6 3v12|M6 21a3 3 0 100-6 3 3 0 000 6z|M18 9a3 3 0 100-6 3 3 0 000 6z|M18 9c0 6-12 3-12 9',
  alerts: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8z|M13.7 21a2 2 0 01-3.4 0',
  usage: 'M12 20v-8|M18 20V8|M6 20v-4|M3 4h18',
  invoices: 'M6 2h12v20l-3-2-3 2-3-2-3 2z|M9 8h6|M9 12h6',
  plans: 'M2 7h20v12H2z|M2 11h20|M6 15h4',
  keys: 'M15.5 7.5a4 4 0 11-4.2 4.2|M11.3 11.7 3 20v2h2l1-1h2v-2h2l3-3',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6|M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-4l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.3 2.5h4l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z',

  /* Chrome & controls */
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16z|M21 21l-4.3-4.3',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8z|M13.7 21a2 2 0 01-3.4 0',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18z|M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3|M12 17h.01',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  plus: 'M12 5v14|M5 12h14',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18|M6 6l12 12',
  dots: 'M12 13a1 1 0 100-2 1 1 0 000 2z|M19 13a1 1 0 100-2 1 1 0 000 2z|M5 13a1 1 0 100-2 1 1 0 000 2z',
  refresh: 'M21 12a9 9 0 01-9 9 9 9 0 01-8.2-5.3|M3 12a9 9 0 019-9 9 9 0 018.2 5.3|M21 3v5h-5|M3 21v-5h5',
  external: 'M15 3h6v6|M10 14L21 3|M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6',
  calendar: 'M4 5h16v16H4z|M16 3v4|M8 3v4|M4 10h16',
  copy: 'M9 9h11v11H9z|M5 15H4V4h11v1',
  trash: 'M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6|M10 11v6|M14 11v6',
  play: 'M6 4l14 8-14 8z',
  pause: 'M8 5h3v14H8z|M13 5h3v14h-3z',
  arrowUp: 'M12 19V5|M6 11l6-6 6 6',
  arrowDown: 'M12 5v14|M6 13l6 6 6-6',
  arrowRight: 'M5 12h14|M13 5l7 7-7 7',
  code: 'M8 6l-6 6 6 6|M16 6l6 6-6 6',
  terminal: 'M4 17l6-5-6-5|M12 19h8',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  scale: 'M12 3v18|M4 8h16|M4 8l-2 6a4 4 0 008 0z|M20 8l2 6a4 4 0 01-8 0z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18z|M3 12h18|M12 3a14 14 0 010 18 14 14 0 010-18z',
  clock: 'M12 7v5l3 2|M12 3a9 9 0 100 18 9 9 0 000-18z',
  spark: 'M3 17l5-6 4 3 4-6 5 5',
  collapse: 'M15 18l-6-6 6-6',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  inbox: 'M3 12h5l2 3h4l2-3h5|M5 5h14l2 7v7H3v-7z',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {ICONS[name].split('|').map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
