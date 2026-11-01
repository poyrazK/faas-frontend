'use client';

import React, { useState } from 'react';
import {
  formatBytes,
  getHostingDiagnostics,
  getHostingHistory,
  getHostingSiteStatus,
  listHostingReleases,
  provenanceLine,
  publicationSummary,
  releaseBadge,
  RETRY_ADVICE,
  type HostingSite,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';
import { RowMenu, copyText } from '@/components/ui/RowMenu';
import { shortId } from '@/components/operator/EntityId';
import { ChecksList, QueryBody } from './shared';

/** What is live and how it got there: publication, production checks, releases and promotions. */
export function ReleasesTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const status = useAsync(() => getHostingSiteStatus(site.id), [site.id, nonce], 30_000);
  const diagnostics = useAsync(() => getHostingDiagnostics(site.id), [site.id, nonce]);
  const releases = useAsync(() => listHostingReleases(site.id), [site.id, nonce]);
  const [before, setBefore] = useState<number | undefined>(undefined);
  const history = useAsync(() => getHostingHistory(site.id, before), [site.id, nonce, before]);

  const publication = status.data ? publicationSummary(status.data.publication) : null;

  return (
    <div className="space-y-6">
      <SectionCard
        title="Production"
        action={publication && <span className={`badge ${publication.tone}`}>{publication.label}</span>}
      >
        <QueryBody query={status} noun="publication status" icon="globe" empty={{ title: '' }} isEmpty={() => false}>
          {(data) => (
            <div className="space-y-1 px-5 py-4 text-xs">
              <p>{publicationSummary(data.publication).detail}</p>
              {data.publication.published_at && (
                <p className="text-[var(--color-ink-muted)]">Last published {relativeTime(data.publication.published_at)}.</p>
              )}
              {data.publication.state === 'pending' && data.publication.next_attempt_at && (
                <p className="text-[var(--color-ink-muted)]">Next attempt {new Date(data.publication.next_attempt_at).toLocaleTimeString()}.</p>
              )}
            </div>
          )}
        </QueryBody>
        <div className="border-t border-[var(--color-line)]">
          <QueryBody query={diagnostics} noun="diagnostics" icon="shield" empty={{ title: 'No checks returned' }} isEmpty={(d) => !d.checks.length}>
            {(data) => (
              <>
                <p className="px-5 pt-3 text-xs font-medium">{RETRY_ADVICE[data.retry_advice] ?? data.retry_advice}</p>
                <ChecksList checks={data.checks} />
              </>
            )}
          </QueryBody>
        </div>
      </SectionCard>

      <SectionCard title="Releases">
        <QueryBody
          query={releases}
          noun="releases"
          icon="deployments"
          empty={{ title: 'No releases', hint: 'Nothing has been staged on this site yet.' }}
          isEmpty={(rows) => !rows.length}
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>State</th>
                    <th>Source</th>
                    <th>Size</th>
                    <th>Staged</th>
                    <th>First live</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                    .map((release) => {
                      const badge = releaseBadge(release.state);
                      const live = release.id === site.active_release_id;
                      return (
                        <tr key={release.id}>
                          <td className="nowrap">
                            <span className="font-mono" title={release.id}>
                              {shortId(release.id)}
                            </span>
                            {live && <span className="badge badge-success ml-2">Live</span>}
                          </td>
                          <td className="nowrap">
                            <span className={`badge ${badge.tone}`}>{badge.label}</span>
                          </td>
                          <td className="nowrap font-mono">{provenanceLine(release.provenance) ?? <span className="text-[var(--color-ink-muted)]">—</span>}</td>
                          <td className="nowrap">
                            {release.manifest.files.length} files · {formatBytes(release.artifact_bytes)}
                          </td>
                          <td className="nowrap">{relativeTime(release.created_at)}</td>
                          <td className="nowrap">{release.first_promoted_at ? relativeTime(release.first_promoted_at) : 'Never'}</td>
                          <td className="cell-menu">
                            <RowMenu
                              label={`Actions for release ${shortId(release.id)}`}
                              items={[
                                { label: 'Copy release ID', onSelect: () => copyText(release.id) },
                                !!release.provenance?.commit_sha && { label: 'Copy commit SHA', onSelect: () => copyText(release.provenance?.commit_sha ?? '') },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>
      </SectionCard>

      <SectionCard
        title="Promotion history"
        action={
          before !== undefined && (
            <button className="btn btn-secondary btn-xs" onClick={() => setBefore(undefined)}>
              Newest
            </button>
          )
        }
      >
        <QueryBody
          query={history}
          noun="promotion history"
          icon="clock"
          empty={{ title: 'No promotions', hint: 'No release has been put live on this site.' }}
          isEmpty={(page) => !page.events.length}
        >
          {(page) => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Revision</th>
                      <th>Put live</th>
                      <th>Replaced</th>
                      <th>By</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.events.map((event) => (
                      <tr key={event.revision}>
                        <td className="nowrap font-mono">
                          {event.previous_revision} → {event.revision}
                        </td>
                        <td className="nowrap">
                          <span className="font-mono" title={event.release_id}>
                            {shortId(event.release_id)}
                          </span>
                          {provenanceLine(event.provenance) && (
                            <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">{provenanceLine(event.provenance)}</div>
                          )}
                        </td>
                        <td className="nowrap font-mono">{event.previous_release_id ? shortId(event.previous_release_id) : '—'}</td>
                        <td className="nowrap">
                          <span className="font-mono" title={event.actor.account_id}>
                            {shortId(event.actor.account_id)}
                          </span>
                          <div className="text-[11px] text-[var(--color-ink-muted)]">{event.actor.key_id ? `API key ${shortId(event.actor.key_id)}` : 'Session'}</div>
                        </td>
                        <td className="nowrap">{relativeTime(event.accepted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-foot">
                <span>Keeps the last {page.retention_limit} promotions.</span>
                {page.next_before_revision ? (
                  <button className="btn btn-secondary btn-xs" onClick={() => setBefore(page.next_before_revision)}>
                    Older
                  </button>
                ) : null}
              </div>
            </>
          )}
        </QueryBody>
      </SectionCard>
    </div>
  );
}
