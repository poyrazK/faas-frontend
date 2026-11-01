'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, type ObsEventRow, type OperatorIntentResponse, type OperatorIntentStatus } from '@/lib/api';
import {
  buildTraceTimeline,
  collectIds,
  formatOffset,
  getTraceLookup,
  getWakeTimeline,
  normalizeTraceId,
  normalizeWakeId,
  offsetMs,
  TRACE_ID_PATTERN,
  WAKE_ID_PATTERN,
  type ObsTraceLookupResponse,
  type ObsWakeEvent,
  type ObsWakeTimeline,
} from '@/lib/ops/support';
import { relativeTime } from '@/lib/format';
import { CopyButton, Mono, PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { IntentStatusBadge } from '@/components/operator/OperatorIntents';
import { TenantLink } from '@/components/operator/TenantLink';
import { useKeyed } from '@/components/operator/tenant/shared';

/* ==========================================================================
   Support lookup: paste an ID from a customer ticket or a log line and see
   what the platform recorded for it.
     ?trace=<32 hex>   operator intents + events sharing one OTel trace id
     ?wake=<wake id>   every event of one wake, oldest first
   Both can be open at once; IDs found in payloads link across.
   ========================================================================== */

export default function SupportLookupPage() {
  return (
    <Suspense>
      <SupportLookup />
    </Suspense>
  );
}

function SupportLookup() {
  const params = useSearchParams();
  const router = useRouter();
  const traceParam = normalizeTraceId(params.get('trace') ?? '');
  const wakeParam = normalizeWakeId(params.get('wake') ?? '');

  const [traceInput, setTraceInput] = useState(traceParam);
  const [wakeInput, setWakeInput] = useState(wakeParam);

  // Follow back/forward navigation and links that change the URL.
  useEffect(() => {
    queueMicrotask(() => setTraceInput(traceParam));
  }, [traceParam]);
  useEffect(() => {
    queueMicrotask(() => setWakeInput(wakeParam));
  }, [wakeParam]);

  const traceValid = TRACE_ID_PATTERN.test(traceParam);
  const wakeValid = WAKE_ID_PATTERN.test(wakeParam);

  const navigate = (next: { trace?: string; wake?: string }) => {
    const q = new URLSearchParams();
    if (next.trace) q.set('trace', next.trace);
    if (next.wake) q.set('wake', next.wake);
    const query = q.toString();
    router.push(`/lookup${query ? `?${query}` : ''}`);
  };

  const trace = useKeyed(traceValid ? traceParam : null, (id) => getTraceLookup(id));
  const wake = useKeyed(wakeValid ? wakeParam : null, getWakeTimeline);

  const openTrace = (id: string) => navigate({ trace: id, wake: wakeParam });
  const openWake = (id: string) => navigate({ trace: traceParam, wake: id });

  const traceDraft = normalizeTraceId(traceInput);
  const wakeDraft = normalizeWakeId(wakeInput);

  return (
    <div>
      <PageHeader
        title="Support lookup"
        subtitle="Follow a trace or wake ID from a ticket, a log line or an error response."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <form
          className="card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (TRACE_ID_PATTERN.test(traceDraft)) navigate({ trace: traceDraft, wake: wakeParam });
          }}
        >
          <label className="label" htmlFor="lookup-trace">
            Trace ID
          </label>
          <div className="flex gap-2">
            <input
              id="lookup-trace"
              className="field field-sm font-mono"
              value={traceInput}
              onChange={(event) => setTraceInput(event.target.value)}
              placeholder="32 hex characters, e.g. 4bf92f3577b34da6a3ce929d0e0e4736"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!TRACE_ID_PATTERN.test(traceDraft)}>
              <Icon name="search" size={14} />
              Look up
            </button>
          </div>
          {traceInput && !TRACE_ID_PATTERN.test(traceDraft) && (
            <p className="mt-1 text-xs text-[var(--color-danger)]">A trace ID is exactly 32 hexadecimal characters.</p>
          )}
        </form>

        <form
          className="card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (WAKE_ID_PATTERN.test(wakeDraft)) navigate({ trace: traceParam, wake: wakeDraft });
          }}
        >
          <label className="label" htmlFor="lookup-wake">
            Wake ID
          </label>
          <div className="flex gap-2">
            <input
              id="lookup-wake"
              className="field field-sm font-mono"
              value={wakeInput}
              onChange={(event) => setWakeInput(event.target.value)}
              placeholder="e.g. 0192f3a4-7b8c-7def-8123-456789abcdef"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!WAKE_ID_PATTERN.test(wakeDraft)}>
              <Icon name="search" size={14} />
              Look up
            </button>
          </div>
          {wakeInput && !WAKE_ID_PATTERN.test(wakeDraft) && (
            <p className="mt-1 text-xs text-[var(--color-danger)]">A wake ID is 8–64 letters, digits or dashes.</p>
          )}
        </form>
      </div>

      {!traceParam && !wakeParam && (
        <div className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">
          Enter a trace ID or a wake ID to see its timeline.
        </div>
      )}

      <div className="space-y-6">
        {traceParam && (
          <LookupSection
            title="Trace"
            id={traceParam}
            invalid={!traceValid ? 'This is not a trace ID (32 lowercase hex characters).' : null}
            state={trace}
            notFound="No operator intent or platform event carries this trace ID."
            onClose={() => navigate({ wake: wakeParam })}
            render={(data) => <TraceView data={data} onOpenWake={openWake} onOpenTrace={openTrace} />}
          />
        )}
        {wakeParam && (
          <LookupSection
            title="Wake"
            id={wakeParam}
            invalid={!wakeValid ? 'This is not a wake ID (8–64 letters, digits or dashes).' : null}
            state={wake}
            notFound="No events are recorded for this wake ID."
            onClose={() => navigate({ trace: traceParam })}
            render={(data) => <WakeView data={data} onOpenTrace={openTrace} />}
          />
        )}
      </div>
    </div>
  );
}

function LookupSection<T>({
  title,
  id,
  invalid,
  state,
  notFound,
  onClose,
  render,
}: {
  title: string;
  id: string;
  invalid: string | null;
  state: { data: T | null; loading: boolean; error: Error | null; stale: boolean; reload: () => void };
  notFound: string;
  onClose: () => void;
  render: (data: T) => React.ReactNode;
}) {
  const missing = state.error instanceof ApiError && state.error.status === 404;
  return (
    <SectionCard
      title={
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="card-title">{title}</h2>
          <Mono className="truncate">{id}</Mono>
        </div>
      }
      action={
        <div className="flex items-center gap-1.5">
          <CopyButton value={id} label="Copy ID" />
          {!invalid && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={state.reload}>
              <Icon name="refresh" size={13} />
              Refresh
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
            <Icon name="x" size={13} />
          </button>
        </div>
      }
    >
      {invalid ? (
        <div role="alert" className="p-6 text-sm text-[var(--color-danger)]">
          {invalid}
        </div>
      ) : state.data ? (
        <>
          {render(state.data)}
          {state.stale && state.error && (
            <div role="alert" className="table-foot text-[var(--color-danger)]">
              Refresh failed: {state.error.message}. Showing the last successful result.
            </div>
          )}
        </>
      ) : missing ? (
        <div className="p-6 text-sm text-[var(--color-ink-muted)]">{notFound}</div>
      ) : state.error ? (
        <div role="alert" className="p-6 text-sm text-[var(--color-danger)]">
          Lookup failed: {state.error.message}
        </div>
      ) : (
        <div className="p-6 text-sm text-[var(--color-ink-muted)]">Looking up…</div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────── Trace ─────────────────────────────────── */

function TraceView({
  data,
  onOpenWake,
  onOpenTrace,
}: {
  data: ObsTraceLookupResponse;
  onOpenWake: (id: string) => void;
  onOpenTrace: (id: string) => void;
}) {
  const timeline = buildTraceTimeline(data);
  const first = timeline[0]?.at;
  const capped = data.intents.length >= data.limit || data.events.length >= data.limit;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
        <span>
          <strong className="text-[var(--color-ink)]">{data.intents.length}</strong> operator intent(s)
        </span>
        <span>
          <strong className="text-[var(--color-ink)]">{data.events.length}</strong> event(s)
        </span>
        {first && timeline.length > 1 && (
          <span>spans {formatOffset(offsetMs(first, timeline[timeline.length - 1].at)).slice(1)}</span>
        )}
        <span>looked up {relativeTime(data.generated_at)}</span>
      </div>
      {capped && (
        <div role="status" className="bg-[var(--color-warning-subtle)] px-5 py-2 text-xs text-[var(--color-warning-bold)]">
          At least one list reached the {data.limit}-row limit, so this timeline may be incomplete.
        </div>
      )}
      <ol className="divide-y divide-[var(--color-line)]">
        {timeline.map((entry) => (
          <li key={entry.key} className="grid gap-3 px-5 py-3 text-xs sm:grid-cols-[150px_1fr]">
            <TimeCell at={entry.at} first={first} />
            {entry.type === 'intent' ? (
              <IntentEntry intent={entry.intent} onOpenWake={onOpenWake} />
            ) : (
              <EventEntry event={entry.event} onOpenWake={onOpenWake} onOpenTrace={onOpenTrace} ownTrace={data.trace_id} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IntentEntry({ intent, onOpenWake }: { intent: OperatorIntentResponse; onOpenWake: (id: string) => void }) {
  const wakeIds = [intent.park_execution?.wake_id, ...collectIds(intent.metadata, 'wake_id')].filter(
    (id, index, all): id is string => !!id && all.indexOf(id) === index,
  );
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-info">Operator intent</span>
        <span className="font-semibold">{intent.kind}</span>
        <IntentStatusBadge status={intent.status as OperatorIntentStatus} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--color-ink-soft)]">
        <span>
          target <Mono>{intent.target_id}</Mono>
        </span>
        {intent.account_id && (
          <span>
            account <TenantLink accountId={intent.account_id} short />
          </span>
        )}
        <span>
          actor <Mono>{intent.actor_id}</Mono>
        </span>
        <span>
          reason <Mono>{intent.reason}</Mono>
        </span>
      </div>
      <div className="text-[var(--color-ink-muted)]">
        {intent.started_at ? `started ${new Date(intent.started_at).toLocaleTimeString()}` : 'not started'}
        {intent.finished_at ? ` · finished ${new Date(intent.finished_at).toLocaleTimeString()}` : ''}
        {intent.park_execution ? ` · park phase ${intent.park_execution.phase}` : ''}
      </div>
      {intent.error && <div className="text-[var(--color-danger)]">{intent.error}</div>}
      <IdLinks label="wake" ids={wakeIds} onOpen={onOpenWake} />
      <JsonDetails label="metadata" value={intent.metadata} />
      {intent.park_execution && <JsonDetails label="park execution" value={intent.park_execution} />}
      {intent.restart_execution && <JsonDetails label="restart execution" value={intent.restart_execution} />}
    </div>
  );
}

function EventEntry({
  event,
  onOpenWake,
  onOpenTrace,
  ownTrace,
}: {
  event: ObsEventRow;
  onOpenWake: (id: string) => void;
  onOpenTrace: (id: string) => void;
  ownTrace: string;
}) {
  const wakeIds = collectIds(event.data, 'wake_id');
  const traceIds = collectIds(event.data, 'trace_id').filter((id) => id !== ownTrace && TRACE_ID_PATTERN.test(id));
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-neutral">Event</span>
        <span className="font-semibold">{event.kind}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--color-ink-soft)]">
        <span>
          actor <Mono>{event.actor}</Mono>
        </span>
        {event.subject && (
          <span>
            subject <Mono>{event.subject}</Mono>
          </span>
        )}
      </div>
      <IdLinks label="wake" ids={wakeIds} onOpen={onOpenWake} />
      <IdLinks label="trace" ids={traceIds} onOpen={onOpenTrace} />
      <JsonDetails label="data" value={event.data} />
    </div>
  );
}

/* ──────────────────────────────── Wake ─────────────────────────────────── */

function WakeView({ data, onOpenTrace }: { data: ObsWakeTimeline; onOpenTrace: (id: string) => void }) {
  const first = data.events[0]?.at;
  const last = data.events[data.events.length - 1]?.at;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
        <span>
          <strong className="text-[var(--color-ink)]">{data.events.length}</strong> event(s)
        </span>
        {first && last && data.events.length > 1 && (
          <span>
            first to last <strong className="text-[var(--color-ink)]">{formatOffset(offsetMs(first, last)).slice(1)}</strong>
          </span>
        )}
        {data.subject && (
          <span>
            subject <Mono>{data.subject}</Mono>
          </span>
        )}
        {first && <span>started {relativeTime(first)}</span>}
      </div>
      {data.truncated && (
        <div role="status" className="bg-[var(--color-warning-subtle)] px-5 py-2 text-xs text-[var(--color-warning-bold)]">
          This wake has more events than the server returns at once; only the oldest {data.events.length} are shown.
        </div>
      )}
      <ol className="divide-y divide-[var(--color-line)]">
        {data.events.map((event, index) => (
          <li key={`${event.at}:${event.kind}:${index}`} className="grid gap-3 px-5 py-3 text-xs sm:grid-cols-[150px_1fr]">
            <TimeCell at={event.at} first={first} previous={index > 0 ? data.events[index - 1].at : undefined} />
            <WakeEventEntry event={event} subject={data.subject} onOpenTrace={onOpenTrace} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function WakeEventEntry({
  event,
  subject,
  onOpenTrace,
}: {
  event: ObsWakeEvent;
  subject?: string;
  onOpenTrace: (id: string) => void;
}) {
  const traceIds = [event.trace_id, ...collectIds(event.data, 'trace_id')].filter(
    (id, index, all): id is string => !!id && TRACE_ID_PATTERN.test(id) && all.indexOf(id) === index,
  );
  return (
    <div className="min-w-0 space-y-1">
      <div className="font-semibold">{event.kind}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--color-ink-soft)]">
        {event.actor && (
          <span>
            actor <Mono>{event.actor}</Mono>
          </span>
        )}
        {event.subject && event.subject !== subject && (
          <span>
            subject <Mono>{event.subject}</Mono>
          </span>
        )}
      </div>
      <IdLinks label="trace" ids={traceIds} onOpen={onOpenTrace} />
      <JsonDetails label="data" value={event.data} />
    </div>
  );
}

/* ─────────────────────────────── Shared ────────────────────────────────── */

function TimeCell({ at, first, previous }: { at: string; first?: string; previous?: string }) {
  const date = new Date(at);
  const valid = !Number.isNaN(date.getTime());
  const sincePrevious = previous ? offsetMs(previous, at) : null;
  return (
    <div className="font-mono text-[11px]" title={valid ? date.toISOString() : at}>
      <div className="text-[var(--color-ink)]">
        {valid
          ? `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`
          : at}
      </div>
      <div className="text-[var(--color-ink-muted)]">{valid ? date.toLocaleDateString() : ''}</div>
      {first && <div className="text-[var(--color-brand-bright)]">{formatOffset(offsetMs(first, at))}</div>}
      {sincePrevious !== null && sincePrevious > 0 && (
        <div className="text-[var(--color-ink-muted)]">Δ {formatOffset(sincePrevious).slice(1)}</div>
      )}
    </div>
  );
}

function IdLinks({ label, ids, onOpen }: { label: string; ids: string[]; onOpen: (id: string) => void }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="btn btn-ghost btn-xs font-mono"
          onClick={() => onOpen(id)}
          title={`Open the ${label} timeline`}
        >
          <Icon name="arrowRight" size={11} />
          {label} {id.length > 20 ? `${id.slice(0, 18)}…` : id}
        </button>
      ))}
    </div>
  );
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[var(--color-surface-subtle)] p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
