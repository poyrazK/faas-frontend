'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { probeControlPlane, probeOperatorAccess } from '@/lib/api';
import { OPS_HOME, OPS_ROUTES, isAccountId, isRouteActive, opsHref, tenantHref, type OpsRoute } from '@/lib/routes';
import { Icon } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { StepUpProvider } from '@/components/operator/StepUpProvider';
import { OperatorIntentsProvider, isTerminalIntent, useOperatorIntents } from '@/components/operator/OperatorIntents';

const GROUPS: OpsRoute['group'][] = ['Monitor', 'Customers', 'Fleet', 'Platform'];

const isLoginPath = (pathname: string) => pathname === '/login' || pathname === '/operations/login';

/**
 * The step-up prompt must be mounted before the first authenticated request
 * (an mfa_pending session answers 403 mfa_required on /v1/account), so the
 * providers wrap every state of the shell, including login and loading.
 */
export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <StepUpProvider>
      <OperatorIntentsProvider>
        <OperationsShell>{children}</OperationsShell>
      </OperatorIntentsProvider>
    </StepUpProvider>
  );
}

type Access = 'checking' | 'granted' | 'denied' | 'error';

function OperationsShell({ children }: { children: React.ReactNode }) {
  const { account, loading, signOut: endSession } = useAuth();
  const toast = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [access, setAccess] = useState<Access>('checking');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [controlPlane, setControlPlane] = useState<'checking' | 'online' | 'degraded'>('checking');
  const onLogin = isLoginPath(pathname);

  useEffect(() => {
    if (!loading && !account && !onLogin) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, account, onLogin, pathname, router]);

  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setAccess('checking');
    });
    probeOperatorAccess()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAccess('error');
        setAccessError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (onLogin) return;
    let cancelled = false;
    const check = async () => {
      const healthy = await probeControlPlane();
      if (!cancelled) setControlPlane(healthy ? 'online' : 'degraded');
    };
    void check();
    // Later checks pause while the tab is hidden; the first one always runs.
    const timer = window.setInterval(() => {
      if (!document.hidden) void check();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onLogin]);

  const signOut = async () => {
    const ended = await endSession();
    if (!ended) toast.error('Signed out here, but the server session could not be revoked. It expires on its own.');
  };

  if (onLogin) return <>{children}</>;

  if (loading || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-subtle)]">
        <div className="text-center">
          <Spinner size={24} />
          <p className="mt-4 text-xs font-medium text-[var(--color-ink-muted)]">Checking your operator session…</p>
        </div>
      </div>
    );
  }

  if (access === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-subtle)] p-6">
        <div className="card max-w-md p-8 text-center">
          <Icon name="shield" size={24} className="mx-auto text-[var(--color-danger)]" />
          <h1 className="mt-4 text-lg font-semibold">Not an operator account</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            {account.email} is signed in but is not on the platform operator allowlist, so the operations console is
            unavailable.
          </p>
          <button className="btn btn-secondary btn-sm mt-5" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const railW = collapsed ? 60 : 228;

  const nav = (compact: boolean) => (
    <nav className="flex h-full flex-col justify-between overflow-y-auto p-3" aria-label="Operations">
      <div>
        {GROUPS.map((group) => (
          <div key={group}>
            {compact ? <div className="my-2 border-t border-[var(--color-line)]" /> : <div className="nav-group">{group}</div>}
            <div className="space-y-0.5">
              {OPS_ROUTES.filter((route) => route.group === group).map((route) => {
                const active = isRouteActive(route.slug, pathname);
                return (
                  <Link
                    key={route.slug}
                    href={opsHref(route.slug)}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`nav-item ${active ? 'nav-item-active' : ''} ${compact ? 'justify-center px-0' : ''}`}
                    title={compact ? route.label : undefined}
                  >
                    <Icon name={route.icon} size={16} />
                    {!compact && <span>{route.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button
        className={`nav-item mt-4 hidden w-full md:flex ${compact ? 'justify-center px-0' : ''}`}
        onClick={() => setCollapsed(!collapsed)}
        title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <Icon name={compact ? 'chevronRight' : 'chevronLeft'} size={16} />
        {!compact && <span>Collapse</span>}
      </button>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--color-surface-subtle)]">
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 md:px-4">
        <button className="btn-icon md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
          <Icon name="dots" size={18} />
        </button>
        <Link href={OPS_HOME} className="flex shrink-0 items-center gap-2">
          <Image
            src="/gregale-logo-green-trans.png"
            alt="Gregale"
            width={130}
            height={34}
            style={{ height: 26, width: 'auto' }}
            priority
          />
          <span className="hidden rounded border border-[var(--color-brand-line)] bg-[var(--color-brand-soft)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-brand-bright)] sm:inline-block">
            OPERATIONS
          </span>
        </Link>

        <TenantJump />

        <div className="ml-auto flex items-center gap-2">
          <InFlightChip />
          <span
            className="hidden items-center gap-1.5 text-[11px] font-medium sm:flex"
            title="Control-plane health check (/healthz), every 30 seconds"
            aria-live="polite"
            style={{
              color:
                controlPlane === 'online'
                  ? 'var(--color-brand-bright)'
                  : controlPlane === 'degraded'
                    ? 'var(--color-danger)'
                    : 'var(--color-ink-muted)',
            }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${controlPlane === 'online' ? 'live-dot' : ''}`}
              style={{ background: 'currentColor' }}
            />
            {controlPlane === 'online' ? 'Control plane up' : controlPlane === 'degraded' ? 'Control plane unreachable' : 'Checking…'}
          </span>
          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-2 py-1 hover:bg-[var(--color-surface-subtle)]"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-brand)] text-[10px] font-bold text-white">
                {account.email.slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden max-w-[160px] truncate text-xs font-semibold md:inline">{account.email}</span>
              <Icon name="chevronDown" size={14} className="text-[var(--color-ink-muted)]" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="card absolute right-0 top-11 z-50 w-64 overflow-hidden py-1 shadow-[var(--shadow-pop)]">
                  <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs">
                    <div className="truncate font-semibold">{account.email}</div>
                    <div className="font-mono text-[11px] text-[var(--color-brand-bright)]">
                      {access === 'granted' ? 'Platform operator' : access === 'checking' ? 'Verifying access…' : 'Access not verified'}
                    </div>
                  </div>
                  <div className="p-1 text-xs">
                    <a
                      role="menuitem"
                      href="https://gregale.dev/dashboard/security"
                      className="flex items-center gap-2 rounded px-2.5 py-1.5 hover:bg-[var(--color-surface-subtle)]"
                    >
                      <Icon name="shield" size={14} />
                      MFA & account security
                    </a>
                    <button
                      role="menuitem"
                      onClick={() => void signOut()}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-[var(--color-danger)] hover:bg-[var(--color-surface-subtle)]"
                    >
                      <Icon name="logout" size={14} />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <aside
        className="fixed bottom-0 left-0 top-14 z-40 hidden border-r border-[var(--color-line)] bg-[var(--color-surface)] transition-[width] duration-200 md:block"
        style={{ width: railW }}
      >
        {nav(collapsed)}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-64 border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            {nav(false)}
          </div>
        </div>
      )}

      <main
        className="pt-14 transition-[margin-left] duration-200 md:ml-[var(--rail-w)]"
        style={{ ['--rail-w' as string]: `${railW}px` }}
      >
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          {access === 'error' && (
            <div role="alert" className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
              Operator access could not be verified ({accessError}). Pages may fail until the control plane responds.
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

/** Jump straight to a tenant from anywhere: account ID, email or org slug. */
function TenantJump() {
  const router = useRouter();
  const [value, setValue] = useState('');
  return (
    <form
      className="search-wrap ml-2 hidden w-72 lg:block"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        if (q) router.push(isAccountId(q) ? tenantHref(q) : `/tenants?q=${encodeURIComponent(q)}`);
      }}
    >
      <Icon name="search" size={14} />
      <input
        className="field field-sm"
        placeholder="Find tenant by ID, email or org…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Find tenant"
      />
    </form>
  );
}

/** Pending operator actions, visible from every page. */
function InFlightChip() {
  const { intents } = useOperatorIntents();
  const pending = intents.filter((intent) => !isTerminalIntent(intent.status));
  const failed = intents.filter((intent) => intent.status === 'failed' || intent.status === 'outcome_unknown');
  if (pending.length === 0 && failed.length === 0) return null;
  return (
    <Link
      href="/controls"
      className={`badge ${failed.length ? 'badge-danger' : 'badge-warning'} hover:brightness-95`}
      title="Operator actions you started in this browser session"
    >
      {pending.length > 0 && (
        <>
          <Spinner size={10} /> {pending.length} running
        </>
      )}
      {pending.length > 0 && failed.length > 0 && ' · '}
      {failed.length > 0 && `${failed.length} need attention`}
    </Link>
  );
}
