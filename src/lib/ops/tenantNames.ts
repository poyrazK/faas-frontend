/* ==========================================================================
   What to call a tenant. apid's tenant list has no display name: the email
   is the only human identifier, and it is returned only when revealed (an
   audited PII read). Every account also owns a personal org whose slug apid
   derives from the account ID ("u-" + 12 hex, state.PersonalOrgSlug), so
   that slug is another ID, not a name, and must not be shown as one.
   ========================================================================== */

import type { ObsTenantDetailResponse, ObsTenantRow } from '@/lib/api';

const GENERATED_ORG_SLUG = /^u-[0-9a-f]{12}$/;

/** A slug a person chose (a team org), or null for none or the generated personal-org slug. */
export const chosenOrgSlug = (slug?: string | null): string | null =>
  slug && !GENERATED_ORG_SLUG.test(slug) ? slug : null;

const shortAccountId = (id: string) => (id.length > 9 ? `${id.slice(0, 8)}…` : id);

/**
 * How a tenant row reads: the email once revealed, else a chosen org slug,
 * else the short account ID (so hidden-email rows stay distinguishable),
 * with what is left on the second line.
 */
export function tenantRowLabel(tenant: Pick<ObsTenantRow, 'account_id' | 'email' | 'org_slug' | 'is_personal'>): {
  primary: string;
  secondary: string;
  mono: boolean;
} {
  const id = shortAccountId(tenant.account_id);
  const org = chosenOrgSlug(tenant.org_slug);
  if (tenant.email) return { primary: tenant.email, secondary: org ? `${id} · org ${org}` : id, mono: false };
  if (org) return { primary: `org ${org}`, secondary: id, mono: false };
  return { primary: id, secondary: tenant.is_personal ? 'Personal account' : 'Organization account', mono: true };
}

/** The workspace heading: the email once revealed, else a team org the account belongs to, else the kind of account. */
export function workspaceTitle(detail: Pick<ObsTenantDetailResponse, 'account' | 'orgs'> | undefined, includePii: boolean): string {
  if (!detail) return 'Loading customer…';
  const account = detail.account;
  if (account.email) return account.email;
  const org = chosenOrgSlug(account.org_slug) ?? detail.orgs.map((o) => chosenOrgSlug(o.slug)).find(Boolean);
  if (org) return `org ${org}`;
  if (includePii) return 'No email on file';
  return account.is_personal ? 'Personal account' : 'Organization account';
}
