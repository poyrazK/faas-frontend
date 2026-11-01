'use client';

import React, { useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  branchOf,
  createOIDCTrust,
  EMPTY_TRUST_DRAFT,
  hostingFeatureOff,
  oidcAudience,
  revokeOIDCTrust,
  TRUST_EVENTS,
  trustDraftErrors,
  trustRules,
  workflowFileOf,
  type HostingOIDCTrust,
  type HostingSite,
  type TrustDraft,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import type { AsyncState } from '@/lib/useAsync';
import { Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { EmptyState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { RowMenu, copyText } from '@/components/ui/RowMenu';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

/**
 * GitHub OIDC trusts: a workflow run matching every rule exchanges its
 * GitHub ID token for a short-lived credential, so no token is stored in
 * GitHub. Trusts are immutable; change one by revoking it and adding another.
 */
export function TrustsSection({ site, query }: { site: HostingSite; query: AsyncState<HostingOIDCTrust[]> }) {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<HostingOIDCTrust | null>(null);
  const { data, error, loading, reload } = query;
  const off = hostingFeatureOff(error);

  return (
    <>
      <SectionCard
        title="GitHub OIDC trusts"
        action={
          <button className="btn btn-primary btn-sm" disabled={!!off} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} />
            New trust
          </button>
        }
      >
        <p className="px-5 pt-3 text-xs text-[var(--color-ink-muted)]">
          A workflow run that matches every rule of a trust requests a GitHub ID token for audience{' '}
          <Mono>{oidcAudience(site.id)}</Mono> and exchanges it, with the trust ID, for a short-lived credential. Trusts
          cannot be edited: revoke one and add another.
        </p>
        {off ? (
          <EmptyState icon="code" title="GitHub OIDC is not available" hint={off} />
        ) : error && !data ? (
          <div role="alert" className="p-6 text-center text-sm text-[var(--color-danger)]">
            Could not load GitHub OIDC trusts: {error.message}
          </div>
        ) : loading && !data ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading GitHub OIDC trusts…</div>
        ) : !data?.length ? (
          <EmptyState icon="code" title="No GitHub OIDC trusts" hint="Add one to let a GitHub Actions workflow deploy without a stored token." />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Branch</th>
                  <th>Workflow</th>
                  <th>Event</th>
                  <th>Added</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((trust) => (
                  <tr key={trust.id}>
                    <td className="nowrap">
                      <span className="cell-primary">{trust.repository}</span>
                      <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">
                        owner {trust.repository_owner_id} · repo {trust.repository_id}
                      </div>
                    </td>
                    <td className="nowrap font-mono">{branchOf(trust.ref)}</td>
                    <td className="nowrap font-mono" title={trust.workflow_ref}>
                      {workflowFileOf(trust.workflow_ref)}
                    </td>
                    <td className="nowrap">
                      <span className="font-mono">{trust.event_name}</span>
                      {trust.environment && (
                        <div className="text-[11px] text-[var(--color-ink-muted)]">environment {trust.environment}</div>
                      )}
                    </td>
                    <td className="nowrap">{relativeTime(trust.created_at)}</td>
                    <td className="cell-menu">
                      <RowMenu
                        label={`Actions for trust ${trust.repository}`}
                        items={[
                          { label: 'Copy trust ID', onSelect: () => copyText(trust.id) },
                          { label: 'Copy audience', onSelect: () => copyText(oidcAudience(site.id)) },
                          { label: 'Revoke trust', tone: 'danger', onSelect: () => setRevoking(trust) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && data && !off && (
          <div role="alert" className="table-foot text-[var(--color-danger)]">
            Refresh failed: {error.message}. Showing the last successful snapshot.
          </div>
        )}
      </SectionCard>

      {creating && <NewTrustDialog site={site} onClose={() => setCreating(false)} onCreated={reload} />}

      {revoking && (
        <OperatorActionDialog
          open
          title="Revoke GitHub OIDC trust"
          tone="danger"
          reason="none"
          submitLabel="Revoke trust"
          fingerprint={revoking.id}
          impact={
            <p>
              Removes the trust for <strong>{revoking.repository}</strong> on <Mono>{branchOf(revoking.ref)}</Mono> (
              <Mono>{workflowFileOf(revoking.workflow_ref)}</Mono>). Credentials issued through it are deleted with it, so a
              deploy from that workflow that is running now fails. This cannot be undone.
            </p>
          }
          onClose={() => setRevoking(null)}
          onSubmit={async () => {
            try {
              await revokeOIDCTrust(site.id, revoking.id);
            } catch (err) {
              if (!(err instanceof ApiError && err.status === 404)) throw err;
            }
            reload();
            return `Revoked the trust for ${revoking.repository}`;
          }}
        />
      )}
    </>
  );
}

type DraftField = keyof TrustDraft;

function NewTrustDialog({ site, onClose, onCreated }: { site: HostingSite; onClose: () => void; onCreated: () => void }) {
  const [draft, setDraft] = useState<TrustDraft>(EMPTY_TRUST_DRAFT);
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const errors = trustDraftErrors(draft);
  const rules = trustRules(draft);
  const valid = Object.keys(errors).length === 0;
  const repoKnown = !errors.repository;

  const field = (name: DraftField, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: React.ReactNode) => (
    <div className="min-w-0">
      <label className="label" htmlFor={`hosting-trust-${name}`}>
        {label}
      </label>
      <input
        id={`hosting-trust-${name}`}
        className="field field-sm font-mono"
        value={draft[name]}
        onChange={(event) => setDraft((current) => ({ ...current, [name]: event.target.value }))}
        onBlur={() => setTouched((current) => ({ ...current, [name]: true }))}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {touched[name] && errors[name] ? (
        <p className="mt-1 text-xs text-[var(--color-danger)]">{errors[name]}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      )}
    </div>
  );

  return (
    <OperatorActionDialog
      open
      title="New GitHub OIDC trust"
      reason="none"
      submitLabel="Add trust"
      canSubmit={valid}
      fingerprint={JSON.stringify(rules)}
      impact={
        <p>
          Lets every run of this exact repository, branch, workflow and event deploy to <Mono>{site.hostname}</Mono> (stage
          releases and publish previews) without a stored token.
        </p>
      }
      onClose={onClose}
      onSubmit={async () => {
        await createOIDCTrust(site.id, rules);
        onCreated();
        return `Added a trust for ${rules.repository}`;
      }}
    >
      {field('repository', 'Repository', { placeholder: 'owner/name' })}
      <div className="grid gap-3 sm:grid-cols-2">
        {field('repositoryOwnerId', 'Owner ID', { inputMode: 'numeric', placeholder: 'e.g. 1234567' })}
        {field('repositoryId', 'Repository ID', { inputMode: 'numeric', placeholder: 'e.g. 89012345' })}
      </div>
      <p className="-mt-2 text-xs text-[var(--color-ink-muted)]">
        Numeric IDs stop a renamed or re-created repository from reusing the trust. Find them with{' '}
        <Mono>gh api repos/{repoKnown ? rules.repository : 'OWNER/NAME'} --jq &apos;.owner.id, .id&apos;</Mono>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('branch', 'Branch', { placeholder: 'main' })}
        {field('workflowFile', 'Workflow file', { placeholder: 'deploy.yml' }, 'In .github/workflows/')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="hosting-trust-eventName">
            Event
          </label>
          <select
            id="hosting-trust-eventName"
            className="field field-sm"
            value={draft.eventName}
            onChange={(event) => setDraft((current) => ({ ...current, eventName: event.target.value }))}
          >
            {TRUST_EVENTS.map((event) => (
              <option key={event.value} value={event.value}>
                {event.label}
              </option>
            ))}
          </select>
        </div>
        {field('environment', 'GitHub environment (optional)', { placeholder: 'production' }, 'Only jobs in this environment match.')}
      </div>
      {valid && (
        <p className="break-all rounded-md bg-[var(--color-surface-subtle)] p-2 text-xs text-[var(--color-ink-soft)]">
          Matches workflow <Mono>{rules.workflow_ref}</Mono> on <Mono>{rules.event_name}</Mono>
          {rules.environment && (
            <>
              {' '}
              in environment <Mono>{rules.environment}</Mono>
            </>
          )}
          .
        </p>
      )}
    </OperatorActionDialog>
  );
}
