'use client';

import { useState } from 'react';
import { cancelHostingCIRun, type HostingActivityEntry } from '@/lib/hosting';

export function HostingRunCancel({siteID, entry, onChanged, onMessage}: {siteID: string; entry: HostingActivityEntry; onChanged: () => void; onMessage: (message: string) => void}) {
  const [attempted, setAttempted] = useState(false);
  const setMessage = (message: string) => onMessage(entry.run_id + ': ' + message);
  async function cancel() {
    if (attempted || !window.confirm(`Permanently cancel CI run ${entry.run_id}? Its original preview will be revoked and its release queued for safe cleanup. This run cannot resume.`)) return;
    setAttempted(true); setMessage('Canceling this CI run…');
    try {
      const run = await cancelHostingCIRun(siteID, entry.run_id);
      if (run.id !== entry.run_id || run.site_id !== siteID || run.release_id !== entry.release_id || run.preview_id !== entry.preview_id || !run.canceled) throw new Error('Cancellation acknowledgment does not match this run.');
      setMessage('Cancellation accepted. Preview revocation and safe cleanup continue.');
    } catch (error) { setMessage((error instanceof Error ? error.message : 'Cancellation could not be confirmed.') + ' Refresh activity and inspect this exact run before retrying cancellation.'); }
    finally { onChanged(); }
  }
  return <div className="space-y-2">
    <button className="btn btn-ghost btn-sm" disabled={attempted} onClick={() => void cancel()}>Cancel CI run</button>
  </div>;
}
