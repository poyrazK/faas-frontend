import Link from 'next/link';
import Image from 'next/image';

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-5"
      style={{ background: 'var(--color-surface-subtle)' }}
    >
      <div className="card w-full max-w-md p-8 text-center">
        <Image
          src="/gregale-logo-green-trans.png"
          alt="Gregale"
          width={130}
          height={34}
          style={{ height: 28, width: 'auto', margin: '0 auto' }}
        />
        <h1 className="mt-6 text-3xl font-bold tracking-tight">404</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          That page doesn&apos;t exist. It may have been renamed, or the workflow it belonged to was deleted.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/dashboard" className="btn btn-primary">
            Go to the console
          </Link>
          <Link href="/" className="btn btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
