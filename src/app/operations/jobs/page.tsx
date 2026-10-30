'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  cancelOperatorJobRun,
  getOperatorJobRun,
  isJobRunCancellable,
  isUuid,
  jobStatusTone,
  listOperatorJobRuns,
  WORKLOAD_REASON_SUGGESTIONS,
  type OperatorJobRun,
  type OperatorJobRunDetailResponse,
} from '@/lib/ops/workloads';
import { useAsync } from '@/lib/useAsync';
import { useDebounced } from '@/lib/useDebounced';
import { formatMegabytes, isRealTimestamp } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { Mono, PageHeader, SearchInput } from '@/components/ui/bits';
import { CursorFooter, SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

const PAGE_SIZE = 50;
const TASK_PAGE_SIZE = 50;
const POLL_MS = 15000;

const short = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);
const tenantHref = (accountId: string) => `/tenants?q=${encodeURIComponent(accountId)}`;

interface RunDetail {
  runId: string;
  taskOffset: number;
  data?: OperatorJobRunDetailResponse;
  error?: string;
}

export default function JobRunsPage() {
  return (
    <Suspense>
      <JobRunOperations />
    </Suspense>
  );
}

function JobRunOperations() {
  const params = useSearchParams();
  const accountParam = params.get('account');
  const runParam = params.get('run');

  const [accountInput, setAccountInput] = useState(accountParam ?? '');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (accountParam !== null)
      queueMicrotask(() => {
        setAccountInput(accountParam);
        setOffset(0);
      });
  }, [accountParam]);

  const account = useDebounced(accountInput.trim(), 400);
  const filterProblem = account && !isUuid(account) ? 'The account filter needs a full account UUID.' : null;

  const key = `${account}|${offset}`;
  const query = useAsync(
    async () => {
      if (filterProblem) return { key, page: null };
      const page = await listOperatorJobRuns({ accountId: account || undefined, limit: PAGE_SIZE, offset });
      return { key, page };
    },
    [key],
    POLL_MS,
  );
  const page = query.data && query.data.key === key ? query.data.page : null;

  /* ── Run drawer: every response is checked against the run and task page it was for ── */
  const detailSeq = useRef(0);
  const [detailRun, setDetailRun] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OperatorJobRun | null>(null);

  const loadDetail = async (runId: string, taskOffset = 0, keepCurrent = false) => {
    const seq = ++detailSeq.current;
    setDetailRun(runId);
    if (!keepCurrent) setDetail(null);
    try {
      const data = await getOperatorJobRun(runId, { taskLimit: TASK_PAGE_SIZE, taskOffset });
      if (seq === detailSeq.current) setDetail({ runId, taskOffset, data });
    } catch (err) {
      if (seq === detailSeq.current) setDetail({ runId, taskOffset, error: (err as Error).message });
    }
  };

  const closeDetail = () => {
    detailSeq.current++;
    setDetailRun(null);
    setDetail(null);
  };

  useEffect(() => {
    if (runParam && isUuid(runParam)) queueMicrotask(() => void loadDetail(runParam.trim()));
  }, [runParam]);

  const view = detail && detail.runId === detailRun ? detail : null;
  const viewData = view?.data;
  const scopeAccount = account && isUuid(account) ? account : null;

  return (
    <div>
      <PageHeader
        title="Customer job runs"
        subtitle="Queued and running batch job runs across customers. Inspect a run’s tasks and cancel runaway work. Every view and action is audited."
        actions={
          <button onClick={query.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <SnapshotFreshness snapshots={[query]} />

      {scopeAccount && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3 text-xs">
          <Icon name="user" size={14} />
          <span>Scoped to account</span>
          <Mono>{scopeAccount}</Mono>
          <Link href={tenantHref(scopeAccount)} className="btn btn-ghost btn-xs">
            Open tenant
            <Icon name="arrowRight" size={12} />
          </Link>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setAccountInput('');
              setOffset(0);
            }}
          >
            <Icon name="x" size={12} />
            Clear scope
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={accountInput}
          onChange={(value) => {
            setAccountInput(value);
            setOffset(0);
          }}
          placeholder="Account ID (UUID)"
          className="w-full sm:w-80"
        />
        <span className="text-xs text-[var(--color-ink-muted)]">
          The control plane lists only queued and running runs; finished runs are visible to the customer.
        </span>
      </div>

      <SectionCard>
        {filterProblem ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-warning-bold)]">
            {filterProblem}
          </div>
        ) : !page && query.loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading job runs…</div>
        ) : !page && query.error ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load job runs: {query.error.message}
          </div>
        ) : !page ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading job runs…</div>
        ) : page.runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {offset > 0
              ? 'No more active runs.'
              : scopeAccount
                ? 'This account has no queued or running job runs.'
                : 'No customer job runs are queued or running.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Job / run</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Tasks</th>
                  <th>RAM / task</th>
                  <th>Created</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.runs.map((run) => (
                  <tr key={run.run_id}>
                    <td>
                      <span className="cell-primary">{run.job_name}</span>
                      <div className="font-mono text-[11px] text-[var(--color-ink-muted)]" title={run.run_id}>
                        run {short(run.run_id)}
                      </div>
                    </td>
                    <td>
                      <Link href={tenantHref(run.account_id)} className="font-mono hover:underline" title={run.account_id}>
                        {short(run.account_id)}
                      </Link>
                      {account !== run.account_id && (
                        <div>
                          <button
                            className="text-[11px] text-[var(--color-ink-muted)] hover:underline"
                            onClick={() => {
                              setAccountInput(run.account_id);
                              setOffset(0);
                            }}
                          >
                            Only this account
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${jobStatusTone(run.aggregate_status)}`}>{run.aggregate_status}</span>
                    </td>
                    <td>
                      <TaskCounts run={run} />
                    </td>
                    <td className="font-mono">{formatMegabytes(run.ram_mb)}</td>
                    <td title={run.created_at}>{relativeTime(run.created_at)}</td>
                    <td>{isRealTimestamp(run.started_at) ? relativeTime(run.started_at) : 'Not started'}</td>
                    <td className="text-right">
                      <button onClick={() => loadDetail(run.run_id)} className="btn btn-secondary btn-xs">
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
            count={page.runs.length}
            noun="runs"
            page={Math.floor(offset / PAGE_SIZE) + 1}
            hasPrev={offset > 0}
            hasNext={page.next_offset > 0}
            onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(page.next_offset)}
          />
        )}
      </SectionCard>

      <Modal
        open={detailRun !== null}
        onClose={closeDetail}
        title={viewData ? `Job run · ${viewData.run.job_name}` : 'Job run'}
        width={960}
      >
        {view?.error ? (
          <div role="alert" className="text-sm text-[var(--color-danger)]">
            Could not load job run {detailRun}: {view.error}
          </div>
        ) : !viewData || !view ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading job run…</div>
        ) : (
          <RunDetailView
            data={viewData}
            taskOffset={view.taskOffset}
            onCancel={() => setCancelTarget(viewData.run)}
            onTaskPage={(taskOffset) => void loadDetail(viewData.run.run_id, taskOffset, true)}
          />
        )}
      </Modal>

      {cancelTarget && (
        <OperatorActionDialog
          open
          title={`Cancel job run · ${cancelTarget.job_name}`}
          tone="danger"
          reason="code"
          reasonSuggestions={WORKLOAD_REASON_SUGGESTIONS.job}
          confirmText={cancelTarget.job_name}
          submitLabel="Cancel run"
          fingerprint={`cancel|${cancelTarget.run_id}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Cancels run <Mono>{short(cancelTarget.run_id)}</Mono> ({cancelTarget.aggregate_status}) of job{' '}
                <strong>{cancelTarget.job_name}</strong> owned by account <Mono>{cancelTarget.account_id}</Mono>.
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                {cancelTarget.tasks_running} running and{' '}
                {Math.max(
                  0,
                  cancelTarget.tasks -
                    cancelTarget.tasks_running -
                    cancelTarget.tasks_succeeded -
                    cancelTarget.tasks_failed -
                    cancelTarget.tasks_cancelled,
                )}{' '}
                not-yet-finished task(s) are affected: queued tasks are not dispatched and the scheduler is told to stop
                running ones. The run cannot be resumed; the customer has to start a new run.
              </p>
            </div>
          }
          onClose={() => setCancelTarget(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const target = cancelTarget;
            const res = await cancelOperatorJobRun(target.run_id, reason, { idempotencyKey });
            query.reload();
            if (detailRun === target.run_id) void loadDetail(target.run_id, view?.taskOffset ?? 0, true);
            return `Run ${short(res.run.run_id)} of ${target.job_name} is ${res.run.aggregate_status}.`;
          }}
        />
      )}
    </div>
  );
}

function TaskCounts({ run }: { run: OperatorJobRun }) {
  const done = run.tasks_succeeded + run.tasks_failed + run.tasks_cancelled;
  const pct = run.tasks > 0 ? Math.min(100, (done / run.tasks) * 100) : 0;
  return (
    <div className="min-w-[150px]">
      <div className="flex justify-between gap-2">
        <span>
          {done} / {run.tasks} done
        </span>
        {run.tasks_failed > 0 && <span className="text-[var(--color-danger)]">{run.tasks_failed} failed</span>}
      </div>
      <span className="meter mt-1 block">
        <span style={{ width: `${pct}%`, background: run.tasks_failed > 0 ? 'var(--color-danger)' : 'var(--color-brand)' }} />
      </span>
      <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">
        {run.tasks_running} running · {run.tasks_succeeded} ok · {run.tasks_cancelled} cancelled
      </div>
    </div>
  );
}

function RunDetailView({
  data,
  taskOffset,
  onCancel,
  onTaskPage,
}: {
  data: OperatorJobRunDetailResponse;
  taskOffset: number;
  onCancel: () => void;
  onTaskPage: (offset: number) => void;
}) {
  const run = data.run;
  return (
    <div className="space-y-5 text-xs">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-4">
        <Fact label="Run" value={<Mono>{run.run_id}</Mono>} wide />
        <Fact
          label="Account"
          value={
            <Link href={tenantHref(run.account_id)} className="font-mono hover:underline">
              {run.account_id}
            </Link>
          }
          wide
        />
        <Fact label="Job" value={run.job_name} />
        <Fact label="Status" value={<span className={`badge ${jobStatusTone(run.aggregate_status)}`}>{run.aggregate_status}</span>} />
        <Fact label="RAM per task" value={formatMegabytes(run.ram_mb)} />
        <Fact label="Created" value={<span title={run.created_at}>{relativeTime(run.created_at)}</span>} />
        <Fact label="Started" value={isRealTimestamp(run.started_at) ? relativeTime(run.started_at) : 'Not started'} />
        <Fact label="Tasks" value={<TaskCounts run={run} />} wide />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isJobRunCancellable(run.aggregate_status) ? (
          <button onClick={onCancel} className="btn btn-danger btn-sm">
            Cancel run…
          </button>
        ) : (
          <span className="text-[var(--color-ink-muted)]">This run is {run.aggregate_status}; only queued or running runs can be cancelled.</span>
        )}
      </div>

      <section>
        <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">
          Tasks {data.tasks.length > 0 && `${data.task_offset + 1}–${data.task_offset + data.tasks.length}`} of {run.tasks}
        </h4>
        {data.tasks.length === 0 ? (
          <div className="text-[var(--color-ink-muted)]">
            {taskOffset > 0 ? 'No more tasks.' : 'No tasks have been materialised for this run yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Instance</th>
                  <th>Error</th>
                  <th>Exit</th>
                  <th>Started</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task) => (
                  <tr key={`${task.task_index}-${task.attempt}`}>
                    <td className="font-mono">
                      {task.task_index}
                      {task.input_ref && (
                        <div className="max-w-[140px] truncate text-[11px] text-[var(--color-ink-muted)]" title={task.input_ref}>
                          {task.input_ref}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${jobStatusTone(task.status)}`}>{task.status}</span>
                      {task.outcome_code && (
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-muted)]">{task.outcome_code}</div>
                      )}
                    </td>
                    <td className="font-mono">{task.attempt}</td>
                    <td className="font-mono" title={task.instance_id}>
                      {task.instance_id ? short(task.instance_id) : '—'}
                    </td>
                    <td className="max-w-[280px]">
                      {task.error_class || task.error_message ? (
                        <>
                          {task.error_class && <span className="font-mono text-[var(--color-danger)]">{task.error_class}</span>}
                          {task.error_message && (
                            <div className="truncate text-[var(--color-ink-muted)]" title={task.error_message}>
                              {task.error_message}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    {/* exit_code is omitted on the wire both when it is 0 and when none was reported. */}
                    <td className="font-mono" title={task.exit_code == null ? 'Zero or not reported' : undefined}>
                      {task.exit_code ?? '—'}
                    </td>
                    <td>{isRealTimestamp(task.started_at) ? relativeTime(task.started_at) : '—'}</td>
                    <td>{isRealTimestamp(task.finished_at) ? relativeTime(task.finished_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(taskOffset > 0 || data.next_task_offset > 0) && (
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-secondary btn-xs"
              disabled={taskOffset === 0}
              onClick={() => onTaskPage(Math.max(0, taskOffset - TASK_PAGE_SIZE))}
            >
              <Icon name="chevronLeft" size={12} />
              Previous tasks
            </button>
            <button
              className="btn btn-secondary btn-xs"
              disabled={data.next_task_offset <= 0}
              onClick={() => onTaskPage(data.next_task_offset)}
            >
              Next tasks
              <Icon name="chevronRight" size={12} />
            </button>
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
