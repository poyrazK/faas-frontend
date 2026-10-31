import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@/lib/api';
import { describeUserAgent, sortSessions } from './sessions';

describe('describeUserAgent', () => {
  it('names common clients', () => {
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome on macOS');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1')).toBe('Safari on iOS');
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Linux');
    expect(describeUserAgent('gregalectl/1.42 (darwin/arm64)')).toBe('gregalectl (CLI)');
    expect(describeUserAgent('')).toBe('Unknown client');
    expect(describeUserAgent('custom-agent')).toBe('custom-agent');
  });
});

describe('sortSessions', () => {
  it('puts this browser first, then the most recently used', () => {
    const s = (id: string, last: string, current = false) => ({ id, issued_at: '2026-10-01T00:00:00Z', last_seen_at: last, current_session: current }) as SessionInfo;
    expect(sortSessions([s('old', '2026-10-02T00:00:00Z'), s('me', '2026-10-01T00:00:00Z', true), s('new', '2026-10-30T00:00:00Z'), s('unused', '')]).map((x) => x.id)).toEqual([
      'me',
      'new',
      'old',
      'unused',
    ]);
  });
});
