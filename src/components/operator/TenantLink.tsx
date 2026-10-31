import React from 'react';
import { EntityId } from './EntityId';

/** An account ID that opens the customer's workspace; every page that shows an account uses it. */
export function TenantLink({ accountId, short = false }: { accountId: string; short?: boolean }) {
  return <EntityId id={accountId} kind="account" full={!short} />;
}
