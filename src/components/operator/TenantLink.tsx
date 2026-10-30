import React from 'react';
import Link from 'next/link';
import { Mono } from '@/components/ui/bits';
import { tenantHref } from '@/lib/routes';

/** An account ID that opens the customer's workspace; every page that shows an account uses it. */
export function TenantLink({ accountId, short = false }: { accountId: string; short?: boolean }) {
  return (
    <Link
      href={tenantHref(accountId)}
      className="hover:underline"
      title={`Open tenant ${accountId}`}
    >
      <Mono>{short ? `${accountId.slice(0, 13)}…` : accountId}</Mono>
    </Link>
  );
}
