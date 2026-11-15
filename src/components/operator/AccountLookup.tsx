'use client';

import React from 'react';
import Link from 'next/link';
import { kindLabel, LOOKUP_KIND_LABELS, type ObsLookupMatch, type ObsLookupResponse } from '@/lib/ops/accountHealth';
import { relativeTime } from '@/lib/format';
import { tenantHref } from '@/lib/routes';
import { TenantLink } from '@/components/operator/TenantLink';
import { Mono } from '@/components/ui/bits';

/* The accounts behind a support lookup (GET /v1/admin/obs/lookup). Each row
   opens the tenant workspace; trace matches also open the trace timeline. */
export function AccountLookupResults({
  data,
  onOpenTrace,
}: {
  data: ObsLookupResponse;
  onOpenTrace: (traceId: string) => void;
}) {
  if (data.matches.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--color-ink-muted)]">
        Nothing matched. The lookup accepts an email, an app slug, an app or custom-domain URL, an account, app or
        deployment ID, or the request or trace ID of a refused API request.
      </p>
    );
  }
  const accounts = new Set(data.matches.map((m) => m.account_id));
  return (
    <div className="overflow-x-auto">
      {accounts.size > 1 && (
        <p className="px-4 pt-3 text-xs text-[var(--color-ink-muted)]">
          {data.matches.length} matches across {accounts.size} accounts.
        </p>
      )}
      <table className="w-full text-left text-xs">
        <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-2">Matched</th>
            <th className="px-4 py-2">Account</th>
            <th className="px-4 py-2">App</th>
            <th className="px-4 py-2">Detail</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {data.matches.map((m, i) => (
            <MatchRow key={`${m.kind}-${m.account_id}-${m.app_id ?? ''}-${i}`} match={m} query={data.query} onOpenTrace={onOpenTrace} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchRow({ match, query, onOpenTrace }: { match: ObsLookupMatch; query: string; onOpenTrace: (id: string) => void }) {
  return (
    <tr>
      <td className="px-4 py-2 font-medium">{kindLabel(LOOKUP_KIND_LABELS, match.kind)}</td>
      <td className="px-4 py-2 font-mono">
        <TenantLink accountId={match.account_id} short />
      </td>
      <td className="px-4 py-2">{match.app_slug ? <Mono>{match.app_slug}</Mono> : <span className="text-[var(--color-ink-muted)]">—</span>}</td>
      <td className="px-4 py-2 text-[var(--color-ink-muted)]">
        {match.detail ?? ''}
        {match.at && <span className="ml-1">· {relativeTime(match.at)}</span>}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <Link href={tenantHref(match.account_id)} className="btn btn-secondary btn-sm">
          Open account
        </Link>
        {match.kind === 'trace' && (
          <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => onOpenTrace(query)}>
            Open trace
          </button>
        )}
      </td>
    </tr>
  );
}
