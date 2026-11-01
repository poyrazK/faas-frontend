'use client';

import React, { useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  createAutomationCredential,
  credentialBlocker,
  credentialLabelError,
  CREDENTIAL_LIFETIMES,
  DEFAULT_CREDENTIAL_LIFETIME,
  expiresSoon,
  hostingSectionOff,
  HOSTING_OPERATIONS,
  isExpired,
  revokeAutomationCredential,
  untilText,
  type HostingAutomationCredential,
  type HostingAutomationCredentialResponse,
  type HostingOperation,
  type HostingSite,
} from '@/lib/ops/hosting';
import { relativeTime } from '@/lib/format';
import type { AsyncState } from '@/lib/useAsync';
import { CopyButton, Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { EmptyState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { Modal } from '@/components/ui/Modal';
import { RowMenu, copyText } from '@/components/ui/RowMenu';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

const operationLabel = (op: string) => HOSTING_OPERATIONS.find((o) => o.value === op)?.label.toLowerCase() ?? op;
const lifetimeLabel = (seconds: number) => CREDENTIAL_LIFETIMES.find((l) => l.seconds === seconds)?.label ?? `${seconds}s`;

/** A request that may have reached apid: no answer, or a 5xx. */
const mayHaveApplied = (err: unknown) => !(err instanceof ApiError) || err.status === 0 || err.status >= 500;

/**
 * Bearer tokens a CI job uses to stage releases and previews. The token is
 * shown once, right after it is issued, and is held only in this
 * component's state until the operator confirms they stored it.
 */
export function CredentialsSection({ site, query }: { site: HostingSite; query: AsyncState<HostingAutomationCredential[]> }) {
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<HostingAutomationCredentialResponse | null>(null);
  const [revoking, setRevoking] = useState<HostingAutomationCredential | null>(null);
  const { data, error, loading, reload } = query;
  const off = hostingSectionOff(error);

  return (
    <>
      <SectionCard
        title="Automation credentials"
        action={
          <button className="btn btn-primary btn-sm" disabled={!!off} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} />
            New credential
          </button>
        }
      >
        <p className="px-5 pt-3 text-xs text-[var(--color-ink-muted)]">
          Tokens a CI job sends to stage releases and publish previews on <Mono>{site.hostname}</Mono>. They never promote a
          release to production.
        </p>
        {off ? (
          <EmptyState icon="keys" title="Automation credentials are not available" hint={off} />
        ) : error && !data ? (
          <div role="alert" className="p-6 text-center text-sm text-[var(--color-danger)]">
            Could not load automation credentials: {error.message}
          </div>
        ) : loading && !data ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading automation credentials…</div>
        ) : !data?.length ? (
          <EmptyState
            icon="keys"
            title="No automation credentials"
            hint="Issue one for a CI job, or add a GitHub OIDC trust below so a workflow signs in without a stored token."
          />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Can</th>
                  <th>Issued</th>
                  <th>Expires</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((credential) => (
                  <tr key={credential.id}>
                    <td className="nowrap">
                      <span className="cell-primary">{credential.label}</span>
                      <div className="font-mono text-[11px] text-[var(--color-ink-muted)]" title={credential.id}>
                        {credential.id.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className="flex gap-1">
                        {credential.operations.map((op) => (
                          <span key={op} className="badge badge-neutral font-mono">
                            {op}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="nowrap">{relativeTime(credential.created_at)}</td>
                    <td className="nowrap" title={new Date(credential.expires_at).toLocaleString()}>
                      <Expiry credential={credential} />
                    </td>
                    <td className="cell-menu">
                      <RowMenu
                        label={`Actions for credential ${credential.label}`}
                        items={[
                          { label: 'Copy credential ID', onSelect: () => copyText(credential.id) },
                          { label: 'Revoke credential', tone: 'danger', onSelect: () => setRevoking(credential) },
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

      {creating && (
        <NewCredentialDialog
          site={site}
          onClose={() => setCreating(false)}
          onIssued={(response) => {
            setIssued(response);
            reload();
          }}
          onUnconfirmed={reload}
        />
      )}

      {issued && <IssuedToken issued={issued} onClose={() => setIssued(null)} />}

      {revoking && (
        <OperatorActionDialog
          open
          title="Revoke automation credential"
          tone="danger"
          reason="none"
          submitLabel="Revoke credential"
          fingerprint={revoking.id}
          impact={
            <p>
              Deletes <strong>{revoking.label}</strong> (<Mono>{revoking.id.slice(0, 8)}…</Mono>). A CI job using it is
              refused from its next request; issue a new credential to restore access. This cannot be undone.
            </p>
          }
          onClose={() => setRevoking(null)}
          onSubmit={async () => {
            try {
              await revokeAutomationCredential(site.id, revoking.id);
            } catch (err) {
              // Already gone, e.g. a retry after a timed-out revoke went through.
              if (!(err instanceof ApiError && err.status === 404)) throw err;
            }
            reload();
            return `Revoked ${revoking.label}`;
          }}
        />
      )}
    </>
  );
}

function Expiry({ credential }: { credential: HostingAutomationCredential }) {
  if (isExpired(credential)) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="badge badge-danger">Expired</span>
        <span className="text-[var(--color-ink-muted)]">{untilText(credential.expires_at)}</span>
      </span>
    );
  }
  if (expiresSoon(credential)) return <span className="badge badge-warning">{untilText(credential.expires_at)}</span>;
  return <span>{untilText(credential.expires_at)}</span>;
}

function NewCredentialDialog({
  site,
  onClose,
  onIssued,
  onUnconfirmed,
}: {
  site: HostingSite;
  onClose: () => void;
  onIssued: (response: HostingAutomationCredentialResponse) => void;
  /** The request may have issued a credential without an answer reaching us. */
  onUnconfirmed: () => void;
}) {
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [operations, setOperations] = useState<HostingOperation[]>(['stage', 'preview']);
  const [lifetime, setLifetime] = useState<number>(DEFAULT_CREDENTIAL_LIFETIME);
  const labelProblem = credentialLabelError(label);
  const blocker = credentialBlocker(site);
  const can = operations.length ? operations.map(operationLabel).join(' and ') : 'nothing';

  const toggle = (op: HostingOperation) =>
    setOperations((current) => (current.includes(op) ? current.filter((o) => o !== op) : HOSTING_OPERATIONS.map((o) => o.value).filter((o) => o === op || current.includes(o))));

  return (
    <OperatorActionDialog
      open
      title="New automation credential"
      reason="none"
      submitLabel="Issue credential"
      canSubmit={!labelProblem && operations.length > 0}
      fingerprint={[label.trim(), operations.join(','), lifetime].join('|')}
      impact={
        <div className="space-y-1.5">
          <p>
            Issues a token that can <strong>{can}</strong> on <Mono>{site.hostname}</Mono> for{' '}
            <strong>{lifetimeLabel(lifetime)}</strong>. It is shown once, on the next screen; Gregale keeps only its hash,
            so a lost token is replaced, not recovered.
          </p>
          {blocker && <p className="text-xs text-[var(--color-warning-bold)]">{blocker}</p>}
          <p className="text-xs text-[var(--color-ink-soft)]">
            If the request times out, check the list before trying again: a retry would issue a second credential.
          </p>
        </div>
      }
      onClose={onClose}
      onSubmit={async () => {
        try {
          onIssued(await createAutomationCredential(site.id, { label: label.trim(), operations, ttlSeconds: lifetime }));
        } catch (err) {
          if (!mayHaveApplied(err)) throw err;
          onUnconfirmed();
          throw new Error(`${(err as Error).message} It may still have been issued: check the credential list before trying again.`);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="hosting-credential-label">
          Label
        </label>
        <input
          id="hosting-credential-label"
          className="field field-sm"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => setLabelTouched(true)}
          placeholder="e.g. github-actions main"
          autoComplete="off"
        />
        {labelTouched && labelProblem ? (
          <p className="mt-1 text-xs text-[var(--color-danger)]">{labelProblem}</p>
        ) : (
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Where it will be used, so you know what breaks when you revoke it.</p>
        )}
      </div>
      <fieldset>
        <legend className="label">Allowed to</legend>
        <div className="space-y-1.5">
          {HOSTING_OPERATIONS.map((op) => (
            <label key={op.value} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={operations.includes(op.value)} onChange={() => toggle(op.value)} />
              <span>
                {op.label}
                <span className="block text-xs text-[var(--color-ink-muted)]">{op.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {!operations.length && <p className="mt-1 text-xs text-[var(--color-danger)]">Choose at least one.</p>}
      </fieldset>
      <div>
        <label className="label" htmlFor="hosting-credential-lifetime">
          Expires after
        </label>
        <select
          id="hosting-credential-lifetime"
          className="field field-sm"
          value={lifetime}
          onChange={(event) => setLifetime(Number(event.target.value))}
        >
          {CREDENTIAL_LIFETIMES.map((choice) => (
            <option key={choice.seconds} value={choice.seconds}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
    </OperatorActionDialog>
  );
}

/**
 * The one time the token is visible. Closing needs an explicit "stored it",
 * so an Escape or a stray click outside cannot throw it away.
 */
function IssuedToken({ issued, onClose }: { issued: HostingAutomationCredentialResponse; onClose: () => void }) {
  const [stored, setStored] = useState(false);
  const [nudged, setNudged] = useState(false);
  const { credential, token } = issued;

  return (
    <Modal open title="Copy the new credential" width={560} onClose={() => (stored ? onClose() : setNudged(true))}>
      <div className="space-y-4">
        <div className="rounded-lg border border-[#f2e2bd] bg-[var(--color-warning-subtle)] p-3 text-sm">
          This is the only time this token is shown. Put it in your CI&apos;s secret store now; Gregale keeps only its hash.
        </div>
        <div>
          <label className="label" htmlFor="hosting-issued-token">
            Token for {credential.label}
          </label>
          <div className="flex gap-2">
            <input
              id="hosting-issued-token"
              className="field field-sm min-w-0 flex-1 font-mono"
              value={token}
              readOnly
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={token} label="Copy token" />
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Can {credential.operations.map(operationLabel).join(' and ')} · expires {new Date(credential.expires_at).toLocaleString()}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={stored} onChange={(event) => setStored(event.target.checked)} />I have stored this token
        </label>
        {nudged && !stored && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            Confirm you stored the token first: it cannot be shown again.
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary btn-sm" disabled={!stored} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
