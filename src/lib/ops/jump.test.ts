import { describe, expect, it } from 'vitest';
import { OPS_ROUTES } from '@/lib/routes';
import { jumpTargets } from './jump';

const UUID = '11111111-2222-4333-8444-555555555555';
const hrefs = (query: string) => jumpTargets(query).map((target) => target.href);

describe('jumpTargets', () => {
  it('lists every page for an empty query', () => {
    expect(hrefs('  ')).toEqual(OPS_ROUTES.map((route) => `/${route.slug}`));
  });

  it('offers each page a bare UUID could belong to, tenant first', () => {
    expect(hrefs(UUID.toUpperCase())).toEqual([
      `/tenants/${UUID}`,
      `/deployments?deployment=${UUID}`,
      `/jobs?run=${UUID}`,
      `/deployments?app=${UUID}&status=all`,
      `/lookup?wake=${UUID}`,
    ]);
  });

  it('recognizes incidents, traces, alert episodes and emails', () => {
    expect(hrefs(`deployment/${UUID}`)[0]).toBe(`/incidents?incident=deployment%2F${UUID}`);
    expect(hrefs(' 4BF92F3577B34DA6A3CE929D0E0E4736 ')[0]).toBe('/lookup?trace=4bf92f3577b34da6a3ce929d0e0e4736');
    expect(hrefs('a'.repeat(64))[0]).toBe(`/incidents?incident=platform_alert%2F${'a'.repeat(64)}`);
    expect(hrefs('ada@customer.test')[0]).toBe('/tenants?q=ada%40customer.test');
  });

  it('matches pages by name, then offers a node and a tenant search', () => {
    expect(hrefs('incid')).toEqual(['/incidents', '/nodes?node=incid', '/tenants?q=incid']);
    expect(hrefs('node-a')).toEqual(['/nodes?node=node-a', '/tenants?q=node-a']);
    expect(hrefs('acme corp')).toEqual(['/tenants?q=acme%20corp']);
  });
});
