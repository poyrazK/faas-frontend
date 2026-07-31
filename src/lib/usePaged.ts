'use client';

/* ==========================================================================
   Pagination helpers.

   The backend paginates with opaque *forward-only* cursors: a response
   carries `next_before`, and passing it back fetches the next older page.
   There is no "previous" cursor and no total count, so the UI cannot offer
   numbered pages or a jump-to-end for those lists — it can only walk forward,
   and step back through pages it has already seen. `useCursorPages` keeps
   that trail so Previous is a replay of a known cursor rather than a query
   the API cannot answer.

   Lists the API returns whole (apps, domains, crons, keys) use `usePage`,
   which slices in memory and can therefore offer real page numbers.

   Fetching is delegated to useAsync so there is exactly one place in the
   codebase that owns request lifecycle; this hook only tracks cursor state,
   and every state write happens in an event handler rather than an effect.
   ========================================================================== */

import { useCallback, useState } from 'react';
import { useAsync } from './useAsync';

/* ─────────────────────────── Cursor pagination ─────────────────────────── */

export interface CursorPage<T> {
  items: T[];
  nextBefore?: string | null;
}

export interface CursorPagination<T> {
  items: T[];
  loading: boolean;
  error: Error | null;
  /** 1-based index of the page on screen. */
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

/**
 * Walks a forward-only cursor API. `fetchPage(cursor)` receives undefined for
 * the first page and the previous response's cursor thereafter.
 *
 * `resetKey` must change whenever the query changes (a filter, a selected
 * workflow); cursors encode a position in the *old* result set, so reusing
 * one across a filter change would silently page through the wrong list.
 */
export function useCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  resetKey: string,
): CursorPagination<T> {
  // trail[i] is the cursor that produces page i. trail[0] is always undefined.
  const [trail, setTrail] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [seenKey, setSeenKey] = useState(resetKey);

  // Derived-state reset: React's documented pattern for "adjust state when a
  // prop changes" — a render-phase set, not an effect.
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setTrail([undefined]);
    setIndex(0);
  }

  const state = useAsync(() => fetchPage(trail[index]), [resetKey, index, trail[index]]);

  const next = useCallback(() => {
    const cursor = state.data?.nextBefore;
    if (!cursor) return;
    setTrail((t) => {
      const copy = [...t];
      copy[index + 1] = cursor;
      return copy;
    });
    setIndex((i) => i + 1);
  }, [state.data, index]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const reload = useCallback(() => {
    setTrail([undefined]);
    setIndex(0);
    state.reload();
  }, [state]);

  return {
    items: state.data?.items ?? [],
    loading: state.loading,
    error: state.error,
    page: index + 1,
    hasNext: !!state.data?.nextBefore,
    hasPrev: index > 0,
    next,
    prev,
    reload,
  };
}

/* ─────────────────────── Client-side pagination ────────────────────────── */

export interface ClientPagination<T> {
  items: T[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  setPage: (p: number) => void;
}

/**
 * Slices an in-memory list. The page is clamped on read, so filtering a list
 * down while sitting on its last page shows the new last page rather than
 * stranding the reader on an empty one.
 */
export function usePage<T>(all: T[], perPage = 15): ClientPagination<T> {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(all.length / perPage));
  const current = Math.min(page, pageCount);
  const items = all.slice((current - 1) * perPage, current * perPage);

  return {
    items,
    page: current,
    pageCount,
    from: all.length === 0 ? 0 : (current - 1) * perPage + 1,
    to: (current - 1) * perPage + items.length,
    total: all.length,
    setPage,
  };
}
