'use client';

import React from 'react';
import type { AsyncState } from '@/lib/useAsync';
import { healthMetric, humanize, type ObsHealthDetail, type ObsHealthMetricKey } from '@/lib/ops/telemetry';
import { SectionCard } from '@/components/ui/Panels';
import { ErrorRow, LoadingRow, RefreshFailed, StateBadge, When } from '../incidents/parts';

const SIGNAL_LABELS: Record<ObsHealthMetricKey, string> = {
  audit_log_write_total_5m: 'Audit writes (5m)',
  audit_log_write_failures_5m: 'Audit write failures (5m)',
  alerts_firing: 'Firing alerts',
};

function MetricTile({ health, metric }: { health: ObsHealthDetail; metric: ObsHealthMetricKey }) {
  const result = healthMetric(health, metric);
  const bad = result.value != null && result.value > 0 && metric !== 'audit_log_write_total_5m';
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs">
      <div className="text-[var(--color-ink-muted)]">{SIGNAL_LABELS[metric]}</div>
      <div className={`mt-1 font-semibold ${bad ? 'text-[var(--color-danger)]' : ''}`}>
        {result.value == null ? 'Unavailable' : result.value.toLocaleString()}
      </div>
      <div className="text-[var(--color-ink-muted)]">
        {result.value == null ? result.reason : result.signal?.observed_at ? <>observed <When at={result.signal.observed_at} /></> : 'Prometheus'}
      </div>
    </div>
  );
}

/**
 * /v1/admin/obs/health: is the observability stack itself recording? Numbers
 * derived from Prometheus are shown only when their signal is healthy.
 */
export function PipelineHealth({ health }: { health: AsyncState<ObsHealthDetail> }) {
  const data = health.data;
  const missingOutcomes = Object.entries(data?.operator_intent_outcome_missing_total ?? {});
  const traceRatios = Object.entries(data?.trace_id_completeness_ratio ?? {});
  const unhealthySignals = Object.values(data?.signals ?? {}).some((signal) => signal.state !== 'healthy');
  const unavailable = !data || data.prometheus_available !== true || unhealthySignals;
  const firing = data ? healthMetric(data, 'alerts_firing').value : null;
  const failures = data ? healthMetric(data, 'audit_log_write_failures_5m').value : null;
  // A missing or non-numeric ratio is unknown, not 0% (and never "NaN%").
  const coverage = data && Number.isFinite(data.audit_log_coverage_ratio_5m) ? data.audit_log_coverage_ratio_5m : null;
  const degraded =
    !!data &&
    ((firing ?? 0) > 0 ||
      (failures ?? 0) > 0 ||
      (coverage !== null && coverage < 1) ||
      missingOutcomes.some(([, count]) => count > 0) ||
      traceRatios.some(([, ratio]) => ratio < 1));

  return (
    <SectionCard
      title="Observability pipeline health"
      action={
        <span className={`badge ${!data ? 'badge-neutral' : unavailable ? 'badge-danger' : degraded ? 'badge-warning' : 'badge-success'}`}>
          {!data ? (health.error ? 'Unknown' : 'Loading…') : unavailable ? 'Telemetry unavailable' : degraded ? 'Degraded' : 'Reporting'}
        </span>
      }
    >
      {health.error && !data ? (
        <ErrorRow message={`Could not load observability health: ${health.error.message}`} />
      ) : health.loading && !data ? (
        <LoadingRow label="Checking audit and trace health" />
      ) : data ? (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile health={data} metric="audit_log_write_total_5m" />
            <MetricTile health={data} metric="audit_log_write_failures_5m" />
            <MetricTile health={data} metric="alerts_firing" />
            <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs">
              <div className="text-[var(--color-ink-muted)]">Audit trace coverage (5m)</div>
              <div className={`mt-1 font-semibold ${coverage !== null && coverage < 1 ? 'text-[var(--color-warning-bold)]' : ''}`}>
                {coverage === null ? 'Unknown' : `${(coverage * 100).toFixed(1)}%`}
              </div>
              <div className="text-[var(--color-ink-muted)]">
                snapshot <When at={data.generated_at} />
              </div>
            </div>
          </div>

          {(data.alert_history || data.alert_retention) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              {data.alert_history && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-ink-muted)]">Alert collection</span>
                  <StateBadge state={data.alert_history.collection_state ?? data.alert_history.state} reason={data.alert_history.reason} />
                  <span className="text-[var(--color-ink-muted)]">
                    last success <When at={data.alert_history.last_success_at} />
                  </span>
                </div>
              )}
              {data.alert_retention && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-ink-muted)]">Alert retention</span>
                  <StateBadge state={data.alert_retention.state} reason={data.alert_retention.reason} />
                  <span className="text-[var(--color-ink-muted)]">{data.alert_retention.expired_episodes} expired episode(s) pending</span>
                </div>
              )}
            </div>
          )}

          {data.signals && Object.keys(data.signals).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(data.signals).map(([key, signal]) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-[var(--color-ink-muted)]">{key}</span>
                  <StateBadge state={signal.state} reason={signal.reason} />
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-4 text-xs lg:grid-cols-2">
            <div>
              <div className="mb-2 font-semibold">Operator intents without an outcome</div>
              {missingOutcomes.length === 0 ? (
                <div className="text-[var(--color-ink-muted)]">No intent kinds reported.</div>
              ) : (
                <div className="space-y-1">
                  {missingOutcomes.map(([kind, count]) => (
                    <div key={kind} className="flex items-center justify-between">
                      <span className="font-mono">{kind}</span>
                      <span className={`badge ${count > 0 ? 'badge-danger' : 'badge-success'}`}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 font-semibold">Trace completeness by action kind</div>
              {traceRatios.length === 0 ? (
                <div className="text-[var(--color-ink-muted)]">No operator action kinds reported.</div>
              ) : (
                <div className="space-y-1">
                  {traceRatios.map(([kind, ratio]) => (
                    <div key={kind} className="flex items-center justify-between">
                      <span className="font-mono">{humanize(kind)}</span>
                      <span className={`badge ${ratio < 1 ? 'badge-warning' : 'badge-success'}`}>{(ratio * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {health.error && data && <RefreshFailed error={health.error} />}
    </SectionCard>
  );
}
