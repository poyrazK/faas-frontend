import React from 'react';
import Link from 'next/link';
import { Mono } from '@/components/ui/bits';

/** An account ID that opens the tenant panel; every page that shows an account uses it. */
export function TenantLink({ accountId, short = false }: { accountId: string; short?: boolean }) {
  return (
    <Link
      href={`/tenants?q=${encodeURIComponent(accountId)}`}
      className="hover:underline"
      title={`Open tenant ${accountId}`}
    >
      <Mono>{short ? `${accountId.slice(0, 13)}…` : accountId}</Mono>
    </Link>
  );
}
