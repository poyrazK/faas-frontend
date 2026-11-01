'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isUuid } from '@/lib/ops/metering';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { TenantLink } from '@/components/operator/TenantLink';
import { ManagedPostgresPanel } from '@/components/operator/tenant/ManagedPostgresPanel';
import { EgressFlows } from './EgressFlows';
import { ReconciliationCard, UsageImportCard, type PrefillSelection } from './PostgresRepair';
import { ObjectStorageReportCard } from './ObjectStorageReport';

/* ==========================================================================
   Metering: the egress flow log, managed PostgreSQL usage and accounting
   repair, and operator object-storage usage reports. ?account=<uuid> scopes
   the per-account tools. Every write previews (or shows its exact body)
   first and is applied through OperatorActionDialog with typed confirmation.
   ========================================================================== */

export default function MeteringPage() {
  return (
    <Suspense>
      <Metering />
    </Suspense>
  );
}

function Metering() {
  const params = useSearchParams();
  const router = useRouter();
  const accountParam = (params.get('account') ?? '').trim();
  const accountId = isUuid(accountParam) ? accountParam.toLowerCase() : null;

  const [accountInput, setAccountInput] = useState(accountParam);
  const [selection, setSelection] = useState<PrefillSelection | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setAccountInput(accountParam);
      setSelection(null);
    });
  }, [accountParam]);

  const draft = accountInput.trim();
  const draftValid = isUuid(draft);

  return (
    <div>
      <PageHeader
        title="Metering"
        subtitle="Egress flows, managed PostgreSQL accounting and object-storage usage."
      />

      <form
        className="card mb-6 flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftValid) router.push(`/metering?account=${encodeURIComponent(draft.toLowerCase())}`);
        }}
      >
        <div className="min-w-[280px] flex-1">
          <label className="label" htmlFor="metering-account">
            Account
          </label>
          <input
            id="metering-account"
            className="field field-sm font-mono"
            value={accountInput}
            onChange={(event) => setAccountInput(event.target.value)}
            placeholder="account UUID — scopes the managed PostgreSQL and object storage tools"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draftValid}>
          <Icon name="arrowRight" size={14} />
          Open account
        </button>
        {accountId && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push('/metering')}>
            Clear
          </button>
        )}
        {draft && !draftValid && <span className="w-full text-xs text-[var(--color-danger)]">Enter an account UUID.</span>}
        {accountParam && !accountId && (
          <span role="alert" className="w-full text-xs text-[var(--color-danger)]">
            The account in the link is not a UUID: {accountParam}
          </span>
        )}
        {accountId && (
          <span className="w-full text-xs text-[var(--color-ink-muted)]">
            Working on <TenantLink accountId={accountId} />
          </span>
        )}
      </form>

      <div className="space-y-6">
        <EgressFlows key={`egress:${accountId ?? ''}`} defaultAccount={accountId} />

        {accountId ? (
          <>
            <SectionCard title="Managed PostgreSQL usage & accounting">
              <div className="p-5">
                <ManagedPostgresPanel
                  accountId={accountId}
                  onSelectDatabase={(next) => setSelection({ ...next, nonce: Date.now() })}
                />
              </div>
            </SectionCard>
            <UsageImportCard
              key={`import:${accountId}`}
              accountId={accountId}
              selection={selection?.action === 'import' ? selection : null}
            />
            <ReconciliationCard
              key={`reconcile:${accountId}`}
              accountId={accountId}
              selection={selection?.action === 'reconcile' ? selection : null}
            />
            <ObjectStorageReportCard key={`object:${accountId}`} accountId={accountId} />
          </>
        ) : (
          <div className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Open an account to see its managed PostgreSQL usage and accounting, run usage imports and reconciliations, or
            record an object storage usage report.
          </div>
        )}
      </div>
    </div>
  );
}
