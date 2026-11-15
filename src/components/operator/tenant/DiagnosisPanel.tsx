'use client';

import React from 'react';
import Link from 'next/link';
import {
  ATTENTION_KIND_LABELS,
  CUSTOMER_VISIBLE_KINDS,
  diagnosisAttention,
  kindLabel,
  RESTRICTION_LABELS,
  type ObsAttentionSignal,
  type ObsTenantDiagnosis,
} from '@/lib/ops/accountHealth';
import { relativeTime } from '@/lib/format';
import { SectionCard } from '@/components/ui/Panels';
import { Mono } from '@/components/ui/bits';

/* Why this account may not be working: the `diagnosis` section of the
   tenant 360 (apid ADR-20261112170000). Restrictions, stuck-customer signals,
   failed deployments, custom-domain problems and the API requests the
   customer was refused. Sections apid could not read are named, so an empty
   list never reads as "fine". */
export function DiagnosisPanel({ diagnosis, loading }: { diagnosis?: ObsTenantDiagnosis | null; loading?: boolean }) {
  if (!diagnosis) {
    return (
      <SectionCard title="Diagnosis">
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">
          {loading ? 'Loading diagnosis…' : 'This apid build does not send a diagnosis.'}
        </p>
      </SectionCard>
    );
  }
  const d = diagnosis;
  const count = diagnosisAttention(d);
  const signals = d.attention_signals ?? [];
  const errors = d.customer_errors;
  return (
    <SectionCard
      title={
        <div className="flex items-center gap-2">
          <h2 className="card-title">Diagnosis</h2>
          <span className={`badge ${count > 0 ? 'badge-danger' : 'badge-success'}`}>
            {count > 0 ? `${count} need${count === 1 ? 's' : ''} attention` : 'Nothing blocking'}
          </span>
        </div>
      }
      action={<span className="text-[11px] text-[var(--color-ink-muted)]">checked {relativeTime(d.generated_at)}</span>}
    >
      <div className="divide-y divide-[var(--color-line)] text-xs">
        {d.unavailable && d.unavailable.length > 0 && (
          <p className="px-4 py-2 text-[var(--color-warning)]">
            Could not read: {d.unavailable.join(', ')}. Those sections are unknown, not empty.
          </p>
        )}

        <Block title="Restrictions" empty="None.">
          {(d.restrictions ?? []).map((r, i) => (
            <li key={`${r.kind}-${i}`}>
              <span className="badge badge-danger">{kindLabel(RESTRICTION_LABELS, r.kind)}</span>
              {r.reason && <span className="ml-2 text-[var(--color-ink-muted)]">{r.reason}</span>}
              {r.since && <span className="ml-2 text-[var(--color-ink-muted)]">since {relativeTime(r.since)}</span>}
            </li>
          ))}
        </Block>

        <Block title="May be stuck" empty="No signals." action={<Link href="/attention" className="text-[11px] underline">All stuck customers</Link>}>
          {signals.map((s) => (
            <SignalRow key={s.id} signal={s} />
          ))}
        </Block>

        <Block title="Failed deployments, last 7 days" empty="None.">
          {(d.failed_deployments ?? []).map((f) => (
            <li key={f.deployment_id}>
              <Mono>{f.app_slug ?? f.app_id}</Mono> <span className="text-[var(--color-ink-muted)]">· {f.status}</span>
              {f.error_code && <span className="badge badge-neutral ml-2 font-mono">{f.error_code}</span>}
              <span className="ml-2 text-[var(--color-ink-muted)]">{relativeTime(f.created_at)}</span>
              {f.error && <div className="mt-0.5 break-words">{f.error}</div>}
              {f.hint && <div className="mt-0.5 text-[var(--color-ink-muted)]">Fix: {f.hint}</div>}
            </li>
          ))}
        </Block>

        <Block
          title="Custom domains"
          empty={d.healthy_domains > 0 ? `All ${d.healthy_domains} serving.` : 'No custom domains.'}
        >
          {(d.domain_issues ?? []).map((di) => (
            <li key={di.domain}>
              <Mono>{di.domain}</Mono>
              {di.app_slug && <span className="ml-1 text-[var(--color-ink-muted)]">→ {di.app_slug}</span>}
              <span className="ml-2">{di.problem}</span>
              {di.cert_last_error && <div className="mt-0.5 break-words text-[var(--color-ink-muted)]">{di.cert_last_error}</div>}
            </li>
          ))}
        </Block>

        <div className="px-4 py-3">
          <h3 className="mb-1 font-medium">
            Refused API requests, last {errors?.window_hours ?? 24} hours: {errors?.total ?? 0}
            {!!errors?.dropped && (
              <span className="ml-2 font-normal text-[var(--color-warning)]">({errors.dropped} not recorded on this replica)</span>
            )}
          </h3>
          {errors && errors.by_code.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {errors.by_code.map((c) => (
                <span key={c.code} className="badge badge-neutral font-mono" title={`last ${relativeTime(c.last_at)}`}>
                  {c.code} ×{c.count}
                </span>
              ))}
            </div>
          )}
          {errors && errors.recent.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <tbody className="divide-y divide-[var(--color-line)]">
                  {errors.recent.map((e, i) => (
                    <tr key={`${e.occurred_at}-${i}`}>
                      <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-ink-muted)]">{relativeTime(e.occurred_at)}</td>
                      <td className="py-1 pr-3 font-mono">{e.route}</td>
                      <td className="py-1 pr-3 font-mono">{e.code}</td>
                      <td className="py-1 pr-3">{e.app_slug ? <Mono>{e.app_slug}</Mono> : ''}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        {e.trace_id ? (
                          <Link href={`/lookup?trace=${encodeURIComponent(e.trace_id)}`} className="underline">
                            trace
                          </Link>
                        ) : e.request_id ? (
                          <Mono>{e.request_id}</Mono>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function Block({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode[];
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        {action}
      </div>
      {children.length === 0 ? (
        <p className="text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

export function SignalRow({ signal: s }: { signal: ObsAttentionSignal }) {
  return (
    <li>
      <span className={`badge ${s.state === 'open' ? 'badge-warning' : 'badge-neutral'}`}>
        {kindLabel(ATTENTION_KIND_LABELS, s.kind)}
      </span>
      <Mono className="ml-2">{s.subject}</Mono>
      {s.detail && <span className="ml-2">{s.detail}</span>}
      <span className="ml-2 text-[var(--color-ink-muted)]">since {relativeTime(s.first_seen_at)}</span>
      {s.state !== 'open' && (
        <span className="ml-2 text-[var(--color-ink-muted)]">
          · {s.state}
          {s.outcome ? ` (${s.outcome.replaceAll('_', ' ')})` : ''}
        </span>
      )}
      {s.state === 'open' && CUSTOMER_VISIBLE_KINDS.includes(s.kind) && (
        <span className="badge badge-info ml-2" title="Shown on the customer's account health page">
          customer sees this
        </span>
      )}
    </li>
  );
}
