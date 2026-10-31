'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  cancelOperatorDeployment,
  defaultRetryStage,
  deploymentStatusTone,
  DEPLOYMENT_STAGES,
  formatDurationMs,
  getOperatorDeployment,
  isDeploymentCancellable,
  isDeploymentRetryable,
  isUuid,
  listOperatorDeployments,
  retryOperatorDeployment,
  WORKLOAD_REASON_SUGGESTIONS,
  type DeploymentStageName,
  type OperatorDeployment,
  type OperatorDeploymentDetailResponse,
  type OperatorDeploymentStatus,
} from '@/lib/ops/workloads';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams, useUrlText } from '@/lib/useUrlState';
import { intParam, pickParam } from '@/lib/urlState';
import { formatBytes, isRealTimestamp } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { FilterSelect, Mono, PageHeader, SearchInput } from '@/components/ui/bits';
import { CursorFooter, SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { appDeploymentsHref, deploymentHref, tenantHref } from '@/lib/routes';
import { CopyLinkButton, EntityId, shortId as short } from '@/components/operator/EntityId';
import { StaleRepairDialog } from './StaleRepairDialog';

const PAGE_SIZE = 50;
const POLL_MS = 30000;

/** `statuses` undefined = the handler's incident default (in flight + failed). */
const STATUS_PRESETS: Record<string, { label: string; statuses?: 'all' | OperatorDeploymentStatus[] }> = {
  incident: { label: 'In flight + failed' },
  in_flight: { label: 'In flight', statuses: ['pending', 'building', 'imaging', 'snapshotting'] },
  failed: { label: 'Failed', statuses: ['failed'] },
  live: { label: 'Live', statuses: ['live'] },
  cancelled: { label: 'Cancelled', statuses: ['cancelled'] },
  superseded: { label: 'Superseded', statuses: ['superseded'] },
  all: { label: 'All statuses', statuses: 'all' },
};

const AGE_OPTIONS = [
  { value: '', label: 'Any age' },
  { value: '15', label: 'Older than 15 min' },
  { value: '60', label: 'Older than 1 h' },
  { value: '120', label: 'Older than 2 h' },
  { value: '1440', label: 'Older than 24 h' },
];

const PRESET_KEYS = Object.keys(STATUS_PRESETS);
const AGE_VALUES = AGE_OPTIONS.map((option) => option.value);

type DeploymentAction = { type: 'cancel' | 'retry'; deployment: OperatorDeployment; defaultStage: DeploymentStageName };

export default function DeploymentsPage() {
  return (
    <Suspense>
      <DeploymentOperations />
    </Suspense>
  );
}

function DeploymentOperations() {
  // Filters, the page and the open deployment live in the URL, so any view
  // can be pasted into a channel and opened as-is.
  const [params, setParams] = useUrlParams();
  const accountFilter = useUrlText('account', { resets: { offset: null } });
  const appFilter = useUrlText('app', { resets: { offset: null } });
  const account = accountFilter.value;
  const app = appFilter.value;
  const preset = pickParam(params.get('status'), PRESET_KEYS, 'incident');
  const age = pickParam(params.get('age'), AGE_VALUES, '');
  const includeDeleted = params.get('deleted') === '1';
  const offset = intParam(params.get('offset'));
  const deploymentParam = params.get('deployment');
  /** Any filter change starts again from the first page. */
  const setFilters = (updates: Parameters<typeof setParams>[0]) => setParams({ ...updates, offset: null });

  const filterProblem =
    account && !isUuid(account)
      ? 'The account filter needs a full account UUID.'
      : app && !isUuid(app)
        ? 'The app filter needs a full app UUID — use “Only this app” on a row to set it.'
        : null;

  // Every response is tagged with the filters it was fetched for, so rows of
  // the previous account never render under the new one while it loads.
  const key = [account, app, preset, age, includeDeleted ? 'deleted' : '', offset].join('|');
  const query = useAsync(
    async () => {
      if (filterProblem) return { key, page: null };
      const page = await listOperatorDeployments({
        accountId: account || undefined,
        appId: app || undefined,
        statuses: STATUS_PRESETS[preset]?.statuses,
        includeDeleted,
        createdBefore: age ? new Date(Date.now() - Number(age) * 60_000) : undefined,
        limit: PAGE_SIZE,
        offset,
      });
      return { key, page };
    },
    [key],
    POLL_MS,
  );
  const current = query.data && query.data.key === key ? query.data : null;
  const page = current?.page ?? null;

  /* ── Detail drawer: responses are matched to the deployment they were for ── */
  const detailSeq = useRef(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; data?: OperatorDeploymentDetailResponse; error?: string } | null>(null);
  const [action, setAction] = useState<DeploymentAction | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [fromStage, setFromStage] = useState<DeploymentStageName>('source_download');
  // A retry ships the failed deployment's source. If the customer has since
  // released something newer, a successful retry would roll them back, so the
  // dialog checks for a newer live release before it allows the retry.
  const [newerLive, setNewerLive] = useState<
    { forId: string; state: 'checking' } | { forId: string; state: 'none' } | { forId: string; state: 'newer'; live: OperatorDeployment } | { forId: string; state: 'unknown'; error: string } | null
  >(null);

  const loadDetail = async (id: string, keepCurrent = false) => {
    const seq = ++detailSeq.current;
    setDetailId(id);
    if (!keepCurrent) setDetail(null);
    try {
      const data = await getOperatorDeployment(id);
      if (seq === detailSeq.current) setDetail({ id, data });
    } catch (err) {
      if (seq === detailSeq.current) setDetail({ id, error: (err as Error).message });
    }
  };

  const resetDetail = () => {
    detailSeq.current++;
    setDetailId(null);
    setDetail(null);
  };

  // The URL decides which deployment is open: Inspect writes it, and so do
  // links from incidents, tenants and GitHub recovery.
  const openDetail = (id: string) => setParams({ deployment: id });
  const closeDetail = () => setParams({ deployment: null });

  useEffect(() => {
    const id = deploymentParam?.trim();
    queueMicrotask(() => (id && isUuid(id) ? void loadDetail(id) : resetDetail()));
  }, [deploymentParam]);

  const view = detail && detail.id === detailId ? detail : null;
  const viewData = view?.data;

  const startAction = (type: DeploymentAction['type'], data: OperatorDeploymentDetailResponse) => {
    const defaultStage = defaultRetryStage(data.stage);
    setFromStage(defaultStage);
    setAction({ type, deployment: data.deployment, defaultStage });
    if (type !== 'retry') return;
    const failed = data.deployment;
    setNewerLive({ forId: failed.id, state: 'checking' });
    listOperatorDeployments({ accountId: failed.account_id, appId: failed.app_id, statuses: ['live'], limit: 1 })
      .then((page) => {
        const live = page.deployments[0];
        const newer = live && live.id !== failed.id && Date.parse(live.created_at) > Date.parse(failed.created_at);
        setNewerLive(newer ? { forId: failed.id, state: 'newer', live } : { forId: failed.id, state: 'none' });
      })
      .catch((err: Error) => setNewerLive({ forId: failed.id, state: 'unknown', error: err.message }));
  };
  const liveCheck = action?.type === 'retry' && newerLive?.forId === action.deployment.id ? newerLive : null;
  const retryNeedsTypedConfirm = liveCheck?.state === 'newer' || liveCheck?.state === 'unknown';

  const scopeAccount = account && isUuid(account) ? account : null;

  return (
    <div>
      <PageHeader
        title="Customer deployments"
        subtitle="Find stuck or failed customer deployments, inspect their stage timeline and build, and cancel or retry them. Every view and action is audited."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setRepairOpen(true)} className="btn btn-secondary btn-sm">
              <Icon name="trash" size={14} />
              Repair stale…
            </button>
            <button onClick={query.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      <StaleRepairDialog open={repairOpen} onClose={() => setRepairOpen(false)} onRepaired={query.reload} />

      <SnapshotFreshness snapshots={[query]} />

      {scopeAccount && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3 text-xs">
          <Icon name="user" size={14} />
          <span>Scoped to account</span>
          <EntityId id={scopeAccount} kind="account" full href={null} />
          {app && isUuid(app) && (
            <>
              <span>· app</span>
              <EntityId id={app} kind="app" full href={null} />
            </>
          )}
          <Link href={tenantHref(scopeAccount)} className="btn btn-ghost btn-xs">
            Open tenant
            <Icon name="arrowRight" size={12} />
          </Link>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setFilters({ account: null, app: null })}
          >
            <Icon name="x" size={12} />
            Clear scope
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={accountFilter.draft}
          onChange={accountFilter.setDraft}
          placeholder="Account ID (UUID)"
          className="w-full sm:w-80"
        />
        <SearchInput
          value={appFilter.draft}
          onChange={appFilter.setDraft}
          placeholder="App ID (UUID)"
          className="w-full sm:w-72"
        />
        <FilterSelect
          value={preset}
          onChange={(value) => setFilters({ status: value === 'incident' ? null : value })}
          options={Object.entries(STATUS_PRESETS).map(([value, p]) => ({ value, label: p.label }))}
        />
        <FilterSelect
          value={age}
          onChange={(value) => setFilters({ age: value })}
          options={AGE_OPTIONS}
        />
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => setFilters({ deleted: event.target.checked })}
          />
          Include deleted apps
        </label>
      </div>

      <SectionCard>
        {filterProblem ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-warning-bold)]">
            {filterProblem}
          </div>
        ) : !page && query.loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading deployments…</div>
        ) : !page && query.error ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load deployments: {query.error.message}
          </div>
        ) : !page ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading deployments…</div>
        ) : page.deployments.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {offset > 0
              ? 'No more deployments match these filters.'
              : `No ${preset === 'incident' ? 'in-flight or failed ' : ''}deployments match these filters.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>App</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.deployments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <EntityId id={d.id} kind="deployment" href={null} />
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        {d.kind || 'image'} · {formatBytes(d.source_bytes)}
                      </div>
                    </td>
                    <td>
                      <span className="cell-primary">{d.app_slug}</span>
                      {d.app_status !== 'active' && (
                        <span className="badge badge-neutral ml-1.5">{d.app_status}</span>
                      )}
                      {app !== d.app_id && (
                        <div>
                          <button
                            className="text-[11px] text-[var(--color-ink-muted)] hover:underline"
                            onClick={() => setFilters({ account: d.account_id, app: d.app_id })}
                          >
                            Only this app
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <EntityId id={d.account_id} kind="account" />
                      {account !== d.account_id && (
                        <div>
                          <button
                            className="text-[11px] text-[var(--color-ink-muted)] hover:underline"
                            onClick={() => setFilters({ account: d.account_id, app: null })}
                          >
                            Only this account
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${deploymentStatusTone(d.status)}`}>{d.status}</span>
                      {d.rollout_state && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">rollout: {d.rollout_state}</div>
                      )}
                    </td>
                    <td className="max-w-[280px]">
                      {d.error_code || d.error ? (
                        <>
                          {d.error_code && <span className="font-mono text-[var(--color-danger)]">{d.error_code}</span>}
                          {d.error && (
                            <div className="truncate text-[var(--color-ink-muted)]" title={d.error}>
                              {d.error}
                            </div>
                          )}
                        </>
                      ) : d.cancel_reason ? (
                        <span className="text-[var(--color-ink-muted)]">cancelled: {d.cancel_reason}</span>
                      ) : (
                        <span className="text-[var(--color-ink-muted)]">—</span>
                      )}
                    </td>
                    <td title={d.created_at}>{relativeTime(d.created_at)}</td>
                    <td className="text-right">
                      <button onClick={() => openDetail(d.id)} className="btn btn-secondary btn-xs">
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.error && page && (
          <div role="alert" className="table-foot text-[var(--color-danger)]">
            Refresh failed: {query.error.message}. Showing the last successful snapshot.
          </div>
        )}
        {page && (
          <CursorFooter
            count={page.deployments.length}
            noun="deployments"
            page={Math.floor(offset / PAGE_SIZE) + 1}
            hasPrev={offset > 0}
            hasNext={page.next_offset > 0}
            onPrev={() => setParams({ offset: Math.max(0, offset - PAGE_SIZE) || null })}
            onNext={() => setParams({ offset: page.next_offset })}
          />
        )}
      </SectionCard>

      <Modal
        open={detailId !== null}
        onClose={closeDetail}
        title={viewData ? `Deployment · ${viewData.deployment.app_slug}` : 'Deployment'}
        width={920}
      >
        {view?.error ? (
          <div role="alert" className="text-sm text-[var(--color-danger)]">
            Could not load deployment {detailId}: {view.error}
          </div>
        ) : !viewData ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading deployment…</div>
        ) : (
          <DeploymentDetail
            data={viewData}
            onCancel={() => startAction('cancel', viewData)}
            onRetry={() => startAction('retry', viewData)}
          />
        )}
      </Modal>

      {action?.type === 'cancel' && (
        <OperatorActionDialog
          open
          title={`Cancel deployment · ${action.deployment.app_slug}`}
          tone="danger"
          reason="code"
          reasonSuggestions={WORKLOAD_REASON_SUGGESTIONS.deployment}
          confirmText={action.deployment.app_slug}
          submitLabel="Cancel deployment"
          fingerprint={`cancel|${action.deployment.id}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Cancels deployment <Mono>{short(action.deployment.id)}</Mono> ({action.deployment.status}) of app{' '}
                <strong>{action.deployment.app_slug}</strong> owned by account <Mono>{action.deployment.account_id}</Mono>,
                together with its in-flight build.
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                The app&apos;s current live release, if it has one, is not touched. The customer has to deploy again to
                ship this change. A cancelled deployment cannot be resumed.
              </p>
            </div>
          }
          onClose={() => setAction(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const target = action.deployment;
            const res = await cancelOperatorDeployment(target.id, reason, { idempotencyKey });
            query.reload();
            void loadDetail(target.id, true);
            return `Deployment ${short(res.deployment.id)} of ${target.app_slug} is now ${res.deployment.status}.`;
          }}
        />
      )}

      {action?.type === 'retry' && (
        <OperatorActionDialog
          open
          title={`Retry deployment · ${action.deployment.app_slug}`}
          tone={liveCheck?.state === 'newer' ? 'danger' : 'warning'}
          reason="code"
          reasonSuggestions={WORKLOAD_REASON_SUGGESTIONS.deployment}
          submitLabel="Enqueue retry"
          confirmText={retryNeedsTypedConfirm ? action.deployment.app_slug : undefined}
          canSubmit={action.deployment.app_status === 'active' && !!liveCheck && liveCheck.state !== 'checking'}
          fingerprint={`retry|${action.deployment.id}|${fromStage}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Enqueues a new deployment of app <strong>{action.deployment.app_slug}</strong> (account{' '}
                <Mono>{action.deployment.account_id}</Mono>) from the failed deployment&apos;s original source, starting at{' '}
                <Mono>{fromStage}</Mono>.
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                It follows the customer&apos;s normal release path, so a successful build goes live for them. The
                account&apos;s deploy admission (plan limits, holds, release pause) still applies.
              </p>
              {action.deployment.app_status !== 'active' && (
                <p className="text-xs font-semibold text-[var(--color-danger)]">
                  The app is {action.deployment.app_status}; the control plane only retries deployments of active apps.
                </p>
              )}
              {liveCheck?.state === 'checking' && (
                <p className="text-xs text-[var(--color-ink-muted)]">Checking for a newer live release…</p>
              )}
              {liveCheck?.state === 'newer' && (
                <p className="text-xs font-semibold text-[var(--color-danger)]">
                  The customer has a newer live release (<EntityId id={liveCheck.live.id} kind="deployment" />, deployed{' '}
                  {relativeTime(liveCheck.live.created_at)}). If this retry succeeds it replaces that release with this
                  older source — a rollback for the customer.
                </p>
              )}
              {liveCheck?.state === 'unknown' && (
                <p className="text-xs font-semibold text-[var(--color-warning-bold)]">
                  Could not check for a newer live release ({liveCheck.error}). A successful retry may roll the customer
                  back to older code.
                </p>
              )}
            </div>
          }
          onClose={() => setAction(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const target = action.deployment;
            const res = await retryOperatorDeployment(target.id, fromStage, reason, { idempotencyKey });
            query.reload();
            // The retry is a new deployment row; follow it in the drawer.
            openDetail(res.deployment.id);
            return `Retry of ${target.app_slug} enqueued as deployment ${short(res.deployment.id)} (${res.deployment.status}).`;
          }}
        >
          <label className="block">
            <span className="label">Restart from stage</span>
            <select
              className="field field-sm font-mono"
              value={fromStage}
              onChange={(event) => setFromStage(event.target.value as DeploymentStageName)}
            >
              {DEPLOYMENT_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                  {stage === action.defaultStage ? ' (failed here)' : ''}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              source_download re-runs the whole pipeline. The control plane may start earlier when stage checkpoints are
              no longer retained.
            </span>
          </label>
        </OperatorActionDialog>
      )}
    </div>
  );
}

function DeploymentDetail({
  data,
  onCancel,
  onRetry,
}: {
  data: OperatorDeploymentDetailResponse;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const d = data.deployment;
  const stage = data.stage;
  const build = data.build;
  const history = stage?.history ?? [];
  const hasError = d.error || d.error_code || d.error_why || d.error_hint || d.error_fix;

  return (
    <div className="space-y-5 text-xs">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-4">
        <Fact label="Deployment" value={<EntityId id={d.id} kind="deployment" full href={null} />} wide />
        <Fact label="Account" value={<EntityId id={d.account_id} kind="account" full />} wide />
        <Fact
          label="App"
          value={
            <span>
              {d.app_slug} <span className="font-normal text-[var(--color-ink-muted)]">({d.app_status})</span>{' '}
              <EntityId id={d.app_id} kind="app" href={null} />
            </span>
          }
        />
        <Fact label="Status" value={<span className={`badge ${deploymentStatusTone(d.status)}`}>{d.status}</span>} />
        <Fact label="Kind" value={d.kind || 'image'} />
        <Fact label="Source size" value={formatBytes(d.source_bytes)} />
        <Fact label="Priority" value={d.priority} />
        <Fact label="Created" value={<span title={d.created_at}>{relativeTime(d.created_at)}</span>} />
        {d.rollout_state && <Fact label="Rollout" value={d.rollout_state} />}
        {d.cancelled_at && (
          <Fact
            label="Cancelled"
            value={`${relativeTime(d.cancelled_at)}${d.cancel_reason ? ` · ${d.cancel_reason}` : ''}`}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isDeploymentCancellable(d.status) && (
          <button onClick={onCancel} className="btn btn-danger btn-sm">
            Cancel deployment…
          </button>
        )}
        {isDeploymentRetryable(d.status) && (
          <button onClick={onRetry} className="btn btn-warning btn-sm">
            <Icon name="refresh" size={14} />
            Retry…
          </button>
        )}
        {!isDeploymentCancellable(d.status) && !isDeploymentRetryable(d.status) && (
          <span className="text-[var(--color-ink-muted)]">
            No operator action applies to a {d.status} deployment. Cancel needs an in-flight deployment; retry needs a
            failed one.
          </span>
        )}
        <Link href={`${appDeploymentsHref(d.app_id)}&account=${encodeURIComponent(d.account_id)}`} className="btn btn-ghost btn-sm">
          All deployments of this app
        </Link>
        <CopyLinkButton href={deploymentHref(d.id)} />
      </div>

      {hasError && (
        <section className="space-y-1.5 rounded-lg border border-[#f5d5d5] bg-[var(--color-danger-subtle)] p-3">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-[var(--color-danger)]">
            Failure
            {d.error_code && <Mono>{d.error_code}</Mono>}
          </div>
          {d.error && <p className="whitespace-pre-wrap break-words">{d.error}</p>}
          {d.error_why && (
            <p>
              <span className="font-semibold">Why: </span>
              {d.error_why}
            </p>
          )}
          {d.error_hint && (
            <p>
              <span className="font-semibold">Hint: </span>
              {d.error_hint}
            </p>
          )}
          {d.error_fix && (
            <p>
              <span className="font-semibold">Fix: </span>
              {d.error_fix}
            </p>
          )}
        </section>
      )}

      <section>
        <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">Build</h4>
        {!build ? (
          <div className="text-[var(--color-ink-muted)]">
            {d.build_id ? `Build ${short(d.build_id)} could not be found.` : 'No build is attached (image deployment or not started).'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-3 sm:grid-cols-4">
            <Fact label="Build" value={<EntityId id={build.id} kind="build" />} />
            <Fact label="Status" value={build.status} />
            <Fact label="Failure class" value={build.failure_class || '—'} />
            <Fact label="Cache" value={build.cache_status || '—'} />
            <Fact label="Enqueued" value={relativeTime(build.enqueued_at)} />
            <Fact label="Started" value={isRealTimestamp(build.started_at) ? relativeTime(build.started_at) : '—'} />
            <Fact label="Finished" value={isRealTimestamp(build.finished_at) ? relativeTime(build.finished_at) : '—'} />
            <Fact
              label="Build time"
              value={
                isRealTimestamp(build.started_at) && isRealTimestamp(build.finished_at)
                  ? formatDurationMs(Date.parse(build.finished_at) - Date.parse(build.started_at))
                  : '—'
              }
            />
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">Stage timeline</h4>
        {!stage ? (
          <div className="text-[var(--color-ink-muted)]">No stage state was recorded for this deployment.</div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--color-ink-soft)]">
              <span>
                Current: <Mono>{stage.current || 'none'}</Mono>
                {isRealTimestamp(stage.current_started_at) && ` since ${relativeTime(stage.current_started_at)}`}
              </span>
              {stage.retry_requested_stage && (
                <span>
                  Retry requested from <Mono>{stage.retry_requested_stage}</Mono>
                  {stage.retry_restart_reason && ` · ${stage.retry_restart_reason}`}
                </span>
              )}
            </div>
            {history.length === 0 ? (
              <div className="text-[var(--color-ink-muted)]">No completed stages yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Started</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item, index) => (
                      <tr key={`${item.name}-${item.started_at ?? index}-${index}`}>
                        <td className="font-mono">{item.name}</td>
                        <td>
                          <span
                            className={`badge ${
                              item.status === 'failed'
                                ? 'badge-danger'
                                : item.status === 'completed'
                                  ? 'badge-success'
                                  : 'badge-neutral'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="font-mono">{formatDurationMs(item.duration_ms)}</td>
                        <td>{isRealTimestamp(item.started_at) ? relativeTime(item.started_at) : '—'}</td>
                        <td className="max-w-[320px] break-words text-[var(--color-ink-muted)]">{item.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <div className="mt-1 break-all font-semibold">{value}</div>
    </div>
  );
}
