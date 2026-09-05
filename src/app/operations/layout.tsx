'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { probeControlPlane } from '@/lib/api';
import { Icon, type IconName } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/States';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const OPS_NAV: NavItem[] = [
  { href: '/operations/overview', label: 'Fleet Overview', icon: 'overview' },
  { href: '/operations/incidents', label: 'Incident Center', icon: 'alerts' },
  { href: '/operations/controls', label: 'Emergency Controls', icon: 'bolt' },
  { href: '/operations/nodes', label: 'Compute Host Nodes', icon: 'storage' },
  { href: '/operations/capacity', label: 'Capacity Planning', icon: 'metrics' },
  { href: '/operations/tenants', label: 'Tenant Directory', icon: 'user' },
  { href: '/operations/anomalies', label: 'Anomaly Scoring', icon: 'spark' },
  { href: '/operations/rate-limits', label: 'Rate Limits & Shield', icon: 'shield' },
  { href: '/operations/billing', label: 'Price Catalog Ops', icon: 'plans' },
  { href: '/operations/configuration', label: 'Runtime Configuration', icon: 'settings' },
  { href: '/operations/audit-log', label: 'Global Audit Trail', icon: 'logs' },
];

function isOpsActive(href: string, pathname: string): boolean {
  if (href === '/operations/overview') {
    return pathname === '/operations/overview' || pathname === '/overview' || pathname === '/operations' || pathname === '/';
  }
  const cleanHref = href.replace('/operations', '');
  return (
    pathname === href ||
    pathname === cleanHref ||
    pathname.startsWith(href + '/') ||
    pathname.startsWith(cleanHref + '/')
  );
}

function initials(str: string): string {
  return str.slice(0, 2).toUpperCase();
}

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const { account, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [controlPlaneState, setControlPlaneState] = useState<'checking' | 'online' | 'degraded'>('checking');
  const [lastHealthCheck, setLastHealthCheck] = useState<Date | null>(null);

  useEffect(() => {
    if (!loading && !account && pathname !== '/operations/login' && pathname !== '/login') {
      router.replace(`/operations/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, account, pathname, router]);

  useEffect(() => {
    if (pathname === '/operations/login' || pathname === '/login') {
      return;
    }

    let cancelled = false;
    const check = async () => {
      const healthy = await probeControlPlane();
      if (!cancelled) {
        setControlPlaneState(healthy ? 'online' : 'degraded');
        setLastHealthCheck(new Date());
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  if (pathname === '/operations/login' || pathname === '/login') {
    return <>{children}</>;
  }

  if (loading || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--color-surface-subtle)' }}>
        <div className="text-center">
          <Spinner size={24} />
          <p className="mt-4 text-xs font-medium text-[var(--color-ink-muted)]">
            Authenticating operator session…
          </p>
        </div>
      </div>
    );
  }

  const railW = collapsed ? 60 : 220;
  const controlPlaneLabel =
    controlPlaneState === 'online' ? 'ONLINE' : controlPlaneState === 'degraded' ? 'DEGRADED' : 'CHECKING';
  const controlPlaneColor =
    controlPlaneState === 'online' ? 'var(--color-brand-bright)' : controlPlaneState === 'degraded' ? 'var(--color-danger)' : 'var(--color-ink-muted)';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-3">
      <div className="space-y-4">
        {/* Module Header */}
        <div className="px-2 pt-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-bright)]">
            {collapsed ? 'OPS' : 'Operations'}
          </div>
          {!collapsed && (
            <p className="text-[11px] text-[var(--color-ink-muted)] mt-0.5">
              Platform & Fleet Controls
            </p>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {OPS_NAV.map((item) => {
            const active = isOpsActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className={`nav-item ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={16} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Controls */}
      <div className="border-t border-[var(--color-line)] pt-3 space-y-2">
        {!collapsed && (
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-2.5 text-[11px]">
            <div className="flex items-center justify-between text-[var(--color-ink-muted)]">
              <span>Control Plane</span>
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: controlPlaneColor }} aria-live="polite">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${controlPlaneState === 'online' ? 'live-dot' : ''}`}
                  style={{ background: controlPlaneColor }}
                />
                {controlPlaneLabel}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-muted)]">
              Host: <span className="font-semibold text-[var(--color-ink)]">api.gregale.dev</span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">
              Checked: {lastHealthCheck ? lastHealthCheck.toLocaleTimeString() : '—'}
            </div>
          </div>
        )}

        {!collapsed && (
          <a
            href="https://gregale.dev/dashboard/security"
            className="block px-2 text-[11px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Manage MFA & account security ↗
          </a>
        )}

        <button
          className={`nav-item mt-2 w-full ${collapsed ? 'justify-center px-0' : ''}`}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-surface-subtle)' }}>
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 px-3 md:px-4"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
      >
        <button
          className="btn-icon md:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
        >
          <Icon name="env" size={18} />
        </button>

        <Link
          href="/operations/overview"
          className="flex items-center gap-2"
          style={{ width: collapsed ? undefined : 210 }}
        >
          <Image
            src="/gregale-logo-green-trans.png"
            alt="Gregale"
            width={130}
            height={34}
            style={{ height: 28, width: 'auto' }}
            priority
          />
          <span className="hidden sm:inline-block rounded bg-[var(--color-brand-bright)]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-brand-bright)] border border-[var(--color-brand-bright)]/20">
            OPERATIONS
          </span>
        </Link>

        {/* Account Switcher Pill */}
        <div className="relative hidden sm:block">
          <button
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--color-surface-subtle)]"
            style={{ border: '1px solid var(--color-line)' }}
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold text-white"
              style={{ background: 'var(--color-brand)' }}
            >
              {initials(account.email)}
            </span>
            <span className="text-left leading-tight">
              <span className="block max-w-[150px] truncate text-[13px] font-semibold">
                {account.email}
              </span>
              <span className="block text-[11px] font-mono text-[var(--color-brand-bright)]">
                Operator Access
              </span>
            </span>
            <Icon name="chevronDown" size={14} style={{ color: 'var(--color-ink-muted)' }} />
          </button>

          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div
                className="card absolute left-0 top-12 z-50 w-64 overflow-hidden py-1"
                style={{ boxShadow: 'var(--shadow-pop)' }}
                onClick={() => setMenu(false)}
              >
                <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs">
                  <div className="font-semibold">{account.email}</div>
                  <div className="text-[11px] text-[var(--color-brand-bright)] font-mono">
                    Operator Privileged
                  </div>
                </div>

                <div className="p-1">
                  <Link
                    href="/operations/controls"
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)]"
                  >
                    <Icon name="bolt" size={14} className="text-[var(--color-danger)]" />
                    <span>Emergency Controls</span>
                  </Link>

                  <a
                    href="https://gregale.dev/dashboard"
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)]"
                  >
                    <Icon name="external" size={14} />
                    <span>Customer Console</span>
                  </a>

                  <button
                    onClick={() => signOut()}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-[var(--color-danger)] hover:bg-[var(--color-surface-subtle)]"
                  >
                    <Icon name="x" size={14} />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right header actions */}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/operations/controls"
            className="btn btn-secondary btn-xs hidden sm:inline-flex text-xs font-semibold text-[var(--color-danger)] border-[var(--color-danger-subtle)]"
            title="Emergency Force-Park & Recovery Primitives"
          >
            <Icon name="bolt" size={13} className="text-[var(--color-danger)]" />
            <span>Emergency Controls</span>
          </Link>

          <a
            href="https://gregale.dev/dashboard"
            className="btn btn-ghost btn-xs hidden md:inline-flex text-xs"
            title="Return to Customer Developer Console"
          >
            Customer Console ↗
          </a>

          <a
            href="https://github.com/poyrazK/faas/issues/new"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm hidden md:inline-flex"
          >
            Feedback
          </a>

          <button
            onClick={() => signOut()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-ink)' }}
            title="Sign out of Operations"
            aria-label="Account"
          >
            {initials(account.email)}
          </button>
        </div>
      </header>

      {/* ── Sidebar (desktop) ─────────────────────────────────────────── */}
      <aside
        className="fixed bottom-0 left-0 top-14 z-40 hidden flex-col transition-[width] duration-200 md:flex"
        style={{ width: railW, background: 'var(--color-surface)', borderRight: '1px solid var(--color-line)' }}
      >
        {sidebarContent}
      </aside>

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="fixed inset-y-0 left-0 w-64 p-2"
            style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-line)' }}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* ── Main content surface ───────────────────────────────────────── */}
      <main
        className="pt-14 transition-[margin-left] duration-200"
        style={{ marginLeft: railW }}
      >
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
