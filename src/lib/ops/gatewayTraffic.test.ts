import { describe, expect, it } from 'vitest';
import { admissionOutcomeBad, admissionOutcomeLabel, errorRateTone, formatCount, formatPercent, isTrafficWindow, trafficWindowLabel } from './gatewayTraffic';

describe('gateway traffic helpers', () => {
  it('validates and labels windows', () => {
    expect(isTrafficWindow('1h')).toBe(true);
    expect(isTrafficWindow('3d')).toBe(false);
    expect(trafficWindowLabel('168h')).toBe('7d');
  });

  it('formats counts and percentages', () => {
    expect(formatCount(9999)).toBe('9,999');
    expect(formatCount(12840)).toBe('12.8k');
    expect(formatCount(250000)).toBe('250k');
    expect(formatCount(3_400_000)).toBe('3.4M');
    expect(formatPercent(1.25)).toBe('1.25%');
    expect(formatPercent(12.5)).toBe('12.5%');
  });

  it('grades error rates and admission outcomes', () => {
    expect(errorRateTone(12.5)).toBe('danger');
    expect(errorRateTone(1.4)).toBe('warning');
    expect(errorRateTone(0.2)).toBe('neutral');
    expect(admissionOutcomeLabel('app_queue_full')).toBe("App's wake queue full");
    expect(admissionOutcomeLabel('something_new')).toBe('something_new');
    expect(admissionOutcomeBad('queue_timeout')).toBe(true);
    expect(admissionOutcomeBad('canceled')).toBe(false);
  });
});
