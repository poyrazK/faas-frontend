import type { Metadata } from 'next';
import { opsRouteTitle } from '@/lib/routes';

export const metadata: Metadata = { title: opsRouteTitle('traffic') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
