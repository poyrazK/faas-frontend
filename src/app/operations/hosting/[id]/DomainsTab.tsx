'use client';

import React from 'react';
import { domainBadge, listHostingDomains, listHostingPreviews, previewBadge, untilText, type HostingSite } from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';
import { RowMenu, copyText } from '@/components/ui/RowMenu';
import { shortId } from '@/components/operator/EntityId';
import { QueryBody } from './shared';

/** Custom domains (with the DNS records still to set) and preview URLs. */
export function DomainsTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const domains = useAsync(() => listHostingDomains(site.id), [site.id, nonce], 60_000);
  const previews = useAsync(() => listHostingPreviews(site.id), [site.id, nonce], 60_000);

  return (
    <div className="space-y-6">
      <SectionCard title="Custom domains">
        <QueryBody
          query={domains}
          noun="custom domains"
          icon="domains"
          empty={{ title: 'No custom domains', hint: `The site is served on ${site.hostname} only.` }}
          isEmpty={(rows) => !rows.length}
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>State</th>
                    <th>TLS</th>
                    <th>Attempts</th>
                    <th>Added</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((domain) => {
                    const badge = domainBadge(domain.state);
                    const records = domain.state === 'active' ? [] : domain.details.records ?? [];
                    return (
                      <React.Fragment key={domain.id}>
                        <tr>
                          <td className="nowrap">
                            <span className="cell-primary font-mono">{domain.hostname}</span>
                            {domain.last_error_code && (
                              <div className="font-mono text-[11px] text-[var(--color-danger)]">{domain.last_error_code}</div>
                            )}
                          </td>
                          <td className="nowrap">
                            <span className={`badge ${badge.tone}`}>{badge.label}</span>
                          </td>
                          <td className="nowrap font-mono">{domain.details.tls_status || '—'}</td>
                          <td className="nowrap">
                            {domain.attempts}
                            {domain.state !== 'active' && Date.parse(domain.next_attempt_at) > Date.now() && (
                              <div className="text-[11px] text-[var(--color-ink-muted)]">next {untilText(domain.next_attempt_at)}</div>
                            )}
                          </td>
                          <td className="nowrap">{relativeTime(domain.created_at)}</td>
                          <td className="cell-menu">
                            <RowMenu
                              label={`Actions for domain ${domain.hostname}`}
                              items={[
                                { label: `Visit ${domain.hostname}`, href: `https://${domain.hostname}`, external: true },
                                records.length > 0 && {
                                  label: 'Copy DNS records',
                                  onSelect: () => copyText(records.map((r) => `${r.name} ${r.type} ${r.value}`).join('\n')),
                                },
                                { label: 'Copy domain ID', onSelect: () => copyText(domain.id) },
                              ]}
                            />
                          </td>
                        </tr>
                        {records.length > 0 && (
                          <tr>
                            <td colSpan={6} className="bg-[var(--color-surface-subtle)]">
                              <div className="mb-1 text-[11px] font-medium text-[var(--color-ink-soft)]">Still to set in DNS:</div>
                              <ul className="space-y-0.5 font-mono text-[11px]">
                                {records.map((record) => (
                                  <li key={`${record.type}-${record.name}-${record.value}`} className="break-all">
                                    {record.name} <span className="text-[var(--color-ink-muted)]">{record.type}</span> {record.value}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>
      </SectionCard>

      <SectionCard title="Preview URLs">
        <QueryBody
          query={previews}
          noun="preview URLs"
          icon="globe"
          empty={{ title: 'No preview URLs', hint: 'CI runs with the preview permission publish them here.' }}
          isEmpty={(rows) => !rows.length}
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Preview</th>
                    <th>State</th>
                    <th>Release</th>
                    <th>Expires</th>
                    <th>Created</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                    .map((preview) => {
                      const badge = previewBadge(preview);
                      const live = badge.label === 'Live';
                      return (
                        <tr key={preview.id}>
                          <td className="nowrap">
                            {live ? (
                              <a href={`https://${preview.hostname}`} target="_blank" rel="noreferrer" className="cell-primary font-mono hover:underline">
                                {preview.hostname}
                              </a>
                            ) : (
                              <span className="cell-primary font-mono text-[var(--color-ink-muted)]">{preview.hostname}</span>
                            )}
                            {preview.last_error_code && (
                              <div className="font-mono text-[11px] text-[var(--color-danger)]">{preview.last_error_code}</div>
                            )}
                          </td>
                          <td className="nowrap">
                            <span className={`badge ${badge.tone}`}>{badge.label}</span>
                          </td>
                          <td className="nowrap font-mono">{shortId(preview.release_id)}</td>
                          <td className="nowrap">{untilText(preview.expires_at)}</td>
                          <td className="nowrap">{relativeTime(preview.created_at)}</td>
                          <td className="cell-menu">
                            <RowMenu
                              label={`Actions for preview ${preview.hostname}`}
                              items={[
                                { label: 'Copy preview URL', onSelect: () => copyText(`https://${preview.hostname}`) },
                                { label: 'Copy release ID', onSelect: () => copyText(preview.release_id) },
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
    </div>
  );
}
