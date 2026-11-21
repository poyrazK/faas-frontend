'use client';

import React, { Suspense, use } from 'react';
import Link from 'next/link';
import { ApiError, getObsAppDetail } from '@/lib/api';
import { getWakeTimeline } from '@/lib/ops/support';
import { getObsInstance, invocationsOnInstance, wakePhases } from '@/lib/ops/fleetInstances';
import { relativeTime } from '@/lib/format';
import { formatMegabytes, isRealTimestamp } from '@/lib/operator';
import { opsHref, wakeHref } from '@/lib/routes';
import { SectionCard } from '@/components/ui/Panels';
import { Mono } from '@/components/ui/bits';
import { EntityId } from '@/components/operator/EntityId';
import { InstanceActions } from '@/components/operator/InstanceActions';
import { useKeyed } from '@/components/operator/tenant/shared';

/* One instance: where it runs and for whom, the wake that started it, and
   the app's recent invocations and errors, with the instance actions. */
export default function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Instance instanceId={decodeURIComponent(id).trim()} />
    </Suspense>
  );
}

function Instance({ instanceId }: { instanceId: string }) {
  const instance = useKeyed(instanceId, getObsInstance);
  const i = instance.data;
  const app = useKeyed(i?.app_id || null, getObsAppDetail);
  const wake = useKeyed(i?.wake_id || null, getWakeTimeline);

  if (instance.error && !i) {
    const missing = instance.error instanceof ApiError && instance.error.status === 404;
    return (
      <div>
        <BackLink />
        <h1 className="text-[22px] font-bold">Instance</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{missing ? 'No instance has this ID.' : instance.error.message}</p>
      </div>
    );
  }
  if (!i) {
    return (
      <div>
        <BackLink />
        <p className="text-sm text-[var(--color-ink-muted)]">Loading the instance…</p>
      </div>
    );
  }
  const plan = app.data?.app;
  const ran = app.data ? invocationsOnInstance(app.data.invocations, i.id) : [];
  const errors = app.data?.health.errors ?? [];
  return (
    <div>
      <BackLink />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight">
            {i.app_slug || 'Instance'} <span className="text-base font-normal text-[var(--color-ink-muted)]">instance</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <span className={`badge ${i.state === 'running' ? 'badge-success' : 'badge-neutral'}`}>{i.state}</span>
            <EntityId id={i.id} kind="instance" href={null} />
            {isRealTimestamp(i.started_at) && <span>started {relativeTime(i.started_at)}</span>}
            <span>· last request {isRealTimestamp(i.last_request_at) ? relativeTime(i.last_request_at) : 'never'}</span>
          </div>
        </div>
        <InstanceActions instance={i} onDone={instance.reload} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-xs sm:grid-cols-4">
        <Fact label="Account">{i.account_id ? <EntityId id={i.account_id} kind="account" /> : '—'}</Fact>
        <Fact label="Node">{i.node_name ? <EntityId id={i.node_name} kind="node" /> : '—'}</Fact>
        <Fact label="App">
          <EntityId id={i.app_id} kind="app" />
        </Fact>
        <Fact label="Deployment">
          <EntityId id={i.deployment_id} kind="deployment" />
        </Fact>
        <Fact label="RAM">
          {formatMegabytes(i.ram_mb)}
          {plan && plan.ram_mb !== i.ram_mb && <span className="ml-1 text-[var(--color-ink-muted)]">(app plan {formatMegabytes(plan.ram_mb)})</span>}
        </Fact>
        <Fact label="App concurrency">{plan ? `${app.data?.instances.filter((x) => x.state === 'running').length ?? 0} running of ${plan.max_concurrency}` : '—'}</Fact>
        <Fact label="Runtime">{plan ? `${plan.runtime} · ${plan.type}` : '—'}</Fact>
        <Fact label="Parked">{i.parked_at && isRealTimestamp(i.parked_at) ? relativeTime(i.parked_at) : '—'}</Fact>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Wake that started it"
          action={
            i.wake_id ? (
              <Link href={wakeHref(i.wake_id)} className="btn btn-ghost btn-xs">
                Full timeline →
              </Link>
            ) : undefined
          }
        >
          <div className="px-4 py-3 text-xs">
            {!i.wake_id ? (
              <p className="text-[var(--color-ink-muted)]">This instance has no recorded wake.</p>
            ) : wake.error && !wake.data ? (
              <p className="text-[var(--color-ink-muted)]">
                {wake.error instanceof ApiError && wake.error.status === 404 ? 'No events are kept for this wake any more.' : wake.error.message}
              </p>
            ) : !wake.data ? (
              <p className="text-[var(--color-ink-muted)]">Loading the wake…</p>
            ) : (
              <ol className="space-y-1">
                {wakePhases(wake.data.events).map((p, n) => (
                  <li key={`${p.at}:${p.kind}:${n}`} className="flex justify-between gap-3">
                    <Mono>{p.kind}</Mono>
                    <span className="font-mono text-[var(--color-ink-muted)]">+{p.offsetMs} ms</span>
                  </li>
                ))}
                {wake.data.truncated && <li className="text-[var(--color-ink-muted)]">… more in the full timeline</li>}
              </ol>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Invocations it ran">
          <div className="px-4 py-3 text-xs">
            {app.error && !app.data ? (
              <p className="text-[var(--color-danger)]">{app.error.message || 'Could not load the app.'}</p>
            ) : !app.data ? (
              <p className="text-[var(--color-ink-muted)]">Loading…</p>
            ) : ran.length === 0 ? (
              <p className="text-[var(--color-ink-muted)]">None among the app&apos;s recent invocations. HTTP requests are not listed one by one.</p>
            ) : (
              <ul className="space-y-1.5">
                {ran.map((inv) => (
                  <li key={inv.id}>
                    <Mono>
                      {inv.method} {inv.path}
                    </Mono>
                    <span className="ml-2">{inv.outcome ?? inv.state}</span>
                    <span className="ml-2 text-[var(--color-ink-muted)]">{relativeTime(inv.created_at)}</span>
                    {inv.last_error && <div className="mt-0.5 break-words text-[var(--color-danger)]">{inv.last_error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="The app's recent errors" className="mt-4">
        <div className="px-4 py-3 text-xs">
          {!app.data ? (
            <p className="text-[var(--color-ink-muted)]">{app.error ? 'Unavailable.' : 'Loading…'}</p>
          ) : !app.data.health.errors ? (
            <p className="text-[var(--color-ink-muted)]">Error groups could not be read.</p>
          ) : errors.length === 0 ? (
            <p className="text-[var(--color-ink-muted)]">No error groups for this app.</p>
          ) : (
            <ul className="space-y-1.5">
              {errors.slice(0, 10).map((e) => (
                <li key={e.fingerprint}>
                  <span className="badge badge-neutral font-mono">{e.http_status}</span>
                  <Mono className="ml-2">{e.route}</Mono>
                  <span className="ml-2">{e.error_class}</span>
                  <span className="ml-2 text-[var(--color-ink-muted)]">
                    ×{e.count} · last {relativeTime(e.last_seen_at)}
                  </span>
                  {e.sample_message && <div className="mt-0.5 break-words text-[var(--color-ink-muted)]">{e.sample_message}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function BackLink() {
  return (
    <Link href={opsHref('instances')} className="mb-3 inline-block text-xs text-[var(--color-ink-muted)] hover:underline">
      ← Running instances
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}
