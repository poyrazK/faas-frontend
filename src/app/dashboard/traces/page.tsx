'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/bits';
import { Unavailable } from '@/components/ui/Panels';

export default function TracesPage() {
  return (
    <div>
      <PageHeader title="Traces" subtitle="Distributed traces across your workflows." />
      <Unavailable
        icon="traces"
        title="Distributed tracing isn't wired up yet"
        what="The control plane stamps a wake id on each wake attempt, but it doesn't collect or store spans, so there's nothing to render as a trace waterfall. Metrics covers latency and failure rates in the meantime."
        endpoint="trace or span"
        alternative={{ href: '/dashboard/metrics', label: 'Go to Metrics' }}
      />
    </div>
  );
}
