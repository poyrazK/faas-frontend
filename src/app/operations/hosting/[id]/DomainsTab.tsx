'use client';

import React, { useState } from 'react';
import {
  domainBadge,
  domainRecovery,
  getHostingPreviewCapacity,
  hostingFeatureOff,
  isUuid,
  listHostingDomains,
  listHostingPreviews,
  previewBadge,
  recoverHostingDomain,
  refreshOnConflict,
  removeHostingDomain,
  revokeHostingPreview,
  untilText,
  type HostingDomain,
  type HostingPreview,
  type HostingSite,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';
import { RowMenu, copyText } from '@/components/ui/RowMenu';
import { Mono } from '@/components/ui/bits';
import { shortId } from '@/components/operator/EntityId';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { QueryBody } from './shared';

type DomainAction =
  | { kind: 'remove'; domain: HostingDomain }
  | { kind: 'recover'; domain: HostingDomain }
  | { kind: 'revoke'; preview: HostingPreview };

const RECOVERY_DOCS = 'https://github.com/poyrazK/faas/blob/main/docs/internal-frontend-hosting-domains.md#recover-an-uncertain-hostname-create';

/** Custom domains (with the DNS records still to set) and preview URLs. */
export function DomainsTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const domains = useAsync(() => listHostingDomains(site.id), [site.id, nonce], 60_000);
  const previews = useAsync(() => listHostingPreviews(site.id), [site.id, nonce], 60_000);
  const capacity = useAsync(() => getHostingPreviewCapacity(site.id), [site.id, nonce], 60_000);
  const [action, setAction] = useState<DomainAction | null>(null);

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
                    const recovery = domainRecovery(domain);
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
                                recovery.applies && {
                                  label: 'Bind reviewed provider ID…',
                                  disabled: !!recovery.blocker,
                                  title: recovery.blocker ?? 'For a hostname create whose response was lost',
                                  onSelect: () => setAction({ kind: 'recover', domain }),
                                },
                                domain.state !== 'deleting' && { label: 'Remove domain…', tone: 'danger', onSelect: () => setAction({ kind: 'remove', domain }) },
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

      <SectionCard
        title="Preview URLs"
        action={
          capacity.data ? (
            <span
              className={`text-[11px] ${capacity.data.available === 0 ? 'font-medium text-[var(--color-warning-bold)]' : 'text-[var(--color-ink-muted)]'}`}
              title="Stored admission capacity, not edge health"
            >
              {capacity.data.available} of {capacity.data.limit} preview slots free
              {capacity.data.reservations > 0 && ` · ${capacity.data.reservations} reserved by CI`}
            </span>
          ) : capacity.error && !hostingFeatureOff(capacity.error) ? (
            <span className="text-[11px] text-[var(--color-ink-muted)]">Preview capacity unavailable</span>
          ) : undefined
        }
      >
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
                                !preview.revoked && {
                                  label: 'Revoke preview…',
                                  tone: 'danger',
                                  // apid revokes only a preview it has not changed since creating (generation 1).
                                  disabled: preview.generation !== 1,
                                  title: preview.generation !== 1 ? 'The preview changed since it was created; refresh first' : undefined,
                                  onSelect: () => setAction({ kind: 'revoke', preview }),
                                },
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

      {action?.kind === 'remove' && (
        <OperatorActionDialog
          open
          title="Remove custom domain"
          tone="danger"
          reason="none"
          confirmText={action.domain.hostname}
          submitLabel="Remove domain"
          fingerprint={`${action.domain.id}|${action.domain.revision}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Stops serving the site on <Mono>{action.domain.hostname}</Mono>. Gregale publishes a disabled alias at once, then deletes
                the Cloudflare hostname and this record after cleanup.
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                Keep DNS pointed at Gregale until the domain disappears from this list, so cleanup can finish.
              </p>
            </div>
          }
          onClose={() => setAction(null)}
          onSubmit={async ({ idempotencyKey }) => {
            await refreshOnConflict(
              () => removeHostingDomain(site.id, action.domain.id, action.domain.revision, { idempotencyKey }),
              domains.reload,
            );
            domains.reload();
            return `Removing ${action.domain.hostname}`;
          }}
        />
      )}

      {action?.kind === 'recover' && <RecoverDomainDialog site={site} domain={action.domain} onClose={() => setAction(null)} onDone={domains.reload} />}

      {action?.kind === 'revoke' && (
        <OperatorActionDialog
          open
          title="Revoke preview"
          tone="danger"
          reason="none"
          submitLabel="Revoke preview"
          fingerprint={`${action.preview.id}|${action.preview.generation}`}
          impact={
            <p>
              Takes <Mono>{action.preview.hostname}</Mono> offline now. A revoked preview cannot be restored; CI has to start a new run to
              publish another one.
            </p>
          }
          onClose={() => setAction(null)}
          onSubmit={async ({ idempotencyKey }) => {
            await refreshOnConflict(
              () => revokeHostingPreview(site.id, action.preview.id, action.preview.generation, { idempotencyKey }),
              previews.reload,
            );
            previews.reload();
            return `Revoked ${action.preview.hostname}`;
          }}
        />
      )}
    </div>
  );
}

/**
 * apid never repeats a hostname create whose response was lost: an operator
 * finds the exact Cloudflare resource for that attempt and binds its ID.
 * apid checks it (zone, hostname, certificate mode, no custom origin) before
 * binding; binding neither enables routing nor cancels a removal.
 */
function RecoverDomainDialog({
  site,
  domain,
  onClose,
  onDone,
}: {
  site: HostingSite;
  domain: HostingDomain;
  onClose: () => void;
  onDone: () => void;
}) {
  const [providerId, setProviderId] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = isUuid(providerId);
  return (
    <OperatorActionDialog
      open
      title="Bind reviewed provider ID"
      tone="warning"
      reason="none"
      confirmText={domain.hostname}
      submitLabel="Bind provider ID"
      canSubmit={valid}
      fingerprint={`${domain.id}|${domain.revision}|${providerId.trim()}`}
      impact={
        <div className="space-y-1.5">
          <p>
            Binds the Cloudflare custom hostname you reviewed to <Mono>{domain.hostname}</Mono> and authorizes Gregale to manage and
            delete it. Provisioning or cleanup resumes on the next pass.
          </p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            Find the exact resource created for this attempt in the zone&apos;s custom hostnames, using provider audit evidence: a matching
            hostname alone is not proof of ownership.{' '}
            <a href={RECOVERY_DOCS} target="_blank" rel="noreferrer" className="underline">
              Recovery procedure
            </a>
          </p>
        </div>
      }
      onClose={onClose}
      onSubmit={async ({ idempotencyKey }) => {
        await refreshOnConflict(() => recoverHostingDomain(site.id, domain, providerId.trim(), { idempotencyKey }), onDone);
        onDone();
        return `Bound the provider hostname for ${domain.hostname}`;
      }}
    >
      <div>
        <label className="label" htmlFor="hosting-domain-provider-id">
          Cloudflare custom hostname ID
        </label>
        <input
          id="hosting-domain-provider-id"
          className="field field-sm font-mono"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
        />
        {touched && !valid && <p className="mt-1 text-xs text-[var(--color-danger)]">The exact provider UUID.</p>}
      </div>
    </OperatorActionDialog>
  );
}
