'use client';

import React, { useState } from 'react';
import { downloadFile } from '@/components/ui/bits';
import { Icon } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';
import {
  collectIncidentBundle,
  incidentBundleFileName,
  serializeIncidentBundle,
} from '@/lib/ops/incidentBundle';
import type { IncidentRef } from '@/lib/ops/incidents';

/**
 * Saves the incident as the same JSON bundle `gregalectl obs bundle` writes:
 * evidence, related context and pipeline health, metadata only.
 */
export function IncidentBundleButton({ incident }: { incident: IncidentRef }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={busy}
      title="Evidence, related context and pipeline health as one JSON file (gregale.operator.incident-bundle/v1); metadata only"
      onClick={async () => {
        setBusy(true);
        try {
          const bundle = await collectIncidentBundle(incident);
          downloadFile(incidentBundleFileName(bundle.incident_id), serializeIncidentBundle(bundle));
          toast.success('Incident bundle saved. It contains identifiers: share it only where incident data may go.');
        } catch (err) {
          toast.error(`Could not export the bundle: ${(err as Error).message}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name={busy ? 'refresh' : 'arrowDown'} size={13} />
      {busy ? 'Collecting…' : 'Download bundle'}
    </button>
  );
}
