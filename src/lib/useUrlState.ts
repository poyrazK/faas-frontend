'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { withSearch, type SearchUpdates } from './urlState';

/**
 * The page's query string and a function that rewrites part of it. Writes use
 * history.replaceState, which Next syncs into useSearchParams without a
 * navigation, so filters and open panels never add Back steps of their own.
 * Callers must sit under a <Suspense> boundary (useSearchParams).
 */
export function useUrlParams() {
  const params = useSearchParams();
  const update = useCallback((updates: SearchUpdates) => {
    const { pathname, search, hash } = window.location;
    const next = withSearch(search, updates);
    if (next !== search) window.history.replaceState(null, '', `${pathname}${next}${hash}`);
  }, []);
  return [params, update] as const;
}

/**
 * A free-text filter mirrored in the URL. The input edits `draft`, which is
 * written to the URL once typing pauses (with `resets` applied alongside, e.g.
 * back to the first page); a URL change from elsewhere (Back, a deep link, a
 * "filter to this" button) replaces the draft. `value` is the committed filter
 * to query with.
 */
export function useUrlText(key: string, options: { delayMs?: number; resets?: SearchUpdates } = {}) {
  const [params, update] = useUrlParams();
  const value = params.get(key)?.trim() ?? '';
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const resets = useRef(options.resets);
  const delayMs = options.delayMs ?? 400;

  useEffect(() => {
    resets.current = options.resets;
  });

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    queueMicrotask(() => setDraft(value));
  }, [value]);

  useEffect(() => {
    const next = draft.trim();
    if (next === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = next;
      update({ [key]: next, ...resets.current });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [draft, key, delayMs, update]);

  return { draft, setDraft, value };
}
