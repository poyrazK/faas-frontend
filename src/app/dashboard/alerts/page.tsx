'use client';

/* ==========================================================================
   Alerts — no alert-rule endpoint exists, so the template's rule list can't
   be built. What *is* real is the audit trail, so rather than an empty shell
   this page shows the security events the account has actually recorded.
   ========================================================================== */

import React from 'react';
import { listAuditEvents } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, Unavailable } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { relativeTime } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'key.created': 'API key created',
  'key.deleted': 'API key revoked',
  'secret.set': 'Secret set',
  'secret.deleted': 'Secret deleted',
  'account.plan_changed': 'Plan changed',
  'account.deletion_scheduled': 'Account deletion staged',
  'account.deletion_restored': 'Account restored',
};

export default function AlertsPage() {
  const events = useAsync(() => listAuditEvents(50), []);

  return (
    <div>
      <PageHeader title="Alerts" subtitle="Notifications and account activity." />

      <Unavailable
        icon="alerts"
        title="Alert rules can't be configured yet"
        what="There's no endpoint for creating threshold or error-rate alerts, so nothing here can page you. Watch error rate on Metrics, and use the account activity below to see security-relevant changes."
        endpoint="alert rule"
        alternative={{ href: '/dashboard/metrics', label: 'Go to Metrics' }}
      />

      <SectionCard className="mt-4" title="Account activity">
        <AsyncBoundary
          state={events}
          isEmpty={(d) => d.events.length === 0}
          skeleton={<SkeletonTable cols={3} rows={4} />}
          empty={<EmptyState icon="bell" title="No activity recorded" hint="Sign-ins, key mints and secret changes appear here." />}
        >
          {(d) => (
            <table className="dtable">
              <thead>
                <tr><th>Event</th><th>Actor</th><th>When</th></tr>
              </thead>
              <tbody>
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-primary">{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td>{e.actor}</td>
                    <td>{relativeTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
