'use client';

import React, { useState } from 'react';
import {
  checkBadge,
  getHostingActivity,
  getHostingDiagnostics,
  provenanceLine,
  RETRY_ADVICE,
  untilText,
  type HostingSite,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { RowMenu, copyText, rowOpener } from '@/components/ui/RowMenu';
import { EntityId, shortId } from '@/components/operator/EntityId';
import { ChecksList, QueryBody } from './shared';

/**
 * CI runs against the site, newest first. A run is stored intent and what
 * apid observed of it; it says nothing about the GitHub job or whether the
 * preview is reachable. A row opens that run's diagnostics (?run=<id>).
 */
export function ActivityTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const [params, setParams] = useUrlParams();
  const runId = params.get('run');
  // Cursors for the pages before this one, so "Newer" can step back.
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors[cursors.length - 1];
  const activity = useAsync(() => getHostingActivity(site.id, before), [site.id, nonce, before], 60_000);

  return (
    <>
      <SectionCard
        title="CI runs"
        action={
          activity.data && !activity.data.source_labels_included ? (
            <span className="text-[11px] text-[var(--color-ink-muted)]">Source labels hidden: promotion history is off</span>
          ) : undefined
        }
      >
        <QueryBody
          query={activity}
          noun="CI runs"
          icon="queues"
          empty={{ title: 'No CI runs', hint: 'No automation credential or GitHub trust has staged a release on this site yet.' }}
          isEmpty={(page) => !page.entries.length}
        >
          {(page) => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>State</th>
                      <th>Source</th>
                      <th>Release</th>
                      <th>Preview window</th>
                      <th>Started</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.entries.map((entry) => {
                      const badge = checkBadge(entry.state);
                      const open = () => setParams({ run: entry.run_id });
                      return (
                        <tr key={entry.run_id} {...rowOpener(open, `Open run ${shortId(entry.run_id)}`)}>
                          <td className="nowrap font-mono">
                            <span className="cell-primary">{shortId(entry.run_id)}</span>
                          </td>
                          <td className="nowrap">
                            <span className={`badge ${badge.tone}`}>{badge.label}</span>
                          </td>
                          <td className="nowrap font-mono">{provenanceLine(entry.provenance) ?? <span className="text-[var(--color-ink-muted)]">—</span>}</td>
                          <td className="nowrap font-mono">
                            {entry.release_id ? shortId(entry.release_id) : '—'}
                            {entry.release_id === site.active_release_id && <span className="badge badge-success ml-2">Live</span>}
                          </td>
                          <td className="nowrap">
                            {Date.parse(entry.preview_expires_at) > Date.now() ? `ends ${untilText(entry.preview_expires_at)}` : `ended ${untilText(entry.preview_expires_at)}`}
                          </td>
                          <td className="nowrap">{relativeTime(entry.created_at)}</td>
                          <td className="cell-menu">
                            <RowMenu
                              label={`Actions for run ${shortId(entry.run_id)}`}
                              items={[
                                { label: 'Diagnose run', onSelect: open },
                                { label: 'Copy run ID', onSelect: () => copyText(entry.run_id) },
                                !!entry.release_id && { label: 'Copy release ID', onSelect: () => copyText(entry.release_id) },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="table-foot">
                <span>Serving health is not checked: apid does not test DNS, TLS or sign-in for these runs.</span>
                <span className="flex gap-1">
                  {cursors.length > 0 && (
                    <button className="btn btn-secondary btn-xs" onClick={() => setCursors((c) => c.slice(0, -1))}>
                      Newer
                    </button>
                  )}
                  {page.next_cursor && (
                    <button className="btn btn-secondary btn-xs" onClick={() => setCursors((c) => [...c, page.next_cursor as string])}>
                      Older
                    </button>
                  )}
                </span>
              </div>
            </>
          )}
        </QueryBody>
      </SectionCard>

      {runId && <RunDiagnostics site={site} runId={runId} onClose={() => setParams({ run: null })} />}
    </>
  );
}

function RunDiagnostics({ site, runId, onClose }: { site: HostingSite; runId: string; onClose: () => void }) {
  const diagnostics = useAsync(() => getHostingDiagnostics(site.id, runId), [site.id, runId]);
  const data = diagnostics.data;
  return (
    <Modal open title={`CI run ${shortId(runId)}`} width={640} onClose={onClose}>
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--color-ink-muted)]">
          <span>
            Run <EntityId id={runId} href={null} />
          </span>
          {data?.release_id && (
            <span>
              Release <EntityId id={data.release_id} href={null} />
            </span>
          )}
          {data?.preview_id && (
            <span>
              Preview <EntityId id={data.preview_id} href={null} />
            </span>
          )}
        </div>
        <div className="-mx-5 border-y border-[var(--color-line)]">
          <QueryBody query={diagnostics} noun="diagnostics" icon="shield" empty={{ title: 'No checks returned' }} isEmpty={(d) => !d.checks.length}>
            {(report) => (
              <>
                <p className="px-5 pt-3 font-medium">{RETRY_ADVICE[report.retry_advice] ?? report.retry_advice}</p>
                <ChecksList checks={report.checks} />
              </>
            )}
          </QueryBody>
        </div>
        {data && <p className="text-[var(--color-ink-faint)]">Observed {new Date(data.observed_at).toLocaleString()}.</p>}
      </div>
    </Modal>
  );
}
