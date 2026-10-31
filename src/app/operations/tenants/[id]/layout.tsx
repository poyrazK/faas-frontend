import type { Metadata } from 'next';
import { CONSOLE_TITLE } from '@/lib/routes';

/**
 * "Tenant 11111111… | Gregale Operations", so several open customers can be
 * told apart. The Tenants layout's plain title stops the root template from
 * reaching this segment, so the full title is spelled out.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let accountId = id;
  try {
    accountId = decodeURIComponent(id);
  } catch {
    /* malformed escape: show it as typed */
  }
  const short = accountId.length > 9 ? `${accountId.slice(0, 8)}…` : accountId;
  return { title: { absolute: `Tenant ${short} | ${CONSOLE_TITLE}` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
