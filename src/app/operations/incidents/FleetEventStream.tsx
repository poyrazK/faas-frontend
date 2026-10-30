'use client';

import React, { useEffect, useState } from 'react';
import { obsNodeEventsUrl } from '@/lib/api';
import { SectionCard } from '@/components/ui/Panels';

const NODE_EVENT_NAMES = ['app_changed', 'deployment_changed', 'instance_changed', 'compute_node_changed'];

interface StreamEntry {
  event: string;
  data: string;
  receivedAt: string;
}

function formatStreamData(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Server-sent app, deployment, instance and compute-node changes. */
export function FleetEventStream() {
  const [connection, setConnection] = useState<'connecting' | 'open' | 'error'>('connecting');
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const source = new EventSource(obsNodeEventsUrl, { withCredentials: true });
    const listeners = NODE_EVENT_NAMES.map((eventName) => {
      const listener = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (!message.data) return;
        setEntries((current) =>
          [{ event: eventName, data: message.data, receivedAt: new Date().toISOString() }, ...current].slice(0, 30),
        );
      };
      source.addEventListener(eventName, listener);
      return { eventName, listener };
    });
    source.onopen = () => setConnection('open');
    source.onerror = () => setConnection('error');
    return () => {
      for (const { eventName, listener } of listeners) source.removeEventListener(eventName, listener);
      source.close();
    };
  }, [generation]);

  return (
    <SectionCard
      title="Live fleet event stream"
      action={
        <div className="flex items-center gap-2">
          <span className={`badge ${connection === 'open' ? 'badge-success' : connection === 'error' ? 'badge-danger' : 'badge-warning'}`}>
            {connection === 'open' ? 'Streaming' : connection === 'error' ? 'Disconnected' : 'Connecting…'}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => {
              setConnection('connecting');
              setGeneration((value) => value + 1);
            }}
          >
            Reconnect
          </button>
        </div>
      }
    >
      <div className="border-b border-[var(--color-line)] p-4 text-xs text-[var(--color-ink-muted)]">
        App, deployment, instance and compute-node changes as they happen. Heartbeats keep the connection alive but are not
        rendered.
      </div>
      {entries.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
          {connection === 'error' ? 'The live feed is unavailable or operator authentication has expired.' : 'Waiting for a fleet event…'}
        </div>
      ) : (
        <div className="max-h-80 divide-y divide-[var(--color-line)] overflow-y-auto">
          {entries.map((entry, index) => (
            <div key={`${entry.receivedAt}-${index}`} className="grid gap-2 p-3 text-xs sm:grid-cols-[170px_1fr]">
              <div>
                <div className="font-mono font-semibold text-[var(--color-brand-bright)]">{entry.event}</div>
                <div className="text-[var(--color-ink-muted)]">{new Date(entry.receivedAt).toLocaleTimeString()}</div>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[var(--color-ink-muted)]">
                {formatStreamData(entry.data)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
