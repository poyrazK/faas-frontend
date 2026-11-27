import { describe, expect, it } from 'vitest';
import { abuseSignalTotal, denialClassDetail, denialClassLabel, denialClassSevere, egressWindowLabel, flowLogHref, isEgressWindow } from './egress';

describe('egress helpers', () => {
  it('validates and labels windows', () => {
    expect(isEgressWindow('24h')).toBe(true);
    expect(isEgressWindow('15m')).toBe(false);
    expect(egressWindowLabel('168h')).toBe('7d');
  });

  it('labels denial classes', () => {
    expect(denialClassLabel('unresolved')).toBe('Unresolved IP');
    expect(denialClassDetail('smtp')).toContain('25, 465 and 587');
    expect(denialClassLabel('something_new')).toBe('something_new');
    expect(denialClassDetail('something_new')).toBe('');
    expect(denialClassSevere('metadata')).toBe(true);
    expect(denialClassSevere('rfc1918')).toBe(false);
  });

  it('links and sums', () => {
    expect(flowLogHref(' acct-1 ')).toBe('/metering?account=acct-1');
    expect(
      abuseSignalTotal({
        denied: 9, denied_last_hour: 0, apps_denied: 1, new_destinations: 4,
        abuse_recycles: 1, abuse_holds: 2, cpu_abuse_signals: 3, dns_blocked: 4, scan_blocked: 5, scan_flagged: 6,
      }),
    ).toBe(21);
  });
});
