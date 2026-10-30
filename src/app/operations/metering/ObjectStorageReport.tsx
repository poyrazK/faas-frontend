'use client';

import React, { useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  formatMillicents,
  objectStoragePeriodStart,
  objectStorageReportError,
  parseCount,
  recordObjectStorageUsageReport,
  toRfc3339Seconds,
  type ObjectStorageUsageReport,
} from '@/lib/ops/metering';
import { formatBytes } from '@/lib/operator';
import { Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { formatDateTime } from '@/components/operator/tenant/shared';
import { Field, Kv, Step } from './form';

/**
 * POST /v1/admin/object-storage/usage-reports has no server preview, so the
 * card shows the exact body for review and binds the confirmation to it.
 */
export function ObjectStorageReportCard({ accountId }: { accountId: string }) {
  const [backendId, setBackendId] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [source, setSource] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [storedByteHours, setStoredByteHours] = useState('');
  const [requestCount, setRequestCount] = useState('');
  const [egressBytes, setEgressBytes] = useState('');
  const [costMillicents, setCostMillicents] = useState('');
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);

  const counts = [storedByteHours, requestCount, egressBytes, costMillicents].map(parseCount);
  const periodStart = objectStoragePeriodStart(observedAt.trim());
  const report: ObjectStorageUsageReport | null =
    counts.every((n) => n !== null) && periodStart
      ? {
          account_id: accountId,
          backend_id: backendId.trim(),
          backend_fingerprint: fingerprint.trim(),
          source: source.trim(),
          period_start: periodStart,
          observed_at: observedAt.trim(),
          stored_byte_hours: counts[0]!,
          request_count: counts[1]!,
          egress_bytes: counts[2]!,
          cost_millicents: counts[3]!,
        }
      : null;
  const problem = !periodStart
    ? 'Observed time must be RFC 3339.'
    : !report
      ? 'Every counter is required; enter 0 for a measured zero (whole numbers only).'
      : objectStorageReportError(report);
  const body = problem || !report ? null : JSON.stringify(report);
  const reviewedNow = body !== null && reviewed === body;

  return (
    <SectionCard title="Object storage usage report">
      <div className="space-y-5 p-5">
        <p className="text-xs text-[var(--color-ink-muted)]">
          Records an authoritative cumulative month-to-date report from a provider adapter for this account on one storage
          backend. Counters must be actual provider traffic. Reports for a backend and month may only move forward: a later
          report must not lower any counter, so an over-count cannot be corrected this month.
        </p>
        <Step n={1} title="Enter the report">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="os-backend" label="Backend ID" value={backendId} onChange={(v) => setBackendId(v)} mono maxLength={63} />
            <div className="lg:col-span-2">
              <Field
                id="os-fingerprint"
                label="Backend fingerprint"
                value={fingerprint}
                onChange={setFingerprint}
                placeholder="64 hex characters"
                mono
              />
            </div>
            <Field id="os-source" label="Source" value={source} onChange={setSource} placeholder="e.g. provider billing export" maxLength={128} />
            <div className="min-w-0 lg:col-span-2">
              <Field
                id="os-observed"
                label="Observed at (RFC 3339)"
                value={observedAt}
                onChange={setObservedAt}
                placeholder="2026-10-30T11:00:00Z"
                mono
                hint={periodStart ? `Month: period_start ${periodStart}` : 'period_start is derived from this (UTC month).'}
              />
              <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={() => setObservedAt(toRfc3339Seconds(new Date()))}>
                Use current time
              </button>
            </div>
            <div className="hidden lg:block lg:col-span-2" />
            <Field id="os-stored" label="Stored byte-hours" value={storedByteHours} onChange={setStoredByteHours} mono inputMode="numeric" />
            <Field id="os-requests" label="Request count" value={requestCount} onChange={setRequestCount} mono inputMode="numeric" />
            <Field id="os-egress" label="Egress bytes" value={egressBytes} onChange={setEgressBytes} mono inputMode="numeric" />
            <Field
              id="os-cost"
              label="Provider cost (millicents)"
              value={costMillicents}
              onChange={setCostMillicents}
              mono
              inputMode="numeric"
              hint={counts[3] !== null ? `${formatMillicents(counts[3]!)} in major units` : undefined}
            />
          </div>
        </Step>

        <Step n={2} title="Review the exact report">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!body} onClick={() => setReviewed(body)}>
              Review report
            </button>
            {problem && <span className="text-xs text-[var(--color-danger)]">{problem}</span>}
            {!problem && reviewed !== null && !reviewedNow && (
              <span className="text-xs text-[var(--color-warning-bold)]">Inputs changed since the review — review again.</span>
            )}
          </div>
          {reviewedNow && report && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-3 sm:grid-cols-4">
                <Kv label="Month" value={new Date(report.period_start).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} />
                <Kv label="Observed" value={formatDateTime(report.observed_at)} />
                <Kv label="Stored" value={`${report.stored_byte_hours.toLocaleString()} byte-h`} />
                <Kv label="Requests" value={report.request_count.toLocaleString()} />
                <Kv label="Egress" value={formatBytes(report.egress_bytes)} />
                <Kv label="Provider cost" value={formatMillicents(report.cost_millicents)} />
                <Kv label="Backend" value={report.backend_id} />
                <Kv label="Source" value={report.source} />
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-[var(--color-surface-subtle)] p-2 font-mono text-[11px]">
                {JSON.stringify(report, null, 2)}
              </pre>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                This endpoint has no server-side preview; the body above is what will be sent.
              </p>
            </div>
          )}
        </Step>

        <Step n={3} title="Record">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-danger btn-sm" disabled={!reviewedNow} onClick={() => setConfirming(true)}>
              Record report…
            </button>
            {recorded && recorded === body ? (
              <span className="badge badge-success">Recorded</span>
            ) : (
              <span className="text-xs text-[var(--color-ink-muted)]">
                {reviewedNow ? 'Records exactly the reviewed report.' : 'Review the current inputs first.'}
              </span>
            )}
          </div>
        </Step>
      </div>

      {confirming && reviewedNow && report && body && (
        <OperatorActionDialog
          open
          title="Record object storage usage report"
          tone="danger"
          reason="none"
          confirmText={accountId}
          submitLabel="Record report"
          fingerprint={body}
          impact={
            <div className="space-y-1.5">
              <p>
                Appends an authoritative cumulative usage report for account <Mono>{accountId}</Mono> on backend{' '}
                <Mono>{report.backend_id}</Mono> for the month starting {report.period_start.slice(0, 10)}. These counters
                become the account&apos;s object-storage usage for the month and can feed its charges.
              </p>
              <p>
                Later reports for this backend and month must not go backwards, so an over-count cannot be corrected
                downwards. The write is audited as object_storage.usage_reported.
              </p>
            </div>
          }
          onSubmit={async ({ idempotencyKey }) => {
            try {
              await recordObjectStorageUsageReport(report, { idempotencyKey });
            } catch (err) {
              if (err instanceof ApiError && err.status === 409) {
                throw new Error(
                  `Refused: the report failed validation, a report with this observation time already exists with different values, or a counter would go backwards (${err.message}).`,
                );
              }
              if (err instanceof ApiError && err.status === 404) {
                throw new Error(`Refused: the backend is unknown or this account has no bucket on it (${err.message}).`);
              }
              throw err;
            }
            setRecorded(body);
            return 'Object storage usage report recorded.';
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </SectionCard>
  );
}
