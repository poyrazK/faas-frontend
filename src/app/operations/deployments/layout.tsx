import type { Metadata } from 'next';
import { opsRouteTitle } from '@/lib/routes';

export const metadata: Metadata = { title: opsRouteTitle('deployments') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
