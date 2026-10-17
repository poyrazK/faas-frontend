import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])(
  'includes the hosting dependency graph only for explicit build opt-in (%s)', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED', value);
    vi.resetModules();
    const { default: config } = await import('../../next.config');
    expect(config.env?.NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED).toBe(value === 'true' ? 'true' : 'false');
    const aliases = config.turbopack?.resolveAlias;
    expect(aliases).toEqual(value === 'true' ? {} : {
      '@/components/hosting/HostingDashboard': './src/components/hosting/DisabledHostingDashboard.tsx',
    });
  },
);
