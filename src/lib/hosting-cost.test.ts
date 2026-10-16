import { expect, it } from 'vitest';
import { estimateHostingCosts, formatHostingUSD, type HostingWorkload } from './hosting-cost';

const zero: HostingWorkload = { classA: '0', classB: '0', workerRequests: '0', cpuMilliseconds: '0' };
it('estimates a documented workload using exact integer money', () => {
  const cost = estimateHostingCosts(1_000_000_000, { classA: '1000000', classB: '1000000', workerRequests: '1000000', cpuMilliseconds: '1000000' });
  expect(cost).toEqual({ storage: BigInt(1500), classA: BigInt(450000), classB: BigInt(36000), workerRequests: BigInt(30000), cpu: BigInt(2000), total: BigInt(519500) });
  expect(formatHostingUSD(cost.total)).toBe('$5.20');
});
it('does not apply shared account allowances or invent measured requests', () => {
  expect(estimateHostingCosts(0, zero).total).toBe(BigInt(0));
  expect(estimateHostingCosts(1, zero).storage).toBe(BigInt(1500));
  expect(formatHostingUSD(BigInt(0))).toBe('$0.00');
  expect(formatHostingUSD(BigInt(1))).toBe('$0.01');
});
it.each(['-1', '1.5', 'NaN', '1e6', '', '9007199254740992'])('rejects invalid workload %s', (classA) => {
  expect(() => estimateHostingCosts(0, { ...zero, classA })).toThrow();
});
it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unavailable storage %s', (size) => {
  expect(() => estimateHostingCosts(size, zero)).toThrow();
});

it('applies R2 aggregate billing-unit rounding', () => {
  const cost = estimateHostingCosts(1_000_000_001, { ...zero, classA: '1000001', classB: '1' });
  expect(cost.storage).toBe(BigInt(3000));
  expect(cost.classA).toBe(BigInt(900000));
  expect(cost.classB).toBe(BigInt(36000));
});
