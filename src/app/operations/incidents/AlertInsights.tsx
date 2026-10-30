'use client';

import React, { useState } from 'react';
import { useAsync } from '@/lib/useAsync';
import {
  getAlertRecurrence,
  getAlertResponseTimes,
  severityTone,
  type ObsAlertRecurrence,
  type ObsAlertResponseMetric,
  type ObsAlertResponseTimes,
} from '@/lib/ops/incidents';
import {
  RETAINED_WINDOWS,
  badgeClass,
  coverageShares,
  formatSeconds,
  humanize,
  windowSince,
  type ObsAlertCollectionCoverage,
  type ObsAlertCollectionHealth,
} from '@/lib/ops/telemetry';
import { FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { CoverageBar, EmptyRow, ErrorRow, Fact, Limitations, LoadingRow, RefreshFailed, StateBadge, When } from './parts';

/**
 * Retained platform-alert cohorts: how fast operators acknowledge and the
 * platform resolves alert episodes, and which alerts keep coming back. Both
 * reads are cohort statistics over retained history, not SLAs.
 */
export function AlertInsights({
  onOpenEpisode,
  refreshToken = 0,
}: {
  onOpenEpisode: (episodeId: string) => void;
  /** Bumped by the page's Refresh button to re-read both cohorts. */
  refreshToken?: number;
}) {
  const [windowValue, setWindowValue] = useState('');
  const lookback = RETAINED_WINDOWS.find((option) => option.value === windowValue) ?? RETAINED_WINDOWS[0];
  const responseTimes = useAsync(() => getAlertResponseTimes(windowSince(lookback.hours)), [lookback.value, refreshToken], 60000);
  const recurrence = useAsync(() => getAlertRecurrence(windowSince(lookback.hours)), [lookback.value, refreshToken], 60000);

  return (
    <SectionCard
      title="Alert response & recurrence"
      action={
        <FilterSelect
          value={windowValue}
          onChange={setWindowValue}
          options={RETAINED_WINDOWS.map((option) => ({ value: option.value, label: `Activated: ${option.label.toLowerCase()}` }))}
        />
      }
    >
      <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-[var(--color-line)]">
        <div>
          <div className="border-b border-[var(--color-line)] px-4 py-3 text-xs font-semibold">Response times</div>
          {responseTimes.error && !responseTimes.data ? (
            <ErrorRow message={`Could not load response times: ${responseTimes.error.message}`} />
          ) : responseTimes.loading && !responseTimes.data ? (
            <LoadingRow label="Loading response times" />
          ) : responseTimes.data ? (
            <ResponseTimesBody data={responseTimes.data} />
          ) : null}
          {responseTimes.error && responseTimes.data && <RefreshFailed error={responseTimes.error} />}
        </div>
        <div>
          <div className="border-b border-[var(--color-line)] px-4 py-3 text-xs font-semibold">Recurring alerts</div>
          {recurrence.error && !recurrence.data ? (
            <ErrorRow message={`Could not load recurrence: ${recurrence.error.message}`} />
          ) : recurrence.loading && !recurrence.data ? (
            <LoadingRow label="Loading recurrence" />
          ) : recurrence.data ? (
            <RecurrenceBody data={recurrence.data} onOpenEpisode={onOpenEpisode} />
          ) : null}
          {recurrence.error && recurrence.data && <RefreshFailed error={recurrence.error} />}
        </div>
      </div>
    </SectionCard>
  );
}

/** Explains a null cohort: no successful collection backs it, so there are no numbers. */
function NoCohort({ collection }: { collection: ObsAlertCollectionHealth }) {
  return (
    <EmptyRow>
      No cohort statistics: alert collection is{' '}
      <StateBadge state={collection.collection_state ?? collection.state} reason={collection.reason} />
      {collection.reason ? ` (${humanize(collection.reason)})` : ''}. This is missing evidence, not a quiet fleet.
    </EmptyRow>
  );
}

function CohortCoverage({ coverage, since, asOf }: { coverage?: ObsAlertCollectionCoverage; since: string; asOf: string }) {
  return (
    <div className="space-y-2 border-b border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
      <div>
        Cohort: episodes activated since <When at={since} /> (as of <When at={asOf} />)
      </div>
      {coverage && (
        <div>
          <div className="mb-1 flex items-center gap-2">
            Collection coverage <StateBadge state={coverage.state} />
          </div>
          <CoverageBar {...coverageShares(coverage)} />
        </div>
      )}
    </div>
  );
}

function metricLine(metric: ObsAlertResponseMetric): string {
  const excluded = metric.not_observed + metric.unknown + metric.invalid_clock;
  return `${metric.samples} sample(s)${excluded ? ` · ${excluded} excluded (not observed, unknown or invalid clock)` : ''}`;
}

function ResponseTimesBody({ data }: { data: ObsAlertResponseTimes }) {
  const totals = data.totals;
  return (
    <div>
      <CohortCoverage coverage={data.coverage} since={data.since} asOf={data.as_of} />
      {!totals ? (
        <NoCohort collection={data.collection} />
      ) : totals.episodes === 0 ? (
        <EmptyRow>No alert episodes activated in this window.</EmptyRow>
      ) : (
        <div className="space-y-4 p-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <Fact
              label="Time to acknowledge (p50 / p95)"
              value={`${formatSeconds(totals.acknowledgment.p50_seconds)} / ${formatSeconds(totals.acknowledgment.p95_seconds)}`}
              sub={metricLine(totals.acknowledgment)}
            />
            <Fact
              label="Time to resolve (p50 / p95)"
              value={`${formatSeconds(totals.resolution.p50_seconds)} / ${formatSeconds(totals.resolution.p95_seconds)}`}
              sub={metricLine(totals.resolution)}
            />
            <Fact
              label="Episodes"
              value={totals.episodes}
              sub={`${totals.unresolved} unresolved · ${totals.unknown_observation} unknown observation`}
            />
            <Fact
              label="Triage receipts"
              value={`${totals.receipt_coverage.complete_episodes} complete`}
              sub={`${totals.receipt_coverage.gapped_episodes} gapped · ${totals.receipt_coverage.missing_revisions} missing revision(s)`}
            />
          </div>
          {data.groups.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Component</th>
                    <th>Episodes</th>
                    <th>Ack p50</th>
                    <th>Resolve p50</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.slice(0, 10).map((group) => (
                    <tr key={`${group.severity}/${group.component}`}>
                      <td>
                        <span className={badgeClass(severityTone(group.severity))}>{group.severity}</span>
                      </td>
                      <td className="font-mono">{group.component || '—'}</td>
                      <td className="font-mono">{group.metrics.episodes}</td>
                      <td className="font-mono">{formatSeconds(group.metrics.acknowledgment.p50_seconds)}</td>
                      <td className="font-mono">{formatSeconds(group.metrics.resolution.p50_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <Limitations items={data.limitations} />
    </div>
  );
}

function RecurrenceBody({ data, onOpenEpisode }: { data: ObsAlertRecurrence; onOpenEpisode: (episodeId: string) => void }) {
  const totals = data.totals;
  return (
    <div>
      <CohortCoverage coverage={data.coverage} since={data.since} asOf={data.as_of} />
      {!totals ? (
        <NoCohort collection={data.collection} />
      ) : totals.series === 0 ? (
        <EmptyRow>No alert series activated in this window.</EmptyRow>
      ) : (
        <div className="space-y-4 p-4 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <Fact label="Series" value={totals.series} sub={`${totals.repeated_series} repeated`} />
            <Fact label="Repeat activations" value={totals.metrics.repeat_activations} sub={`of ${totals.metrics.episodes} episode(s)`} />
            <Fact
              label="Recovery gap p50"
              value={formatSeconds(totals.metrics.recovery_gap.p50_seconds)}
              sub={`episode p50 ${formatSeconds(totals.metrics.duration.p50_seconds)}`}
            />
          </div>
          {data.items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Episodes</th>
                    <th>Repeats</th>
                    <th>Last activation</th>
                    <th>Recent episodes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.slice(0, 10).map((series) => (
                    <tr key={`${series.rule_key}/${series.series_id}`}>
                      <td>
                        <div className="cell-primary">{series.name}</div>
                        <div className="text-[var(--color-ink-muted)]">
                          <span className={badgeClass(severityTone(series.severity))}>{series.severity}</span>{' '}
                          {series.component || 'no component'}
                        </div>
                      </td>
                      <td className="font-mono">{series.metrics.episodes}</td>
                      <td className="font-mono">{series.metrics.repeat_activations}</td>
                      <td>
                        <When at={series.last_activation_at} />
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {series.recent_episodes.map((episode) => (
                            <button
                              key={episode.episode_id}
                              type="button"
                              className="badge badge-neutral cursor-pointer"
                              title={`Started ${new Date(episode.started_at).toLocaleString()}; open evidence`}
                              onClick={() => onOpenEpisode(episode.episode_id)}
                            >
                              {episode.status}
                            </button>
                          ))}
                          {series.recent_episodes_truncated && <span className="text-[var(--color-ink-muted)]">…</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data.truncated || data.items.length > 10) && (
            <p className="text-[var(--color-ink-muted)]">Showing {Math.min(10, data.items.length)} series; more exist in this cohort.</p>
          )}
        </div>
      )}
      <Limitations items={data.limitations} />
    </div>
  );
}
