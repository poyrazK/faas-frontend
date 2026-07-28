'use client';

/* ==========================================================================
   Logs — live SSE tail of a workflow's stdout/stderr.

   The log endpoint is per-app (/v1/apps/{slug}/logs), so a workflow has to be
   picked before there's anything to stream; there is no account-wide tail.
   ========================================================================== */

import React, { useState } from 'react';
import Link from 'next/link';
import { listApps, appLogsUrl } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, FilterSelect } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonBlock } from '@/components/ui/States';
import { LogStream } from '@/components/LogStream';
import { Icon } from '@/components/ui/Icons';

export default function LogsPage() {
  const apps = useAsync(listApps, []);
  const [picked, setPicked] = useState('');

  // Derived rather than stored, so the first workflow is selected as soon as
  // the list lands without an effect writing state back during render.
  const slug = picked || apps.data?.[0]?.slug || '';
  const setSlug = setPicked;

  return (
    <div>
      <PageHeader
        title="Logs"
        subtitle="Live output from your running microVMs."
        actions={
          apps.data && apps.data.length > 0 ? (
            <>
              <FilterSelect
                value={slug}
                onChange={setSlug}
                options={apps.data.map((a) => ({ value: a.slug, label: a.slug }))}
              />
              {slug && (
                <Link href={`/dashboard/workflows/${slug}`} className="btn btn-secondary">
                  <Icon name="workflows" size={14} /> Open workflow
                </Link>
              )}
            </>
          ) : undefined
        }
      />

      <AsyncBoundary
        state={apps}
        skeleton={<SkeletonBlock height={420} />}
        isEmpty={(d) => d.length === 0}
        empty={
          <div className="card">
            <EmptyState
              icon="logs"
              title="No workflows to tail"
              hint="Create a workflow and its stdout and stderr stream here in real time."
              action={<Link href="/dashboard/workflows" className="btn btn-primary">Create a workflow</Link>}
            />
          </div>
        }
      >
        {() => (
          <div className="card overflow-hidden">
            <LogStream
              url={slug ? appLogsUrl(slug, true) : null}
              height={520}
              emptyHint={slug ? `Waiting for ${slug} to write output. A parked workflow stays silent until it wakes.` : undefined}
            />
          </div>
        )}
      </AsyncBoundary>

      <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Logs stream over Server-Sent Events and are not retained server-side — this is a live tail, not a searchable
        history. Build output for a specific release is on that deployment.
      </p>
    </div>
  );
}
