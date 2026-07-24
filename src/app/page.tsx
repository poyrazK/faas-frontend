'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { PLANS } from '@/lib/format';
import { Plan } from '@/lib/api';

function Nav() {
  const { account, loading } = useAuth();
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--color-line)' }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="flex items-center">
          <Image src="/gregale-logo-green-trans.png" alt="Gregale" width={140} height={36} style={{ height: 34, width: 'auto' }} priority />
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold md:flex" style={{ color: 'var(--color-ink-soft)' }}>
          <a href="#features">Features</a>
          <a href="#architecture">Architecture</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          {!loading && account ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">Open console</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link href="/login" className="btn btn-primary btn-sm">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Feature({ title, children, badge }: { title: string; children: React.ReactNode; badge: string }) {
  return (
    <div className="card p-6">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-brand)' }}>{badge}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>{children}</p>
    </div>
  );
}

export default function Home() {
  const order: Plan[] = ['free', 'hobby', 'pro', 'scale'];
  return (
    <div>
      <Nav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center md:px-8">
        <span className="badge badge-brand mb-5">Firecracker microVMs · scale to zero</span>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
          Serverless without the <span style={{ color: 'var(--color-brand)' }}>cold-start penalty.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg" style={{ color: 'var(--color-ink-soft)' }}>
          Gregale runs your apps inside isolated Firecracker microVMs. They park as memory snapshots on NVMe when idle and
          unpark on request in under 350&nbsp;ms — with zero resident memory while parked.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className="btn btn-primary" style={{ padding: '0.7rem 1.4rem' }}>Launch console</Link>
          <a href="#architecture" className="btn btn-secondary" style={{ padding: '0.7rem 1.4rem' }}>How it works</a>
        </div>
        <div
          className="mx-auto mt-8 inline-flex items-center gap-3 rounded-lg px-4 py-2.5"
          style={{ background: 'var(--color-surface-code)' }}
        >
          <span className="mono text-sm" style={{ color: '#4ade80' }}>$</span>
          <code className="mono text-sm" style={{ color: '#e2e8f0' }}>curl -fsSL https://get.gregale.dev | sh</code>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-14 md:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature badge="< 350ms p50" title="Cold wake, not cold start">
            Snapshots restore memory, network and clock in one pipeline. Your app resumes exactly where it parked.
          </Feature>
          <Feature badge="Hardware isolation" title="A microVM per tenant">
            Every workload runs jailed under its own uid, seccomp filter and cgroup — a real VM boundary, not a shared runtime.
          </Feature>
          <Feature badge="Predictable billing" title="Pay for running seconds">
            Billed on plan RAM + 8&nbsp;MB per running second. Parked apps cost nothing. No surprise bills from sampled RSS.
          </Feature>
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="mx-auto max-w-6xl px-4 py-14 md:px-8">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold">How a request wakes your app</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            The full path from an idle snapshot to a served response.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ['1 · Gateway', 'gatewayd holds the request and asks the scheduler to wake the app.'],
            ['2 · Restore', 'vmmd restores the Firecracker snapshot from NVMe — memory unpark ~142ms.'],
            ['3 · Resume', 'The guest re-seeds entropy and steps its clock before signalling ready.'],
            ['4 · Serve', 'The gateway forwards the held request. Total p50 under 350ms.'],
          ].map(([t, d]) => (
            <div key={t} className="card p-5">
              <div className="text-sm font-bold" style={{ color: 'var(--color-brand)' }}>{t}</div>
              <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>{d}</p>
            </div>
          ))}
        </div>
        <div className="card mt-4 p-6">
          <div className="grid gap-6 sm:grid-cols-3 text-center">
            {[
              ['Two-drive rootfs', 'Shared read-only base + per-app overlay. ~130 MB per sandbox on disk.'],
              ['Snapshot as cache', 'Snapshots are cache, not truth — apps always cold-boot as a fallback.'],
              ['Zero when parked', "A parked app's cgroup is gone. No resident RAM, no cost."],
            ].map(([t, d]) => (
              <div key={t}>
                <div className="text-sm font-semibold">{t}</div>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14 md:px-8">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold">Simple, capacity-based pricing</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            Start free. Overage billed at €0.01 per GB-hour.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {order.map((p) => {
            const info = PLANS[p];
            return (
              <div key={p} className="card flex flex-col p-6" style={p === 'pro' ? { borderColor: 'var(--color-brand)', borderWidth: 2 } : undefined}>
                {p === 'pro' && <span className="badge badge-brand mb-2 self-start">Most popular</span>}
                <h3 className="text-lg font-bold">{info.label}</h3>
                <div className="mt-1 text-3xl font-bold">
                  {info.price}<span className="text-sm font-normal" style={{ color: 'var(--color-ink-muted)' }}>/mo</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                  <li>{info.apps} app{info.apps > 1 ? 's' : ''}</li>
                  <li>{info.ramMb} MB RAM / app</li>
                  <li>{info.concurrency} concurrent wakes</li>
                  <li>{info.gbHours} GB-hours included</li>
                </ul>
                <Link href="/login" className={`btn ${p === 'pro' ? 'btn-primary' : 'btn-secondary'} mt-5 w-full`}>
                  Get started
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--color-line)' }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm md:flex-row md:px-8" style={{ color: 'var(--color-ink-muted)' }}>
          <div className="flex items-center gap-2">
            <Image src="/gregale-logo-green-trans.png" alt="Gregale" width={110} height={28} style={{ height: 26, width: 'auto' }} />
          </div>
          <p>© {new Date().getFullYear()} Gregale. Scale-to-zero Firecracker MicroVM cloud.</p>
        </div>
      </footer>
    </div>
  );
}
