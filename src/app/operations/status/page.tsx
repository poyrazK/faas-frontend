'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPublicStatusOverview,
  listAdminStatusEvents,
  STATUS_LIST_LIMIT,
  type PublicStatusEvent,
  type StatusEventKind,
} from '@/lib/ops/status';
import {
  componentNames,
  emptyDraft,
  humanizeState,
  IMPACT_LABELS,
  PUBLIC_STATUS_URL,
  switchDraftKind,
  updateDraftFor,
  type StatusDraft,
  type UpdateDraft,
} from '@/lib/ops/status-events';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { FilterSelect, PageHeader, SearchInput } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { Icon } from '@/components/ui/Icons';
import { EventDetail, stateBadgeClass } from './EventDetail';
import { StatusComposer } from './StatusComposer';

/**
 * Status page authoring. Customer-facing publishing is its own page, not a
 * tab of the internal incident inbox: a different audience and a different
 * blast radius. Everything written here is public the moment it is sent.
 */
export default function StatusAuthoringPage() {
  const [kind, setKind] = useState<StatusEventKind | ''>('');
  const [openOnly, setOpenOnly] = useState('all');
  const [query, setQuery] = useState('');
  const filterKey = `${kind}|${openOnly}`;
  const events = useAsync(
    async () => ({ key: filterKey, items: await listAdminStatusEvents({ kind, active: openOnly === 'open' }) }),
    [filterKey],
    30000,
  );
  const overview = useAsync(getPublicStatusOverview, [], 60000);
  const live = useMemo(() => overview.data?.components ?? [], [overview.data]);

  const [composer, setComposer] = useState<StatusDraft | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The last copy of the open event, so it stays on screen when a filter drops it from the list.
  const [pinned, setPinned] = useState<PublicStatusEvent | null>(null);
  const [updateDrafts, setUpdateDrafts] = useState<Record<string, UpdateDraft>>({});
  const detailRef = useRef<HTMLDivElement>(null);

  // Rows fetched for a previous filter are never shown under the current one.
  const current = events.data && events.data.key === filterKey ? events.data : null;
  const items = useMemo(() => current?.items ?? [], [current]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((event) => event.title.toLowerCase().includes(q) || event.id.includes(q)) : items;
  }, [items, query]);
  const selected = items.find((event) => event.id === selectedId) ?? (pinned?.id === selectedId ? pinned : undefined);

  const open = (event: PublicStatusEvent) => {
    setComposerOpen(false);
    setPinned(event);
    setSelectedId(event.id);
  };

  useEffect(() => {
    if (selectedId || composerOpen) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId, composerOpen]);

  /** Show apid's response at once, then refetch; the reload drops any poll still in flight. */
  const merge = (event: PublicStatusEvent) => {
    if (event.id === selectedId) setPinned(event);
    events.setData({ key: filterKey, items: [event, ...items.filter((existing) => existing.id !== event.id)] });
    events.reload();
  };

  const startComposer = (eventKind: StatusEventKind) => {
    setSelectedId(null);
    setComposer((draft) => (!draft ? emptyDraft(eventKind) : draft.kind === eventKind ? draft : switchDraftKind(draft, eventKind)));
    setComposerOpen(true);
  };

  const openEvents = items.filter((event) => !event.resolved_at && !['completed', 'cancelled', 'resolved'].includes(event.state));

  return (
    <div>
      <PageHeader
        title="Status page"
        subtitle="Publish incidents and maintenance on gregale.dev/status. Customers see it immediately."
        actions={
          <>
            <a href={PUBLIC_STATUS_URL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              <Icon name="external" size={13} />
              Public page
            </a>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                events.reload();
                overview.reload();
              }}
            >
              <Icon name="refresh" size={14} />
              Refresh
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => startComposer('maintenance')}>
              <Icon name="calendar" size={14} />
              Schedule maintenance
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => startComposer('incident')}>
              <Icon name="alerts" size={14} />
              Publish incident
            </button>
          </>
        }
      />

      <SnapshotFreshness snapshots={[events]} />

      <SectionCard title="What customers see right now" className="mb-6">
        {overview.error && !overview.data ? (
          <div role="alert" className="p-4 text-xs text-[var(--color-danger)]">
            Could not read the public snapshot (GET /v1/status): {overview.error.message}. Publishing still works; previews use the known
            component names.
          </div>
        ) : !overview.data ? (
          <div className="p-4 text-xs text-[var(--color-ink-muted)]">Loading the public snapshot…</div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 p-4 text-xs">
            <span className={`badge ${overview.data.overall_status === 'operational' ? 'badge-success' : overview.data.overall_status === 'major_outage' ? 'badge-danger' : 'badge-warning'}`}>
              {IMPACT_LABELS[overview.data.overall_status] ?? overview.data.overall_status}
            </span>
            {overview.data.components.map((component) => (
              <span key={component.id} className="inline-flex items-center gap-1">
                <span className="text-[var(--color-ink-muted)]">{component.name}:</span>
                <span className={component.status === 'operational' ? '' : 'font-semibold text-[var(--color-warning-bold)]'}>
                  {IMPACT_LABELS[component.status] ?? component.status}
                </span>
              </span>
            ))}
            <span className="ml-auto text-[var(--color-ink-muted)]">
              telemetry {overview.data.data_status} · {relativeTime(overview.data.updated_at)}
              {overview.error ? ' · refresh failing' : ''}
            </span>
          </div>
        )}
      </SectionCard>

      <div ref={detailRef} className="scroll-mt-4">
        {composerOpen && composer && (
          <StatusComposer
            draft={composer}
            setDraft={(draft) => {
              setComposer(draft);
              if (!draft) setComposerOpen(false);
            }}
            live={live}
            onPublished={(event) => {
              merge(event);
              open(event);
            }}
            onClose={() => setComposerOpen(false)}
          />
        )}
        {selected && (
          <EventDetail
            key={selected.id}
            event={selected}
            live={live}
            draft={updateDrafts[selected.id] ?? updateDraftFor(selected)}
            setDraft={(draft) =>
              setUpdateDrafts((drafts) => {
                const next = { ...drafts };
                if (draft) next[selected.id] = draft;
                else delete next[selected.id];
                return next;
              })
            }
            onWritten={merge}
            onStale={events.reload}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {!composerOpen && composer && (
        <div className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          An unpublished {composer.kind} draft is kept.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setComposerOpen(true)}>
            Resume it
          </button>
        </div>
      )}

      <SectionCard
        title={`Published events${openEvents.length ? ` · ${openEvents.length} open` : ''}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Filter by title…" />
            <FilterSelect
              value={kind}
              onChange={(value) => setKind(value as StatusEventKind | '')}
              options={[
                { value: '', label: 'Incidents and maintenance' },
                { value: 'incident', label: 'Incidents' },
                { value: 'maintenance', label: 'Maintenance' },
              ]}
            />
            <FilterSelect
              value={openOnly}
              onChange={setOpenOnly}
              options={[
                { value: 'all', label: 'Open and closed' },
                { value: 'open', label: 'Open only' },
              ]}
            />
          </div>
        }
      >
        {events.error && !current ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load status events: {events.error.message}
            <div>
              <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={events.reload}>
                Retry
              </button>
            </div>
          </div>
        ) : events.loading && !current ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading status events…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {items.length === 0 ? 'Nothing has been published with these filters.' : 'No event title matches this filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>State</th>
                  <th>Impact</th>
                  <th>Components</th>
                  <th>Updates</th>
                  <th>Last change</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => (
                  <tr key={event.id} className={event.id === selectedId ? 'bg-[var(--color-surface-subtle)]' : undefined}>
                    <td className="cell-primary">
                      <div className="flex items-center gap-1.5">
                        <span className="badge badge-neutral">{event.kind === 'incident' ? 'Incident' : 'Maintenance'}</span>
                        {event.title}
                        {updateDrafts[event.id]?.message.trim() && <span className="badge badge-warning">draft</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${stateBadgeClass(event)}`}>{humanizeState(event.state)}</span>
                    </td>
                    <td>{IMPACT_LABELS[event.impact] ?? event.impact}</td>
                    <td>{componentNames(event.components, live).join(', ')}</td>
                    <td className="font-mono">{event.updates.length}</td>
                    <td>{relativeTime(event.updated_at)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => open(event)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {events.error && current && (
          <div role="alert" className="table-foot text-[var(--color-danger)]">
            Refresh failed: {events.error.message}. Showing the last loaded events.
          </div>
        )}
        {current && (
          <div className="table-foot">
            <span>
              {visible.length} of {items.length} events
              {items.length >= STATUS_LIST_LIMIT ? ` · apid returns the ${STATUS_LIST_LIMIT} most recently changed` : ''}
            </span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
