'use client';

import React, { useEffect, useState } from 'react';
import {
  cleanupBadge,
  CLEANUP_REASONS,
  durationText,
  formatBytes,
  getHostingCleanupPlan,
  refreshOnConflict,
  releaseBadge,
  retentionHoursError,
  RETENTION_HOURS_MAX,
  RETENTION_HOURS_MIN,
  setHostingRetention,
  untilText,
  type HostingRetentionPolicy,
  type HostingRetentionRules,
  type HostingSite,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';
import { Mono } from '@/components/ui/bits';
import { shortId } from '@/components/operator/EntityId';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { QueryBody } from './shared';

/**
 * The site's retention policy and apid's cleanup plan: which releases a
 * retention pass would retire now and why the rest are kept. The plan is an
 * observation; only an enabled policy lets the background pass act on it.
 */
export function RetentionSection({ site, nonce }: { site: HostingSite; nonce: number }) {
  const plan = useAsync(() => getHostingCleanupPlan(site.id), [site.id, nonce]);
  const [editing, setEditing] = useState(false);
  // apid stores a policy only for an active site with durable routing (409 otherwise).
  const blocker = site.status !== 'active' || !site.durable_routing ? 'The site needs to be active with durable routing.' : null;

  return (
    <>
      <SectionCard
        title="Retention"
        action={
          plan.data && (
            <button
              className="btn btn-secondary btn-xs"
              disabled={!!blocker}
              title={blocker ?? undefined}
              onClick={() => setEditing(true)}
            >
              Edit policy
            </button>
          )
        }
      >
        <QueryBody query={plan} noun="cleanup plan" icon="clock" empty={{ title: '' }} isEmpty={() => false}>
          {(data) => (
            <>
              <PolicySummary policy={data.policy} />
              {data.entries.length === 0 ? (
                <p className="px-5 pb-4 text-xs text-[var(--color-ink-muted)]">No releases to evaluate.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="dtable text-xs">
                    <thead>
                      <tr>
                        <th>Release</th>
                        <th>State</th>
                        <th>Cleanup</th>
                        <th>Why</th>
                        <th className="text-right">Reserved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((entry) => {
                        const verdict = cleanupBadge(entry, data.policy.enabled);
                        const state = releaseBadge(entry.state);
                        return (
                          <tr key={entry.release_id}>
                            <td className="nowrap font-mono" title={entry.release_id}>
                              {shortId(entry.release_id)}
                              {entry.release_id === site.active_release_id && <span className="badge badge-success ml-2">Live</span>}
                            </td>
                            <td className="nowrap">
                              <span className={`badge ${state.tone}`}>{state.label}</span>
                            </td>
                            <td className="nowrap">
                              <span className={`badge ${verdict.tone}`}>{verdict.label}</span>
                            </td>
                            <td className="min-w-[16rem]">
                              {CLEANUP_REASONS[entry.reason] ?? entry.reason}
                              {entry.reason === 'recent_activity' && entry.eligible_at && (
                                <span className="text-[var(--color-ink-muted)]"> Eligible {untilText(entry.eligible_at)}.</span>
                              )}
                            </td>
                            <td className="nowrap text-right">{formatBytes(entry.reserved_bytes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="table-foot">
                <span>
                  {data.reclaimable_reserved_bytes > 0
                    ? `${formatBytes(data.reclaimable_reserved_bytes)} ${data.policy.enabled ? 'is retired on the next pass' : 'could be reclaimed'}`
                    : 'Nothing is eligible now'}
                  {data.retiring_reserved_bytes > 0 && ` · ${formatBytes(data.retiring_reserved_bytes)} already retiring`}. Reserved space counts
                  both stored copies and a manifest per release. Evaluated {relativeTime(data.evaluated_at)}.
                </span>
              </div>
            </>
          )}
        </QueryBody>
      </SectionCard>

      {editing && plan.data && (
        <RetentionDialog
          site={site}
          policy={plan.data.policy}
          onClose={() => setEditing(false)}
          onDone={plan.reload}
        />
      )}
    </>
  );
}

function PolicySummary({ policy }: { policy: HostingRetentionPolicy }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 text-xs sm:flex-row sm:items-start sm:gap-3">
      <span className={`badge ${policy.enabled ? 'badge-success' : 'badge-neutral'} self-start`}>{policy.enabled ? 'On' : 'Off'}</span>
      <div className="min-w-0 space-y-0.5">
        <p>
          {policy.enabled ? 'Retires' : 'When turned on, retires'} unfinished uploads idle for {durationText(policy.pending_age_seconds)} and CI
          releases never put live, idle for {durationText(policy.staged_age_seconds)}. Live, previously live and preview releases are always
          kept.
        </p>
        <p className="text-[var(--color-ink-muted)]">
          {policy.revision === 0
            ? 'No policy has been set for this site; these are the defaults.'
            : `Revision ${policy.revision}${policy.updated_at ? `, updated ${relativeTime(policy.updated_at)}` : ''}.`}
        </p>
      </div>
    </div>
  );
}

const hoursOf = (seconds: number) => String(Math.round(seconds / 3600));

/** Edits the policy, previewing what the new ages would make eligible before it is saved. */
function RetentionDialog({
  site,
  policy,
  onClose,
  onDone,
}: {
  site: HostingSite;
  policy: HostingRetentionPolicy;
  onClose: () => void;
  onDone: () => void;
}) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [pending, setPending] = useState(hoursOf(policy.pending_age_seconds));
  const [staged, setStaged] = useState(hoursOf(policy.staged_age_seconds));
  const pendingError = retentionHoursError(pending);
  const stagedError = retentionHoursError(staged);
  const valid = !pendingError && !stagedError;
  const rules: HostingRetentionRules = { pending_age_seconds: Number(pending) * 3600, staged_age_seconds: Number(staged) * 3600 };
  const changed =
    enabled !== policy.enabled || rules.pending_age_seconds !== policy.pending_age_seconds || rules.staged_age_seconds !== policy.staged_age_seconds;

  // Ask apid what these ages would make eligible, once typing settles.
  const [asked, setAsked] = useState<HostingRetentionRules | null>(null);
  useEffect(() => {
    if (!valid) return;
    const timer = setTimeout(() => setAsked({ pending_age_seconds: Number(pending) * 3600, staged_age_seconds: Number(staged) * 3600 }), 400);
    return () => clearTimeout(timer);
  }, [pending, staged, valid]);
  const preview = useAsync(
    () => (asked ? getHostingCleanupPlan(site.id, asked) : Promise.resolve(null)),
    [site.id, asked?.pending_age_seconds, asked?.staged_age_seconds],
  );
  const eligible = preview.data?.entries.filter((entry) => entry.eligible) ?? [];

  return (
    <OperatorActionDialog
      open
      title="Edit retention policy"
      tone={enabled && !policy.enabled ? 'warning' : 'default'}
      reason="none"
      submitLabel="Save policy"
      canSubmit={valid && changed}
      fingerprint={`${enabled}|${rules.pending_age_seconds}|${rules.staged_age_seconds}|${policy.revision}`}
      impact={
        <p>
          Sets how long <Mono>{site.hostname}</Mono> keeps releases that never went live. While the policy is on, a background pass retires
          eligible releases and deletes their files; a retired release cannot be put live. Live, previously live and preview releases are always
          kept.
        </p>
      }
      onClose={onClose}
      onSubmit={async () => {
        await refreshOnConflict(
          () => setHostingRetention(site.id, { enabled, rules, expectedRevision: policy.revision }),
          onDone,
        );
        onDone();
        return enabled ? `Retention is on for ${site.name}` : `Retention is off for ${site.name}`;
      }}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Retire eligible releases automatically
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <HoursField id="hosting-retention-pending" label="Unfinished uploads, idle hours" value={pending} onChange={setPending} error={pendingError} />
          <HoursField id="hosting-retention-staged" label="Unused CI releases, idle hours" value={staged} onChange={setStaged} error={stagedError} />
        </div>
        <div role="status" className="rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs">
          {!valid ? (
            'Fix the ages to see what they would retire.'
          ) : preview.error ? (
            <span className="text-[var(--color-danger)]">Could not preview: {preview.error.message}</span>
          ) : !preview.data || preview.loading ? (
            'Checking what these ages would retire…'
          ) : eligible.length === 0 ? (
            'With these ages nothing is eligible now.'
          ) : (
            <>
              With these ages {eligible.length} {eligible.length === 1 ? 'release is' : 'releases are'} eligible now:{' '}
              <span className="font-mono">{eligible.map((entry) => shortId(entry.release_id)).join(', ')}</span> (
              {formatBytes(preview.data.reclaimable_reserved_bytes)} reserved).
              {enabled ? ' The next retention pass retires them.' : ' Nothing is retired while the policy is off.'}
            </>
          )}
        </div>
      </div>
    </OperatorActionDialog>
  );
}

function HoursField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field field-sm"
        type="number"
        inputMode="numeric"
        min={RETENTION_HOURS_MIN}
        max={RETENTION_HOURS_MAX}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={`mt-1 text-[11px] ${error ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}`}>
        {error ?? (Number(value) >= 24 ? durationText(Number(value) * 3600) : `${RETENTION_HOURS_MIN}–${RETENTION_HOURS_MAX} hours`)}
      </p>
    </div>
  );
}
