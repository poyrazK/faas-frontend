'use client';

/* ==========================================================================
   Console shell: full-width top bar, grouped collapsible sidebar with the
   plan meter pinned to its foot, and the routed page area.

   Everything shown in the chrome is real: the account chip is the signed-in
   account, and the plan meter is this month's GB-hour roll-up from
   /v1/usage/summary — not a mocked dollar figure.
   ========================================================================== */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getUsageSummary } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { Spinner } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { PLANS } from '@/lib/format';
import { NAV, isActive } from '@/components/shell/nav';

const COLLAPSE_KEY = 'gg.sidebar.collapsed';

/**
 * The collapsed flag lives in localStorage, which is an external store rather
 * than React state — reading it through useSyncExternalStore keeps the server
 * snapshot (false) and the client snapshot consistent without a hydration
 * flash or a setState-in-effect.
 */
const collapseStore = {
  listeners: new Set<() => void>(),
  subscribe(fn: () => void) {
    collapseStore.listeners.add(fn);
    window.addEventListener('storage', fn);
    return () => {
      collapseStore.listeners.delete(fn);
      window.removeEventListener('storage', fn);
    };
  },
  get(): boolean {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  },
  set(v: boolean) {
    localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    collapseStore.listeners.forEach((fn) => fn());
  },
};

/** Whole days left in the current UTC billing month. */
function daysLeftInMonth(): number {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { account, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.get,
    () => false,
  );
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);

  const usage = useAsync(() => getUsageSummary(), []);

  useEffect(() => {
    if (!loading && !account) router.replace('/login?next=' + encodeURIComponent(pathname));
  }, [loading, account, router, pathname]);

  const toggleCollapse = useCallback(() => collapseStore.set(!collapsed), [collapsed]);

  if (loading || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3" style={{ color: 'var(--color-ink-muted)' }}>
        <Spinner size={22} /> <span className="text-sm">Loading console…</span>
      </div>
    );
  }

  const plan = PLANS[account.plan];
  const u = usage.data;
  const usedPct = u && u.included_gb_hours > 0 ? Math.min(100, (u.used_gb_hours / u.included_gb_hours) * 100) : 0;
  const railW = collapsed ? 68 : 224;

  const sidebar = (
    <>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group, gi) => (
          <div key={group.label ?? gi}>
            {group.label &&
              (collapsed ? (
                <div className="mx-3 my-3" style={{ borderTop: '1px solid var(--color-line)' }} />
              ) : (
                <div className="nav-group">{group.label}</div>
              ))}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawer(false)}
                    className={`nav-item ${active ? 'nav-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon name={item.icon} size={16} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.unbacked && (
                      <span
                        className="ml-auto h-1.5 w-1.5 rounded-full"
                        style={{ background: 'var(--color-line-strong)' }}
                        title="No backend endpoint yet"
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Plan meter */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-line)' }}>
        {collapsed ? (
          <Link
            href="/dashboard/plans"
            onClick={() => setDrawer(false)}
            className="nav-item justify-center"
            title={`${plan.label} plan — ${u ? `${u.used_gb_hours.toFixed(1)}/${u.included_gb_hours} GB-h` : 'usage loading'}`}
          >
            <Icon name="plans" size={16} />
          </Link>
        ) : (
          <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--color-surface-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{plan.label} Plan</span>
              <Link
                href="/dashboard/plans"
                onClick={() => setDrawer(false)}
                className="text-xs font-medium"
                style={{ color: 'var(--color-brand)' }}
              >
                Manage
              </Link>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold">
              {u ? `${u.used_gb_hours.toFixed(2)}` : '—'}
              <span className="font-normal" style={{ color: 'var(--color-ink-muted)' }}>
                {u ? ` / ${u.included_gb_hours} GB-h` : ''}
              </span>
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
              Resets in {daysLeftInMonth()} days
            </div>
            <span className="meter mt-2">
              <span
                style={{
                  width: `${usedPct}%`,
                  background: usedPct > 90 ? 'var(--color-warn)' : 'var(--color-brand)',
                }}
              />
            </span>
          </div>
        )}

        <button
          className={`nav-item mt-2 w-full ${collapsed ? 'justify-center px-0' : ''}`}
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-surface-subtle)' }}>
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 px-3 md:px-4"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
      >
        <button className="btn-icon md:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Icon name="env" size={18} />
        </button>

        <Link href="/dashboard" className="flex items-center" style={{ width: collapsed ? undefined : 196 }}>
          <Image
            src="/gregale-logo-green-trans.png"
            alt="Gregale"
            width={130}
            height={34}
            style={{ height: 28, width: 'auto' }}
            priority
          />
        </Link>

        {/* Account chip — the template's team switcher. Gregale accounts are
            single-tenant, so this opens account actions rather than a list. */}
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
              <span className="block max-w-[150px] truncate text-[13px] font-semibold">{account.email}</span>
              <span className="block text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
                {plan.label} Plan
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
                <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-line)' }}>
                  <div className="truncate text-sm font-semibold">{account.email}</div>
                  <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                    {account.app_count} workflow{account.app_count === 1 ? '' : 's'} · {plan.label}
                  </div>
                </div>
                <Link href="/dashboard/settings" className="block px-3 py-2 text-sm hover:bg-[var(--color-surface-subtle)]">
                  Account settings
                </Link>
                <Link href="/dashboard/keys" className="block px-3 py-2 text-sm hover:bg-[var(--color-surface-subtle)]">
                  API keys
                </Link>
                <Link href="/dashboard/plans" className="block px-3 py-2 text-sm hover:bg-[var(--color-surface-subtle)]">
                  Plans &amp; billing
                </Link>
                <button
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-subtle)]"
                  style={{ color: 'var(--color-danger)', borderTop: '1px solid var(--color-line)' }}
                  onClick={() => signOut().then(() => router.replace('/login'))}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/poyrazK/faas/issues/new"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm hidden md:inline-flex"
          >
            Feedback
          </a>
          <Link href="/dashboard/alerts" className="btn-icon" aria-label="Alerts">
            <Icon name="bell" size={17} />
          </Link>
          <a href="/v1/openapi.yaml" target="_blank" rel="noreferrer" className="btn-icon" aria-label="API reference">
            <Icon name="help" size={17} />
          </a>
          <Link
            href="/dashboard/settings"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: 'var(--color-ink)' }}
            aria-label="Account"
          >
            {initials(account.email)}
          </Link>
        </div>
      </header>

      {/* ── Sidebar (desktop) ─────────────────────────────────────────── */}
      <aside
        className="fixed bottom-0 left-0 top-14 z-40 hidden flex-col transition-[width] duration-200 md:flex"
        style={{ width: railW, background: 'var(--color-surface)', borderRight: '1px solid var(--color-line)' }}
      >
        {sidebar}
      </aside>

      {/* ── Sidebar (mobile drawer) ───────────────────────────────────── */}
      {drawer && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0" style={{ background: 'rgba(26,28,25,0.4)' }} onClick={() => setDrawer(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col"
            style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-line)' }}
          >
            <div className="flex h-14 items-center justify-between px-4" style={{ borderBottom: '1px solid var(--color-line)' }}>
              <Image
                src="/gregale-logo-green-trans.png"
                alt="Gregale"
                width={120}
                height={30}
                style={{ height: 26, width: 'auto' }}
              />
              <button className="btn-icon" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <Icon name="x" size={18} />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      {/* ── Page ──────────────────────────────────────────────────────── */}
      <div className="pt-14 transition-[padding] duration-200" style={{ paddingLeft: 0 }}>
        <div className="md:pl-[var(--rail)]" style={{ ['--rail' as string]: `${railW}px` }}>
          <main className="mx-auto max-w-[1400px] px-4 py-7 md:px-7">{children}</main>
        </div>
      </div>
    </div>
  );
}
