'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui/States';
import { PLANS } from '@/lib/format';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: icon('M3 13h8V3H3z|M13 21h8v-8h-8z|M3 21h8v-6H3z|M13 9h8V3h-8z') },
  { href: '/dashboard/apps', label: 'Apps', icon: icon('M4 4h16v12H4z|M2 20h20') },
  { href: '/dashboard/deployments', label: 'Deployments', icon: icon('M12 2v20|M2 7l10 5 10-5|M2 17l10 5 10-5') },
  { href: '/dashboard/domains', label: 'Domains', icon: icon('M12 2a10 10 0 100 20 10 10 0 000-20|M2 12h20|M12 2a15 15 0 010 20 15 15 0 010-20') },
  { href: '/dashboard/crons', label: 'Cron Triggers', icon: icon('M12 6v6l4 2|M12 2a10 10 0 100 20 10 10 0 000-20') },
  { href: '/dashboard/keys', label: 'API Keys', icon: icon('M15 7a4 4 0 11-4 4|M11 11l-8 8v2h2l1-1h2v-2h2l3-3') },
  { href: '/dashboard/usage', label: 'Usage & Billing', icon: icon('M3 3v18h18|M7 15l4-4 3 3 5-6') },
  { href: '/dashboard/settings', label: 'Settings', icon: icon('M12 15a3 3 0 100-6 3 3 0 000 6|M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-4l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.3 2.5h4l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z') },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { account, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !account) router.replace('/login?next=' + encodeURIComponent(pathname));
  }, [loading, account, router, pathname]);

  if (loading || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3" style={{ color: 'var(--color-ink-muted)' }}>
        <Spinner size={22} /> <span className="text-sm">Loading console…</span>
      </div>
    );
  }

  const plan = PLANS[account.plan];

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-surface-subtle)' }}>
      {/* Sidebar */}
      <aside
        className="fixed inset-y-0 left-0 hidden w-60 flex-col md:flex"
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-line)' }}
      >
        <div className="flex h-16 items-center px-5" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <Link href="/" className="flex items-center">
            <Image src="/gregale-logo-green-trans.png" alt="Gregale" width={130} height={34} style={{ height: 32, width: 'auto' }} priority />
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAV.map((item) => {
            const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={{
                  background: active ? 'var(--color-brand-soft)' : 'transparent',
                  color: active ? 'var(--color-brand-bright)' : 'var(--color-ink-soft)',
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4" style={{ borderTop: '1px solid var(--color-line)' }}>
          <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--color-surface-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-ink)' }}>{plan.label} plan</span>
              <Link href="/dashboard/usage" className="text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>
                Manage
              </Link>
            </div>
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--color-ink-muted)' }}>{account.email}</p>
          </div>
          <button className="btn btn-ghost btn-sm mt-2 w-full justify-start" onClick={() => signOut().then(() => router.replace('/login'))}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="md:pl-60">
        {/* Mobile top bar */}
        <header
          className="flex h-16 items-center justify-between px-4 md:hidden"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
        >
          <Link href="/">
            <Image src="/gregale-logo-green-trans.png" alt="Gregale" width={120} height={30} style={{ height: 28, width: 'auto' }} />
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut().then(() => router.replace('/login'))}>Sign out</button>
        </header>

        {/* Mobile nav scroller */}
        <div
          className="flex gap-1 overflow-x-auto px-3 py-2 md:hidden"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
        >
          {NAV.map((item) => {
            const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: active ? 'var(--color-brand-soft)' : 'transparent',
                  color: active ? 'var(--color-brand-bright)' : 'var(--color-ink-soft)',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
