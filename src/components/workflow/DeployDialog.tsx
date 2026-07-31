'use client';

/* ==========================================================================
   Deploy a new version.

   Two paths, matching the two content-types the API accepts:
     • a digest-pinned OCI image reference (application/json)
     • a source tarball upload (multipart/form-data)

   The response is 202: the build is queued, not finished. The dialog says so
   and hands the customer straight to the build log rather than implying the
   deploy is live.
   ========================================================================== */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deployImage, deploySource, type AppType, type Runtime, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';

type Mode = 'image' | 'source';

/** Plan caps from the API description; enforced client-side for a better error. */
const SIZE_CAP_MB: Record<string, number> = { free: 100, hobby: 100, pro: 250, scale: 250 };

export function DeployDialog({
  open,
  onClose,
  slug,
  plan,
  appType,
  runtime,
  onDeployed,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  plan: string;
  appType: AppType;
  runtime?: Runtime | null;
  onDeployed: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('source');
  const [image, setImage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dockerfile, setDockerfile] = useState(false);
  const [busy, setBusy] = useState(false);

  const capMb = SIZE_CAP_MB[plan] ?? 100;
  const tooBig = !!file && file.size > capMb * 1024 * 1024;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const dep =
        mode === 'image'
          ? await deployImage(slug, image.trim())
          : await deploySource(slug, file!, {
              dockerfile,
              kind: appType,
              ...(appType === 'function' && runtime ? { runtime } : {}),
            });

      toast.success('Build queued.');
      onClose();
      onDeployed();
      // 202 means queued — send them where the progress actually is.
      router.push(`/dashboard/deployments/${dep.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Deploy failed.');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === 'image' ? image.trim().length > 0 : !!file && !tooBig;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={`Deploy a new version of ${slug}`}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="deploy-form" type="submit" disabled={busy || !canSubmit}>
            {busy ? 'Uploading…' : 'Start build'}
          </button>
        </>
      }
    >
      <form id="deploy-form" onSubmit={submit} className="space-y-4">
        <div className="seg w-full">
          <button type="button" data-active={mode === 'source'} onClick={() => setMode('source')} className="flex-1">
            Source tarball
          </button>
          <button type="button" data-active={mode === 'image'} onClick={() => setMode('image')} className="flex-1">
            Container image
          </button>
        </div>

        {mode === 'source' ? (
          <>
            <div>
              <label className="label" htmlFor="deploy-file">Source archive</label>
              <input
                id="deploy-file"
                type="file"
                className="field"
                accept=".tar,.tar.gz,.tgz,application/gzip,application/x-tar"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
              <p className="mt-1 text-xs" style={{ color: tooBig ? 'var(--color-danger)' : 'var(--color-ink-muted)' }}>
                {file
                  ? tooBig
                    ? `${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the ${capMb} MB cap on the ${plan} plan.`
                    : `${(file.size / 1024 / 1024).toFixed(1)} MB of ${capMb} MB allowed on the ${plan} plan.`
                  : `A .tar or .tar.gz of your project. Up to ${capMb} MB on the ${plan} plan.`}
              </p>
            </div>

            <label className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              <input
                type="checkbox"
                checked={dockerfile}
                onChange={(e) => setDockerfile(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                Build with my Dockerfile
                <span className="block text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                  Skips automatic runtime detection and uses the Dockerfile in the archive root.
                </span>
              </span>
            </label>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="deploy-image">Image reference</label>
            <input
              id="deploy-image"
              className="field mono"
              placeholder="ghcr.io/you/app@sha256:…"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Pin by digest rather than tag — a moving tag makes rollbacks meaningless, since the same reference can
              resolve to different code later.
            </p>
          </div>
        )}

        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs"
          style={{ background: 'var(--color-surface-subtle)', color: 'var(--color-ink-soft)' }}
        >
          <Icon name="help" size={14} style={{ marginTop: 1, flex: 'none' }} />
          <span>
            Starting a build doesn&apos;t deploy immediately — the API accepts the work and queues it. You&apos;ll land
            on the build log so you can watch it finish.
          </span>
        </div>
      </form>
    </Modal>
  );
}
