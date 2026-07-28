'use client';

/* ==========================================================================
   Marketing home, laid out section-for-section like the product template:
   hero + illustration, feature grid, stat strip, "how it works" flow,
   workflow-type cards, architecture facts, terminal block, pricing, CTA
   band and a full footer.

   The copy is Gregale's own and every figure here is one the platform
   actually claims — no placeholder logos, no invented uptime number.
   ========================================================================== */

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { PLANS } from '@/lib/format';
import { Plan } from '@/lib/api';
import { Icon, type IconName } from '@/components/ui/Icons';
import { HeroArt } from '@/components/marketing/HeroArt';

const ORDER: Plan[] = ['free', 'hobby', 'pro', 'scale'];

/* ─────────────────────────────── Nav ───────────────────────────────────── */

function Nav() {
  const { account, loading } = useAuth();
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--color-line)' }}
    >
      <div className="section flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image
            src="/gregale-logo-green-trans.png"
            alt="Gregale"
            width={140}
            height={36}
            style={{ height: 32, width: 'auto' }}
            priority
          />
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium md:flex" style={{ color: 'var(--color-ink-soft)' }}>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#workflows">Workflows</a>
          <a href="#pricing">Pricing</a>
          <a href="/v1/openapi.yaml" target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
        <div className="flex items-center gap-2">
          {!loading && account ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Open console
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                Sign in
              </Link>
              <Link href="/login" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────────── Sections ───────────────────────────────── */

function Hero() {
  return (
    <section className="section grid items-center gap-12 pb-8 pt-16 lg:grid-cols-2 lg:pt-24">
      <div>
        <span className="badge badge-brand mb-5">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
          Built on Firecracker · scale to zero
        </span>
        <h1 className="text-4xl font-bold leading-[1.08] tracking-tight md:text-[56px]">
          Serverless without the
          <br />
          <span style={{ color: 'var(--color-brand)' }}>cold-start penalty.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg" style={{ color: 'var(--color-ink-soft)' }}>
          Gregale runs your apps inside isolated Firecracker microVMs. They park as memory snapshots on NVMe when idle
          and unpark on request in under 350&nbsp;ms — with zero resident memory while parked.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/login" className="btn btn-primary" style={{ padding: '0.72rem 1.5rem' }}>
            Launch console <Icon name="arrowRight" size={15} />
          </Link>
          <a href="#how" className="btn btn-secondary" style={{ padding: '0.72rem 1.5rem' }}>
            How it works
          </a>
        </div>
        <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
          {['No credit card required', 'Scale to zero', 'Pay per running second'].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Icon name="check" size={14} style={{ color: 'var(--color-brand)' }} />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        <HeroArt className="w-full" />
        <div className="card absolute bottom-2 right-2 flex items-center gap-2.5 px-3.5 py-2.5" style={{ boxShadow: 'var(--shadow-raised)' }}>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
          >
            <Icon name="bolt" size={16} />
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-semibold">Powered by Firecracker</span>
            <span className="block text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Hardware isolation per tenant
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features: { icon: IconName; title: string; body: string }[] = [
    {
      icon: 'bolt',
      title: 'Cold wake, not cold start',
      body: 'Snapshots restore memory, network and clock in one pipeline. Your app resumes exactly where it parked.',
    },
    {
      icon: 'scale',
      title: 'Zero when parked',
      body: "A parked app's cgroup is gone — no resident RAM, no cost, no idle instance quietly billing you.",
    },
    {
      icon: 'workflows',
      title: 'Built for workflows',
      body: 'HTTPS apps, cron schedules and queue jobs run on the same runtime, with one deploy and one bill.',
    },
    {
      icon: 'shield',
      title: 'A microVM per tenant',
      body: 'Every workload is jailed under its own uid, seccomp filter and cgroup — a real VM boundary, not a shared runtime.',
    },
  ];

  return (
    <section id="features" className="section py-14">
      <div className="card grid-hairline grid-hairline-124 grid overflow-hidden md:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="p-6">
            <span
              className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
            >
              <Icon name={f.icon} size={19} />
            </span>
            <h3 className="text-[15px] font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatStrip() {
  const stats = [
    ['< 350ms', 'p50 cold wake'],
    ['~142ms', 'Memory unpark'],
    ['0 MB', 'Resident when parked'],
    ['€0.01', 'Per GB-hour overage'],
  ];
  return (
    <section className="section pb-14">
      <div className="card grid-hairline-24 grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {stats.map(([big, small]) => (
          <div key={big + small} className="px-6 py-7 text-center">
            <div className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-brand)' }}>
              {big}
            </div>
            <div className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {small}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ['1 · Gateway', 'gatewayd holds the request and asks the scheduler to wake the app.', 'globe'],
    ['2 · Restore', 'vmmd restores the Firecracker snapshot from NVMe — memory unpark ~142ms.', 'storage'],
    ['3 · Resume', 'The guest re-seeds entropy and steps its clock before signalling ready.', 'refresh'],
    ['4 · Serve', 'The gateway forwards the held request. Total p50 under 350ms.', 'check'],
  ] as const;

  return (
    <section id="how" className="section py-14">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold tracking-tight">How a request wakes your app</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          The full path from an idle snapshot to a served response.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {steps.map(([title, body, icon], i) => (
          <div key={title} className="relative">
            <div className="card h-full p-5">
              <span
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
              >
                <Icon name={icon as IconName} size={17} />
              </span>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>
                {title}
              </div>
              <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                {body}
              </p>
            </div>
            {i < steps.length - 1 && (
              <span
                className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full md:flex"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink-muted)' }}
              >
                <Icon name="chevronRight" size={11} />
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Architecture facts */}
      <div className="card mt-3 grid gap-6 p-6 sm:grid-cols-3">
        {[
          ['Two-drive rootfs', 'Shared read-only base plus a per-app overlay — about 130 MB per sandbox on disk.'],
          ['Snapshot as cache', 'Snapshots are a cache, not the source of truth. Apps always cold-boot as a fallback.'],
          ['Billed on running seconds', 'Plan RAM plus 8 MB per running second. No surprise bills from sampled RSS.'],
        ].map(([t, d]) => (
          <div key={t}>
            <div className="text-sm font-semibold">{t}</div>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {d}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkflowTypes() {
  const kinds: { icon: IconName; title: string; body: string; href: string }[] = [
    {
      icon: 'apis',
      title: 'HTTPS APIs',
      body: 'Every app gets a TLS endpoint that parks when idle and wakes on the next request.',
      href: '/login',
    },
    {
      icon: 'crons',
      title: 'Cron jobs',
      body: 'Schedule recurring requests on a cron expression. Minute, hourly or custom — all in UTC.',
      href: '/login',
    },
    {
      icon: 'queues',
      title: 'Queue jobs',
      body: 'Push work onto a per-app queue and let the drain dispatch it with retries and leases.',
      href: '/login',
    },
  ];

  return (
    <section id="workflows" className="section py-14">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Built for every serverless workflow</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          One runtime, one deploy, one bill — whether the trigger is a request, a schedule or a message.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {kinds.map((k) => (
          <div key={k.title} className="card p-6" style={{ background: 'var(--color-brand-softer)' }}>
            <span
              className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-surface)', color: 'var(--color-brand-bright)', border: '1px solid var(--color-brand-line)' }}
            >
              <Icon name={k.icon} size={20} />
            </span>
            <h3 className="text-base font-semibold">{k.title}</h3>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              {k.body}
            </p>
            <Link href={k.href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--color-brand)' }}>
              Get started <Icon name="arrowRight" size={13} />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeveloperFirst() {
  return (
    <section className="section py-14">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div
          className="overflow-hidden rounded-xl"
          style={{ background: 'var(--color-surface-code)', boxShadow: 'var(--shadow-raised)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="h-3 w-3 rounded-full" style={{ background: '#f87171' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#fbbf24' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#4ade80' }} />
            <span className="ml-2 text-xs" style={{ color: '#8b8d84' }}>
              Terminal
            </span>
          </div>
          <pre className="mono overflow-x-auto px-5 py-5 text-[13px] leading-relaxed" style={{ color: '#e7e5e1' }}>
            <Line prompt>curl -fsSL https://get.gregale.dev | sh</Line>
            <Line out>Installed gregale CLI</Line>
            {'\n'}
            <Line prompt>gregale deploy</Line>
            <Line out>Building app layer…</Line>
            <Line out>Uploading (12.4 MB)</Line>
            <Line out>Snapshotting microVM…</Line>
            <Line ok>Live in 4.2s</Line>
            {'\n'}
            <Line url>https://hello-world.gregale.app</Line>
          </pre>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-brand)' }}>
            Developer first
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Deploy in seconds, not hours.</h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            One command ships your code. The CLI and the REST API cover the same surface, so anything you can click in
            the console you can script in CI.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'One command deploys your code',
              'Live log streaming over SSE',
              'Instant rollback to the previous deployment',
              'Open API spec for any language or tool',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                <Icon name="check" size={15} style={{ color: 'var(--color-brand)', marginTop: 2, flex: 'none' }} />
                {t}
              </li>
            ))}
          </ul>
          <a href="/v1/openapi.yaml" target="_blank" rel="noreferrer" className="btn btn-secondary mt-6">
            Read the API spec <Icon name="external" size={13} />
          </a>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="section py-14">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Simple, capacity-based pricing</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          Start free. Overage billed at €0.01 per GB-hour beyond your included allowance.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((p) => {
          const info = PLANS[p];
          const featured = p === 'pro';
          return (
            <div
              key={p}
              className="card flex flex-col p-6"
              style={featured ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 1px var(--color-brand)' } : undefined}
            >
              {featured && <span className="badge badge-brand mb-2 self-start">Most popular</span>}
              <h3 className="text-lg font-bold">{info.label}</h3>
              <div className="mt-1 text-[32px] font-bold leading-none tracking-tight">
                {info.price}
                <span className="text-sm font-normal" style={{ color: 'var(--color-ink-muted)' }}>
                  /mo
                </span>
              </div>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                {[
                  `${info.apps} workflow${info.apps > 1 ? 's' : ''}`,
                  `${info.ramMb} MB RAM per microVM`,
                  `${info.concurrency} concurrent wake${info.concurrency > 1 ? 's' : ''}`,
                  `${info.gbHours} GB-hours included`,
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Icon name="check" size={14} style={{ color: 'var(--color-brand)', marginTop: 3, flex: 'none' }} />
                    {t}
                  </li>
                ))}
              </ul>
              <Link href="/login" className={`btn ${featured ? 'btn-primary' : 'btn-secondary'} mt-6 w-full`}>
                Get started
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="section pb-16">
      <div className="card relative overflow-hidden px-8 py-12" style={{ background: 'var(--color-brand-softer)' }}>
        <div className="dot-grid pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60" />
        <div className="relative grid items-center gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Start building on Gregale</h2>
            <p className="mt-2.5 max-w-md text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              Create your account and deploy your first workflow in minutes. It parks itself when nobody&apos;s calling.
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              {['No credit card required', 'Free forever plan'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Icon name="check" size={14} style={{ color: 'var(--color-brand)' }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link href="/login" className="btn btn-primary" style={{ padding: '0.72rem 1.5rem' }}>
              Get started for free <Icon name="arrowRight" size={15} />
            </Link>
            <a href="#pricing" className="btn btn-secondary" style={{ padding: '0.72rem 1.5rem' }}>
              View pricing
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'How it works', href: '#how' },
        { label: 'Workflows', href: '#workflows' },
        { label: 'Pricing', href: '#pricing' },
      ],
    },
    {
      title: 'Developers',
      links: [
        { label: 'API reference', href: '/v1/openapi.yaml', external: true },
        { label: 'OpenAPI (JSON)', href: '/v1/openapi.json', external: true },
        { label: 'Console', href: '/dashboard' },
        { label: 'Sign in', href: '/login' },
      ],
    },
    {
      title: 'Project',
      links: [
        { label: 'Source', href: 'https://github.com/poyrazK/faas', external: true },
        { label: 'Issues', href: 'https://github.com/poyrazK/faas/issues', external: true },
      ],
    },
  ];

  return (
    <footer style={{ borderTop: '1px solid var(--color-line)', background: 'var(--color-surface-subtle)' }}>
      <div className="section py-12">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Image
              src="/gregale-logo-green-trans.png"
              alt="Gregale"
              width={130}
              height={34}
              style={{ height: 30, width: 'auto' }}
            />
            <p className="mt-3 max-w-xs text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              A scale-to-zero Firecracker microVM cloud. Apps park as snapshots and wake on request.
            </p>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <h4 className="text-[13px] font-semibold">{c.title}</h4>
              <ul className="mt-3 space-y-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className="hover:underline">
                        {l.label}
                      </a>
                    ) : l.href.startsWith('#') ? (
                      <a href={l.href} className="hover:underline">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="hover:underline">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-10 flex flex-col items-center justify-between gap-3 pt-6 text-sm md:flex-row"
          style={{ borderTop: '1px solid var(--color-line)', color: 'var(--color-ink-muted)' }}
        >
          <p>© {new Date().getFullYear()} Gregale. Scale-to-zero Firecracker MicroVM cloud.</p>
          <a
            href="https://github.com/poyrazK/faas"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:underline"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.75.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── Terminal helper ───────────────────────────── */

function Line({
  children,
  prompt,
  out,
  ok,
  url,
}: {
  children: React.ReactNode;
  prompt?: boolean;
  out?: boolean;
  ok?: boolean;
  url?: boolean;
}) {
  if (prompt) {
    return (
      <div>
        <span style={{ color: '#4ade80' }}>$ </span>
        <span>{children}</span>
      </div>
    );
  }
  if (ok) return <div style={{ color: '#4ade80' }}>&gt; {children}</div>;
  if (url) return <div style={{ color: '#7dd3fc' }}>&gt; {children}</div>;
  if (out) return <div style={{ color: '#8b8d84' }}>&gt; {children}</div>;
  return <div>{children}</div>;
}

/* ──────────────────────────────── Page ─────────────────────────────────── */

export default function Home() {
  return (
    <div>
      <Nav />
      <Hero />
      <FeatureGrid />
      <StatStrip />
      <HowItWorks />
      <WorkflowTypes />
      <DeveloperFirst />
      <Pricing />
      <CtaBand />
      <Footer />
    </div>
  );
}
