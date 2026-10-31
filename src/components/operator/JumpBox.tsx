'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { jumpTargets } from '@/lib/ops/jump';

const MAX_RESULTS = 12;

/**
 * The header's "Jump to…" field and the ⌘K / Ctrl+K palette it opens: paste
 * any ID or type a page, node or org, then Enter opens the first match.
 */
export function JumpBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** -1 until the operator types or moves: Enter on an empty box opens nothing. */
  const [active, setActive] = useState(-1);
  const targets = useMemo(() => jumpTargets(query).slice(0, MAX_RESULTS), [query]);
  const selected = active >= 0 ? Math.min(active, targets.length - 1) : query.trim() ? 0 : -1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(-1);
  };

  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        className="ml-2 hidden h-8 w-72 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-ink-faint)] hover:border-[var(--color-ink-faint)] md:flex"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Icon name="search" size={14} />
        <span className="flex-1 text-left">Jump to an ID, tenant or page…</span>
        <kbd className="rounded border border-[var(--color-line)] px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <button type="button" className="btn-icon md:hidden" onClick={() => setOpen(true)} aria-label="Jump to an ID, tenant or page">
        <Icon name="search" size={16} />
      </button>

      <Modal open={open} onClose={close} title="Jump to" width={560}>
        <div className="space-y-3">
          <input
            autoFocus
            className="field font-mono"
            placeholder="Account, deployment, run, incident or trace ID · email · node · page"
            value={query}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls="jump-results"
            aria-activedescendant={targets[selected] ? `jump-${selected}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((selected + 1) % Math.max(1, targets.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(selected <= 0 ? targets.length - 1 : selected - 1);
              } else if (event.key === 'Enter' && targets[selected]) {
                event.preventDefault();
                go(targets[selected].href);
              }
            }}
          />
          <ul id="jump-results" role="listbox" aria-label="Destinations" className="max-h-80 overflow-y-auto">
            {targets.map((target, index) => (
              <li
                key={target.href}
                id={`jump-${index}`}
                role="option"
                aria-selected={index === selected}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                  index === selected ? 'bg-[var(--color-surface-subtle)]' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(target.href)}
              >
                <span className="min-w-0 truncate">{target.label}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{target.hint}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--color-ink-muted)]">↑ ↓ to choose · Enter to open · Esc to close</p>
        </div>
      </Modal>
    </>
  );
}
