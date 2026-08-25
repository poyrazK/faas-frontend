'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Icon, type IconName } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/States';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: string;
}

const OPS_NAV: NavItem[] = [
  { href: '/operations/overview', label: 'Fleet Overview', icon: 'overview' },
  { href: '/operations/controls', label: 'Emergency Controls', icon: 'bolt' },
  { href: '/operations/nodes', label: 'Compute Host Nodes', icon: 'storage' },
  { href: '/operations/tenants', label: 'Tenant Directory', icon: 'user' },
  { href: '/operations/anomalies', label: 'Anomaly Scoring', icon: 'spark' },
  { href: '/operations/rate-limits', label: 'Rate Limits & Shield', icon: 'shield' },
  { href: '/operations/billing', label: 'Price Catalog Ops', icon: 'plans' },
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

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const { account, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // If unauthenticated and not on the login page, redirect to operator login
  useEffect(() => {
    if (!loading && !account && pathname !== '/operations/login' && pathname !== '/login') {
      router.replace(`/operations/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, account, pathname, router]);

  // If on operator login page, render bare without the shell
  if (pathname === '/operations/login' || pathname === '/login') {
    return <>{children}</>;
  }

  if (loading || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070a12] text-[#94a3b8]">
        <div className="text-center">
          <Spinner size={28} />
          <p className="mt-4 font-mono text-xs text-cyan-400 tracking-wider">
            AUTHENTICATING OPERATOR SESSION…
          </p>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-3">
      <div className="space-y-6">
        {/* Module Header */}
        <div className="px-2 pt-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/80">
            {collapsed ? 'OPS' : 'Mission Control'}
          </div>
          {!collapsed && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Infrastructure & Platform Fleet
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
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)] border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  className={active ? 'text-cyan-400' : 'text-slate-400'}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / Status Area */}
      <div className="border-t border-slate-800/80 pt-3 space-y-2">
        {!collapsed && (
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-400">
              <span>Cluster Status</span>
              <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-slate-400">
              Plane: <span className="text-slate-300">api.gregale.dev</span>
            </div>
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={14} />
          {!collapsed && <span>Collapse Menu</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 selection:bg-cyan-500/30">
      {/* ── Top Mission Control Bar ─────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-slate-800/80 bg-[#090d16]/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-800 md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Toggle menu"
          >
            <Icon name="env" size={18} />
          </button>

          <Link href="/operations/overview" className="flex items-center gap-2.5">
            <Image
              src="/gregale-logo-green-trans.png"
              alt="Gregale"
              width={120}
              height={30}
              style={{ height: 24, width: 'auto' }}
              priority
            />
            <span className="hidden sm:inline-flex items-center rounded-md bg-cyan-950/80 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-400 border border-cyan-500/30 tracking-wider">
              MISSION CONTROL
            </span>
          </Link>
        </div>

        {/* Center Live Telemetry Status Pill */}
        <div className="hidden lg:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-950/40 px-3 py-1 font-mono text-[11px] text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
          <span>CONTROL PLANE ACTIVE</span>
          <span className="text-emerald-600">|</span>
          <span className="text-emerald-400">US-EAST-1</span>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/operations/controls"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-900/40 transition-colors"
            title="Emergency Force-Park & Recovery Primitives"
          >
            <Icon name="bolt" size={13} className="text-red-400" />
            <span>Emergency Controls</span>
          </Link>

          <a
            href="https://gregale.dev/dashboard"
            className="hidden md:inline-flex text-xs text-slate-400 hover:text-cyan-300 transition-colors"
            title="Switch to Customer Developer Portal"
          >
            Customer Console ↗
          </a>

          {/* Operator Profile Pill */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-xs">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-600 text-[10px] font-bold text-white">
              {account.email.slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden sm:inline font-mono text-[11px] text-slate-300 max-w-[140px] truncate">
              {account.email}
            </span>
            <button
              onClick={() => signOut()}
              className="ml-1 text-slate-400 hover:text-red-400 transition-colors"
              title="Sign Out of Operations Console"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="fixed bottom-0 left-0 top-14 z-40 hidden border-r border-slate-800/80 bg-[#090d16] transition-[width] duration-200 md:flex flex-col"
        style={{ width: collapsed ? 64 : 220 }}
      >
        {sidebarContent}
      </aside>

      {/* ── Mobile Drawer ──────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 border-r border-slate-800 bg-[#090d16] p-2">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* ── Main Operations Content Surface ─────────────────────────────────── */}
      <main
        className="pt-14 transition-[margin-left] duration-200"
        style={{ marginLeft: collapsed ? 64 : 220 }}
      >
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
