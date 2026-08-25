'use client';

import React, { useState } from 'react';
import { getObsAnomalies, type ObsAnomalyRow } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function AnomaliesPage() {
  const [windowHours, setWindowHours] = useState('24');
  const { data, loading, error, reload } = useAsync(
    () => getObsAnomalies(parseInt(windowHours, 10)),
    [windowHours],
  );

  return (
    <div>
      <PageHeader
        title="Usage Anomaly Detection"
        subtitle="Statistical Z-score anomaly detector scoring tenant usage against 7-day rolling baselines (ADR-091 §3.6)"
        actions={
          <div className="flex items-center gap-3">
            <FilterSelect
              value={windowHours}
              onChange={setWindowHours}
              options={[
                { value: '12', label: '12 Hours Window' },
                { value: '24', label: '24 Hours Window' },
                { value: '48', label: '48 Hours Window' },
                { value: '72', label: '72 Hours Window' },
              ]}
            />
            <button onClick={reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Re-evaluate
            </button>
          </div>
        }
      />

      <SectionCard>
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Analyzing baseline anomalies…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Operator access required to view anomalies.'}
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Zero usage anomalies detected across all tenants in the selected {windowHours}h window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Account ID / App ID</th>
                  <th className="px-4 py-3">Minute Timestamp</th>
                  <th className="px-4 py-3">Observed MB-s</th>
                  <th className="px-4 py-3">Baseline Mean ± Stddev</th>
                  <th className="px-4 py-3">Samples</th>
                  <th className="px-4 py-3">Z-Score</th>
                  <th className="px-4 py-3">Detector Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.items.map((row: ObsAnomalyRow, idx: number) => {
                  const z = row.z_score !== null ? row.z_score : 0;
                  const isHighSeverity = z > 3.5;

                  return (
                    <tr key={idx} className="hover:bg-[var(--color-surface-subtle)]">
                      <td className="px-4 py-3 font-mono">
                        <div>
                          <Mono>{row.account_id.slice(0, 13)}…</Mono>
                        </div>
                        <div className="text-[11px] text-[var(--color-ink-muted)]">
                          app: <Mono>{row.app_id.slice(0, 13)}…</Mono>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <div>{new Date(row.minute).toLocaleTimeString()}</div>
                        <div className="text-[11px] text-[var(--color-ink-muted)]">
                          {relativeTime(row.minute)}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[var(--color-danger)]">
                        {row.current.toLocaleString()} MB-s
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                        {row.baseline_mean.toFixed(1)} ± {row.baseline_stddev.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 font-mono">{row.baseline_samples}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${
                            isHighSeverity ? 'badge-danger' : 'badge-warning'
                          } font-mono`}
                        >
                          Z = {row.z_score !== null ? row.z_score.toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <span className="badge badge-neutral">{row.reason}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
