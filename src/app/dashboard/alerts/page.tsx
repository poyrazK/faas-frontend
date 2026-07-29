'use client';

/* ==========================================================================
   Alerts — real rule CRUD against /v1/apps/{slug}/alerts (#396).

   Contract details that drive the form:
     • Rules are per-app, so a workflow is selected first.
     • `failure_source` is required when metric is `failed_invocations` and
       must be omitted otherwise (the backend enforces an xor check).
     • The webhook secret is sealed server-side and never echoed; the list
       returns only a masked form, so changing it means rotating it.
     • cooldown_minutes is bounded 5..1440.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  listApps, listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, rotateAlertSecret,
  listAuditEvents, METRICS_RANGES,
  type AlertRule, type AlertMetric, type AlertComparison, type AlertFailureSource, type MetricsRange,
  ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, FilterSelect, Mono, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { StatTile, SectionCard, TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

const METRIC_LABEL: Record<AlertMetric, string> = {
  error_rate_pct: 'Error rate (%)',
  latency_p50_ms: 'p50 latency (ms)',
  latency_p95_ms: 'p95 latency (ms)',
  latency_p99_ms: 'p99 latency (ms)',
  cold_start_pct: 'Cold start rate (%)',
  request_count: 'Request count',
  failed_invocations: 'Failed invocations',
};

const COMPARISON_LABEL: Record<AlertComparison, string> = {
  gt: 'is above',
  gte: 'is at or above',
  lt: 'is below',
  lte: 'is at or below',
};

const FAILURE_SOURCES: AlertFailureSource[] = ['any', 'cron', 'queue', 'delayed_task', 'async_invoke'];

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

/** Reads a rule back as a sentence, so the table doesn't need decoding. */
function describe(r: AlertRule): string {
  const metric = METRIC_LABEL[r.metric];
  const src = r.failure_source && r.failure_source !== 'any' ? ` (${r.failure_source})` : '';
  return `${metric}${src} ${COMPARISON_LABEL[r.comparison]} ${r.threshold} over ${r.window_spec}`;
}

export default function AlertsPage() {
  const apps = useAsync(listApps, []);
  const toast = useToast();

  const [picked, setPicked] = useState('');
  const slug = picked || apps.data?.[0]?.slug || '';

  const rules = useAsync(() => (slug ? listAlertRules(slug) : Promise.resolve([])), [slug]);
  const events = useAsync(() => listAuditEvents(15), []);

  const [open, setOpen] = useState(false);
  const [rotating, setRotating] = useState<AlertRule | null>(null);
  const [busy, setBusy] = useState(false);

  // form
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<AlertMetric>('error_rate_pct');
  const [comparison, setComparison] = useState<AlertComparison>('gt');
  const [threshold, setThreshold] = useState('5');
  const [windowSpec, setWindowSpec] = useState<MetricsRange>('15m');
  const [failureSource, setFailureSource] = useState<AlertFailureSource>('any');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [cooldown, setCooldown] = useState('15');

  const list = useMemo(() => rules.data ?? [], [rules.data]);
  const firing = list.filter((r) => r.state === 'firing');

  function resetForm() {
    setName('');
    setMetric('error_rate_pct');
    setComparison('gt');
    setThreshold('5');
    setWindowSpec('15m');
    setFailureSource('any');
    setWebhookUrl('');
    setWebhookSecret('');
    setCooldown('15');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createAlertRule(slug, {
        name: name.trim(),
        metric,
        comparison,
        threshold: Number(threshold),
        window_spec: windowSpec,
        // xor: only sent for failed_invocations, omitted for every other metric
        ...(metric === 'failed_invocations' ? { failure_source: failureSource } : {}),
        webhook_url: webhookUrl.trim(),
        webhook_secret: webhookSecret,
        cooldown_minutes: Number(cooldown),
      });
      toast.success('Alert rule created.');
      setOpen(false);
      resetForm();
      rules.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create the rule.');
    } finally {
      setBusy(false);
    }
  }

  if (apps.data && apps.data.length === 0) {
    return (
      <div>
        <PageHeader title="Alerts" subtitle="Get notified when your workflows misbehave." />
        <div className="card">
          <EmptyState
            icon="alerts"
            title="No workflows yet"
            hint="Alert rules are attached to a workflow. Create one first."
            action={<Link href="/dashboard/workflows" className="btn btn-primary">Create a workflow</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Get notified by webhook when your workflows misbehave."
        actions={
          <>
            <FilterSelect
              value={slug}
              onChange={setPicked}
              options={(apps.data ?? []).map((a) => ({ value: a.slug, label: a.slug }))}
            />
            <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={!slug}>
              <Icon name="plus" size={14} /> New Alert Rule
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Rules" value={list.length} sub={`on ${slug}`} />
        <StatTile
          label="Firing"
          value={firing.length}
          color="var(--color-chart-alt)"
          sub={firing.length ? firing.map((r) => r.name).join(', ') : 'all quiet'}
        />
        <StatTile label="Enabled" value={list.filter((r) => r.enabled).length} sub={`${list.filter((r) => !r.enabled).length} paused`} />
      </div>

      <SectionCard title="Alert rules">
        <AsyncBoundary
          state={rules}
          isEmpty={() => list.length === 0}
          skeleton={<SkeletonTable cols={5} rows={3} />}
          empty={
            <EmptyState
              icon="alerts"
              title="No alert rules"
              hint={`Nothing is watching ${slug}. Add a rule to get a webhook when error rate or latency crosses a threshold.`}
              action={<button className="btn btn-primary" onClick={() => setOpen(true)}>New Alert Rule</button>}
            />
          }
        >
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Condition</th>
                      <th>State</th>
                      <th>Webhook</th>
                      <th>Cool-down</th>
                      <th>Last fired</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-primary">
                          {r.name}
                          {!r.enabled && <span className="badge badge-muted ml-2">paused</span>}
                        </td>
                        <td className="text-xs">{describe(r)}</td>
                        <td>
                          <span className={`badge ${r.state === 'firing' ? 'badge-danger' : 'badge-brand'}`}>
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${r.state === 'firing' ? 'live-dot' : ''}`}
                              style={{ background: 'currentColor' }}
                            />
                            {r.state}
                          </span>
                        </td>
                        <td className="max-w-[200px] truncate text-xs" title={r.webhook_url}>
                          {r.webhook_url}
                          <div style={{ color: 'var(--color-ink-faint)' }}>
                            <Mono>{r.webhook_secret_sealed_masked}</Mono>
                          </div>
                        </td>
                        <td>{r.cooldown_minutes}m</td>
                        <td>{relativeTime(r.last_fired_at)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem
                              onClick={async () => {
                                try {
                                  await updateAlertRule(slug, r.id, { enabled: !r.enabled });
                                  toast.success(r.enabled ? 'Rule paused.' : 'Rule resumed.');
                                  rules.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Update failed.');
                                }
                              }}
                            >
                              {r.enabled ? 'Pause rule' : 'Resume rule'}
                            </RowMenuItem>
                            <RowMenuItem onClick={() => setRotating(r)}>Rotate secret</RowMenuItem>
                            <RowMenuItem
                              danger
                              onClick={async () => {
                                if (!confirm(`Delete alert rule “${r.name}”?`)) return;
                                try {
                                  await deleteAlertRule(slug, r.id);
                                  toast.success('Rule deleted.');
                                  rules.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                                }
                              }}
                            >
                              Delete rule
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={list.length} total={list.length} noun="alert rules" />
            </>
          )}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard className="mt-4" title="Account activity">
        <AsyncBoundary
          state={events}
          isEmpty={(d) => d.events.length === 0}
          skeleton={<SkeletonTable cols={3} rows={3} />}
          empty={<EmptyState icon="bell" title="No activity recorded" />}
        >
          {(d) => (
            <table className="dtable">
              <thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead>
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

      {/* ── Create rule ─────────────────────────────────────────────────── */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title={`New alert rule on ${slug}`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-alert" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create rule'}
            </button>
          </>
        }
      >
        <form id="add-alert" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Rule name</label>
            <input className="field" placeholder="p99 above 500ms" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Metric</label>
              <select className="field" value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>
                {(Object.keys(METRIC_LABEL) as AlertMetric[]).map((m) => (
                  <option key={m} value={m}>{METRIC_LABEL[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Window</label>
              <select className="field" value={windowSpec} onChange={(e) => setWindowSpec(e.target.value as MetricsRange)}>
                {METRICS_RANGES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {metric === 'failed_invocations' && (
            <div>
              <label className="label">Failure source</label>
              <select
                className="field"
                value={failureSource}
                onChange={(e) => setFailureSource(e.target.value as AlertFailureSource)}
              >
                {FAILURE_SOURCES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Which dispatch kind to count. Required for this metric only.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Comparison</label>
              <select className="field" value={comparison} onChange={(e) => setComparison(e.target.value as AlertComparison)}>
                {(Object.keys(COMPARISON_LABEL) as AlertComparison[]).map((c) => (
                  <option key={c} value={c}>{COMPARISON_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Threshold</label>
              <input className="field" type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
            </div>
          </div>

          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--color-surface-subtle)', color: 'var(--color-ink-soft)' }}
          >
            Fires when <strong>{METRIC_LABEL[metric]}</strong> {COMPARISON_LABEL[comparison]}{' '}
            <strong>{threshold || '—'}</strong> over <strong>{windowSpec}</strong>.
          </div>

          <div>
            <label className="label">Webhook URL</label>
            <input
              className="field"
              type="url"
              placeholder="https://example.com/hooks/gregale"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Signing secret</label>
              <input
                className="field mono"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                maxLength={256}
                required
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Used to HMAC the payload. Sealed at rest and never shown again.
              </p>
            </div>
            <div>
              <label className="label">Cool-down (minutes)</label>
              <input
                className="field"
                type="number"
                min={5}
                max={1440}
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
                required
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Minimum 5, maximum 1440.
              </p>
            </div>
          </div>
        </form>
      </Modal>

      {/* ── Rotate secret ───────────────────────────────────────────────── */}
      <Modal
        open={rotating !== null}
        onClose={() => setRotating(null)}
        title={rotating ? `Rotate secret for “${rotating.name}”` : ''}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRotating(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={busy || !webhookSecret}
              onClick={async () => {
                if (!rotating) return;
                setBusy(true);
                try {
                  await rotateAlertSecret(slug, rotating.id, webhookSecret);
                  toast.success('Signing secret rotated.');
                  setRotating(null);
                  setWebhookSecret('');
                  rules.reload();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Rotation failed.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Rotating…' : 'Rotate secret'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            The old secret stops signing immediately. Update your receiver before rotating, or deliveries will fail
            signature verification.
          </p>
          <div>
            <label className="label">New signing secret</label>
            <input
              className="field mono"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              maxLength={256}
              autoFocus
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
