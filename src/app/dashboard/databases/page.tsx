'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/bits';
import { Unavailable } from '@/components/ui/Panels';

export default function DatabasesPage() {
  return (
    <div>
      <PageHeader title="Databases" subtitle="Managed databases attached to your workflows." />
      <Unavailable
        icon="databases"
        title="Managed databases aren't offered yet"
        what="Gregale doesn't provision or host databases today. Point your workflow at an external database and keep the connection string in Secrets, where it's sealed at rest."
        endpoint="database provisioning"
        alternative={{ href: '/dashboard/secrets', label: 'Manage secrets' }}
      />
    </div>
  );
}
