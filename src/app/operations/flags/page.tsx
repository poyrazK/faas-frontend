'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getPlatformFlags, type OperatorPlatformFlag } from '@/lib/ops/flags';
import { describeRule } from '@/lib/ops/flags-edit';
import { useAsync } from '@/lib/useAsync';
import { FilterSelect, Mono, PageHeader, SearchInput } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { Icon } from '@/components/ui/Icons';
import { DecisionExplorer } from './DecisionExplorer';
import { convergenceBadge, FlagEditor, type FlagDraft } from './FlagEditor';
import { FlagGroups } from './FlagGroups';

type FlagFilter = 'all' | 'targeted' | 'everyone' | 'off' | 'self_serve' | 'attention' | 'core';

const FILTERS: { value: FlagFilter; label: string }[] = [
  { value: 'all', label: 'All flags' },
  { value: 'targeted', label: 'Targeted by rules' },
  { value: 'everyone', label: 'On for everyone' },
  { value: 'off', label: 'Kill switch off' },
  { value: 'self_serve', label: 'Self-serve previews' },
  { value: 'attention', label: 'Not converged / failing' },
  { value: 'core', label: 'Core capabilities' },
];

const needsAttention = (flag: OperatorPlatformFlag) =>
  flag.status !== 'applied' || flag.convergence.pending.length > 0 || flag.convergence.failed.length > 0;

function matches(flag: OperatorPlatformFlag, filter: FlagFilter): boolean {
  const def = flag.definition;
  switch (filter) {
    case 'targeted':
      return def.enabled && !!def.rules?.length;
    case 'everyone':
      return def.enabled && def.default && !def.rules?.length;
    case 'off':
      return !def.enabled;
    case 'self_serve':
      return !!def.self_serve?.enabled;
    case 'attention':
      return needsAttention(flag);
    case 'core':
      return !!flag.core;
    default:
      return true;
  }
}

function decides(flag: OperatorPlatformFlag): string {
  const def = flag.definition;
  if (!def.enabled) return 'Off for every account (kill switch)';
  const rules = def.rules ?? [];
  if (rules.length === 0) return def.default ? 'On for every account' : 'Off for every account (default)';
  const first = rules[0];
  const more = rules.length > 1 ? ` + ${rules.length - 1} more` : '';
  return `${first.id}: ${describeRule(first)}${more} · else ${def.default ? 'on' : 'off'}`;
}

export default function PlatformFlagsPage() {
  const flags = useAsync(getPlatformFlags, [], 30000);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FlagFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FlagDraft>>({});
  const editorRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => flags.data?.items ?? [], [flags.data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (flag) =>
        matches(flag, filter) &&
        (!q || [flag.key, flag.label, flag.capability ?? '', flag.description].some((field) => field.toLowerCase().includes(q))),
    );
  }, [items, query, filter]);
  const selected = items.find((flag) => flag.key === selectedKey);
  const draftCount = Object.keys(drafts).length;

  useEffect(() => {
    if (selectedKey) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedKey]);

  const setDraft = (key: string) => (draft: FlagDraft | undefined) =>
    setDrafts((current) => {
      const next = { ...current };
      if (draft) next[key] = draft;
      else delete next[key];
      return next;
    });

  // The heading shows in every state, so the page is recognisable while it loads or fails.
  const header = (
    <PageHeader
      title="Platform flags"
      subtitle="Release features to selected accounts without a deploy. Versioned and audited."
      actions={
        <button type="button" onClick={flags.reload} className="btn btn-secondary btn-sm">
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      }
    />
  );

  if (flags.loading && !flags.data) {
    return (
      <div>
        {header}
        <div className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading platform flags…</div>
      </div>
    );
  }

  if (flags.error && !flags.data) {
    return (
      <div>
        {header}
        <div className="card p-8 text-center">
          <Icon name="shield" size={24} className="mx-auto text-[var(--color-danger)]" />
          <h2 className="mt-4 text-lg font-semibold">Could not load platform flags</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{flags.error.message}</p>
          <button type="button" onClick={flags.reload} className="btn btn-secondary btn-sm mt-4">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const data = flags.data!;
  const counts = {
    targeted: items.filter((flag) => matches(flag, 'targeted')).length,
    off: items.filter((flag) => matches(flag, 'off')).length,
    attention: items.filter(needsAttention).length,
  };

  return (
    <div>
      {header}

      <SnapshotFreshness snapshots={[flags]} />
      {flags.error && (
        <div role="alert" className="mb-4 rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          Refresh failed: {flags.error.message}. Showing the last loaded flags.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Catalogued flags" value={items.length} sub={`${Object.keys(data.groups.groups).length} account groups`} />
        <StatTile label="Targeted by rules" value={counts.targeted} sub="kill switch on, rules decide" />
        <StatTile label="Kill switch off" value={counts.off} sub="off for every account" />
        <StatTile label="Needs attention" value={counts.attention} sub="pending, failed or not converged" />
      </div>

      <DecisionExplorer flags={items} onOpenFlag={setSelectedKey} />

      <div ref={editorRef} className="scroll-mt-4">
        {selected && (
          <div className="mb-6">
            <FlagEditor
              key={selected.key}
              summary={selected}
              groups={data.groups}
              draft={drafts[selected.key]}
              setDraft={setDraft(selected.key)}
              onChanged={flags.reload}
              onClose={() => setSelectedKey(null)}
            />
          </div>
        )}
      </div>

      <SectionCard
        title="Flags"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {draftCount > 0 && <span className="badge badge-warning">{draftCount} unapplied draft(s)</span>}
            <SearchInput value={query} onChange={setQuery} placeholder="Search key, label, capability…" />
            <FilterSelect value={filter} onChange={(value) => setFilter(value as FlagFilter)} options={FILTERS} />
          </div>
        }
      >
        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {items.length === 0 ? 'apid reports no platform flags.' : 'No flag matches this search and filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Tier</th>
                  <th>Decides</th>
                  <th>Self-serve</th>
                  <th>Applied</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((flag) => (
                  <tr key={flag.key} className={flag.key === selectedKey ? 'bg-[var(--color-surface-subtle)]' : undefined}>
                    <td className="cell-primary">
                      <div className="flex items-center gap-1.5">
                        {flag.label}
                        {flag.core && <span className="badge badge-danger">core</span>}
                        {drafts[flag.key] && <span className="badge badge-warning">draft</span>}
                      </div>
                      <Mono className="mt-1 inline-block">{flag.key}</Mono>
                    </td>
                    <td>{flag.maturity ? <span className="badge badge-neutral">{flag.maturity}</span> : '—'}</td>
                    <td className="max-w-[360px]">
                      <span className={flag.definition.enabled ? '' : 'text-[var(--color-danger)]'}>{decides(flag)}</span>
                    </td>
                    <td>
                      {flag.definition.self_serve?.enabled
                        ? `${flag.opt_ins.accounts + flag.opt_ins.orgs} joined`
                        : flag.opt_ins.accounts + flag.opt_ins.orgs > 0
                          ? `closed (${flag.opt_ins.accounts + flag.opt_ins.orgs} kept)`
                          : '—'}
                    </td>
                    <td>
                      {flag.status !== 'applied' ? <span className="badge badge-danger">{flag.status}</span> : convergenceBadge(flag)}
                    </td>
                    <td className="font-mono">{flag.source === 'operator' ? `v${flag.version}` : 'boot fallback'}</td>
                    <td className="text-right">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => setSelectedKey(flag.key)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          <span>
            Showing {visible.length} of {items.length} flags
          </span>
        </div>
      </SectionCard>

      <FlagGroups live={data.groups} onChanged={flags.reload} />
    </div>
  );
}
