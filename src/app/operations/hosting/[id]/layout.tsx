import type { Metadata } from 'next';
import { CONSOLE_TITLE } from '@/lib/routes';

/** "Site 1a2b3c4d… | Gregale Operations"; the Hosting layout's plain title stops the root template here. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let siteId = id;
  try {
    siteId = decodeURIComponent(id);
  } catch {
    /* malformed escape: show it as typed */
  }
  const short = siteId.length > 9 ? `${siteId.slice(0, 8)}…` : siteId;
  return { title: { absolute: `Site ${short} | ${CONSOLE_TITLE}` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
