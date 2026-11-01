'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAsync } from '@/lib/useAsync';
import {
  RETAINED_WINDOWS,
  badgeClass,
  coverageShares,
  formatSeconds,
  getCollectionHistory,
  getInputHealth,
  getNotificationHealth,
  getRecordingCoverage,
  getRuleCoverage,
  getRuleHealth,
  humanize,
  inputHealthAnswers,
  stateTone,
  windowSince,
  type ObsAlertCollectionHistory,
  type ObsInputHealth,
  type ObsNotificationHealth,
  type ObsNotificationSignal,
  type ObsRuleHealthResponse,
} from '@/lib/ops/telemetry';
import { runbookHref } from '@/lib/ops/incidents';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { FilterSelect, Mono, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import {
  CoverageBar,
  EmptyRow,
  ErrorRow,
  Fact,
  Limitations,
  LoadingRow,
  Notice,
  RefreshFailed,
  StateBadge,
  When,
} from '../incidents/parts';
import { CoverageSection, type CoverageView } from './CoverageSection';

/**
 * Telemetry health: whether the alerting stack can be trusted right now.
 * Expected inventories (rule sets, input roles) are never inferred: the
 * operator selects them, and nothing is compared until they do.
 */
export default function TelemetryHealthPage() {
  const notifications = useAsync(getNotificationHealth, [], 30000);
  const rules = useAsync(getRuleHealth, [], 30000);

  const [historyWindow, setHistoryWindow] = useState('');
  const [failureDetails, setFailureDetails] = useState(false);
  const lookback = RETAINED_WINDOWS.find((option) => option.value === historyWindow) ?? RETAINED_WINDOWS[0];
  const history = useAsync(
    () => getCollectionHistory({ since: windowSince(lookback.hours), details: failureDetails }),
    [lookback.value, failureDetails],
    60000,
  );

  // Selections drive whether the expensive comparisons run and poll at all.
  const [role, setRole] = useState('');
  const inputs = useAsync(() => getInputHealth(role), [role], role ? 30000 : undefined);
  const [ruleSet, setRuleSet] = useState('');
  const ruleCoverage = useAsync(() => getRuleCoverage(ruleSet), [ruleSet], ruleSet ? 60000 : undefined);
  const [recordingSet, setRecordingSet] = useState('');
  const recordingCoverage = useAsync(() => getRecordingCoverage(recordingSet), [recordingSet], recordingSet ? 60000 : undefined);

  const refreshAll = () => {
    notifications.reload();
    rules.reload();
    history.reload();
    inputs.reload();
    ruleCoverage.reload();
    recordingCoverage.reload();
  };

  const inputData = inputs.data && inputHealthAnswers(inputs.data, role) ? inputs.data : null;
  const ruleView: CoverageView | null = ruleCoverage.data
    ? { ...ruleCoverage.data, rows: ruleCoverage.data.items.map((comparison) => ({ comparison })), dependencies: undefined }
    : null;
  const recordingView: CoverageView | null = recordingCoverage.data
    ? {
        ...recordingCoverage.data,
        rows: recordingCoverage.data.items.map((item) => ({ comparison: item.comparison, dependents: item.dependent_alerts })),
        dependencies: recordingCoverage.data.dependencies,
      }
    : null;

  return (
    <div>
      <PageHeader
        title="Telemetry health"
        subtitle="Whether alerting, rules and scrapes work. Missing evidence shows as unknown, never as healthy."
        actions={
          <>
            <Link href="/incidents" className="btn btn-secondary btn-sm">
              <Icon name="alerts" size={14} />
              Incidents
            </Link>
            <button onClick={refreshAll} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </>
        }
      />

      <SnapshotFreshness snapshots={[notifications, rules, history, inputs, ruleCoverage, recordingCoverage]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Notification pipeline"
          value={notifications.data ? <StateBadge state={notifications.data.state} /> : notifications.error ? 'Unknown' : '…'}
          sub={
            notifications.data ? (
              <>
                Alertmanager API {humanize(notifications.data.alertmanager_api.state)}
              </>
            ) : notifications.error ? (
              `Unavailable: ${notifications.error.message}`
            ) : (
              'Loading'
            )
          }
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="Alert rules"
          value={rules.data ? <StateBadge state={rules.data.state} reason={rules.data.reason} /> : rules.error ? 'Unknown' : '…'}
          sub={
            rules.data?.totals
              ? `${rules.data.totals.healthy} of ${rules.data.totals.rules} rules healthy`
              : rules.data
                ? humanize(rules.data.reason) || 'Rule source not read'
                : rules.error
                  ? `Unavailable: ${rules.error.message}`
                  : 'Loading'
          }
          color="var(--color-chart)"
        />
        <StatTile
          label="Alert collection"
          value={
            history.data ? (
              <StateBadge
                state={history.data.collection.collection_state ?? history.data.collection.state}
                reason={history.data.collection.reason}
              />
            ) : history.error ? (
              'Unknown'
            ) : (
              '…'
            )
          }
          sub={
            history.data ? (
              <>
                last success <When at={history.data.collection.last_success_at} />
              </>
            ) : history.error ? (
              `Unavailable: ${history.error.message}`
            ) : (
              'Loading'
            )
          }
          color="var(--color-warning)"
        />
        <StatTile
          label="Scrape inputs"
          value={!role ? 'Not selected' : inputData ? <StateBadge state={inputData.state} reason={inputData.reason} /> : inputs.error ? 'Unknown' : '…'}
          sub={!role ? 'Choose the expected role below' : `role ${role}`}
          color="var(--color-danger)"
        />
      </div>

      <div className="mt-6">
        <NotificationSection query={notifications} />
      </div>

      <div className="mt-6">
        <RuleHealthSection query={rules} />
      </div>

      <div className="mt-6">
        <SectionCard
          title="Alert collection history"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                <input type="checkbox" checked={failureDetails} onChange={(event) => setFailureDetails(event.target.checked)} />
                Failure details
              </label>
              <FilterSelect
                value={historyWindow}
                onChange={setHistoryWindow}
                options={RETAINED_WINDOWS.map((option) => ({ value: option.value, label: option.label }))}
              />
            </div>
          }
        >
          {history.error && !history.data ? (
            <ErrorRow message={`Could not load collection history: ${history.error.message}`} />
          ) : history.loading && !history.data ? (
            <LoadingRow label="Loading collection history" />
          ) : history.data ? (
            <CollectionHistoryBody data={history.data} detailsRequested={failureDetails} />
          ) : null}
          {history.error && history.data && <RefreshFailed error={history.error} />}
        </SectionCard>
      </div>

      <div className="mt-6">
        <InputHealthSection query={inputs} data={inputData} role={role} onRole={setRole} />
      </div>

      <div className="mt-6">
        <CoverageSection
          title="Alert rule coverage"
          noun="alert rules"
          query={ruleCoverage}
          view={ruleView}
          selected={ruleSet}
          onSelect={setRuleSet}
        />
      </div>

      <div className="mt-6">
        <CoverageSection
          title="Recording rule coverage"
          noun="recording rules"
          query={recordingCoverage}
          view={recordingView}
          selected={recordingSet}
          onSelect={setRecordingSet}
        />
      </div>
    </div>
  );
}

/* ───────────────────────────── Notifications ───────────────────────────── */

const NOTIFICATION_SIGNALS: Record<string, string> = {
  alertmanager_up: 'Alertmanager up',
  alertmanager_config_reload_successful: 'Alertmanager config reload succeeded',
  prometheus_queue_length: 'Prometheus notification queue length',
  prometheus_queue_capacity: 'Prometheus notification queue capacity',
  prometheus_dropped: 'Notifications dropped by Prometheus',
  alertmanager_attempts: 'Alertmanager notification attempts',
  alertmanager_failures: 'Alertmanager notification failures',
};

function SignalValue({ signal }: { signal: ObsNotificationSignal }) {
  if (signal.state !== 'healthy' || signal.value == null) {
    return <span className="text-[var(--color-ink-muted)]">— ({humanize(signal.reason || signal.state)})</span>;
  }
  return <span className="font-mono">{Number.isInteger(signal.value) ? signal.value : signal.value.toFixed(2)}</span>;
}

function NotificationSection({ query }: { query: { data: ObsNotificationHealth | null; loading: boolean; error: Error | null } }) {
  const data = query.data;
  return (
    <SectionCard
      title="Notification pipeline"
      action={data ? <StateBadge state={data.state} /> : null}
    >
      {query.error && !data ? (
        <ErrorRow message={`Could not load notification health: ${query.error.message}`} />
      ) : query.loading && !data ? (
        <LoadingRow label="Reading Prometheus and Alertmanager" />
      ) : data ? (
        <div className="space-y-4 p-4 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Alertmanager API</span>
            <StateBadge state={data.alertmanager_api.state} reason={data.alertmanager_api.reason} />
            {data.alertmanager_api.reason && <span className="text-[var(--color-ink-muted)]">{humanize(data.alertmanager_api.reason)}</span>}
            <span className="text-[var(--color-ink-muted)]">
              · counters over {formatSeconds(data.window_seconds)} · generated <When at={data.generated_at} />
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Evidence</th>
                  <th>Value</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.signals).map(([name, signal]) => (
                  <tr key={name}>
                    <td className="cell-primary">{NOTIFICATION_SIGNALS[name] ?? humanize(name)}</td>
                    <td>
                      <StateBadge state={signal.state} reason={signal.reason} />
                    </td>
                    <td>
                      <SignalValue signal={signal} />
                    </td>
                    <td>
                      <When at={signal.observed_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.integrations.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Integration</th>
                    <th>Attempts</th>
                    <th>Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {data.integrations.map((integration) => (
                    <tr key={integration.integration}>
                      <td className="cell-primary font-mono">{integration.integration}</td>
                      <td>
                        <SignalValue signal={integration.attempts} />
                      </td>
                      <td>
                        <span className={integration.failures.value && integration.failures.state === 'healthy' ? 'text-[var(--color-danger)]' : ''}>
                          <SignalValue signal={integration.failures} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-[var(--color-ink-muted)]">No integration counters were observed in this window.</div>
          )}
        </div>
      ) : null}
      {query.error && data && <RefreshFailed error={query.error} />}
      <Limitations items={data?.limitations} />
    </SectionCard>
  );
}

/* ────────────────────────────── Rule health ────────────────────────────── */

function RuleHealthSection({ query }: { query: { data: ObsRuleHealthResponse | null; loading: boolean; error: Error | null } }) {
  const data = query.data;
  const totals = data?.totals;
  return (
    <SectionCard title="Loaded alert rules" action={data ? <StateBadge state={data.state} reason={data.reason} /> : null}>
      {query.error && !data ? (
        <ErrorRow message={`Could not load rule health: ${query.error.message}`} />
      ) : query.loading && !data ? (
        <LoadingRow label="Reading loaded alert rules" />
      ) : data ? (
        <div className="space-y-4 p-4 text-xs">
          {!totals ? (
            <Notice>
              The rule source was not read ({humanize(data.reason || data.state)}), so rule evaluation health is unknown.
            </Notice>
          ) : (
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-7">
              <Fact label="Rules" value={totals.rules} sub={`${totals.groups} group(s)`} />
              <Fact label="Healthy" value={totals.healthy} />
              <Fact label="Failed" value={<span className={totals.failed ? 'text-[var(--color-danger)]' : ''}>{totals.failed}</span>} />
              <Fact label="Stale" value={<span className={totals.stale ? 'text-[var(--color-warning-bold)]' : ''}>{totals.stale}</span>} />
              <Fact label="Unavailable" value={totals.unavailable} />
              <Fact label="Invalid" value={totals.invalid} sub={totals.invalid_groups ? `${totals.invalid_groups} invalid group(s)` : undefined} />
              <Fact label="Clock invalid" value={totals.invalid_clock} />
            </div>
          )}
          {data.items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>State</th>
                    <th>Issues</th>
                    <th>Last evaluated</th>
                    <th>Pending / firing</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const runbook = runbookHref(item.runbook_url);
                    return (
                      <tr key={`${item.kind}/${item.id}`}>
                        <td>
                          <div className="cell-primary">{item.rule_name || item.group_name || <Mono>{item.id.slice(0, 12)}</Mono>}</div>
                          <div className="text-[var(--color-ink-muted)]">
                            {item.kind === 'group' ? 'group · ' : ''}
                            {[item.file_name, item.group_name].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td>
                          <span className={badgeClass(stateTone(item.state))}>{humanize(item.state)}</span>
                          {item.reported_state !== 'unknown' && (
                            <div className="mt-0.5 text-[var(--color-ink-muted)]">reported {item.reported_state}</div>
                          )}
                        </td>
                        <td>{item.issues.length ? item.issues.map(humanize).join(', ') : '—'}</td>
                        <td>
                          <When at={item.last_evaluated_at} />
                          {item.evaluation_age_seconds != null && (
                            <div className="text-[var(--color-ink-muted)]">age {formatSeconds(item.evaluation_age_seconds)}</div>
                          )}
                        </td>
                        <td className="font-mono">
                          {item.pending == null || item.firing == null ? (
                            <span className="text-[var(--color-ink-muted)]" title="Counts are only usable for healthy rules">
                              unknown
                            </span>
                          ) : (
                            `${item.pending} / ${item.firing}`
                          )}
                        </td>
                        <td className="text-right">
                          {runbook && (
                            <a href={runbook} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs">
                              Runbook
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && (
            <p className="text-[var(--color-ink-muted)]">
              Showing {data.items.length} of {data.total_items} rules and groups, unhealthy first; totals cover all of them.
            </p>
          )}
        </div>
      ) : null}
      {query.error && data && <RefreshFailed error={query.error} />}
      <Limitations items={data?.limitations} />
    </SectionCard>
  );
}

/* ─────────────────────────── Collection history ────────────────────────── */

function CollectionHistoryBody({ data, detailsRequested }: { data: ObsAlertCollectionHistory; detailsRequested: boolean }) {
  const { coverage, collection } = data;
  const details = data.failure_details;
  return (
    <div>
      <div className="space-y-4 p-4 text-xs">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact
            label="Collector"
            value={<StateBadge state={collection.collection_state ?? collection.state} reason={collection.reason} />}
            sub={collection.reason ? humanize(collection.reason) : undefined}
          />
          <Fact label="Last attempt" value={<When at={collection.last_attempt_at} />} />
          <Fact label="Last success" value={<When at={collection.last_success_at} />} />
          <Fact label="Outcomes in window" value={`${coverage.successes} ok · ${coverage.failures} failed`} />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-[var(--color-ink-muted)]">
            Cadence coverage since <When at={coverage.since} /> <StateBadge state={coverage.state} />
          </div>
          <CoverageBar {...coverageShares(coverage)} />
        </div>
        {data.items.length === 0 ? (
          <div className="text-[var(--color-ink-muted)]">No recorded collection intervals in this window.</div>
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-[var(--color-line)]">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Until</th>
                  <th>State</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((interval) => (
                  <tr key={`${interval.from}-${interval.state}`}>
                    <td>{new Date(interval.from).toLocaleString()}</td>
                    <td>{new Date(interval.until).toLocaleString()}</td>
                    <td>
                      <StateBadge state={interval.state} />
                    </td>
                    <td>{humanize(interval.reason) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.truncated && (
          <p className="text-[var(--color-ink-muted)]">
            Showing {data.items.length} of {data.total_intervals} intervals; narrow the window to see all of them.
          </p>
        )}
        {detailsRequested &&
          (details ? (
            <div className="space-y-2">
              <div className="font-semibold">
                Failed attempts ({details.total_failures}){details.truncated ? `, newest ${details.items.length} shown` : ''}
              </div>
              {details.items.length === 0 ? (
                <div className="text-[var(--color-ink-muted)]">No failed attempts in this window.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                  <table className="dtable text-xs">
                    <thead>
                      <tr>
                        <th>Attempted</th>
                        <th>Reason</th>
                        <th>Diagnostics</th>
                        <th>Rejected source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.items.map((failure) => (
                        <tr key={failure.attempted_at}>
                          <td>{new Date(failure.attempted_at).toLocaleString()}</td>
                          <td>{humanize(failure.reason)}</td>
                          <td>
                            <StateBadge state={failure.diagnostics_state} />
                          </td>
                          <td>
                            {failure.diagnostics ? (
                              <>
                                {humanize(failure.diagnostics.reason)} · {failure.diagnostics.totals.healthy}/{failure.diagnostics.totals.rules}{' '}
                                rules healthy
                                {failure.diagnostics.items.length > 0 && (
                                  <div className="text-[var(--color-ink-muted)]">
                                    {failure.diagnostics.items
                                      .slice(0, 3)
                                      .map((item) => `${item.rule_name || item.group_name || item.id.slice(0, 8)} (${humanize(item.state)})`)
                                      .join(', ')}
                                    {failure.diagnostics.truncated || failure.diagnostics.items.length > 3 ? '…' : ''}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-[var(--color-ink-muted)]">No diagnostics retained (unknown, not healthy)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[var(--color-ink-muted)]">Loading failure details…</div>
          ))}
      </div>
      <Limitations items={[...coverage.limitations, ...(details?.limitations ?? [])]} />
    </div>
  );
}

/* ────────────────────────────── Input health ───────────────────────────── */

function InputHealthSection({
  query,
  data,
  role,
  onRole,
}: {
  query: { data: ObsInputHealth | null; loading: boolean; error: Error | null };
  data: ObsInputHealth | null;
  role: string;
  onRole: (role: string) => void;
}) {
  const roles = query.data?.available_roles ?? [];
  const options = [
    { value: '', label: roles.length ? 'Select expected role…' : 'No roles reported' },
    ...roles.map((value) => ({ value, label: value })),
  ];
  if (role && !roles.includes(role)) options.push({ value: role, label: role });
  return (
    <SectionCard
      title="Critical scrape inputs"
      action={
        <div className="flex items-center gap-2">
          {data && role && <StateBadge state={data.state} reason={data.reason} />}
          <FilterSelect value={role} onChange={onRole} options={options} />
        </div>
      }
    >
      {!data ? (
        query.loading ? (
          <LoadingRow label={role ? `Checking inputs for ${role}` : 'Loading input roles'} />
        ) : query.error ? (
          <ErrorRow message={`Could not load input health: ${query.error.message}`} />
        ) : (
          <LoadingRow label="Loading input health" />
        )
      ) : !role ? (
        <EmptyRow>
          Choose the deployment role this control plane is expected to run. The server checks the critical scrape jobs for that
          role only; it does not infer the role.
        </EmptyRow>
      ) : (
        <div className="space-y-4 p-4 text-xs">
          {data.reason && <Notice>{humanize(data.reason)}</Notice>}
          <div className="text-[var(--color-ink-muted)]">
            Samples must be fresher than {formatSeconds(data.max_age_seconds)} (look-back {formatSeconds(data.lookback_seconds)}) · read{' '}
            <When at={data.generated_at} />
          </div>
          {data.jobs.length === 0 ? (
            <div className="text-[var(--color-ink-muted)]">No jobs were assessed.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>State</th>
                    <th>Expectation</th>
                    <th>Targets</th>
                    <th>Readiness metric</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => {
                    const counts = job.targets.counts;
                    return (
                      <tr key={job.job}>
                        <td className="cell-primary font-mono">{job.job}</td>
                        <td>
                          <span className={badgeClass(stateTone(job.state))}>{humanize(job.state)}</span>
                        </td>
                        <td>
                          <StateBadge state={job.expectation.state} reason={job.expectation.reason} />
                          <div className="mt-0.5 text-[var(--color-ink-muted)]">
                            min {job.expectation.minimum_targets ?? '?'} target(s) · {humanize(job.expectation.source)}
                          </div>
                        </td>
                        <td>
                          <StateBadge state={job.targets.state} reason={job.targets.reason} />
                          <div className="mt-0.5 text-[var(--color-ink-muted)]">
                            {counts
                              ? `${counts.fresh_up}/${counts.observed} fresh up · ${counts.down} down · ${counts.stale} stale${
                                  counts.missing_minimum ? ` · ${counts.missing_minimum} short of minimum` : ''
                                }`
                              : humanize(job.targets.reason) || 'counts unknown'}
                          </div>
                        </td>
                        <td>
                          {job.metrics.map((metric) => (
                            <div key={metric.metric}>
                              <span className="font-mono">{metric.metric}</span> <StateBadge state={metric.state} reason={metric.reason} />
                              <div className="text-[var(--color-ink-muted)]">
                                {metric.counts
                                  ? `${metric.counts.fresh}/${metric.counts.expected} fresh · ${metric.counts.missing} missing · ${metric.counts.stale} stale`
                                  : humanize(metric.reason) || 'counts unknown'}
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {query.error && query.data && <RefreshFailed error={query.error} />}
      <Limitations items={data?.limitations} />
    </SectionCard>
  );
}
