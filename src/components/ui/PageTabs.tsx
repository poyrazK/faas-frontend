'use client';

import React from 'react';
import { Icon, type IconName } from './Icons';

/**
 * Tabs that split a long page into views (the same look as the tenant
 * workspace's section links). The caller keeps the selected view, usually in
 * the URL, so a tab can be linked to. Arrow keys move between tabs.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { key: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.key === value);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    onChange(next.key);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-tab={tab.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${
              selected
                ? 'border-[var(--color-brand)] text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {tab.icon && <Icon name={tab.icon} size={14} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
