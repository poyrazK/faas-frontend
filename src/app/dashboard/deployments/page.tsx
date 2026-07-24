'use client';

import React from 'react';
import { listDeployments } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { relativeTime } from '@/lib/format';

export default function DeploymentsPage() {
  const deps = useAsync(listDeployments, []);

  return (
    <div>
      <PageHeader title="Deployments" subtitle="Build and deploy history across all your apps." />
      <div className="card overflow-hidden">
        <AsyncBoundary
          state={deps}
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState icon="📦" title="No deployments yet" hint="Push to a connected repo or deploy via the CLI to see builds here." />}
          skeleton={<SkeletonTable cols={4} rows={4} />}
        >
          {(d) => (
            <table className="dtable">
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>Image digest</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((dep) => (
                  <tr key={dep.id}>
                    <td><Mono>{dep.id.slice(0, 12)}</Mono></td>
                    <td className="mono text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                      {dep.image_digest ? dep.image_digest.slice(0, 24) + '…' : '—'}
                    </td>
                    <td>
                      <StatusBadge state={dep.status} />
                      {dep.error && <span className="ml-2 text-xs" style={{ color: 'var(--color-danger)' }}>{dep.error}</span>}
                    </td>
                    <td>{relativeTime(dep.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}
