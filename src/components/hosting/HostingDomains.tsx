'use client';

import { useCallback, useState } from 'react';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { listHostingDomains, recoverHostingDomain, createHostingDomain, deleteHostingDomain, hostingSiteURL, type HostingCapabilities, type HostingDNSRecord, type HostingDomain, type HostingSite } from '@/lib/hosting';
import { CopyButton } from '@/components/ui/bits';
import { Spinner } from '@/components/ui/States';

const stateLabels: Record<HostingDomain['state'], string> = { pending_dns: 'Waiting for DNS', pending_certificate: 'Preparing HTTPS', active: 'HTTPS ready', deleting: 'Removing domain' };
const errorLabels: Record<string, string> = { dns_pending: 'The verification TXT and DNS-only CNAME records have not both been observed.', provider_unavailable: 'Domain provisioning could not be checked. Gregale will retry.', provider_conflict: 'The domain conflicts with an existing provider resource. An operator must review it.', publication_unavailable: 'Routing publication is pending. Gregale will retry.', origin_unavailable: 'This domain’s hosting configuration needs operator attention.' };

export function HostingDomains({ site, limits, disabled }: { site: HostingSite; limits: HostingCapabilities; disabled: boolean }) {
  const fetcher = useCallback((signal: AbortSignal) => listHostingDomains(site.id, signal), [site.id]);
  const query = useHostingQuery(fetcher, 10000);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState<string | null>(null);
  const stale = !!query.error || !query.data || (needsRefresh !== null && (!query.observedAt || query.observedAt <= needsRefresh));
  const writesBlocked = disabled || busy || stale;
  const blocked = writesBlocked || site.status === 'deleting';
  async function run(action: () => Promise<unknown>, success: string) {
    if (writesBlocked) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); }
    catch (error) { setMessage((error instanceof Error ? error.message : 'Domain request failed.') + ' Refresh domains before retrying an uncertain request.'); }
    finally { setBusy(false); setNeedsRefresh(new Date().toISOString()); query.refresh(); }
  }
  return <section className="space-y-4 rounded-lg border border-[var(--color-line)] p-4" aria-label="Custom domains">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Custom domains <span className="badge badge-neutral">Internal</span></h3><button className="btn btn-secondary btn-sm" disabled={busy} onClick={query.refresh}>Refresh domains</button></div>
    <p className="text-xs text-[var(--color-ink-muted)]">Subdomains with DNS-only CNAME records are supported. Use DNS outside the hosting provider’s Cloudflare account. Every domain stays behind internal Access sign-in.</p>
    {!site.durable_routing ? <p className="text-sm">Custom domains require a site created with durable routing.</p> : <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!hostname.trim() || !limits.domains_per_site || (query.data?.length ?? 0) >= limits.domains_per_site) return; void run(async () => { await createHostingDomain(site.id, hostname.trim()); setHostname(''); }, 'Domain reserved. Add the DNS records shown below.'); }}>
      <label className="min-w-0 flex-1 text-sm">Domain<input className="field mt-1" aria-label="Custom domain hostname" required maxLength={limits.domain_hostname_max_bytes} placeholder="portal.example.com" value={hostname} onChange={(event) => setHostname(event.target.value)} disabled={blocked} /></label>
      <button className="btn btn-primary btn-sm" disabled={blocked || !limits.domains_per_site || (query.data?.length ?? 0) >= limits.domains_per_site}>Add domain</button>
      <p className="basis-full text-xs text-[var(--color-ink-muted)]">{query.data?.length ?? 0} / {limits.domains_per_site ?? 0} domains. Removing domains count until cleanup finishes. Removed hostnames stay reserved during the pilot.</p>
    </form>}
    {query.error && <p className="text-sm text-[var(--color-danger)]" role="alert">{query.error.message} Domain changes are paused.</p>}
    {!query.data && !query.error && <Spinner />}
    {busy && <p role="status" className="text-sm">Updating domain…</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {query.data?.map((domain) => <article className="space-y-3 rounded-lg bg-[var(--color-surface-subtle)] p-3" key={domain.id} aria-label={`Domain ${domain.hostname}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-all text-sm">{domain.hostname}</strong><span className={`badge ${domain.state === 'active' ? 'badge-success' : 'badge-warning'}`}>{stateLabels[domain.state]}</span></div>
      <p className="text-xs">Certificate: {domain.details.tls_status} · Routing: {domain.published_generation === domain.generation ? 'published' : 'pending'}</p>
      {domain.last_error_code && <p className="text-xs text-[var(--color-danger)]">{errorLabels[domain.last_error_code] || 'The last domain check needs attention.'}</p>}
      {domain.details.create_started_at && !domain.details.provider_id && domain.last_error_code && <DomainRecovery domain={domain} disabled={writesBlocked} recover={(providerID) => run(() => recoverHostingDomain(site.id, domain.id, domain.revision, domain.hostname, providerID), 'Provider ID bound. Provisioning or cleanup will resume.')} />}
      {domain.state !== 'active' && domain.state !== 'deleting' && <DNSInstructions records={[
        { type: 'TXT', name: `_gregale-hosting.${domain.hostname}`, value: `gregale-hosting=${domain.challenge}` },
        ...(limits.domain_cname_target ? [{ type: 'CNAME' as const, name: domain.hostname, value: limits.domain_cname_target }] : []),
        ...domain.details.records,
      ]} />}
      {domain.state === 'active' && <p className="text-xs">HTTPS and routing publication are separate checks. Edge updates may take up to 60 seconds. Opening this domain requires its own Access sign-in.</p>}
      {domain.state === 'deleting' ? <p className="text-xs">Routing is disabled before the certificate and Access configuration are removed. Keep DNS pointed here until cleanup finishes, then remove the records.</p> : <div className="flex flex-wrap gap-2">
        {domain.state === 'active' && domain.published_generation === domain.generation && hostingSiteURL(domain.hostname) && <a className="btn btn-secondary btn-sm" href={hostingSiteURL(domain.hostname)!} target="_blank" rel="noreferrer">Open domain ↗</a>}
        <button className="btn btn-ghost btn-sm text-[var(--color-danger)]" disabled={blocked} onClick={() => { if (window.confirm(`Remove ${domain.hostname}? HTTPS and routing will be removed after safe cleanup. This hostname remains reserved during the internal pilot.`)) void run(() => deleteHostingDomain(site.id, domain.id, domain.revision), 'Domain removal accepted. Cleanup continues in the background.'); }}>Remove domain</button>
      </div>}
      <p className="text-xs text-[var(--color-ink-muted)]">Next check {new Date(domain.next_attempt_at).toLocaleString()} · {domain.attempts} checks</p>
    </article>)}
  </section>;
}

function DNSInstructions({ records }: { records: HostingDNSRecord[] }) {
  return <div className="space-y-2"><p className="text-xs">Add these records at your DNS provider. Keep TXT records for verification and certificate renewal.</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Type', 'Name', 'Value', ''].map((name,index) => <th className="p-2 font-medium" key={index}>{name}</th>)}</tr></thead><tbody>{records.map((record,index) => <tr className="border-t border-[var(--color-line)]" key={index}>
    <td className="p-2">{record.type}</td><td className="max-w-xs break-all p-2 font-mono">{record.name}</td><td className="max-w-xs break-all p-2 font-mono">{record.value}</td><td className="space-y-1 p-2"><CopyButton value={record.name} label="Copy name" /><CopyButton value={record.value} label="Copy value" /></td>
  </tr>)}</tbody></table></div></div>;
}

function DomainRecovery({ domain, disabled, recover }: { domain: HostingDomain; disabled: boolean; recover: (providerID: string) => Promise<void> }) {
  const [providerID, setProviderID] = useState('');
  return <form className="space-y-2 rounded border border-[var(--color-line)] p-3" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && window.confirm(`Bind Cloudflare hostname ID ${providerID} to ${domain.hostname}? Verify the exact hostname and dedicated zone in Cloudflare first. This authorizes Gregale to manage and delete that resource.`)) void recover(providerID);
  }}>
    <p className="text-xs">The provider create result needs operator review. Gregale will not create again or adopt a hostname match. Check the dedicated zone in Cloudflare, then bind the exact hostname ID. Recovery is available after the in-flight request window closes.</p>
    <label className="block text-xs">Reviewed Cloudflare hostname ID<input className="field mt-1" value={providerID} onChange={(event) => setProviderID(event.target.value)} required pattern="[0-9a-fA-F-]{36}" maxLength={36} disabled={disabled} /></label>
    <button className="btn btn-secondary btn-sm" disabled={disabled || !providerID}>Bind reviewed provider ID</button>
  </form>;
}
