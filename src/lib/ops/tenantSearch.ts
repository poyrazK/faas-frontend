/* ==========================================================================
   Finding a customer by email. apid's tenant list has no email filter and
   returns emails only with include_pii=1 (each read audited as PII access),
   so the console pages through the directory until it finds the address —
   only when the operator explicitly asks.
   ========================================================================== */

import type { ObsTenantListResponse, ObsTenantRow } from '@/lib/api';

/** Upper bound on pages scanned for one search (100 tenants per page). */
export const EMAIL_SEARCH_MAX_PAGES = 30;

export const looksLikeEmail = (query: string) => /^[^\s@]+@[^\s@]*$/.test(query.trim());

/** Exact (case-insensitive) address match, or a partial match on the typed text. */
export function emailMatch(row: ObsTenantRow, query: string): 'exact' | 'partial' | null {
  const email = row.email?.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!email || !q) return null;
  if (email === q) return 'exact';
  return email.includes(q) ? 'partial' : null;
}

export interface EmailSearchResult {
  matches: ObsTenantRow[];
  scanned: number;
  /** False when the page budget ran out before the directory did. */
  complete: boolean;
}

/**
 * Pages through the tenant directory (with emails) until an exact match is
 * found, the directory ends, or the page budget runs out. Partial matches
 * seen on the way are returned too. `onProgress` reports tenants scanned.
 */
export async function findTenantsByEmail(
  query: string,
  fetchPage: (cursor: string | undefined) => Promise<ObsTenantListResponse>,
  options: { maxPages?: number; onProgress?: (scanned: number) => void; signal?: { cancelled: boolean } } = {},
): Promise<EmailSearchResult> {
  const maxPages = options.maxPages ?? EMAIL_SEARCH_MAX_PAGES;
  const matches: ObsTenantRow[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  for (let page = 0; page < maxPages; page++) {
    if (options.signal?.cancelled) break;
    const res = await fetchPage(cursor);
    scanned += res.items.length;
    options.onProgress?.(scanned);
    for (const row of res.items) {
      const kind = emailMatch(row, query);
      if (kind) matches.push(row);
      if (kind === 'exact') return { matches: sortMatches(matches, query), scanned, complete: true };
    }
    if (!res.next_cursor) return { matches: sortMatches(matches, query), scanned, complete: true };
    cursor = res.next_cursor;
  }
  return { matches: sortMatches(matches, query), scanned, complete: false };
}

const sortMatches = (rows: ObsTenantRow[], query: string) =>
  [...rows].sort((a, b) => (emailMatch(a, query) === 'exact' ? -1 : 0) - (emailMatch(b, query) === 'exact' ? -1 : 0));
