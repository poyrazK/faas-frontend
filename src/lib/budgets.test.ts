import { describe, expect, it } from 'vitest';
import { budgetMoney, budgetWarningThreshold, parseBudgetEuros } from './budgets';

describe('exact budget money', () => {
  it('preserves cents and sub-cent amounts without floating point rounding', () => {
    expect(parseBudgetEuros('0.29')).toBe(29000);
    expect(parseBudgetEuros('10.00001')).toBe(1000001);
    expect(budgetMoney(1000001)).toBe('€10.00001');
    expect(budgetMoney(0)).toBe('€0.00');
  });
  it('rejects ambiguous, negative, excessive precision and unsafe inputs', () => {
    for (const input of ['1,000', '-1', '1e3', '0.000001', '90071992547.40992', 'NaN', '']) {
      expect(() => parseBudgetEuros(input)).toThrow();
    }
    expect(parseBudgetEuros('90071992547.40991')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('computes a warning threshold exactly even at the supported maximum', () => {
    const limit = Number.MAX_SAFE_INTEGER;
    expect(budgetWarningThreshold(limit)).toBe(Number((BigInt(limit) * BigInt(4) + BigInt(4)) / BigInt(5)));
    expect(budgetWarningThreshold(0)).toBe(0);
  });
  it('does not alert at zero when 80% falls between representable units', () => {
    expect(budgetWarningThreshold(1)).toBe(1);
    expect(budgetWarningThreshold(5)).toBe(4);
    expect(budgetWarningThreshold(1000001)).toBe(800001);
  });
});
