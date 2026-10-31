/* ==========================================================================
   Page state kept in the query string, so a filtered list or an open panel
   is a link an operator can paste into a channel. Pure helpers live here;
   the React hooks are in useUrlState.ts.
   ========================================================================== */

export type SearchUpdates = Record<string, string | number | boolean | null | undefined>;

/**
 * `search` with `updates` applied, as "?…" (or "" when empty). null,
 * undefined, "" and false remove a key, so default state keeps the URL
 * clean; true is written as "1".
 */
export function withSearch(search: string, updates: SearchUpdates): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '' || value === false) params.delete(key);
    else params.set(key, value === true ? '1' : String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** One of `allowed`, or `fallback` when the URL holds anything else. */
export function pickParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A non-negative integer from the URL, or `fallback`. */
export function intParam(value: string | null, fallback = 0): number {
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
