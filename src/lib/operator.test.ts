import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCents,
  formatMegabytes,
  gbHours,
  parseMoneyAmount,
  reasonError,
  safeNextPath,
  toReasonCode,
} from './operator';

describe('reason codes', () => {
  it('normalizes free text into the backend code format', () => {
    expect(toReasonCode('Customer request #42')).toBe('customer_request_42');
    expect(toReasonCode('kernel-upgrade  now')).toBe('kernel_upgrade_now');
    expect(toReasonCode('x'.repeat(80))).toHaveLength(64);
  });

  it('requires a reason and enforces the code pattern', () => {
    expect(reasonError('', 'code')).toMatch(/required/);
    expect(reasonError('   ', 'text')).toMatch(/required/);
    expect(reasonError('Has Spaces', 'code')).toMatch(/lowercase/);
    expect(reasonError('ok', 'text')).toMatch(/few words/);
    expect(reasonError('abuse_report', 'code')).toBeNull();
    expect(reasonError('Customer asked for a refund on INV-12', 'text')).toBeNull();
  });
});

describe('safeNextPath', () => {
  const fallback = '/operations/overview';

  it('keeps same-origin paths with their query and hash', () => {
    expect(safeNextPath('/operations/tenants?q=acme#apps', fallback)).toBe('/operations/tenants?q=acme#apps');
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
    'operations/tenants',
    '/\u0000x',
  ])('rejects %s', (raw) => {
    expect(safeNextPath(raw, fallback)).toBe(fallback);
  });

  it('falls back when missing', () => {
    expect(safeNextPath(null, fallback)).toBe(fallback);
    expect(safeNextPath('', fallback)).toBe(fallback);
  });
});

describe('money and size formatting', () => {
  it('parses amounts into cents and rejects junk', () => {
    expect(parseMoneyAmount('12.50')).toBe(1250);
    expect(parseMoneyAmount('12,5')).toBe(1250);
    expect(parseMoneyAmount('0.01')).toBe(1);
    expect(parseMoneyAmount('0')).toBeNull();
    expect(parseMoneyAmount('-3')).toBeNull();
    expect(parseMoneyAmount('1.234')).toBeNull();
    expect(parseMoneyAmount('abc')).toBeNull();
  });

  it('formats cents in the response currency, or bare without one', () => {
    expect(formatCents(1250, 'eur')).toContain('€');
    expect(formatCents(1250, 'USD')).toContain('12.50');
    expect(formatCents(1250)).toBe('12.50');
    expect(formatCents(1250, 'not-a-code')).toBe('12.50');
  });

  it('formats sizes and tolerates telemetry gaps', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.00 GB');
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB');
    expect(formatMegabytes(1536)).toBe('1.5 GB');
    expect(formatMegabytes(undefined)).toBe('—');
  });
});

describe('metering units', () => {
  it('converts MB-seconds to GB-hours like apid (1 GB = 1024 MB)', () => {
    expect(gbHours(1024 * 3600)).toBe(1);
    expect(gbHours(512 * 3600 * 2)).toBe(1);
  });
});
