'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getObsTenant360,
  getObsTenantActivity,
  getObsTenantDetail,
  type ObsTenant360Response,
  type ObsTenantActivityResponse,
  type ObsTenantDetailResponse,
} from '@/lib/api';

export interface TenantData {
  accountId: string;
  detail?: ObsTenantDetailResponse;
  tenant360?: ObsTenant360Response;
  activity?: ObsTenantActivityResponse;
  /** Per-source failures; a missing section is shown as unavailable, never as empty. */
  errors: { source: 'account' | 'usage' | 'activity'; message: string }[];
  loadedAt: number;
}

/**
 * Loads one customer's account, usage/billing and recent activity together.
 * Responses for a previous account or PII setting are dropped, and a reload
 * keeps the last data on screen until the new one lands.
 */
export function useTenant(accountId: string, includePii: boolean) {
  const seq = useRef(0);
  const [data, setData] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const [detail, activity, tenant360] = await Promise.allSettled([
      getObsTenantDetail(accountId, includePii),
      getObsTenantActivity(accountId),
      getObsTenant360(accountId, undefined, includePii),
    ]);
    if (mine !== seq.current) return;
    const errors: TenantData['errors'] = [];
    if (detail.status === 'rejected') errors.push({ source: 'account', message: (detail.reason as Error).message });
    if (tenant360.status === 'rejected') errors.push({ source: 'usage', message: (tenant360.reason as Error).message });
    if (activity.status === 'rejected') errors.push({ source: 'activity', message: (activity.reason as Error).message });
    setData({
      accountId,
      detail: detail.status === 'fulfilled' ? detail.value : undefined,
      tenant360: tenant360.status === 'fulfilled' ? tenant360.value : undefined,
      activity: activity.status === 'fulfilled' ? activity.value : undefined,
      errors,
      loadedAt: Date.now(),
    });
    setLoading(false);
  }, [accountId, includePii]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const current = data && data.accountId === accountId ? data : null;
  return { data: current, loading, reload: load };
}
