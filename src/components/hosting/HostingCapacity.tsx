'use client';

import { useCallback } from 'react';
import { getHostingPreviewCapacity, hostingCapacityMatches } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';

export function HostingCapacity({siteID, disabled}: {siteID: string; disabled: boolean}) {
  const fetcher = useCallback((signal: AbortSignal) => getHostingPreviewCapacity(siteID, signal), [siteID]);
  const query = useHostingQuery(fetcher);
  const valid = !!query.data && hostingCapacityMatches(query.data, siteID);
  const data = !disabled && !query.error && valid ? query.data : null;
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Preview capacity">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">Preview capacity</h3><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={query.refresh}>Refresh capacity</button></div>
    <p className="text-xs">Reservation-backed CI checks capacity before uploading. This snapshot can change before admission. Other upload and release limits still apply.</p>
    {query.error && <p role="alert" className="text-sm">{query.error.message} Capacity is unavailable until a successful refresh.</p>}
    {disabled && <p className="text-xs">Capacity is paused while site details are unavailable or changing.</p>}
    {!disabled && !query.error && query.data && !valid && <p role="alert" className="text-sm">Capacity response does not match this site or its limits. Refresh capacity.</p>}
    {!disabled && !query.error && !query.data && <p className="text-xs">Reading preview capacity…</p>}
    {data && <div className="space-y-2 text-xs">
      <p><strong>{data.available} of {data.limit} slots available</strong> · {data.previews} stored previews · {data.reservations} CI reservations</p>
      {data.available === 0 && <p role="status">Preview capacity is full. Retire unused CI releases or let their reservations expire. Revoke unused previews and wait for safe cleanup before retrying.</p>}
      <p>Stored previews include revoked or expired rows awaiting safe cleanup. Unused reservations end at their original expiry or when their release is retired.</p>
      <p>Observed {new Date(data.observed_at).toLocaleString()}.</p>
    </div>}
  </section>;
}
