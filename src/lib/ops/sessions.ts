/* ==========================================================================
   The operator's own sessions: readable client names and a stable order
   (this browser first, then most recently used).
   ========================================================================== */

import type { SessionInfo } from '@/lib/api';

/** "Chrome on macOS", "gregalectl (CLI)", or the start of the raw user agent. */
export function describeUserAgent(ua: string): string {
  const agent = ua.trim();
  if (!agent) return 'Unknown client';
  if (/^gregalectl\b/i.test(agent)) return 'gregalectl (CLI)';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : /^curl\//.test(agent)
              ? 'curl'
              : null;
  const os = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(agent)
        ? 'macOS'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Linux/.test(agent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? (agent.length > 48 ? `${agent.slice(0, 48)}…` : agent);
}

const lastUsed = (session: SessionInfo) => Date.parse(session.last_seen_at || session.issued_at) || 0;

export const sortSessions = (sessions: SessionInfo[]) =>
  [...sessions].sort((a, b) => Number(b.current_session) - Number(a.current_session) || lastUsed(b) - lastUsed(a));
