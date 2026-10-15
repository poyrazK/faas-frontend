import { notFound } from 'next/navigation';
import { hostingDashboardEnabled } from '@/lib/hosting-flag';
import { HostingDashboard } from '@/components/hosting/HostingDashboard';

export default function HostingPage() {
  if (!hostingDashboardEnabled) notFound();
  return <HostingDashboard />;
}
