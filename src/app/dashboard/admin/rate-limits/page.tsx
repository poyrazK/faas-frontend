'use client';

import React, { useState } from 'react';
import { getObsRateLimits } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function RateLimitsPage() {
  const [windowHours] = useState(24);
  const { data, loading, error, reload } = useAsync(
    () => getObsRateLimits(windowHours),
    [windowHours],
    15000,
  );

  return (
    <div>
      <PageHeader
        title="Rate Limits & Abuse Security"
        subtitle="Dual monitoring: Postgres durable auth events + live in-process IP rate-limiter snapshot (ADR-091 §3.5)"
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Snapshot
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live IP Limiter Snapshot */}
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="bolt" size={16} className="text-[var(--color-warning)]" />
              <span>Live In-Memory IP Rate Limiter</span>
            </div>
          }
        >
          {loading && !data ? (
            <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              Reading live IP snapshot…
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-[var(--color-danger)]">
              {error.message || 'Operator access required.'}
            </div>
          ) : !data?.live || data.live.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">
              No IP rate-limiting activity detected in active memory bucket.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {data.live.map((live, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <div className="font-mono font-semibold text-sm">{live.ip}</div>
                    <div className="text-[11px] text-[var(--color-ink-muted)]">
                      Last hit {relativeTime(live.last_event_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs">
                      <strong>{live.live_hits_30s}</strong> hits / 30s
                    </span>

                    {live.currently_rate_limited ? (
                      <span className="badge badge-danger">429 Active Block</span>
                    ) : (
                      <span className="badge badge-warning font-mono">Elevated</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Durable Rate Limits (Postgres) */}
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="shield" size={16} className="text-[var(--color-brand-bright)]" />
              <span>Durable Auth Rate Limits (24h)</span>
            </div>
          }
        >
          {loading && !data ? (
            <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              Reading durable logs…
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-[var(--color-danger)]">
              {error.message || 'Operator access required.'}
            </div>
          ) : !data?.durable || data.durable.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">
              Zero durable rate-limiting events logged in 24h.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {data.durable.map((dur, idx) => {
                const isAnonymous = dur.account_id === '00000000-0000-0000-0000-000000000000';

                return (
                  <div key={idx} className="flex items-center justify-between p-4 text-xs">
                    <div>
                      {isAnonymous ? (
                        <span className="badge badge-warning font-mono">Anonymous / Pre-auth Bucket</span>
                      ) : (
                        <Mono>{dur.account_id}</Mono>
                      )}
                      <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                        Most recent: {relativeTime(dur.last_event_at)}
                      </div>
                    </div>

                    <div className="font-mono font-bold text-sm text-[var(--color-danger)]">
                      {dur.hits} 429 events
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
