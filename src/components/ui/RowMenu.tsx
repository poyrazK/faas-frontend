'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icons';

export interface RowMenuItem {
  label: string;
  /** In-console link; the item renders as a link. */
  href?: string;
  /** Opens in a new tab (runbooks and other external pages). */
  external?: boolean;
  onSelect?: () => void;
  tone?: 'danger';
  disabled?: boolean;
  /** Why the item is disabled, or what it does. */
  title?: string;
}

const MENU_WIDTH = 220;

/**
 * The "⋯" menu at the end of a table row (or a page's "More" button): the
 * row's secondary links and actions, so the row itself stays one line.
 * Positioned against the viewport, so a table's scroll container cannot clip
 * it; closes on Escape, outside clicks, scrolling and after a choice.
 */
export function RowMenu({
  items,
  label = 'More actions',
  trigger,
}: {
  items: (RowMenuItem | false | null | undefined)[];
  label?: string;
  /** Visible button content; an icon-only "⋯" when omitted. */
  trigger?: React.ReactNode;
}) {
  const shown = items.filter((item): item is RowMenuItem => !!item);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4 + height <= window.innerHeight;
    setPlace({
      top: below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height),
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const close = () => setOpen(false);
    const onPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (shown.length === 0) return null;

  const onMenuKey = (event: React.KeyboardEvent) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const itemClass = (item: RowMenuItem) =>
    `flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs ${
      item.disabled
        ? 'cursor-not-allowed text-[var(--color-ink-faint)]'
        : `${item.tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'} hover:bg-[var(--color-surface-subtle)] focus:bg-[var(--color-surface-subtle)] focus:outline-none`
    }`;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={trigger ? 'btn btn-secondary btn-sm' : 'inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)]'}
        aria-label={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {trigger ?? <Icon name="dots" size={16} />}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className="card fixed z-[80] p-1 shadow-[var(--shadow-pop)]"
          style={{ width: MENU_WIDTH, top: place?.top ?? -9999, left: place?.left ?? -9999 }}
          onKeyDown={onMenuKey}
          onClick={(event) => event.stopPropagation()}
        >
          {shown.map((item) =>
            item.href && !item.disabled ? (
              item.external ? (
                <a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" className={itemClass(item)} title={item.title} onClick={() => setOpen(false)}>
                  {item.label}
                  <Icon name="external" size={11} className="ml-auto" />
                </a>
              ) : (
                <Link key={item.label} role="menuitem" href={item.href} className={itemClass(item)} title={item.title} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              )
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                className={itemClass(item)}
                title={item.title}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

/**
 * Props that make a table row open its item: click anywhere on the row
 * (except links, buttons and form fields inside it, or when text is being
 * selected), or focus it and press Enter.
 */
export function rowOpener(open: () => void, label: string) {
  return {
    tabIndex: 0,
    'aria-label': label,
    className: 'row-link',
    onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
      if ((event.target as HTMLElement).closest('a, button, input, select, textarea, [role="menu"]')) return;
      if (window.getSelection()?.toString()) return;
      open();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) {
        event.preventDefault();
        open();
      }
    },
  };
}

/** Copies text, for "Copy … ID" menu items. */
export const copyText = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
