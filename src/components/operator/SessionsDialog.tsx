'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/format';
import { listSessions, revokeOtherSessions, revokeSession, type SessionInfo } from '@/lib/api';
import { describeUserAgent, sortSessions } from '@/lib/ops/sessions';

/**
 * The operator's own sign-in sessions. Operator sessions last 7 days, so a
 * lost laptop or a forgotten shared machine stays signed in until it is
 * revoked here. Revoking asks twice in place; this browser signs out from the
 * account menu instead.
 */
export function SessionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(sortSessions((await listSessions()).sessions));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (open) queueMicrotask(() => void load());
  }, [open, load]);

  const run = async (id: string, task: () => Promise<string>) => {
    setBusy(id);
    try {
      toast.success(await task());
      setConfirming(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const others = sessions?.filter((session) => !session.current_session) ?? [];

  return (
    <Modal
      open={open}
      onClose={() => {
        setConfirming(null);
        onClose();
      }}
      title="Your sessions"
      width={720}
    >
      <div className="space-y-3 text-xs">
        <p className="text-[var(--color-ink-soft)]">
          Every browser and CLI signed in as you. Operator sessions last 7 days; sign out any you don’t recognise or no
          longer use.
        </p>
        {error && (
          <div role="alert" className="text-[var(--color-danger)]">
            Could not load your sessions: {error}
          </div>
        )}
        {!sessions && !error && <div className="text-[var(--color-ink-muted)]">Loading sessions…</div>}
        {sessions && (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>IP</th>
                  <th>Signed in</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td title={session.issued_ua}>
                      <span className="cell-primary">{describeUserAgent(session.issued_ua)}</span>
                      {session.current_session && <span className="badge badge-success ml-1.5">This browser</span>}
                    </td>
                    <td className="font-mono">{session.issued_ip || '—'}</td>
                    <td title={session.issued_at}>{relativeTime(session.issued_at)}</td>
                    <td title={session.last_seen_at || undefined}>{session.last_seen_at ? relativeTime(session.last_seen_at) : 'Not since sign-in'}</td>
                    <td className="text-right">
                      {session.current_session ? (
                        <span className="whitespace-nowrap text-[var(--color-ink-muted)]">Use Sign out</span>
                      ) : confirming === session.id ? (
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setConfirming(null)} disabled={busy !== null}>
                            Keep
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-xs"
                            disabled={busy !== null}
                            onClick={() =>
                              void run(session.id, async () => {
                                await revokeSession(session.id);
                                return `Signed out ${describeUserAgent(session.issued_ua)}.`;
                              })
                            }
                          >
                            {busy === session.id ? 'Signing out…' : 'Sign it out'}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-xs" onClick={() => setConfirming(session.id)} disabled={busy !== null}>
                          Sign out…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {others.length > 1 && (
          <div className="flex items-center justify-end gap-2">
            {confirming === 'all' ? (
              <>
                <span>Sign out all {others.length} other sessions?</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(null)} disabled={busy !== null}>
                  Keep them
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('all', async () => {
                      const res = await revokeOtherSessions();
                      return `Signed out ${res.revoked} other session${res.revoked === 1 ? '' : 's'}.`;
                    })
                  }
                >
                  {busy === 'all' ? 'Signing out…' : 'Sign them out'}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming('all')} disabled={busy !== null}>
                Sign out every other session…
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
