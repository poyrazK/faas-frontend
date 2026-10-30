'use client';

import React, { useMemo, useState } from 'react';
import { writePlatformFlagGroups, type OperatorPlatformFlagGroups } from '@/lib/ops/flags';
import {
  addGroup,
  diffGroups,
  editGroup,
  FLAG_KEY_PATTERN,
  groupsStillReferenced,
  isUUID,
  removeGroup,
  validateGroups,
} from '@/lib/ops/flags-edit';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { TenantLink } from '@/components/operator/TenantLink';

const MEMBERS_SHOWN = 60;

interface GroupsDraft {
  groups: Record<string, string[]>;
  baseVersion: number;
}

/**
 * The shared named account sets (platform_flag_groups). One row holds every
 * group, so a write replaces the whole map, pinned to the version editing
 * started from.
 */
export function FlagGroups({ live, onChanged }: { live: OperatorPlatformFlagGroups; onChanged: () => void }) {
  const [draft, setDraft] = useState<GroupsDraft | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [memberInputs, setMemberInputs] = useState<Record<string, string>>({});
  const [inputError, setInputError] = useState<{ group: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<GroupsDraft | null>(null);

  const working = draft?.groups ?? live.groups;
  const names = useMemo(() => Object.keys(working).sort(), [working]);
  const conflict = draft !== null && draft.baseVersion !== live.version;
  const errors = useMemo(
    () => [
      ...validateGroups(working),
      ...groupsStillReferenced(working, live.references).map((entry) => `still used by a flag: ${entry}; remove it from those rules first`),
    ],
    [working, live.references],
  );
  const changes = useMemo(() => diffGroups(live.groups, working), [live.groups, working]);

  const edit = (next: Record<string, string[]>) => setDraft({ groups: next, baseVersion: draft?.baseVersion ?? live.version });

  const addMember = (group: string) => {
    const value = memberInputs[group] ?? '';
    if (!isUUID(value)) {
      setInputError({ group, message: 'Enter an account UUID.' });
      return;
    }
    setInputError(null);
    edit(editGroup(working, group, value, true));
    setMemberInputs((inputs) => ({ ...inputs, [group]: '' }));
  };

  return (
    <SectionCard title={`Account groups${live.version ? ` · v${live.version}` : ''}`} className="mt-6">
      <div className="divide-y divide-[var(--color-line)] text-xs">
        <p className="p-4 text-[var(--color-ink-muted)]">
          Named account sets that flag rules reference, maintained once for every flag. A group a flag still uses cannot be deleted.
        </p>
        {names.length === 0 && <div className="p-4 text-[var(--color-ink-muted)]">No groups yet.</div>}
        {names.map((name) => {
          const members = working[name];
          const usedBy = live.references[name] ?? [];
          const shown = expanded[name] ? members : members.slice(0, MEMBERS_SHOWN);
          const isNew = !(name in live.groups);
          return (
            <div key={name} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{name}</span>
                <span className="badge badge-neutral">{members.length} accounts</span>
                {isNew && <span className="badge badge-info">new</span>}
                {usedBy.length > 0 && <span className="text-[var(--color-ink-muted)]">used by {usedBy.join(', ')}</span>}
                <button
                  type="button"
                  className="btn btn-ghost btn-xs ml-auto"
                  disabled={usedBy.length > 0}
                  title={usedBy.length > 0 ? 'Remove this group from the flags that use it first' : undefined}
                  onClick={() => edit(removeGroup(working, name))}
                >
                  <Icon name="trash" size={12} />
                  Delete group
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {shown.map((account) => (
                  <span key={account} className="inline-flex items-center gap-1">
                    <TenantLink accountId={account} short />
                    <button
                      type="button"
                      aria-label={`Remove ${account} from ${name}`}
                      className="text-[var(--color-ink-muted)] hover:text-[var(--color-danger)]"
                      onClick={() => edit(editGroup(working, name, account, false))}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
                {members.length > MEMBERS_SHOWN && (
                  <button
                    type="button"
                    className="font-semibold text-[var(--color-brand-bright)] hover:underline"
                    onClick={() => setExpanded((open) => ({ ...open, [name]: !open[name] }))}
                  >
                    {expanded[name] ? 'Show fewer' : `Show all ${members.length}`}
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="field field-sm font-mono"
                  style={{ maxWidth: 340 }}
                  placeholder="account UUID"
                  value={memberInputs[name] ?? ''}
                  spellCheck={false}
                  onChange={(event) => setMemberInputs((inputs) => ({ ...inputs, [name]: event.target.value }))}
                />
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => addMember(name)}>
                  Add account
                </button>
                {inputError?.group === name && <span className="text-[var(--color-danger)]">{inputError.message}</span>}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-end gap-2 p-4">
          <label>
            <span className="label">New group</span>
            <input
              className="field field-sm font-mono"
              style={{ width: 220 }}
              placeholder="design-partners"
              value={newGroup}
              onChange={(event) => setNewGroup(event.target.value.toLowerCase())}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!FLAG_KEY_PATTERN.test(newGroup.trim()) || newGroup.trim() in working}
            onClick={() => {
              edit(addGroup(working, newGroup));
              setNewGroup('');
            }}
          >
            Create group
          </button>
          {newGroup && !FLAG_KEY_PATTERN.test(newGroup.trim()) && (
            <span className="text-[var(--color-danger)]">Lowercase letters, digits, - and _; starts with a letter.</span>
          )}
        </div>

        {draft && (
          <div className="space-y-2 bg-[var(--color-surface-subtle)] p-4">
            {conflict && (
              <div role="alert" className="rounded bg-[var(--color-warning-subtle)] p-2 text-[var(--color-warning-bold)]">
                Someone changed the groups (v{draft.baseVersion} → v{live.version}) while you were editing. Discard your draft and
                review the new groups before applying.
              </div>
            )}
            {errors.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-[var(--color-danger)]">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {changes.length === 0 ? (
              <div className="text-[var(--color-ink-muted)]">The draft matches the live groups.</div>
            ) : (
              <ul className="list-disc pl-5">
                {changes.map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                Discard draft
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={conflict || errors.length > 0 || changes.length === 0}
                onClick={() => setConfirming(draft)}
              >
                Review & apply…
              </button>
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <OperatorActionDialog
          open
          title="Apply account groups"
          tone="warning"
          reason="text"
          submitLabel="Apply groups"
          fingerprint={`groups|${confirming.baseVersion}|${JSON.stringify(confirming.groups)}`}
          impact={
            <div className="space-y-2 text-xs">
              <p>
                Every flag rule that names a changed group re-evaluates at once. Written against v{confirming.baseVersion}; if the groups
                changed since, nothing is applied.
              </p>
              <ul className="list-disc pl-5">
                {diffGroups(live.groups, confirming.groups).map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          }
          onClose={() => setConfirming(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const result = await writePlatformFlagGroups(confirming.groups, reason, confirming.baseVersion, { idempotencyKey });
            setDraft(null);
            onChanged();
            return `Account groups are now v${result.version}.`;
          }}
        />
      )}
    </SectionCard>
  );
}
