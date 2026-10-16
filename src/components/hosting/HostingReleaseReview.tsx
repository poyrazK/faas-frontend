'use client';

import type { HostingReleaseReview as Review } from '@/lib/hosting';

export function HostingReleaseReview({ review, stale, disabled, onPublish, onClose }: {
  review: Review; stale: boolean; disabled: boolean; onPublish: () => void; onClose: () => void;
}) {
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Release comparison">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Review release {review.release_id.slice(0,8)}</h3>
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onClose}>Close comparison</button></div>
    <p className="text-sm">Compared with {review.base_release_id ? `release ${review.base_release_id.slice(0,8)}` : 'an empty site'} at revision {review.expected_revision}.</p>
    <p className="text-sm">{review.added} added · {review.changed} changed · {review.removed} removed · {review.before_bytes} → {review.after_bytes} content bytes</p>
    <p className="text-xs text-[var(--color-ink-muted)]">Removed paths may remain available from previously published retained releases. Publishing replaces the active release and preserves suspension.</p>
    {review.files.length > 0 && <div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Path</th><th className="p-2">Change</th><th className="p-2">Before → after</th></tr></thead>
      <tbody>{review.files.map((f) => <tr key={f.path} className="border-t border-[var(--color-line)]"><td className="p-2 font-mono">{f.path}</td><td className="p-2">{f.change}</td>
        <td className="p-2">{f.before ? `${f.before.size} B · ${f.before.content_type} · ${f.before.sha256.slice(0,8)}` : '—'} → {f.after ? `${f.after.size} B · ${f.after.content_type} · ${f.after.sha256.slice(0,8)}` : '—'}</td></tr>)}</tbody></table></div>}
    {review.settings_changed ? <details open><summary className="text-sm font-medium">SPA, redirects, headers, and 404 configuration changes</summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">{[['Before',review.before_settings],['After',review.after_settings]].map(([label,value]) => <div key={String(label)}><p className="text-xs font-medium">{String(label)}</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value,null,2)}</pre></div>)}</div>
    </details> : <p className="text-xs">SPA and response configuration are unchanged.</p>}
    {stale && <p role="alert" className="text-sm text-[var(--color-danger)]">The site or release changed. Close this comparison, refresh, and review again before publishing.</p>}
    <button type="button" className="btn btn-primary btn-sm" disabled={disabled || stale} onClick={onPublish}>Publish reviewed release</button>
  </section>;
}
