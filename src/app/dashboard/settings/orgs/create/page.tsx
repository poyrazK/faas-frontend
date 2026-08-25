'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/bits';
import { createOrg, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function CreateOrgPage() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { switchOrg, refresh } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await createOrg({ name, slug });
      await refresh();
      switchOrg(slug);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to create organization');
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Create Organization" subtitle="Provision a new multi-tenant workspace." />
      <div className="card max-w-xl">
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="text-sm font-semibold text-[var(--color-danger)]">{error}</div>}
          
          <div>
            <label className="block text-sm font-semibold mb-1">Organization Name</label>
            <input
              className="field w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Slug</label>
            <input
              className="field w-full"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="acme-corp"
              required
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Unique identifier used in URLs. Alphanumeric and hyphens only.
            </p>
          </div>

          <div className="pt-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !name || !slug}>
              {busy ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
