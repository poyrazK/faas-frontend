'use client';

/* ==========================================================================
   Live log console backed by the control plane's SSE endpoints
   (/v1/apps/{slug}/logs and /v1/deployments/{id}/logs).

   These stream `text/event-stream`, so this bypasses the JSON client and
   attaches an EventSource. Same-origin through the Next rewrites, so the
   faas_sid cookie rides along without extra configuration.
   ========================================================================== */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icons';
import { EmptyState } from '@/components/ui/States';

export interface LogLine {
  seq: number;
  at: string;
  level?: string;
  stream?: string;
  message: string;
}

const MAX_LINES = 2000;

const LEVEL_COLOR: Record<string, string> = {
  error: '#f87171',
  warn: '#fbbf24',
  warning: '#fbbf24',
  info: '#93c5fd',
  debug: '#a8a29e',
};

/**
 * Best-effort shaping of one SSE frame. The backend emits structured JSON
 * lines, but a plain string is treated as the message rather than dropped —
 * a log viewer that hides output it can't parse is worse than useless.
 */
function parseFrame(raw: string, seq: number): LogLine {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      seq,
      at: typeof obj.at === 'string' ? obj.at : typeof obj.time === 'string' ? obj.time : new Date().toISOString(),
      level: typeof obj.level === 'string' ? obj.level : undefined,
      stream: typeof obj.stream === 'string' ? obj.stream : undefined,
      message:
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.msg === 'string'
            ? obj.msg
            : typeof obj.line === 'string'
              ? obj.line
              : raw,
    };
  } catch {
    return { seq, at: new Date().toISOString(), message: raw };
  }
}

export function LogStream({
  url,
  height = 460,
  emptyHint,
}: {
  url: string | null;
  height?: number;
  emptyHint?: string;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  /**
   * Connection status is only ever written from EventSource callbacks, never
   * synchronously in the effect body. It carries the connection key it belongs
   * to, so a status left over from a previous stream reads as "connecting"
   * for the new one instead of briefly claiming to be open.
   */
  const connKey = `${url ?? ''}|${paused}`;
  const [conn, setConn] = useState<{ key: string; status: 'open' | 'error' } | null>(null);

  const state: 'idle' | 'paused' | 'connecting' | 'open' | 'error' = !url
    ? 'idle'
    : paused
      ? 'paused'
      : conn?.key === connKey
        ? conn.status
        : 'connecting';

  useEffect(() => {
    if (!url || paused) return;

    const key = `${url}|${paused}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => setConn({ key, status: 'open' });
    es.onmessage = (e) => {
      // The backend terminates a stream with an empty frame.
      if (!e.data) return;
      setLines((prev) => {
        const next = [...prev, parseFrame(e.data as string, seqRef.current++)];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };
    es.onerror = () => {
      // EventSource retries on its own; surface the state without tearing down.
      setConn({ key, status: 'error' });
    };

    return () => es.close();
  }, [url, paused]);

  // Stick to the bottom unless the reader has scrolled up to read history.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const shown = useMemo(
    () => (filter ? lines.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase())) : lines),
    [lines, filter],
  );

  const statusLabel = {
    open: 'Streaming',
    connecting: 'Connecting…',
    error: 'Disconnected',
    paused: 'Paused',
    idle: 'Idle',
  }[state];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
        <span className="badge badge-muted">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${state === 'open' ? 'live-dot' : ''}`}
            style={{ background: state === 'open' ? 'var(--color-ok)' : 'var(--color-ink-faint)' }}
          />
          {statusLabel}
        </span>
        <input
          className="field field-sm max-w-[220px]"
          placeholder="Filter lines…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setPaused((p) => !p)} disabled={!url}>
            <Icon name={paused ? 'play' : 'pause'} size={12} />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setLines([])}>
            Clear
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="logs"
          title={url ? (state === 'open' ? 'Waiting for output' : 'No log lines yet') : 'Select a workflow'}
          hint={emptyHint ?? 'Lines appear here as your microVM writes to stdout and stderr.'}
        />
      ) : (
        <div
          ref={bodyRef}
          className="mono overflow-auto px-4 py-3 text-xs leading-relaxed"
          style={{ height, background: 'var(--color-surface-code)' }}
        >
          {shown.map((l) => (
            <div key={l.seq} className="flex gap-3 whitespace-pre-wrap break-all">
              <span style={{ color: '#6b7264', flex: 'none' }}>
                {new Date(l.at).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              {l.level && (
                <span style={{ color: LEVEL_COLOR[l.level.toLowerCase()] ?? '#a8a29e', flex: 'none' }}>
                  {l.level.toUpperCase()}
                </span>
              )}
              <span style={{ color: '#e7e5e1' }}>{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
