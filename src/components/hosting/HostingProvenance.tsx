import type { HostingReleaseProvenance } from '@/lib/hosting';

export function HostingProvenance({ value }: { value?: HostingReleaseProvenance }) {
 return <div className="space-y-1 text-xs"><p className="font-medium">Caller-provided source details · unverified</p>{value ? <>
  {value.repository && <p className="break-all">Repository: {value.repository}</p>}
  {value.commit_sha && <p className="break-all font-mono">Commit: {value.commit_sha}</p>}
  {value.branch && <p className="break-all">Branch: {value.branch}</p>}
  {value.description && <p className="break-words">{value.description}</p>}
 </> : <p>No source details were supplied.</p>}</div>;
}
