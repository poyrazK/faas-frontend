'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getGithubRecovery,
  GITHUB_REASON_SUGGESTIONS,
  GITHUB_RECOVERY_STATUSES,
  githubStatusTone,
  isGithubRetryable,
  retryGithubCheckUpdate,
  retryGithubDelivery,
  type GithubCheckUpdateRecord,
  type GithubRecoveryStatus,
  type GithubWebhookDeliveryRecord,
} from '@/lib/ops/github';
import { useAsync } from '@/lib/useAsync';
import { isRealTimestamp } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { FilterSelect, Mono, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { EntityId } from '@/components/operator/EntityId';

const POLL_MS = 30000;
const LIMITS = ['100', '250', '500'];

const short = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

type RetryTarget =
  | { kind: 'delivery'; record: GithubWebhookDeliveryRecord }
  | { kind: 'check_update'; record: GithubCheckUpdateRecord };

type StatusFilter = GithubRecoveryStatus | 'all';

const parseStatus = (raw: string | null): StatusFilter | null =>
  raw === 'all' || (GITHUB_RECOVERY_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as StatusFilter) : null;

export default function GithubRecoveryPage() {
  return (
    <Suspense>
      <GithubRecovery />
    </Suspense>
  );
}

function GithubRecovery() {
  const params = useSearchParams();
  const statusParam = parseStatus(params.get('status'));
  const [status, setStatus] = useState<StatusFilter>(statusParam ?? 'dead');
  const [limit, setLimit] = useState('100');
  const [target, setTarget] = useState<RetryTarget | null>(null);

  useEffect(() => {
    if (statusParam) queueMicrotask(() => setStatus(statusParam));
  }, [statusParam]);

  // Responses are tagged with their filter so a slow "all" never renders under "dead".
  const key = `${status}|${limit}`;
  const query = useAsync(
    async () => ({
      key,
      data: await getGithubRecovery({ status: status === 'all' ? '' : status, limit: Number(limit) }),
    }),
    [key],
    POLL_MS,
  );
  const data = query.data && query.data.key === key ? query.data.data : null;
  const limitN = Number(limit);

  // Dead counts are only meaningful when the list was fetched including dead items.
  const deadCounted = status === 'dead' || status === 'all';
  const deadDeliveries = data?.deliveries.filter((d) => d.status === 'dead').length;
  const deadChecks = data?.check_updates.filter((c) => c.status === 'dead').length;
  const tile = (n: number | undefined) =>
    n != null ? (n >= limitN ? `${n}+` : n) : query.error && !query.loading ? '—' : '…';
  const scopeLabel = query.error && !data ? 'Unavailable' : status === 'all' ? 'All statuses' : `Status: ${status}`;

  return (
    <div>
      <PageHeader
        title="GitHub recovery"
        subtitle="Requeue dead webhook deliveries and Check Run updates once the cause is fixed."
        actions={
          <button onClick={query.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <SnapshotFreshness snapshots={[query]} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          value={status}
          onChange={(value) => setStatus(value as StatusFilter)}
          options={[
            { value: 'dead', label: 'Dead (retryable)' },
            { value: 'pending', label: 'Pending' },
            { value: 'processing', label: 'Processing' },
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'all', label: 'All statuses' },
          ]}
        />
        <FilterSelect
          value={limit}
          onChange={setLimit}
          options={LIMITS.map((value) => ({ value, label: `Newest ${value} per queue` }))}
        />
        <span className="text-xs text-[var(--color-ink-muted)]">
          Fleet-wide: deliveries carry no customer, and check updates are keyed by deployment (open one to see its
          account).
        </span>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Webhook deliveries shown" value={tile(data?.deliveries.length)} sub={scopeLabel} />
        <StatTile
          label="Dead deliveries"
          value={deadCounted ? tile(deadDeliveries) : '—'}
          sub={deadCounted ? 'Retryable from this page' : 'Not loaded under this filter'}
        />
        <StatTile label="Check updates shown" value={tile(data?.check_updates.length)} sub={scopeLabel} />
        <StatTile
          label="Dead check updates"
          value={deadCounted ? tile(deadChecks) : '—'}
          sub={deadCounted ? 'Retryable from this page' : 'Not loaded under this filter'}
        />
      </div>

      {!data && query.error && !query.loading ? (
        <div role="alert" className="card p-8 text-center text-sm text-[var(--color-danger)]">
          Could not load the GitHub recovery queues: {query.error.message}
        </div>
      ) : (
        <div className="space-y-6">
          <SectionCard
            title={
              <h2 className="card-title">
                Webhook deliveries
                {data && data.deliveries.length >= limitN && <LimitReached />}
              </h2>
            }
          >
            {!data ? (
              <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">Loading deliveries…</div>
            ) : data.deliveries.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
                No {status === 'all' ? '' : `${status} `}webhook deliveries.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Delivery</th>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Last error</th>
                      <th>Received</th>
                      <th>Next attempt / processed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.delivery_id}>
                        <td>
                          <EntityId id={d.delivery_id} />
                        </td>
                        <td className="cell-primary">{d.event_type}</td>
                        <td>
                          <span className={`badge ${githubStatusTone(d.status)}`}>{d.status}</span>
                        </td>
                        <td className="font-mono">{d.attempts}</td>
                        <td className="max-w-[320px]">
                          {d.last_error ? (
                            <div className="truncate text-[var(--color-danger)]" title={d.last_error}>
                              {d.last_error}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td title={d.received_at}>{relativeTime(d.received_at)}</td>
                        <td title={d.processed_at ?? d.next_attempt_at}>
                          {describeSchedule(d.status, d.next_attempt_at, d.processed_at)}
                        </td>
                        <td className="text-right">
                          {isGithubRetryable(d.status) && (
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => setTarget({ kind: 'delivery', record: d })}
                            >
                              Retry…
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={
              <h2 className="card-title">
                Check Run updates
                {data && data.check_updates.length >= limitN && <LimitReached />}
              </h2>
            }
          >
            {!data ? (
              <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">Loading check updates…</div>
            ) : data.check_updates.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
                No {status === 'all' ? '' : `${status} `}Check Run updates.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Deployment</th>
                      <th>Generation</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Last error</th>
                      <th>Updated</th>
                      <th>Next attempt / processed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.check_updates.map((c) => (
                      <tr key={c.deployment_id}>
                        <td>
                          <EntityId id={c.deployment_id} kind="deployment" />
                        </td>
                        <td className="font-mono">{c.generation}</td>
                        <td>
                          <span className={`badge ${githubStatusTone(c.status)}`}>{c.status}</span>
                        </td>
                        <td className="font-mono">{c.attempts}</td>
                        <td className="max-w-[320px]">
                          {c.last_error ? (
                            <div className="truncate text-[var(--color-danger)]" title={c.last_error}>
                              {c.last_error}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td title={c.updated_at}>{relativeTime(c.updated_at)}</td>
                        <td title={c.processed_at ?? c.next_attempt_at}>
                          {describeSchedule(c.status, c.next_attempt_at, c.processed_at)}
                        </td>
                        <td className="text-right">
                          {isGithubRetryable(c.status) && (
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => setTarget({ kind: 'check_update', record: c })}
                            >
                              Retry…
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {query.error && data && (
            <div role="alert" className="text-xs text-[var(--color-danger)]">
              Refresh failed: {query.error.message}. Showing the last successful snapshot.
            </div>
          )}
        </div>
      )}

      {target && (
        <OperatorActionDialog
          open
          title={target.kind === 'delivery' ? 'Retry webhook delivery' : 'Retry Check Run update'}
          tone="warning"
          reason="code"
          reasonSuggestions={GITHUB_REASON_SUGGESTIONS}
          submitLabel="Requeue"
          fingerprint={
            target.kind === 'delivery'
              ? `delivery|${target.record.delivery_id}`
              : `check_update|${target.record.deployment_id}`
          }
          impact={
            target.kind === 'delivery' ? (
              <div className="space-y-1.5">
                <p>
                  Requeues dead webhook delivery <Mono>{target.record.delivery_id}</Mono> (
                  <strong>{target.record.event_type}</strong>, {target.record.attempts} failed attempt(s)) so githubd
                  processes it again. Its status returns to pending and attempts reset to 0.
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  Processing a push or pull-request event can start a deployment for the customer app connected to that
                  repository.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p>
                  Requeues the dead Check Run update for deployment <Mono>{target.record.deployment_id}</Mono> (
                  {target.record.attempts} failed attempt(s)). The generation advances, attempts reset to 0, and githubd
                  publishes the deployment&apos;s status to the customer&apos;s commit again.
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  Only the GitHub status is affected; the deployment itself is not rebuilt.
                </p>
              </div>
            )
          }
          onClose={() => setTarget(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res =
              target.kind === 'delivery'
                ? await retryGithubDelivery(target.record.delivery_id, reason, { idempotencyKey })
                : await retryGithubCheckUpdate(target.record.deployment_id, reason, { idempotencyKey });
            query.reload();
            return `${res.kind === 'delivery' ? 'Delivery' : 'Check Run update'} ${short(res.target_id)} requeued (${res.status}).`;
          }}
        />
      )}
    </div>
  );
}

function LimitReached() {
  return (
    <span className="ml-2 text-xs font-normal text-[var(--color-warning-bold)]">
      limit reached; older items may exist — raise the limit or narrow the status
    </span>
  );
}

/** "processed 3m ago", "gave up", "due now", "in 4m". */
function describeSchedule(status: string, next: string, processed?: string | null): string {
  if (isRealTimestamp(processed)) return `processed ${relativeTime(processed)}`;
  if (status === 'dead') return 'gave up';
  if (!isRealTimestamp(next)) return '—';
  const sec = Math.round((Date.parse(next) - Date.now()) / 1000);
  if (sec <= 0) return 'due now';
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `in ${min}m` : `in ${Math.round(min / 60)}h`;
}
