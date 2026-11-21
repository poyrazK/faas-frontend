import type { Metadata } from 'next';
import { CONSOLE_TITLE } from '@/lib/routes';

/** "Instance 1a2b3c4d… | Gregale Operations", so several open instances can be told apart. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let instanceId = id;
  try {
    instanceId = decodeURIComponent(id);
  } catch {
    /* malformed escape: show it as typed */
  }
  const short = instanceId.length > 9 ? `${instanceId.slice(0, 8)}…` : instanceId;
  return { title: { absolute: `Instance ${short} | ${CONSOLE_TITLE}` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
