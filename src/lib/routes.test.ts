import { describe, expect, it } from 'vitest';
import {
  appDeploymentsHref,
  deploymentHref,
  incidentHref,
  isAccountId,
  jobRunHref,
  nodeHref,
  tenantHref,
  traceHref,
  wakeHref,
} from './routes';

const ID = '11111111-2222-4333-8444-555555555555';

describe('tenantHref', () => {
  it('links to the workspace, with a tab only when it is not the overview', () => {
    expect(tenantHref(ID)).toBe(`/tenants/${ID}`);
    expect(tenantHref(ID, 'overview')).toBe(`/tenants/${ID}`);
    expect(tenantHref(` ${ID} `, 'billing')).toBe(`/tenants/${ID}?tab=billing`);
  });

  it('recognizes account IDs', () => {
    expect(isAccountId(ID)).toBe(true);
    expect(isAccountId(ID.toUpperCase())).toBe(true);
    expect(isAccountId('ada@customer.test')).toBe(false);
    expect(isAccountId(`${ID}x`)).toBe(false);
  });
});

describe('deep links', () => {
  it('opens the panel for one thing, with the ID encoded', () => {
    expect(deploymentHref(` ${ID} `)).toBe(`/deployments?deployment=${ID}`);
    expect(jobRunHref(ID)).toBe(`/jobs?run=${ID}`);
    expect(nodeHref('node a')).toBe('/nodes?node=node+a');
    expect(incidentHref(`deployment/${ID}`)).toBe(`/incidents?incident=deployment%2F${ID}`);
    expect(traceHref('4bf92f3577b34da6a3ce929d0e0e4736')).toBe('/lookup?trace=4bf92f3577b34da6a3ce929d0e0e4736');
    expect(wakeHref('w-1')).toBe('/lookup?wake=w-1');
    expect(appDeploymentsHref(ID)).toBe(`/deployments?app=${ID}&status=all`);
  });
});
