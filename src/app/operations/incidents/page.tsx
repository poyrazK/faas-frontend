'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, searchObsAuditLog } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import {
  ALERT_STATUSES,
  DEFAULT_INCIDENT_FILTERS,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  INCIDENT_WINDOWS,
  SNOOZE_PRESETS,
  TRIAGE_IMPACT,
  describeSource,
  getAlertTriageHistory,
  getAlertWorkloadSummary,
  getIncidentContext,
  getIncidentEvidence,
  incidentConsoleLinks,
  incidentFiltersKey,
  incidentRefKey,
  incidentStatusTone,
  loadIncidentInbox,
  mergeIncidentContext,
  mergeTriageHistory,
  normalizeIncidentFilters,
  parseIncidentId,
  runbookHref,
  severityTone,
  snoozeUntil,
  triageAlert,
  type IncidentFilters,
  type IncidentRef,
  type ObsAlertTriage,
  type ObsAlertTriageRequest,
  type ObsIncident,
  type TriageOption,
} from '@/lib/ops/incidents';
import { badgeClass, formatSeconds, getObsHealthDetail, humanize } from '@/lib/ops/telemetry';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { FilterSelect, Mono, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { OperatorActionDialog, type OperatorActionContext } from '@/components/operator/OperatorActionDialog';
import { IncidentDetail, type IncidentDetailState } from './IncidentDetail';
import { AlertInsights } from './AlertInsights';
import { PipelineHealth } from './PipelineHealth';
import { FleetEventStream } from './FleetEventStream';
import { EmptyRow, ErrorRow, LoadingRow, Notice, RefreshFailed, StateBadge, When } from './parts';

const errorMessage = (err: unknown) => (err as Error)?.message || 'Request failed';

const TYPE_OPTIONS = [
  { value: '', label: 'All sources' },
  ...INCIDENT_TYPES.map((type) => ({ value: type, label: INCIDENT_TYPE_LABELS[type] })),
];
const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  ...INCIDENT_SEVERITIES.map((severity) => ({ value: severity, label: severity[0].toUpperCase() + severity.slice(1) })),
];
const ALERT_STATUS_OPTIONS = [
  { value: '', label: 'Any alert status' },
  ...ALERT_STATUSES.map((status) => ({ value: status, label: status[0].toUpperCase() + status.slice(1) })),
];
const ACK_OPTIONS = [
  { value: '', label: 'Any acknowledgment' },
  { value: 'unacknowledged', label: 'Unacknowledged' },
  { value: 'acknowledged', label: 'Acknowledged' },
];
const OWNERSHIP_OPTIONS = [
  { value: '', label: 'Any owner' },
  { value: 'unowned', label: 'Unowned' },
  { value: 'mine', label: 'Owned by me' },
  { value: 'owned', label: 'Owned' },
];
const SNOOZE_OPTIONS = [
  { value: '', label: 'Snoozed or not' },
  { value: 'inactive', label: 'Not snoozed' },
  { value: 'active', label: 'Snoozed' },
];

interface PendingTriage {
  option: TriageOption;
  ref: IncidentRef;
  revision: number;
  summary: string;
}

export default function IncidentsPage() {
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULT_INCIDENT_FILTERS);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [insightsToken, setInsightsToken] = useState(0);
  const inboxKey = incidentFiltersKey(filters);
  const inbox = useAsync(() => loadIncidentInbox(filters), [inboxKey], 30000);
  const summary = useAsync(getAlertWorkloadSummary, [], 30000);
  const health = useAsync(getObsHealthDetail, [], 30000);
  const audit = useAsync(() => searchObsAuditLog({ limit: 8, operator_only: true }), [], 30000);

  // A page answers exactly one query: after a filter change the previous
  // page is never shown under the new filters, even while it is the only data.
  const page = inbox.data && inbox.data.key === inboxKey ? inbox.data.page : null;

  /* ───────────────────────────── Detail drawer ────────────────────────── */

  // Every load bumps the generation; a response from an older generation
  // (another incident, or a superseded refresh) is dropped.
  const detailGen = useRef(0);
  const openKey = useRef<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetailState | null>(null);
  const [pendingTriage, setPendingTriage] = useState<PendingTriage | null>(null);
  const [snoozeMinutes, setSnoozeMinutes] = useState(60);
  const snoozeBody = useRef<{ key: string; until: string } | null>(null);

  const patchDetail = (
    gen: number,
    patch: Partial<IncidentDetailState> | ((current: IncidentDetailState) => Partial<IncidentDetailState>),
  ) =>
    setDetail((current) =>
      current && current.gen === gen ? { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } : current,
    );

  const loadIncident = async (ref: IncidentRef, refresh: boolean) => {
    const gen = ++detailGen.current;
    openKey.current = incidentRefKey(ref);
    setDetail((current) =>
      refresh && current && incidentRefKey(current.ref) === incidentRefKey(ref)
        ? { ...current, gen, refreshing: true, contextMore: undefined, triageMore: undefined }
        : { ref, gen, refreshing: true },
    );
    const evidenceTask = getIncidentEvidence(ref).then(
      (evidence) => {
        patchDetail(gen, { evidence, evidenceError: undefined });
        return evidence;
      },
      (err) => {
        patchDetail(gen, { evidenceError: errorMessage(err) });
        return null;
      },
    );
    const contextTask = getIncidentContext(ref).then(
      (context) => patchDetail(gen, { context, contextError: undefined }),
      (err) => patchDetail(gen, { contextError: errorMessage(err) }),
    );
    const evidence = await evidenceTask;
    if (evidence && ref.kind === 'platform_alert') {
      if (evidence.triage_history) {
        patchDetail(gen, { triageHistory: evidence.triage_history, triageHistoryError: undefined });
      } else if (evidence.incident.triage) {
        // Evidence embeds the first receipt page when the store supports it;
        // otherwise read it from the dedicated history route.
        try {
          const history = await getAlertTriageHistory(ref.id);
          patchDetail(gen, { triageHistory: history, triageHistoryError: undefined });
        } catch (err) {
          patchDetail(gen, { triageHistoryError: errorMessage(err) });
        }
      }
    }
    await contextTask;
    patchDetail(gen, { refreshing: false });
  };

  const openIncident = (ref: IncidentRef) => void loadIncident(ref, false);

  const openIncidentId = (incidentId: string) => {
    const ref = parseIncidentId(incidentId);
    if (ref) openIncident(ref);
  };

  const closeDetail = () => {
    detailGen.current++;
    openKey.current = null;
    setDetail(null);
    setPendingTriage(null);
  };

  const loadMoreContext = async () => {
    const current = detail;
    const cursor = current?.context?.next_cursor;
    if (!current || !cursor || current.contextMore === 'loading') return;
    patchDetail(current.gen, { contextMore: 'loading' });
    try {
      const next = await getIncidentContext(current.ref, { cursor });
      patchDetail(current.gen, (d) => ({
        contextMore: undefined,
        context: d.context ? mergeIncidentContext(d.context, next) : next,
      }));
    } catch (err) {
      patchDetail(current.gen, { contextMore: { error: errorMessage(err) } });
    }
  };

  const loadOlderTriage = async () => {
    const current = detail;
    const cursor = current?.triageHistory?.next_cursor;
    if (!current || !cursor || current.triageMore === 'loading') return;
    patchDetail(current.gen, { triageMore: 'loading' });
    try {
      const next = await getAlertTriageHistory(current.ref.id, cursor);
      patchDetail(current.gen, (d) => ({
        triageMore: undefined,
        triageHistory: d.triageHistory ? mergeTriageHistory(d.triageHistory, next) : next,
      }));
    } catch (err) {
      patchDetail(current.gen, { triageMore: { error: errorMessage(err) } });
    }
  };

  const startTriage = (option: TriageOption, triage: ObsAlertTriage) => {
    if (!detail) return;
    setSnoozeMinutes(60);
    setPendingTriage({
      option,
      ref: detail.ref,
      revision: triage.revision,
      summary: detail.evidence?.incident.summary ?? incidentRefKey(detail.ref),
    });
  };

  const submitTriage = async ({ idempotencyKey }: OperatorActionContext) => {
    if (!pendingTriage) return;
    const { option, ref, revision } = pendingTriage;
    const body: ObsAlertTriageRequest = { action: option.action, expected_revision: revision };
    if (option.action === 'snooze') {
      // A retry under the same key must replay the same body.
      if (snoozeBody.current?.key !== idempotencyKey) {
        snoozeBody.current = { key: idempotencyKey, until: snoozeUntil(snoozeMinutes) };
      }
      body.snoozed_until = snoozeBody.current.until;
    }
    const stillOpen = () => openKey.current === incidentRefKey(ref);
    try {
      const res = await triageAlert(ref.id, body, { idempotencyKey });
      setDetail((current) =>
        current && current.evidence && incidentRefKey(current.ref) === incidentRefKey(ref)
          ? { ...current, evidence: { ...current.evidence, incident: { ...current.evidence.incident, triage: res.triage } } }
          : current,
      );
      inbox.reload();
      summary.reload();
      if (stillOpen()) void loadIncident(ref, true);
      return `${option.label.replace('…', '')}: recorded at revision ${res.triage.revision}.`;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (stillOpen()) void loadIncident(ref, true);
        throw new Error(
          'Nothing was changed: the episode was triaged by someone else in the meantime, or another operator owns it. The incident has been refreshed; close this dialog and review its current triage before retrying.',
        );
      }
      throw err;
    }
  };

  /* ──────────────────────────────── Filters ───────────────────────────── */

  const updateFilters = (patch: Partial<IncidentFilters>) => {
    setFilters((current) => normalizeIncidentFilters({ ...current, ...patch, cursor: '' }));
    setPreviousCursors([]);
  };

  const olderPage = () => {
    if (!page?.next_cursor) return;
    const next = page.next_cursor;
    setPreviousCursors((cursors) => [...cursors, filters.cursor]);
    setFilters((current) => ({ ...current, cursor: next }));
  };

  const newerPage = () => {
    const previous = previousCursors[previousCursors.length - 1] ?? '';
    setPreviousCursors(previousCursors.slice(0, -1));
    setFilters((current) => ({ ...current, cursor: previous }));
  };

  const newestPage = () => {
    setPreviousCursors([]);
    setFilters((current) => ({ ...current, cursor: '' }));
  };

  const refreshAll = () => {
    inbox.reload();
    summary.reload();
    health.reload();
    audit.reload();
    setInsightsToken((value) => value + 1);
  };

  const alertsOnly = filters.type === 'platform_alert';
  const windowOptions = INCIDENT_WINDOWS.filter((option) => alertsOnly || !option.alertsOnly).map((option) => ({
    value: String(option.hours),
    label: option.label,
  }));

  /* ─────────────────────────────── Summary ────────────────────────────── */

  const workload = summary.data;
  const counts = workload?.counts ?? null;
  const oldest = workload?.oldest_unacknowledged ?? null;
  const unavailableSources = page?.unavailable_sources ?? [];
  const pending = pendingTriage;

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="The unified incident inbox across deployments, job runs, compute nodes and platform alerts, with evidence, related context and alert triage."
        actions={
          <>
            <Link href="/telemetry" className="btn btn-secondary btn-sm">
              <Icon name="metrics" size={14} />
              Telemetry health
            </Link>
            <button onClick={refreshAll} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </>
        }
      />

      <SnapshotFreshness snapshots={[inbox, summary, health]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Alerts needing attention"
          value={counts ? counts.needs_attention : workload ? 'Not collected' : summary.error ? '—' : '…'}
          sub={
            counts
              ? 'unresolved, unsnoozed and unacknowledged or unowned'
              : workload
                ? 'No successful alert collection yet; counts are unknown'
                : summary.error
                  ? `Alert summary unavailable: ${summary.error.message}`
                  : 'Loading alert workload'
          }
          color="var(--color-danger)"
        />
        <StatTile
          label="Platform alerts"
          value={counts ? `${counts.firing} firing` : workload ? '—' : summary.error ? '—' : '…'}
          sub={counts ? `${counts.unknown} unknown status · ${counts.resolved} resolved retained` : 'Retained alert episodes'}
          color="var(--color-warning)"
        />
        <StatTile
          label="Oldest unacknowledged"
          value={oldest ? formatSeconds(oldest.age_seconds) : counts ? 'None' : '—'}
          sub={
            oldest ? (
              <button type="button" className="underline" onClick={() => openIncidentId(oldest.incident_id)}>
                {oldest.severity} · {oldest.status} · inspect
              </button>
            ) : counts ? (
              'Every unresolved, unsnoozed alert is acknowledged'
            ) : (
              'Unknown until alert collection succeeds'
            )
          }
          color="var(--color-chart)"
        />
        <StatTile
          label="Alert collection"
          value={
            workload ? (
              <StateBadge state={workload.collection.collection_state ?? workload.collection.state} reason={workload.collection.reason} />
            ) : summary.error ? (
              '—'
            ) : (
              '…'
            )
          }
          sub={
            workload ? (
              <>
                last success <When at={workload.collection.last_success_at} /> · retention {humanize(workload.retention.state)}
              </>
            ) : (
              'Collector state unknown'
            )
          }
          color="var(--color-brand-bright)"
        />
      </div>

      <div className="mt-6">
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="inbox" size={16} />
              <h2 className="card-title">Incident inbox</h2>
            </div>
          }
          action={
            page ? (
              <span className="text-xs text-[var(--color-ink-muted)]">
                since <When at={page.since} /> · generated <When at={page.generated_at} />
              </span>
            ) : null
          }
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] p-3">
            <FilterSelect value={filters.type} onChange={(value) => updateFilters({ type: value as IncidentFilters['type'] })} options={TYPE_OPTIONS} />
            <FilterSelect
              value={filters.severity}
              onChange={(value) => updateFilters({ severity: value as IncidentFilters['severity'] })}
              options={SEVERITY_OPTIONS}
            />
            <FilterSelect
              value={String(filters.windowHours)}
              onChange={(value) => updateFilters({ windowHours: Number(value) })}
              options={windowOptions}
            />
            {alertsOnly && (
              <>
                <FilterSelect
                  value={filters.alertStatus}
                  onChange={(value) => updateFilters({ alertStatus: value as IncidentFilters['alertStatus'] })}
                  options={ALERT_STATUS_OPTIONS}
                />
                <FilterSelect
                  value={filters.acknowledgment}
                  onChange={(value) => updateFilters({ acknowledgment: value as IncidentFilters['acknowledgment'] })}
                  options={ACK_OPTIONS}
                />
                <FilterSelect
                  value={filters.ownership}
                  onChange={(value) => updateFilters({ ownership: value as IncidentFilters['ownership'] })}
                  options={OWNERSHIP_OPTIONS}
                />
                <FilterSelect
                  value={filters.snooze}
                  onChange={(value) => updateFilters({ snooze: value as IncidentFilters['snooze'] })}
                  options={SNOOZE_OPTIONS}
                />
              </>
            )}
          </div>

          {!page ? (
            inbox.loading ? (
              <LoadingRow label="Loading incidents" />
            ) : inbox.error ? (
              <ErrorRow message={`Could not load incidents: ${inbox.error.message}. Incident state is unknown.`} />
            ) : (
              <LoadingRow label="Loading incidents" />
            )
          ) : (
            <>
              {(unavailableSources.length > 0 || page.since_clamped) && (
                <div className="space-y-2 border-b border-[var(--color-line)] p-3">
                  {unavailableSources.length > 0 && (
                    <Notice>
                      Incomplete snapshot: {unavailableSources.map(describeSource).join(', ')}{' '}
                      {unavailableSources.length === 1 ? 'is' : 'are'} unavailable. Incidents from{' '}
                      {unavailableSources.length === 1 ? 'that source' : 'those sources'} may be missing or show a stale status.
                    </Notice>
                  )}
                  {page.since_clamped && (
                    <Notice tone="info">
                      The requested window reaches further back than the server allows for this source; showing incidents since{' '}
                      {new Date(page.since).toLocaleString()}.
                    </Notice>
                  )}
                </div>
              )}
              {page.items.length === 0 ? (
                unavailableSources.length > 0 ? (
                  <EmptyRow>
                    No incidents from the sources that answered. Because {unavailableSources.map(describeSource).join(', ')} could not
                    be read, this is not an all-clear.
                  </EmptyRow>
                ) : (
                  <EmptyRow>No incidents match these filters in this window.</EmptyRow>
                )
              ) : (
                <div className="overflow-x-auto">
                  <table className="dtable text-xs">
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Incident</th>
                        <th>Status</th>
                        <th>Observed</th>
                        <th>Go to</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((item) => (
                        <InboxRow key={item.id} item={item} onInspect={openIncident} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="table-foot">
                <span>
                  {page.items.length} incident(s) on this page
                  {previousCursors.length > 0 ? ` · page ${previousCursors.length + 1}` : ''}
                </span>
                <div className="flex gap-2">
                  {filters.cursor && (
                    <>
                      <button className="btn btn-secondary btn-xs" onClick={newestPage}>
                        Newest
                      </button>
                      <button className="btn btn-secondary btn-xs" onClick={newerPage}>
                        Newer
                      </button>
                    </>
                  )}
                  {page.next_cursor && (
                    <button className="btn btn-secondary btn-xs" disabled={inbox.loading} onClick={olderPage}>
                      Older
                    </button>
                  )}
                </div>
              </div>
              {inbox.error && <RefreshFailed error={inbox.error} />}
            </>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <AlertInsights refreshToken={insightsToken} onOpenEpisode={(episodeId) => openIncidentId(`platform_alert/${episodeId}`)} />
      </div>

      <div className="mt-6">
        <PipelineHealth health={health} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FleetEventStream />
        <SectionCard title="Recent operator actions" action={<Link href="/audit-log" className="btn btn-secondary btn-xs">Audit trail</Link>}>
          {audit.error && !audit.data ? (
            <ErrorRow message={`Could not load operator audit: ${audit.error.message}`} />
          ) : audit.loading && !audit.data ? (
            <LoadingRow label="Loading operator audit" />
          ) : !audit.data?.items.length ? (
            <EmptyRow>No operator actions in the audit window.</EmptyRow>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {audit.data.items.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-mono font-semibold">{row.kind}</div>
                    <div className="truncate text-[var(--color-ink-muted)]">
                      {row.actor || 'system'}
                      {row.account_email ? ` · ${row.account_email}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[var(--color-ink-muted)]">{relativeTime(row.received_at)}</span>
                </div>
              ))}
            </div>
          )}
          {audit.error && audit.data && <RefreshFailed error={audit.error} />}
        </SectionCard>
      </div>

      <Modal
        open={detail !== null}
        onClose={closeDetail}
        title={detail ? `Incident · ${INCIDENT_TYPE_LABELS[detail.ref.kind]}` : 'Incident'}
        width={1040}
      >
        {detail && (
          <IncidentDetail
            detail={detail}
            onRefresh={() => void loadIncident(detail.ref, true)}
            onLoadMoreContext={() => void loadMoreContext()}
            onLoadOlderTriage={() => void loadOlderTriage()}
            onTriage={startTriage}
          />
        )}
      </Modal>

      {pending && (
        <OperatorActionDialog
          open
          title={`${pending.option.label.replace('…', '')}: ${pending.summary}`}
          reason="none"
          submitLabel={pending.option.label.replace('…', '')}
          fingerprint={`${pending.option.action}|${pending.ref.id}|${pending.revision}|${pending.option.action === 'snooze' ? snoozeMinutes : ''}`}
          impact={
            <div className="space-y-1">
              <p>{TRIAGE_IMPACT[pending.option.action]}</p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                Applies only if the episode is still at triage revision {pending.revision}; otherwise nothing changes and you are asked
                to review the newer state.
              </p>
            </div>
          }
          onClose={() => setPendingTriage(null)}
          onSubmit={submitTriage}
        >
          {pending.option.action === 'snooze' && (
            <div>
              <label className="label" htmlFor="incident-snooze">
                Snooze for
              </label>
              <select
                id="incident-snooze"
                className="field field-sm"
                value={snoozeMinutes}
                onChange={(event) => setSnoozeMinutes(Number(event.target.value))}
              >
                {SNOOZE_PRESETS.map((preset) => (
                  <option key={preset.minutes} value={preset.minutes}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </OperatorActionDialog>
      )}
    </div>
  );
}

function InboxRow({ item, onInspect }: { item: ObsIncident; onInspect: (ref: IncidentRef) => void }) {
  const ref = parseIncidentId(item.id);
  const links = incidentConsoleLinks(item);
  const runbook = runbookHref(item.runbook_url);
  const triage = item.triage;
  return (
    <tr>
      <td>
        <span className={badgeClass(severityTone(item.severity))}>{item.severity}</span>
      </td>
      <td className="max-w-[420px]">
        <div className="cell-primary truncate" title={item.summary}>
          {item.summary}
        </div>
        <div className="truncate text-[var(--color-ink-muted)]">
          {INCIDENT_TYPE_LABELS[item.type] ?? item.type} · {item.resource_name || <Mono>{item.resource_id.slice(0, 13)}</Mono>}
        </div>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          <span className={badgeClass(incidentStatusTone(item.status))} title={item.status === 'unknown' ? 'Last known state; alert collection is not current' : undefined}>
            {humanize(item.status) || 'unknown'}
          </span>
          {triage && item.status !== 'resolved' && (
            <span className={badgeClass(triage.acknowledged ? 'success' : 'warning')}>{triage.acknowledged ? 'acked' : 'unacked'}</span>
          )}
          {triage?.owned && <span className="badge badge-info">owned</span>}
          {triage?.snoozed && (
            <span className="badge badge-neutral" title={triage.snoozed_until ? `until ${new Date(triage.snoozed_until).toLocaleString()}` : undefined}>
              snoozed
            </span>
          )}
        </div>
      </td>
      <td>
        <When at={item.observed_at} />
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="btn btn-ghost btn-xs">
              {link.label}
            </Link>
          ))}
          {runbook && (
            <a href={runbook} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs">
              Runbook
              <Icon name="external" size={11} />
            </a>
          )}
          {links.length === 0 && !runbook && <span className="text-[var(--color-ink-muted)]">—</span>}
        </div>
      </td>
      <td className="text-right">
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          disabled={!ref}
          title={ref ? undefined : 'This incident reference cannot be inspected'}
          onClick={() => ref && onInspect(ref)}
        >
          Inspect
        </button>
      </td>
    </tr>
  );
}
