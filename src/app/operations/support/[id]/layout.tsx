import type { Metadata } from 'next';
import { CONSOLE_TITLE } from '@/lib/routes';

/** "Ticket 1a2b3c4d… | Gregale Operations", so several open tickets can be told apart. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let ticketId = id;
  try {
    ticketId = decodeURIComponent(id);
  } catch {
    /* malformed escape: show it as typed */
  }
  const short = ticketId.length > 9 ? `${ticketId.slice(0, 8)}…` : ticketId;
  return { title: { absolute: `Ticket ${short} | ${CONSOLE_TITLE}` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
