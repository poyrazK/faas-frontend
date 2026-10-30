'use client';

import React, { useEffect, useId } from 'react';

/**
 * Open modals, innermost last. Operator dialogs open on top of inspect panels,
 * and Escape must close only the dialog in front — not the panel behind it.
 */
const openStack: string[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    return () => {
      const index = openStack.lastIndexOf(id);
      if (index >= 0) openStack.splice(index, 1);
    };
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, id]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card w-full overflow-hidden"
        style={{ maxWidth: width, boxShadow: 'var(--shadow-pop)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="text-2xl leading-none" style={{ color: 'var(--color-ink-muted)' }} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--color-line)', background: 'var(--color-surface-subtle)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
