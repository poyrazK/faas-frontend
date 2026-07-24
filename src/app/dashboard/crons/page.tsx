'use client';

import React, { useState } from 'react';
import { listCrons, createCron, deleteCron, updateCron, listApps, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/format';

export default function CronsPage() {
  const crons = useAsync(listCrons, []);
  const apps = useAsync(listApps, []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState('');
  const [schedule, setSchedule] = useState('*/5 * * * *');
  const [path, setPath] = useState('/');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createCron({ app_id: appId, schedule: schedule.trim(), path: path.trim() || '/' });
      toast.success('Cron trigger created.');
      setOpen(false);
      crons.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create cron.');
    } finally {
      setBusy(false);
    }
  }

  const appName = (id: string) => apps.data?.find((a) => a.id === id)?.slug ?? id.slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Cron triggers"
        subtitle="Schedule recurring requests to your apps."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ Add trigger</button>}
      />

      <div className="card overflow-hidden">
        <AsyncBoundary
          state={crons}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon="⏰" title="No cron triggers" hint="Add a schedule to invoke an app on a recurring cron expression." action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Add trigger</button>} />}
          skeleton={<SkeletonTable cols={4} rows={3} />}
        >
          {(list) => (
            <table className="dtable">
              <thead>
                <tr><th>Schedule</th><th>App</th><th>Path</th><th>Last fired</th><th>Enabled</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><Mono>{c.schedule}</Mono></td>
                    <td className="font-semibold">{appName(c.app_id)}</td>
                    <td><Mono>{c.path}</Mono></td>
                    <td>{relativeTime(c.last_fired_at)}</td>
                    <td>
                      <button
                        className={`badge ${c.enabled ? 'badge-brand' : 'badge-muted'}`}
                        onClick={async () => {
                          try {
                            await updateCron(c.id, { enabled: !c.enabled });
                            crons.reload();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : 'Toggle failed.');
                          }
                        }}
                      >
                        {c.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        onClick={async () => {
                          try {
                            await deleteCron(c.id);
                            toast.success('Trigger deleted.');
                            crons.reload();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add cron trigger"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-cron" type="submit" disabled={busy || !appId}>
              {busy ? 'Creating…' : 'Create trigger'}
            </button>
          </>
        }
      >
        <form id="add-cron" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Target app</label>
            <select className="field" value={appId} onChange={(e) => setAppId(e.target.value)} required>
              <option value="">Select an app…</option>
              {(apps.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.slug}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Schedule (cron expression)</label>
            <input className="field mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="*/5 * * * *" required />
          </div>
          <div>
            <label className="label">Path</label>
            <input className="field mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/cron/refresh" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
