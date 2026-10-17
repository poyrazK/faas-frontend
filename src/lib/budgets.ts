export interface BudgetSpec {
  name: string;
  scope: { kind: 'account' | 'project' | 'environment' | 'app' | 'job'; id?: string };
  currency: 'EUR';
  meters: ('compute' | 'egress')[];
  basis: 'net_usage' | 'gross_usage';
  limit_millicents: number;
  notify_millicents: number[];
  mode: 'monitored' | 'strict';
  action: 'notify' | 'reject_traffic' | 'suspend_background' | 'stop_previews' | 'suspend_workloads';
  drain_seconds: number;
  resume_rule: 'manual' | 'next_period';
  enabled: boolean;
}

export interface BudgetEvaluation {
  period_start: string;
  period_end: string;
  as_of: string;
  evaluated_at: string;
  evidence_through_id: number;
  known_millicents?: number;
  coverage_complete: boolean;
  fresh: boolean;
  reasons: string[];
}

export interface BudgetPolicy {
  id: string;
  account_id: string;
  revision: number;
  spec: BudgetSpec;
  status: 'draft' | 'unavailable' | 'active' | 'deleted';
  enforcement_ready: boolean;
  notification_ready: boolean;
  reasons: string[];
  runtime?: {
    compute?: {
      initialized: boolean;
      app_id?: string;
      job_id?: string;
      account_id?: string;
      scope_kind?: 'account' | 'app' | 'job';
      basis?: 'net_usage' | 'gross_usage';
      allowance_granted_mb_seconds?: number;
      allowance_committed_mb_seconds?: number;
      allowance_reserved_mb_seconds?: number;
      allowance_remaining_mb_seconds?: number;
      period_start: string;
      period_end: string;
      committed_millicents: number;
      reserved_millicents: number;
      remaining_millicents: number;
      unconfirmed_leases: number;
      held: boolean;
      observed_at: string;
    };
    evaluation?: BudgetEvaluation;
    stops?: {
      id: string;
      policy_id: string;
      revision: number;
      period_start: string;
      period_end: string;
      requested_at: string;
      drain_deadline: string;
      resume_rule: 'manual' | 'next_period';
      evaluation: BudgetEvaluation;
      targets: {
        app_id: string;
        environment_id?: string;
        state: 'requested' | 'draining' | 'enforced' | 'failed' | 'unavailable';
        observed_at: string;
        resident_count: number;
        last_error?: string;
      }[];
    }[];
    alerts: {
      id: string;
      policy_revision: number;
      threshold_millicents: number;
      evaluation: BudgetEvaluation;
      state: 'pending' | 'sending' | 'retrying' | 'delivered';
      attempts: number;
      next_attempt_at: string;
      delivered_at?: string;
      last_error?: string;
    }[];
  };
}

export function strictAppCompute(spec: BudgetSpec): boolean {
  return spec.mode === 'strict' && spec.scope.kind === 'app' && spec.basis === 'gross_usage'
    && spec.action === 'suspend_workloads' && spec.meters.length === 1 && spec.meters[0] === 'compute'
    && spec.drain_seconds === 0 && spec.notify_millicents.length === 0;
}

export function strictJobCompute(spec: BudgetSpec): boolean {
  return spec.mode === 'strict' && spec.scope.kind === 'job' && spec.basis === 'gross_usage'
    && spec.action === 'suspend_workloads' && spec.meters.length === 1 && spec.meters[0] === 'compute'
    && spec.drain_seconds === 0 && spec.notify_millicents.length === 0;
}

/** Account compute shares allowance; app and job compute reserve gross charges. */
export function strictCompute(spec: BudgetSpec): boolean {
  return strictAppCompute(spec) || strictJobCompute(spec) || spec.mode === 'strict' && spec.scope.kind === 'account' && spec.basis === 'net_usage'
    && spec.action === 'suspend_workloads' && spec.meters.length === 1 && spec.meters[0] === 'compute'
    && spec.drain_seconds === 0 && spec.notify_millicents.length === 0;
}

/** Parse EUR without floating-point rounding or silently discarding precision. */
export function parseBudgetEuros(input: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,5}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter a nonnegative EUR amount, with up to five decimal places.');
  const value = BigInt(match[1]) * BigInt(100000) + BigInt((match[2] ?? '').padEnd(5, '0'));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Budget exceeds the supported amount.');
  return Number(value);
}

export function budgetMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return 'Unavailable';
  const n = BigInt(value);
  const decimals = (n % BigInt(100000)).toString().padStart(5, '0').replace(/0+$/, '').padEnd(2, '0');
  return `€${n / BigInt(100000)}.${decimals}`;
}

export function budgetWarningThreshold(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid budget amount.');
  // Round up to the next millicent so the warning cannot fire below 80%.
  return Number((BigInt(limit) * BigInt(4) + BigInt(4)) / BigInt(5));
}
