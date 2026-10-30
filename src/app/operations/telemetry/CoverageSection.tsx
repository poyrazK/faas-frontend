'use client';

import React from 'react';
import {
  badgeClass,
  coverageAnswers,
  humanize,
  stateTone,
  type ObsRecordingAlertReferences,
  type ObsRecordingDependencyMapping,
  type ObsRuleCoverageItem,
  type ObsRuleCoverageSet,
  type ObsRuleCoverageTotals,
} from '@/lib/ops/telemetry';
import { FilterSelect, Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { EmptyRow, ErrorRow, Fact, Limitations, LoadingRow, Notice, RefreshFailed, StateBadge, When } from '../incidents/parts';

/** The fields rule-coverage and recording-coverage share. */
export interface CoverageView {
  generated_at: string;
  selection_source: string;
  state: string;
  reason?: string;
  fingerprint_algorithm: string;
  expected_set: ObsRuleCoverageSet | null;
  available_sets: ObsRuleCoverageSet[];
  totals: ObsRuleCoverageTotals | null;
  rows: { comparison: ObsRuleCoverageItem; dependents?: ObsRecordingAlertReferences }[];
  total_items: number;
  truncated: boolean;
  dependencies?: ObsRecordingDependencyMapping | null;
  limitations: string[];
}

/**
 * Expected-definition coverage. The server never infers which expected set a
 * deployment should run, so nothing is compared until the operator picks one.
 */
export function CoverageSection({
  title,
  noun,
  query,
  view,
  selected,
  onSelect,
}: {
  title: string;
  noun: 'alert rules' | 'recording rules';
  query: { loading: boolean; error: Error | null };
  view: CoverageView | null;
  selected: string;
  onSelect: (setId: string) => void;
}) {
  const current = view && coverageAnswers(view, selected) ? view : null;
  const sets = view?.available_sets ?? [];
  const options = [
    { value: '', label: sets.length ? 'Select expected set…' : 'No expected sets' },
    ...sets.map((set) => ({ value: set.id, label: `${set.id} · rev ${set.revision} · ${set.expected_rules} rules` })),
  ];
  // A selection the latest catalog no longer lists stays visible as itself.
  if (selected && !sets.some((set) => set.id === selected)) options.push({ value: selected, label: selected });

  return (
    <SectionCard
      title={title}
      action={
        <div className="flex items-center gap-2">
          {current && <StateBadge state={current.state} reason={current.reason} />}
          <FilterSelect value={selected} onChange={onSelect} options={options} />
        </div>
      }
    >
      {!current ? (
        query.loading ? (
          <LoadingRow label={selected ? `Comparing loaded ${noun} with ${selected}` : `Loading expected ${noun} sets`} />
        ) : query.error ? (
          <ErrorRow message={`Could not load ${noun} coverage: ${query.error.message}`} />
        ) : (
          <LoadingRow label={`Loading ${noun} coverage`} />
        )
      ) : !selected ? (
        <EmptyRow>
          {current.reason === 'expected_set_not_selected'
            ? `Choose the expected set this deployment should run. The comparison is explicit: loaded ${noun} are not assumed to be complete.`
            : `Coverage unavailable: ${humanize(current.reason || current.state)}.`}
        </EmptyRow>
      ) : (
        <div className="space-y-4 p-4 text-xs">
          {current.reason && current.state !== 'covered' && (
            <Notice tone={stateTone(current.state) === 'danger' ? 'danger' : 'warning'}>
              {humanize(current.state)}: {humanize(current.reason)}.
              {current.totals ? '' : ' No comparison was made, so coverage is unknown.'}
            </Notice>
          )}
          {current.expected_set && (
            <div className="text-[var(--color-ink-muted)]">
              Expected set <Mono>{current.expected_set.id}</Mono> rev {current.expected_set.revision} ·{' '}
              {current.expected_set.files.length} file(s) · compared <When at={current.generated_at} /> ({current.fingerprint_algorithm})
            </div>
          )}
          {current.totals && <TotalsGrid totals={current.totals} />}
          {current.dependencies && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Dependent alert mapping</span>
              <StateBadge state={current.dependencies.state} />
              <span className="text-[var(--color-ink-muted)]">
                {current.dependencies.total_alerts} alert(s) in rev {current.dependencies.alert_set_revision} ·{' '}
                {current.dependencies.uncertain_alerts.total_items} with uncertain dependencies
              </span>
            </div>
          )}
          {current.rows.length === 0 ? (
            current.totals && (
              <div className="text-[var(--color-ink-muted)]">
                {current.totals.matching === current.totals.expected_rules
                  ? 'Every expected definition matches.'
                  : 'The response carried no per-definition preview.'}
              </div>
            )
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Definition</th>
                    <th>State</th>
                    <th>Detail</th>
                    {current.dependencies !== undefined && <th>Dependent alerts</th>}
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map(({ comparison, dependents }) => (
                    <tr key={comparison.id}>
                      <td>
                        <div className="cell-primary">{comparison.rule_name}</div>
                        <div className="text-[var(--color-ink-muted)]">
                          {comparison.file_name} · {comparison.group_name}
                        </div>
                      </td>
                      <td>
                        <span className={badgeClass(stateTone(comparison.state))}>{humanize(comparison.state)}</span>
                      </td>
                      <td>
                        {comparison.reason ? humanize(comparison.reason) : '—'}
                        {comparison.changed_fields.length > 0 && (
                          <div className="text-[var(--color-ink-muted)]">changed: {comparison.changed_fields.join(', ')}</div>
                        )}
                        {comparison.observed_candidates > 1 && (
                          <div className="text-[var(--color-ink-muted)]">{comparison.observed_candidates} loaded candidates</div>
                        )}
                      </td>
                      {current.dependencies !== undefined && (
                        <td>
                          {dependents && dependents.total_items > 0 ? (
                            <span title={dependents.items.map((alert) => alert.rule_name).join(', ')}>
                              {dependents.total_items} alert(s)
                              {dependents.items.length ? `: ${dependents.items.slice(0, 3).map((alert) => alert.rule_name).join(', ')}` : ''}
                              {dependents.truncated || dependents.total_items > 3 ? '…' : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {current.truncated && (
            <p className="text-[var(--color-ink-muted)]">
              Showing {current.rows.length} of {current.total_items} definitions (problems first); totals cover all of them.
            </p>
          )}
        </div>
      )}
      {query.error && view && <RefreshFailed error={query.error} />}
      <Limitations items={current?.limitations} />
    </SectionCard>
  );
}

function TotalsGrid({ totals }: { totals: ObsRuleCoverageTotals }) {
  const tone = (n: number, bad: 'danger' | 'warning') =>
    n > 0 ? (bad === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning-bold)]') : '';
  return (
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-6">
      <Fact label="Expected" value={totals.expected_rules} sub={`${totals.observed_rules} loaded · ${totals.additional_rules} additional`} />
      <Fact label="Matching" value={totals.matching} />
      <Fact label="Missing" value={<span className={tone(totals.missing, 'danger')}>{totals.missing}</span>} />
      <Fact label="Changed" value={<span className={tone(totals.changed, 'danger')}>{totals.changed}</span>} />
      <Fact label="Ambiguous" value={<span className={tone(totals.ambiguous, 'warning')}>{totals.ambiguous}</span>} />
      <Fact
        label="Unknown"
        value={<span className={tone(totals.unknown, 'warning')}>{totals.unknown}</span>}
        sub={
          totals.invalid_observed_rules + totals.invalid_observed_groups > 0
            ? `${totals.invalid_observed_rules} invalid rule(s), ${totals.invalid_observed_groups} invalid group(s) loaded`
            : undefined
        }
      />
    </div>
  );
}
