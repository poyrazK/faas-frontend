import type { HostingCapabilities, HostingReleaseProvenance } from './hosting';

export function validateHostingProvenance(p: HostingReleaseProvenance, limits: HostingCapabilities): void {
 if (!Object.values(p).some(Boolean)) throw new Error('Provide at least one source detail.');
 for (const [value, max] of [[p.repository, limits.provenance_repository_max_bytes], [p.branch, limits.provenance_branch_max_bytes], [p.description, limits.provenance_description_max_bytes]] as const) {
  if (value && (!max || new TextEncoder().encode(value).length > max || value.trim() !== value || /[\p{Cc}\p{Cf}]/u.test(value))) throw new Error('Source details exceed the advertised bounds or contain unsupported characters.');
 }
 if (p.commit_sha && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(p.commit_sha)) throw new Error('Use the full lowercase Git commit SHA.');
}
