import { describe, expect, it } from 'vitest';
import type { ObsInstanceRow, ObsNodeApp } from '@/lib/api';
import { visibleInstances } from './NodeInstances';
import { visibleApps } from './NodeApps';

const row = (id: string, state: string, lastRequestAt: string): ObsInstanceRow => ({
  id, app_id: 'a', deployment_id: 'd', state, ram_mb: 256, started_at: '2026-11-16T00:00:00Z', last_request_at: lastRequestAt,
});

describe('visibleInstances', () => {
  const rows = [
    row('old', 'running', '2026-11-16T09:00:00Z'),
    row('frozen', 'frozen', '2026-11-16T11:00:00Z'),
    row('never', 'running', '0001-01-01T00:00:00Z'),
    row('new', 'running', '2026-11-16T10:00:00Z'),
  ];

  it('shows running instances, most recently used first', () => {
    expect(visibleInstances(rows, 'running').map((r) => r.id)).toEqual(['new', 'old', 'never']);
  });

  it('shows every VM on the node on request without reordering the input', () => {
    expect(visibleInstances(rows, 'all').map((r) => r.id)).toEqual(['frozen', 'new', 'old', 'never']);
    expect(rows.map((r) => r.id)).toEqual(['old', 'frozen', 'never', 'new']);
  });
});

describe('visibleApps', () => {
  const app = (id: string, live: number) => ({ id, slug: id, account_id: 'a', status: 'active', instances_live: live,
    instances_running: live, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 0, last_request_at: '' }) as ObsNodeApp;
  const apps = [app('parked', 0), app('busy', 2)];

  it('shows apps with a VM on the node unless all are asked for', () => {
    expect(visibleApps(apps, false).map((a) => a.id)).toEqual(['busy']);
    expect(visibleApps(apps, true).map((a) => a.id)).toEqual(['parked', 'busy']);
  });
});
