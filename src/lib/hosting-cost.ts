// Cloudflare public Standard R2 / Workers Paid usage rates, checked 2026-10-16.
// Money remains integer USD millicents, including intermediate arithmetic.
// Included allowances, the shared Workers base and other
// services are excluded. This is a workload estimate, never a usage meter.
export const hostingPricing = {
  checkedAt: '2026-10-16',
  r2URL: 'https://developers.cloudflare.com/r2/pricing/',
  workersURL: 'https://developers.cloudflare.com/workers/platform/pricing/',
};
export type HostingWorkload = { classA: string; classB: string; workerRequests: string; cpuMilliseconds: string };

function count(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 16) throw new Error('Use nonnegative whole numbers.');
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Workload is too large.');
  return result;
}
const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - BigInt(1)) / divisor;

export function estimateHostingCosts(storageBytes: number, workload: HostingWorkload) {
  if (!Number.isSafeInteger(storageBytes) || storageBytes < 0) throw new Error('Storage accounting is unavailable.');
  // R2 rounds each monthly aggregate up to its GB / million-operation unit.
  const storage = ceilDivide(BigInt(storageBytes), BigInt(1000000000)) * BigInt(1500);
  const classA = ceilDivide(count(workload.classA), BigInt(1000000)) * BigInt(450000);
  const classB = ceilDivide(count(workload.classB), BigInt(1000000)) * BigInt(36000);
  const workerRequests = ceilDivide(count(workload.workerRequests) * BigInt(30000), BigInt(1000000));
  const cpu = ceilDivide(count(workload.cpuMilliseconds) * BigInt(2000), BigInt(1000000));
  return { storage, classA, classB, workerRequests, cpu, total: storage + classA + classB + workerRequests + cpu };
}

export function formatHostingUSD(millicents: bigint): string {
  if (millicents < BigInt(0)) throw new Error('Negative cost.');
  const cents = ceilDivide(millicents, BigInt(1000));
  return `$${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`;
}
