'use client';

import React, { useEffect, useId, useRef } from 'react';

/**
 * Open modals, innermost last. Operator dialogs open on top of inspect panels,
 * and Escape must close only the dialog in front — not the panel behind it.
 */
const openStack: string[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that always fits the viewport: the header stays put and the body
 * scrolls, so long node, heartbeat or job-run panels never push their close
 * button or last rows off screen. Focus moves into the dialog, Tab cycles
 * inside it, and closing returns focus to whatever opened it.
 */
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
  const titleId = `${id}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Prefer a field marked autoFocus, then the first control in the body, then the dialog itself.
    queueMicrotask(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const body = dialog.querySelector<HTMLElement>('[data-modal-body]');
      const target = body?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
      target.focus({ preventScroll: true });
    });

    return () => {
      const index = openStack.lastIndexOf(id);
      if (index >= 0) openStack.splice(index, 1);
      if (openStack.length === 0) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, id]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="card flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden outline-none"
        style={{ maxWidth: width, boxShadow: 'var(--shadow-pop)' }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-line)' }}
        >
          <h3 id={titleId} className="min-w-0 truncate text-base font-semibold">
            {title}
          </h3>
          <button className="text-2xl leading-none" style={{ color: 'var(--color-ink-muted)' }} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
        {footer && (
          <div
            className="flex shrink-0 justify-end gap-2 px-5 py-4"
            style={{ borderTop: '1px solid var(--color-line)', background: 'var(--color-surface-subtle)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
