'use client';

/* ==========================================================================
   The metrics endpoints (#273 / #393) never fail loudly: on a Prometheus
   error they return 200 with every number zeroed and `source: "degraded:
   <reason>"`. Rendering that as-is produces a convincing page of zeros, which
   is worse than an error — a customer would read it as "no traffic".

   Every surface that shows metrics puts this banner above the numbers when
   the source is degraded, so a zero is never mistaken for a measurement.
   ========================================================================== */

import React from 'react';
import { degradedReason } from '@/lib/api';
import { Icon } from './Icons';

export function DegradedNotice({ source, onRetry }: { source: string; onRetry?: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 rounded-lg px-4 py-3"
      style={{ background: '#fdf6e7', border: '1px solid #f2e2bd' }}
    >
      <Icon name="alerts" size={16} style={{ color: '#a1650b', marginTop: 2, flex: 'none' }} />
      <div className="flex-1" style={{ minWidth: 220 }}>
        <p className="text-sm font-medium" style={{ color: '#7c4f08' }}>
          Metrics are unavailable right now
        </p>
        <p className="mt-0.5 text-sm" style={{ color: '#7c4f08' }}>
          The metrics backend returned: {degradedReason(source)}. The figures below are placeholder zeros, not
          measurements — treat them as missing data.
        </p>
      </div>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={13} /> Retry
        </button>
      )}
    </div>
  );
}
