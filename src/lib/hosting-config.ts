import type { HostingCapabilities, HostingFile, HostingReleaseConfig } from './hosting';

export const hostingConfigFilename = 'gregale-hosting.json';
const approvedHeaders = new Set(['content-security-policy', 'content-security-policy-report-only', 'permissions-policy', 'referrer-policy', 'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy']);
const invalid = () => new Error('Invalid hosting configuration. Check version, paths, redirects, approved headers, and the HTML 404 file.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}
function filePath(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[a-zA-Z0-9._~/-]+$/.test(value) &&
    value !== hostingConfigFilename && !value.startsWith('_gregale/') && value.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}
function routePath(value: unknown, max: number): value is string {
  return value === '/' || typeof value === 'string' && value.length <= max && value.startsWith('/') &&
    value.slice(1).replace(/\/$/, '') !== '_gregale' && filePath(value.slice(1).replace(/\/$/, ''), max);
}

// Mirrors the API/Worker contract. Server validation remains authoritative.
export function parseHostingConfig(text: string, limits: HostingCapabilities, files: HostingFile[]): HostingReleaseConfig {
  if (!limits.config_max_bytes || new TextEncoder().encode(text).length > limits.config_max_bytes) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw invalid(); }
  const cfg = object(parsed);
  keys(cfg, ['version', 'redirects', 'headers', 'not_found']);
  if (cfg.version !== 1) throw invalid();
  const redirects = cfg.redirects ?? [];
  const headers = cfg.headers ?? [];
  if (!Array.isArray(redirects) || redirects.length > (limits.config_redirects_max ?? 0) || !Array.isArray(headers) || headers.length > (limits.config_header_rules_max ?? 0)) throw invalid();
  const graph = new Map<string, string>();
  for (const value of redirects) {
    const rule = object(value); keys(rule, ['from', 'to', 'status']);
    if (!routePath(rule.from, limits.path_max_bytes) || !routePath(rule.to, limits.path_max_bytes) || ![301, 302, 307, 308].includes(rule.status as number) || graph.has(rule.from)) throw invalid();
    graph.set(rule.from, rule.to);
  }
  for (const source of graph.keys()) {
    const seen = new Set<string>();
    for (let p = source; graph.has(p); p = graph.get(p)!) {
      if (seen.has(p)) throw invalid(); seen.add(p);
    }
  }
  const seen = new Set<string>();
  for (const value of headers) {
    const rule = object(value); keys(rule, ['path', 'values']);
    if (typeof rule.path !== 'string' || !routePath(rule.path.replace(/\*$/, ''), limits.path_max_bytes) || rule.path.includes('*') && !rule.path.endsWith('/*') || seen.has(rule.path)) throw invalid();
    seen.add(rule.path);
    const values = object(rule.values);
    if (Object.keys(values).length < 1 || Object.keys(values).length > (limits.config_headers_per_rule_max ?? 0)) throw invalid();
    for (const [name, v] of Object.entries(values)) {
      if (!approvedHeaders.has(name) || typeof v !== 'string' || !v.length || v.length > (limits.config_header_value_max_bytes ?? 0) || v.trim() !== v || /[^\x20-\x7e]/.test(v)) throw invalid();
    }
  }
  if (cfg.not_found !== undefined && cfg.not_found !== '') {
    if (!filePath(cfg.not_found, limits.path_max_bytes) || !files.some((file) => file.path === cfg.not_found && file.content_type.split(';')[0].toLowerCase() === 'text/html')) throw invalid();
  }
  return cfg as unknown as HostingReleaseConfig;
}
