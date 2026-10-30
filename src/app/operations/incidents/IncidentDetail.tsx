'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import {
  INCIDENT_TYPE_LABELS,
  describeSource,
  incidentConsoleLinks,
  incidentStatusTone,
  relatedResourceLink,
  runbookHref,
  severityTone,
  triageOptions,
  type IncidentRef,
  type ObsAlertTriage,
  type ObsAlertTriageHistory,
  type ObsIncident,
  type ObsIncidentContextResponse,
  type ObsIncidentEvidenceResponse,
  type TriageOption,
} from '@/lib/ops/incidents';
import { badgeClass, humanize } from '@/lib/ops/telemetry';
import { Mono } from '@/components/ui/bits';
import { Icon } from '@/components/ui/Icons';
import { Fact, Notice, StateBadge, When } from './parts';

export type MoreState = 'loading' | { error: string } | undefined;

/**
 * Everything the detail drawer shows for one incident. `gen` is the request
 * generation that produced it: responses from an older generation (another
 * incident, or a superseded refresh) are dropped by the page.
 */
export interface IncidentDetailState {
  ref: IncidentRef;
  gen: number;
  refreshing: boolean;
  evidence?: ObsIncidentEvidenceResponse;
  evidenceError?: string;
  context?: ObsIncidentContextResponse;
  contextError?: string;
  contextMore?: MoreState;
  triageHistory?: ObsAlertTriageHistory;
  triageHistoryError?: string;
  triageMore?: MoreState;
}

export function IncidentDetail({
  detail,
  onRefresh,
  onLoadMoreContext,
  onLoadOlderTriage,
  onTriage,
}: {
  detail: IncidentDetailState;
  onRefresh: () => void;
  onLoadMoreContext: () => void;
  onLoadOlderTriage: () => void;
  onTriage: (option: TriageOption, triage: ObsAlertTriage) => void;
}) {
  const { evidence, context } = detail;
  const incident = evidence?.incident;
  const unavailable = Array.from(
    new Set([...(evidence?.unavailable_sources ?? []), ...(context?.unavailable_sources ?? [])]),
  );

  return (
    <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {incident ? (
            <>
              <div className="text-sm font-semibold">{incident.summary}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={badgeClass(severityTone(incident.severity))}>{incident.severity}</span>
                <span className={badgeClass(incidentStatusTone(incident.status))}>{humanize(incident.status) || 'unknown'}</span>
                <span className="badge badge-neutral">{INCIDENT_TYPE_LABELS[incident.type] ?? incident.type}</span>
              </div>
            </>
          ) : (
            <Mono>{`${detail.ref.kind}/${detail.ref.id}`}</Mono>
          )}
        </div>
        <div className="flex items-center gap-2 text-[var(--color-ink-muted)]">
          {evidence && (
            <span>
              Evidence <When at={evidence.generated_at} />
            </span>
          )}
          <button type="button" className="btn btn-secondary btn-xs" onClick={onRefresh} disabled={detail.refreshing}>
            <Icon name="refresh" size={12} />
            {detail.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {detail.evidenceError &&
        (evidence ? (
          <Notice tone="danger">Evidence refresh failed: {detail.evidenceError}. Showing the previous evidence snapshot.</Notice>
        ) : (
          <Notice tone="danger">Could not load incident evidence: {detail.evidenceError}</Notice>
        ))}
      {unavailable.length > 0 && (
        <Notice>
          Incomplete evidence: {unavailable.map(describeSource).join(', ')} could not be read. Missing sources are unknown, not
          healthy.
        </Notice>
      )}

      {!evidence && !detail.evidenceError ? (
        <div className="p-6 text-center text-[var(--color-ink-muted)]">Loading incident evidence…</div>
      ) : incident ? (
        <IncidentFacts incident={incident} errorCode={evidence?.error_code} />
      ) : null}

      {incident?.type === 'platform_alert' && evidence && (
        <AlertSection evidence={evidence} onTriage={onTriage} refreshing={detail.refreshing} />
      )}

      {evidence && (
        <section>
          <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">
            Evidence history <span className="font-normal text-[var(--color-ink-muted)]">since <When at={evidence.since} /></span>
          </h4>
          {evidence.history.length === 0 ? (
            <div className="text-[var(--color-ink-muted)]">No exact-resource history in this window.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kind</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.history.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <When at={entry.at} />
                      </td>
                      <td className="cell-primary font-mono">{entry.kind}</td>
                      <td>{humanize(entry.source)}</td>
                      <td>{entry.status ? <span className={badgeClass(incidentStatusTone(entry.status))}>{entry.status}</span> : '—'}</td>
                      <td className="font-mono">{entry.trace_id ? <Mono>{entry.trace_id.slice(0, 12)}…</Mono> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {evidence.truncated && (
            <p className="mt-1 text-[var(--color-ink-muted)]">Showing the newest {evidence.limit} entries; older matches exist.</p>
          )}
        </section>
      )}

      <ContextSection detail={detail} onLoadMore={onLoadMoreContext} />

      {incident?.type === 'platform_alert' && (incident.triage || detail.triageHistory || detail.triageHistoryError) && (
        <TriageHistorySection detail={detail} onLoadOlder={onLoadOlderTriage} />
      )}
    </div>
  );
}

function IncidentFacts({ incident, errorCode }: { incident: ObsIncident; errorCode?: string }) {
  const links = incidentConsoleLinks(incident);
  const runbook = runbookHref(incident.runbook_url);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-4">
        <Fact
          label="Resource"
          value={incident.resource_name || <Mono>{incident.resource_id}</Mono>}
          sub={incident.resource_name ? <Mono>{incident.resource_id}</Mono> : undefined}
        />
        <Fact label="Observed" value={<When at={incident.observed_at} />} sub={new Date(incident.observed_at).toLocaleString()} />
        <Fact label="Account" value={incident.account_id ? <Mono>{incident.account_id.slice(0, 13)}…</Mono> : '—'} />
        <Fact
          label={incident.app_id ? 'App' : 'Node'}
          value={incident.app_id ? <Mono>{incident.app_id.slice(0, 13)}…</Mono> : incident.node_id ? <Mono>{incident.node_id.slice(0, 13)}…</Mono> : '—'}
        />
        {errorCode && <Fact label="Error code" value={<Mono>{errorCode}</Mono>} />}
      </div>
      {(links.length > 0 || runbook) && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="btn btn-secondary btn-xs">
              {link.label}
              <Icon name="arrowRight" size={12} />
            </Link>
          ))}
          {runbook && (
            <a href={runbook} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs">
              Runbook
              <Icon name="external" size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function AlertSection({
  evidence,
  onTriage,
  refreshing,
}: {
  evidence: ObsIncidentEvidenceResponse;
  onTriage: (option: TriageOption, triage: ObsAlertTriage) => void;
  refreshing: boolean;
}) {
  const { incident, suppression } = evidence;
  const episode = incident.alert_episode;
  const unknownBool = (value: boolean | null) => (value == null ? 'Unknown' : value ? 'Yes' : 'No');
  return (
    <section className="space-y-3">
      <h4 className="font-semibold text-[var(--color-ink-soft)]">Alert episode</h4>
      {episode ? (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-4 sm:grid-cols-4">
          <Fact label="Started" value={<When at={episode.started_at} />} />
          <Fact label="Last seen firing" value={<When at={episode.last_seen_at} />} />
          <Fact label="Last evaluated" value={<When at={episode.last_evaluated_at} />} />
          <Fact
            label="Resolved"
            value={episode.resolved_at ? <When at={episode.resolved_at} /> : 'Not confirmed'}
            sub={<StateBadge state={episode.observation_state} />}
          />
        </div>
      ) : (
        <Notice>
          Live alert without retained history: status is reported as unknown and this alert cannot be triaged until alert
          collection has succeeded.
        </Notice>
      )}
      {suppression && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] p-3">
          <span className="font-semibold">Alertmanager</span>
          <StateBadge state={suppression.state} reason={suppression.reason} />
          <span>Silenced: {unknownBool(suppression.silenced)}</span>
          <span>Inhibited: {unknownBool(suppression.inhibited)}</span>
          <span className="text-[var(--color-ink-muted)]">
            checked <When at={suppression.checked_at} />
          </span>
        </div>
      )}
      {incident.triage && <TriagePanel triage={incident.triage} onTriage={onTriage} disabled={refreshing} />}
    </section>
  );
}

function TriagePanel({
  triage,
  onTriage,
  disabled,
}: {
  triage: ObsAlertTriage;
  onTriage: (option: TriageOption, triage: ObsAlertTriage) => void;
  disabled: boolean;
}) {
  const { account } = useAuth();
  const options = triageOptions(triage, account?.id);
  const mine = triage.owned && !!account && triage.owner_account_id === account.id;
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Triage</span>
        <span className={badgeClass(triage.acknowledged ? 'success' : 'warning')}>
          {triage.acknowledged ? 'Acknowledged' : 'Unacknowledged'}
        </span>
        <span className={badgeClass(triage.owned ? 'info' : 'warning')}>
          {triage.owned ? (mine ? 'Owned by you' : 'Owned by another operator') : 'Unowned'}
        </span>
        {triage.snoozed && triage.snoozed_until && (
          <span className="badge badge-neutral">Snoozed until {new Date(triage.snoozed_until).toLocaleString()}</span>
        )}
        <span className="text-[var(--color-ink-muted)]">
          revision {triage.revision}
          {triage.updated_at ? (
            <>
              {' '}
              · updated <When at={triage.updated_at} />
            </>
          ) : null}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.action}
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={disabled || !!option.disabledReason}
            title={option.disabledReason}
            onClick={() => onTriage(option, triage)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContextSection({ detail, onLoadMore }: { detail: IncidentDetailState; onLoadMore: () => void }) {
  const { context } = detail;
  if (!context) {
    return detail.contextError ? (
      <section>
        <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">Related context</h4>
        <Notice tone="danger">Could not load related context: {detail.contextError}</Notice>
      </section>
    ) : detail.evidence ? (
      <div className="text-[var(--color-ink-muted)]">Loading related context…</div>
    ) : null;
  }
  const counts = context.counts;
  return (
    <section className="space-y-3">
      <h4 className="font-semibold text-[var(--color-ink-soft)]">
        Related context{' '}
        <span className="font-normal text-[var(--color-ink-muted)]">
          current relationships as of <When at={context.as_of} />, not causation
        </span>
      </h4>
      {detail.contextError && <Notice tone="danger">Context refresh failed: {detail.contextError}. Showing the previous snapshot.</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <span>Scope</span>
        <StateBadge state={context.scope.state} reason={context.scope.reason} />
        <span className="text-[var(--color-ink-muted)]">basis: {humanize(context.scope.basis)}</span>
      </div>
      {counts ? (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-7">
          <Fact label="Tenants" value={counts.tenants} />
          <Fact label="Apps" value={counts.apps} />
          <Fact label="Deployments" value={counts.deployments} />
          <Fact label="Nodes" value={counts.nodes} />
          <Fact label="Jobs" value={counts.jobs} />
          <Fact label="Job runs" value={counts.job_runs} />
          <Fact
            label="Failed"
            value={<span className={counts.failed_resources > 0 ? 'text-[var(--color-danger)]' : ''}>{counts.failed_resources}</span>}
          />
        </div>
      ) : (
        <div className="text-[var(--color-ink-muted)]">Relationship counts are unavailable for this incident scope.</div>
      )}
      {context.resources.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Relationship</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {context.resources.map((resource) => {
                const link = relatedResourceLink(resource);
                return (
                  <tr key={`${resource.kind}/${resource.id}`}>
                    <td>
                      <span className="text-[var(--color-ink-muted)]">{humanize(resource.kind)}</span>{' '}
                      <Mono>{resource.id.slice(0, 13)}…</Mono>
                    </td>
                    <td>{humanize(resource.relationship)}</td>
                    <td>
                      <span className={badgeClass(resource.confirmed_failure ? 'danger' : incidentStatusTone(resource.status))}>
                        {resource.status || 'unknown'}
                      </span>
                    </td>
                    <td className="text-right">
                      {link && (
                        <Link href={link.href} className="btn btn-ghost btn-xs">
                          {link.label}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {context.next_cursor && (
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary btn-xs" onClick={onLoadMore} disabled={detail.contextMore === 'loading'}>
            {detail.contextMore === 'loading' ? 'Loading…' : 'More related resources'}
          </button>
          {typeof detail.contextMore === 'object' && (
            <span role="alert" className="text-[var(--color-danger)]">
              {detail.contextMore.error}
            </span>
          )}
        </div>
      )}
      <div>
        <div className="mb-1 font-semibold">
          Related timeline{' '}
          <span className="font-normal text-[var(--color-ink-muted)]">
            <When at={context.since} /> → <When at={context.until} />
          </span>
        </div>
        {context.timeline.length === 0 ? (
          <div className="text-[var(--color-ink-muted)]">No related history in this window.</div>
        ) : (
          <div className="max-h-60 divide-y divide-[var(--color-line)] overflow-y-auto rounded-lg border border-[var(--color-line)]">
            {context.timeline.map((row) => (
              <div key={`${row.resource_kind}/${row.resource_id}/${row.entry.id}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-mono font-semibold">{row.entry.kind}</div>
                  <div className="truncate text-[var(--color-ink-muted)]">
                    {humanize(row.resource_kind)} {row.resource_id.slice(0, 8)}… · {humanize(row.match)}
                    {row.entry.status ? ` · ${row.entry.status}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-[var(--color-ink-muted)]">
                  <When at={row.entry.at} />
                </span>
              </div>
            ))}
          </div>
        )}
        {context.timeline_truncated && (
          <p className="mt-1 text-[var(--color-ink-muted)]">Timeline truncated at {context.timeline_limit} entries per page.</p>
        )}
      </div>
    </section>
  );
}

function TriageHistorySection({ detail, onLoadOlder }: { detail: IncidentDetailState; onLoadOlder: () => void }) {
  const history = detail.triageHistory;
  return (
    <section className="space-y-2">
      <h4 className="font-semibold text-[var(--color-ink-soft)]">Triage history</h4>
      {detail.triageHistoryError && <Notice tone="danger">Could not load triage history: {detail.triageHistoryError}</Notice>}
      {!history ? (
        !detail.triageHistoryError && <div className="text-[var(--color-ink-muted)]">Loading triage history…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[var(--color-ink-muted)]">
            <StateBadge state={history.coverage.state} reason={history.coverage.reason} />
            <span>
              {history.coverage.available_entries} receipt(s) retained
              {history.coverage.missing_entries > 0 ? `, ${history.coverage.missing_entries} missing` : ''} up to revision{' '}
              {history.snapshot_revision}
            </span>
          </div>
          {history.items.length === 0 ? (
            <div className="text-[var(--color-ink-muted)]">No triage actions recorded for this episode.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Revision</th>
                    <th>Action</th>
                    <th>When</th>
                    <th>State after</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((entry) => (
                    <tr key={entry.id}>
                      <td className="font-mono">{entry.revision}</td>
                      <td className="cell-primary">{humanize(entry.action)}</td>
                      <td>
                        <When at={entry.at} />
                      </td>
                      <td>
                        {entry.acknowledged ? 'acknowledged' : 'unacknowledged'} · {entry.owned ? 'owned' : 'unowned'}
                        {entry.snoozed_until ? ` · snoozed until ${new Date(entry.snoozed_until).toLocaleString()}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {history.next_cursor && (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-secondary btn-xs" onClick={onLoadOlder} disabled={detail.triageMore === 'loading'}>
                {detail.triageMore === 'loading' ? 'Loading…' : 'Older receipts'}
              </button>
              {typeof detail.triageMore === 'object' && (
                <span role="alert" className="text-[var(--color-danger)]">
                  {detail.triageMore.error}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
