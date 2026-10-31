'use client';

import React from 'react';
import Link from 'next/link';
import { SectionCard } from '@/components/ui/Panels';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useUrlText } from '@/lib/useUrlState';
import { nodeHref } from '@/lib/routes';
import { listComputeNodes } from '@/lib/ops/nodes';
import {
  evaluateReleaseStatus,
  observedReleases,
  READINESS_FAILURE_LABEL,
  RELEASE_HEARTBEAT_STALENESS_MS,
  RELEASE_SHA,
} from '@/lib/ops/releaseStatus';
import { CopyLinkButton, EntityId, shortId } from '@/components/operator/EntityId';

const POLL_MS = 15_000;

/**
 * "Is every active node on release X?" — compute-nodes release-status in the
 * console. The desired release lives in the URL (?release=), so a rollout
 * channel can link straight to the check; it rechecks every 15 s.
 */
export function ReleaseConvergence() {
  const release = useUrlText('release', { delayMs: 300 });
  const desired = release.value.toLowerCase();
  const valid = RELEASE_SHA.test(desired);
  // The CLI reads active nodes only (no include_inactive).
  const nodes = useAsync(() => listComputeNodes(false), [], valid ? POLL_MS : 0);
  const active = nodes.data ?? [];
  const report = valid && nodes.data ? evaluateReleaseStatus(active, desired) : null;
  const notReady = report?.nodes.filter((node) => !node.ready).length ?? 0;
  const picks = observedReleases(active);

  return (
    <SectionCard title="Release convergence">
      <div className="space-y-3 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="field field-sm w-full font-mono sm:w-[26rem]"
            placeholder="Desired release: 40-character git SHA"
            value={release.draft}
            onChange={(event) => release.setDraft(event.target.value.trim())}
            spellCheck={false}
            autoComplete="off"
            aria-label="Desired release"
          />
          {picks.map((pick) => (
            <button
              key={pick.release}
              type="button"
              className={`btn btn-xs ${pick.release === desired ? 'btn-primary' : 'btn-secondary'}`}
              title={`Check against ${pick.release}`}
              onClick={() => release.setDraft(pick.release)}
            >
              <span className="font-mono">{pick.release.slice(0, 10)}</span> · {pick.count} node{pick.count === 1 ? '' : 's'}
            </button>
          ))}
        </div>

        {release.draft && !RELEASE_SHA.test(release.draft.toLowerCase()) && (
          <p className="text-[var(--color-warning-bold)]">A release is a 40-character lowercase git SHA.</p>
        )}
        {!release.draft && (
          <p className="text-[var(--color-ink-muted)]">
            Enter the release a rollout should have reached, or pick one the active nodes report. A node is ready when it
            is active, reports that release and sent a heartbeat in the last {RELEASE_HEARTBEAT_STALENESS_MS / 1000} s.
          </p>
        )}
        {nodes.error && !nodes.data && (
          <p role="alert" className="text-[var(--color-danger)]">
            Could not list active nodes: {nodes.error.message}
          </p>
        )}

        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2" role="status">
              {report.ready ? (
                <span className="badge badge-success">Converged</span>
              ) : (
                <span className="badge badge-warning">Not converged</span>
              )}
              <span>
                {report.failureReason === 'no_active_nodes'
                  ? 'No compute node is active.'
                  : report.ready
                    ? `All ${report.activeNodeCount} active nodes run ${shortId(desired, 10)} with a fresh heartbeat.`
                    : `${notReady} of ${report.activeNodeCount} active nodes are not ready on ${shortId(desired, 10)}.`}
              </span>
              <span className="text-[var(--color-ink-muted)]">Rechecks every {POLL_MS / 1000} s.</span>
              <CopyLinkButton href={`/nodes?release=${desired}`} />
            </div>
            {report.nodes.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Reported release</th>
                      <th>Lifecycle</th>
                      <th>Last heartbeat</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.nodes.map((node) => (
                      <tr key={node.name}>
                        <td>
                          <Link href={nodeHref(node.name)} className="cell-primary hover:underline">
                            {node.name}
                          </Link>
                        </td>
                        <td>{node.observedRelease ? <EntityId id={node.observedRelease} chars={10} /> : '—'}</td>
                        <td>{node.lifecycle}</td>
                        <td title={node.lastHeartbeatAt}>{node.lastHeartbeatAt ? relativeTime(node.lastHeartbeatAt) : 'Never'}</td>
                        <td>
                          {node.ready ? (
                            <span className="badge badge-success">Ready</span>
                          ) : (
                            <span className="badge badge-warning">{READINESS_FAILURE_LABEL[node.failure!]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
