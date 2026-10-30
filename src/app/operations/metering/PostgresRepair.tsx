'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  applyManagedPostgresReconciliation,
  applyManagedPostgresUsageImport,
  formatMillicents,
  MANAGED_POSTGRES_METERS,
  newRequestId,
  parseUsageImportWindows,
  previewManagedPostgresReconciliation,
  previewManagedPostgresUsageImport,
  reconciliationFieldError,
  toRfc3339Seconds,
  usageImportFieldError,
  usageImportTemplate,
  type ManagedPostgresReconciliationRequest,
  type ManagedPostgresReconciliationResult,
  type ManagedPostgresUsageImportRequest,
  type ManagedPostgresUsageImportResult,
} from '@/lib/ops/metering';
import { Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import type { ManagedPostgresSelection } from '@/components/operator/tenant/ManagedPostgresPanel';
import { formatDateTime } from '@/components/operator/tenant/shared';
import { applyError, Field, Kv, Step, usePreview } from './form';

export type PrefillSelection = ManagedPostgresSelection & { nonce: number };

/** Applies a diagnostics-row selection once per click, then scrolls the card into view. */
function usePrefill(selection: PrefillSelection | null, apply: (s: PrefillSelection) => void) {
  const applied = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selection || applied.current === selection.nonce) return;
    applied.current = selection.nonce;
    queueMicrotask(() => {
      apply(selection);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  return ref;
}

function TextArea({
  id,
  label,
  value,
  onChange,
  rows = 2,
  maxLength,
  placeholder,
  mono = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  mono?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`field field-sm ${mono ? 'font-mono text-[11px]' : ''}`}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={!mono}
      />
      {hint && <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{hint}</p>}
    </div>
  );
}

function PreviewControls({
  problem,
  busy,
  outdated,
  error,
  onPreview,
}: {
  problem: string | null;
  busy: boolean;
  outdated: boolean;
  error: string | null;
  onPreview: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!problem || busy} onClick={onPreview}>
          <Icon name="search" size={13} />
          {busy ? 'Previewing…' : 'Preview (read-only)'}
        </button>
        {problem && <span className="text-xs text-[var(--color-danger)]">{problem}</span>}
        {!problem && outdated && (
          <span className="text-xs text-[var(--color-warning-bold)]">Inputs changed since the last preview — run it again.</span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-[var(--color-danger-subtle)] p-2 text-xs text-[var(--color-danger)]">
          Preview refused: {error}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────────── Usage import ────────────────────────────── */

export function UsageImportCard({ accountId, selection }: { accountId: string; selection: PrefillSelection | null }) {
  const [importId, setImportId] = useState(() => newRequestId());
  const [databaseId, setDatabaseId] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [windowSeconds, setWindowSeconds] = useState<number | undefined>(undefined);
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceSha, setEvidenceSha] = useState('');
  const [reason, setReason] = useState('');
  const [windowsText, setWindowsText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<{ fingerprint: string; result: ManagedPostgresUsageImportResult } | null>(null);

  const ref = usePrefill(selection, (s) => {
    setDatabaseId(s.database.database_id);
    setDatabaseName(s.database.name);
    setWindowSeconds(s.windowSeconds || undefined);
    setWindowsText((current) => current.trim() ? current : JSON.stringify(usageImportTemplate(s.windowSeconds || 3600), null, 2));
  });

  const fields = {
    import_id: importId,
    database_id: databaseId.trim(),
    evidence_reference: evidenceReference,
    evidence_sha256: evidenceSha.trim(),
    reason,
  };
  const fieldProblem = usageImportFieldError(fields);
  const parsed = windowsText.trim() ? parseUsageImportWindows(windowsText, { windowSeconds }) : { error: 'Add at least one usage window.' };
  const problem = fieldProblem ?? ('error' in parsed ? parsed.error : null);
  const body: ManagedPostgresUsageImportRequest | null = !problem && 'windows' in parsed ? { ...fields, windows: parsed.windows } : null;

  const preview = usePreview(body, (b) => previewManagedPostgresUsageImport(accountId, b));
  const result = preview.result;
  const appliedHere = applied && applied.fingerprint === preview.fingerprint ? applied.result : null;

  const startOver = () => {
    setImportId(newRequestId());
    setApplied(null);
    preview.reset();
  };

  return (
    <div ref={ref}>
      <SectionCard title="Managed PostgreSQL usage import">
        <div className="space-y-5 p-5">
          <p className="text-xs text-[var(--color-ink-muted)]">
            Replaces collected usage for a database with provider-evidenced readings, for windows the collector missed. The
            preview computes the cost change without writing anything; applying rewrites billed usage.
          </p>
          <Step n={1} title="Describe the import">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <span className="label">Import ID</span>
                <div className="flex items-center gap-2">
                  <Mono className="truncate">{importId}</Mono>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={startOver} title="Mint a new import ID">
                    New ID
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">Generated here; the server deduplicates on it.</p>
              </div>
              <Field
                id="import-database"
                label="Database ID"
                value={databaseId}
                onChange={setDatabaseId}
                placeholder="pick a row above or paste a UUID"
                mono
                hint={databaseName ? `Selected: ${databaseName}` : undefined}
              />
              <Field
                id="import-evidence-ref"
                label="Evidence reference"
                value={evidenceReference}
                onChange={setEvidenceReference}
                placeholder="provider export or ticket"
                maxLength={256}
              />
              <Field
                id="import-evidence-sha"
                label="Evidence SHA-256"
                value={evidenceSha}
                onChange={setEvidenceSha}
                placeholder="64 lowercase hex characters"
                mono
              />
            </div>
            <TextArea
              id="import-reason"
              label="Reason (sent with the request, recorded with the import)"
              value={reason}
              onChange={setReason}
              maxLength={512}
              placeholder="Why this usage is being imported. Reference the ticket."
            />
            <TextArea
              id="import-windows"
              label={`Usage windows (JSON)${windowSeconds ? ` · each exactly ${windowSeconds}s, contiguous` : ''}`}
              value={windowsText}
              onChange={setWindowsText}
              rows={8}
              mono
              placeholder='[{"from":"…Z","to":"…Z","observed_at":"…Z","readings":[{"meter":"compute_unit_seconds","quantity":0}]}]'
              hint={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    Meters: {MANAGED_POSTGRES_METERS.join(', ')}. List every meter the database&apos;s backend reports, once per
                    window. Up to 256 windows.
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setWindowsText(JSON.stringify(usageImportTemplate(windowSeconds ?? 3600), null, 2))}
                  >
                    Insert template
                  </button>
                </span>
              }
            />
          </Step>

          <Step n={2} title="Preview the change">
            <PreviewControls
              problem={problem}
              busy={preview.busy}
              outdated={preview.outdated}
              error={preview.error}
              onPreview={() => void preview.runPreview()}
            />
            {result && <ImportResultView result={result} />}
          </Step>

          <Step n={3} title="Apply">
            {appliedHere ? (
              <div className="space-y-2 rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs">
                <div className="font-semibold">Import applied.</div>
                <ImportResultView result={appliedHere} />
                <button type="button" className="btn btn-secondary btn-xs" onClick={startOver}>
                  Start another import
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-danger btn-sm" disabled={!result} onClick={() => setConfirming(true)}>
                  Apply import…
                </button>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {result ? 'Applies exactly the previewed request.' : 'Run a preview of the current inputs first.'}
                </span>
              </div>
            )}
          </Step>
        </div>
      </SectionCard>

      {confirming && result && body && (
        <OperatorActionDialog
          open
          title="Apply usage import"
          tone="danger"
          reason="none"
          confirmText={body.database_id}
          submitLabel="Apply import"
          fingerprint={`${preview.fingerprint}|${result.revision}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Rewrites billed managed-PostgreSQL usage of database <Mono>{body.database_id}</Mono> for account{' '}
                <Mono>{accountId}</Mono>: {result.window_count} window(s), {formatDateTime(result.collected_from)} →{' '}
                {formatDateTime(result.collected_until)}.
              </p>
              <p>
                Cost {formatMillicents(result.previous_cost_millicents)} → {formatMillicents(result.imported_cost_millicents)}{' '}
                (change <strong>{signed(result.cost_delta_millicents)}</strong>, billing currency). This changes what the
                customer is charged and cannot be undone from the console.
              </p>
              <p className="text-[var(--color-ink-muted)]">Recorded reason: “{body.reason}”</p>
            </div>
          }
          onSubmit={async ({ idempotencyKey }) => {
            try {
              const res = await applyManagedPostgresUsageImport(accountId, body, result.revision, { idempotencyKey });
              if (preview.fingerprint) setApplied({ fingerprint: preview.fingerprint, result: res });
              return `Usage import applied: cost change ${signed(res.cost_delta_millicents)}.`;
            } catch (err) {
              throw applyError(err, 'The usage ledger changed after the preview, or this import ID was used for a different request. Run the preview again');
            }
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

const signed = (millicents: number) => `${millicents > 0 ? '+' : ''}${formatMillicents(millicents)}`;

function ImportResultView({ result }: { result: ManagedPostgresUsageImportResult }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-3 sm:grid-cols-4">
      <Kv label="Windows" value={result.window_count} />
      <Kv label="Collected from" value={formatDateTime(result.collected_from)} />
      <Kv label="Collected until" value={formatDateTime(result.collected_until)} />
      <Kv label="Observed" value={formatDateTime(result.observed_at)} />
      <Kv label="Previous cost" value={formatMillicents(result.previous_cost_millicents)} />
      <Kv label="Imported cost" value={formatMillicents(result.imported_cost_millicents)} />
      <Kv
        label="Cost change"
        value={signed(result.cost_delta_millicents)}
        tone={result.cost_delta_millicents > 0 ? 'danger' : result.cost_delta_millicents < 0 ? 'success' : undefined}
      />
      <Kv label={result.applied ? 'Applied revision' : 'Preview revision'} value={<span title={result.revision}>{result.revision.slice(0, 12)}…</span>} />
    </div>
  );
}

/* ──────────────────────────── Reconciliation ───────────────────────────── */

export function ReconciliationCard({ accountId, selection }: { accountId: string; selection: PrefillSelection | null }) {
  const [reconciliationId, setReconciliationId] = useState(() => newRequestId());
  const [databaseId, setDatabaseId] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [backendId, setBackendId] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [providerResourceId, setProviderResourceId] = useState('');
  const [shutdownAt, setShutdownAt] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceSha, setEvidenceSha] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<{ fingerprint: string; result: ManagedPostgresReconciliationResult } | null>(null);

  const ref = usePrefill(selection, (s) => {
    setDatabaseId(s.database.database_id);
    setDatabaseName(s.database.name);
  });

  const candidate: ManagedPostgresReconciliationRequest = {
    reconciliation_id: reconciliationId,
    database_id: databaseId.trim(),
    backend_id: backendId,
    backend_fingerprint: fingerprint.trim(),
    provider_resource_id: providerResourceId,
    shutdown_at: shutdownAt.trim(),
    observed_at: observedAt.trim(),
    evidence_reference: evidenceReference,
    evidence_sha256: evidenceSha.trim(),
    reason,
  };
  const problem = reconciliationFieldError(candidate);
  const body = problem ? null : candidate;

  const preview = usePreview(body, (b) => previewManagedPostgresReconciliation(accountId, b));
  const result = preview.result;
  const appliedHere = applied && applied.fingerprint === preview.fingerprint ? applied.result : null;

  const startOver = () => {
    setReconciliationId(newRequestId());
    setApplied(null);
    preview.reset();
  };

  return (
    <div ref={ref}>
      <SectionCard title="Managed PostgreSQL accounting reconciliation">
        <div className="space-y-5 p-5">
          <p className="text-xs text-[var(--color-ink-muted)]">
            For a deleted database whose provider identity was never recorded (&ldquo;legacy identity unknown&rdquo;): attest
            the provider resource and its actual shutdown from evidence, never from a failed provider lookup. Applying fixes
            the database&apos;s accounting end and clears its collected-usage progress, so its usage must be imported again.
          </p>
          <Step n={1} title="Describe the evidence">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <span className="label">Reconciliation ID</span>
                <div className="flex items-center gap-2">
                  <Mono className="truncate">{reconciliationId}</Mono>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={startOver} title="Mint a new reconciliation ID">
                    New ID
                  </button>
                </div>
              </div>
              <Field
                id="reconcile-database"
                label="Database ID"
                value={databaseId}
                onChange={setDatabaseId}
                placeholder="pick a row above or paste a UUID"
                mono
                hint={databaseName ? `Selected: ${databaseName}` : undefined}
              />
              <Field id="reconcile-backend" label="Backend ID" value={backendId} onChange={setBackendId} mono maxLength={128} />
              <Field
                id="reconcile-fingerprint"
                label="Backend fingerprint"
                value={fingerprint}
                onChange={setFingerprint}
                placeholder="64 lowercase hex characters"
                mono
              />
              <div className="sm:col-span-2">
                <Field
                  id="reconcile-resource"
                  label="Provider resource ID"
                  value={providerResourceId}
                  onChange={setProviderResourceId}
                  mono
                  maxLength={1024}
                />
              </div>
              <Field
                id="reconcile-shutdown"
                label="Shutdown at (RFC 3339)"
                value={shutdownAt}
                onChange={setShutdownAt}
                placeholder="2026-10-20T08:00:00Z"
                mono
              />
              <div className="min-w-0">
                <Field
                  id="reconcile-observed"
                  label="Observed at (RFC 3339)"
                  value={observedAt}
                  onChange={setObservedAt}
                  placeholder="when the shutdown was verified"
                  mono
                />
                <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={() => setObservedAt(toRfc3339Seconds(new Date()))}>
                  Use current time
                </button>
              </div>
              <Field
                id="reconcile-evidence-ref"
                label="Evidence reference"
                value={evidenceReference}
                onChange={setEvidenceReference}
                placeholder="provider ticket or audit export"
                maxLength={256}
              />
              <Field
                id="reconcile-evidence-sha"
                label="Evidence SHA-256"
                value={evidenceSha}
                onChange={setEvidenceSha}
                placeholder="64 lowercase hex characters"
                mono
              />
            </div>
            <TextArea
              id="reconcile-reason"
              label="Reason (sent with the request, recorded with the reconciliation)"
              value={reason}
              onChange={setReason}
              maxLength={512}
              placeholder="Why the ledger needs this correction. Reference the ticket."
            />
          </Step>

          <Step n={2} title="Preview the change">
            <PreviewControls
              problem={problem}
              busy={preview.busy}
              outdated={preview.outdated}
              error={preview.error}
              onPreview={() => void preview.runPreview()}
            />
            {result && <ReconciliationResultView result={result} />}
          </Step>

          <Step n={3} title="Apply">
            {appliedHere ? (
              <div className="space-y-2 rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs">
                <div className="font-semibold">Reconciliation applied.</div>
                <ReconciliationResultView result={appliedHere} />
                {appliedHere.requires_usage_recovery && (
                  <p className="text-[var(--color-warning-bold)]">
                    Usage for this database must now be recovered with a usage import.
                  </p>
                )}
                <button type="button" className="btn btn-secondary btn-xs" onClick={startOver}>
                  Start another reconciliation
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-danger btn-sm" disabled={!result} onClick={() => setConfirming(true)}>
                  Apply reconciliation…
                </button>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {result ? 'Applies exactly the previewed request.' : 'Run a preview of the current inputs first.'}
                </span>
              </div>
            )}
          </Step>
        </div>
      </SectionCard>

      {confirming && result && body && (
        <OperatorActionDialog
          open
          title="Apply accounting reconciliation"
          tone="danger"
          reason="none"
          confirmText={body.database_id}
          submitLabel="Apply reconciliation"
          fingerprint={`${preview.fingerprint}|${result.revision}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Records that database <Mono>{body.database_id}</Mono> of account <Mono>{accountId}</Mono> was shut down at
                the provider at <strong>{formatDateTime(result.shutdown_at)}</strong> (resource{' '}
                <Mono>{body.provider_resource_id}</Mono>).
              </p>
              <p>
                Its accounting end changes from {result.previous_deleted_at ? formatDateTime(result.previous_deleted_at) : 'unset'} to
                the shutdown time, which changes the period it is billed for, and its collected-usage progress is cleared.
                {result.requires_usage_recovery ? ' Its usage must then be re-imported.' : ''} This cannot be undone from the
                console.
              </p>
              <p className="text-[var(--color-ink-muted)]">Recorded reason: “{body.reason}”</p>
            </div>
          }
          onSubmit={async ({ idempotencyKey }) => {
            try {
              const res = await applyManagedPostgresReconciliation(accountId, body, result.revision, { idempotencyKey });
              if (preview.fingerprint) setApplied({ fingerprint: preview.fingerprint, result: res });
              return 'Accounting reconciliation applied.';
            } catch (err) {
              throw applyError(err, 'The database or its ledger changed after the preview, or this reconciliation ID was used for a different request. Run the preview again');
            }
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function ReconciliationResultView({ result }: { result: ManagedPostgresReconciliationResult }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-3 sm:grid-cols-4">
      <Kv label="Previous accounting end" value={result.previous_deleted_at ? formatDateTime(result.previous_deleted_at) : 'unset'} />
      <Kv label="New accounting end (shutdown)" value={formatDateTime(result.shutdown_at)} />
      <Kv label="Observed" value={formatDateTime(result.observed_at)} />
      <Kv label="Shared accounting" value={result.shared_accounting ? 'yes (restore of a source database)' : 'no'} />
      <Kv label="Needs usage import" value={result.requires_usage_recovery ? 'yes' : 'no'} tone={result.requires_usage_recovery ? 'danger' : undefined} />
      <Kv label={result.applied ? 'Applied revision' : 'Preview revision'} value={<span title={result.revision}>{result.revision.slice(0, 12)}…</span>} />
    </div>
  );
}
