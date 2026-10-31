'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mono } from '@/components/ui/bits';
import { Icon } from '@/components/ui/Icons';
import {
  appDeploymentsHref,
  deploymentHref,
  incidentHref,
  jobRunHref,
  nodeHref,
  tenantHref,
  traceHref,
  wakeHref,
} from '@/lib/routes';

export type EntityKind =
  | 'account'
  | 'app'
  | 'deployment'
  | 'job_run'
  | 'node'
  | 'incident'
  | 'trace'
  | 'wake'
  | 'instance'
  | 'build'
  | 'id';

const LINKS: Partial<Record<EntityKind, (id: string) => string>> = {
  account: tenantHref,
  app: appDeploymentsHref,
  deployment: deploymentHref,
  job_run: jobRunHref,
  node: nodeHref,
  incident: incidentHref,
  trace: traceHref,
  wake: wakeHref,
};

const NOUNS: Record<EntityKind, string> = {
  account: 'tenant',
  app: 'app deployments',
  deployment: 'deployment',
  job_run: 'job run',
  node: 'node',
  incident: 'incident',
  trace: 'trace',
  wake: 'wake',
  instance: 'instance',
  build: 'build',
  id: 'ID',
};

/** First `chars` characters and an ellipsis, or the whole value when it is short. */
export const shortId = (id: string, chars = 8) => (id.length > chars + 1 ? `${id.slice(0, chars)}…` : id);

/**
 * Every ID the console shows: shortened (the full value on hover), copyable,
 * and linked to the page for that thing when one exists. Pass `href={null}`
 * to show an ID without a link (e.g. on its own page).
 */
export function EntityId({
  id,
  kind = 'id',
  full = false,
  chars = 8,
  href,
  copy = true,
}: {
  id: string;
  kind?: EntityKind;
  full?: boolean;
  chars?: number;
  href?: string | null;
  copy?: boolean;
}) {
  const target = href === undefined ? LINKS[kind]?.(id) : href;
  const text = full ? id : shortId(id, chars);
  const noun = NOUNS[kind];
  return (
    // A full ID may wrap inside narrow grids; a short one stays on one line.
    <span className={`inline-flex max-w-full items-center gap-0.5 align-middle ${full ? '' : 'whitespace-nowrap'}`}>
      {target ? (
        <Link href={target} className="min-w-0 hover:underline" title={`Open ${noun} ${id}`}>
          <Mono className={full ? 'break-all' : ''}>{text}</Mono>
        </Link>
      ) : (
        <span className="min-w-0" title={id}>
          <Mono className={full ? 'break-all' : ''}>{text}</Mono>
        </span>
      )}
      {copy && <CopyId value={id} noun={noun} />}
    </span>
  );
}

function CopyId({ value, noun }: { value: string; noun: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)]"
      aria-label={`Copy ${noun === 'ID' ? 'ID' : `${noun} ID`}`}
      title={copied ? 'Copied' : `Copy ${value}`}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={11} />
    </button>
  );
}

/** Copies the absolute URL of an in-console link, for pasting into a channel or ticket. */
export function CopyLinkButton({ href, label = 'Copy link' }: { href: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Copied' : label}
    </button>
  );
}
