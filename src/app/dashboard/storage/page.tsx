'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/bits';
import { Unavailable } from '@/components/ui/Panels';

export default function StoragePage() {
  return (
    <div>
      <PageHeader title="Storage" subtitle="Object storage buckets for your workflows." />
      <Unavailable
        icon="storage"
        title="Object storage isn't part of the platform yet"
        what="Gregale gives each microVM an overlay filesystem on NVMe that lives for the life of the sandbox. There is no durable bucket API to list here — persist to an external object store from your workflow for now."
        endpoint="storage"
        alternative={{ href: '/dashboard/workflows', label: 'View workflows' }}
      />
    </div>
  );
}
