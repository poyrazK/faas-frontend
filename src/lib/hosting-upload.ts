import {
  createHostingRelease, getHostingUploads, finalizeHostingRelease, promoteHostingRelease,
  type HostingCapabilities, type HostingManifest, type HostingFile, type HostingSite,
  type HostingUpload, type HostingUploadResponse,
} from './hosting';

export interface PreparedHostingFiles {
  manifest: HostingManifest;
  files: Map<string, File>;
  bytes: number;
}

export interface HostingDeployProgress {
  phase: 'hashing' | 'creating' | 'uploading' | 'verifying' | 'promoting' | 'accepted';
  completed: number;
  total: number;
  bytes: number;
  totalBytes: number;
  releaseID?: string;
}

export class HostingDeployError extends Error {
  constructor(message: string, readonly releaseID?: string) { super(message); }
}

const mime: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', map: 'application/json', txt: 'text/plain', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', pdf: 'application/pdf',
  webmanifest: 'application/manifest+json', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
};

function validPath(path: string, max: number): boolean {
  return path.length <= max && /^[a-zA-Z0-9._~/-]+$/.test(path) &&
    !path.startsWith('_gregale/') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export async function prepareHostingFiles(
  selected: readonly File[], spa: boolean, limits: HostingCapabilities, signal: AbortSignal,
  progress: (completed: number, total: number) => void = () => {},
): Promise<PreparedHostingFiles> {
  if (selected.length === 0 || selected.length > limits.files_max) throw new Error(`Select between 1 and ${limits.files_max} files.`);
  const files = new Map<string, File>();
  let bytes = 0;
  let root: string | undefined;
  for (const file of selected) {
    signal.throwIfAborted();
    // webkitdirectory includes the chosen output folder. Strip exactly that
    // common root, retaining nested paths (including framework asset folders).
    const relative = file.webkitRelativePath;
    const prefix = relative?.split('/')[0];
    if (!relative || !prefix || (root !== undefined && root !== prefix)) throw new Error('Select one built output directory.');
    root = prefix;
    const path = relative.slice(prefix.length + 1);
    if (!validPath(path, limits.path_max_bytes) || files.has(path)) throw new Error('The directory contains duplicate or unsupported URL paths.');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.file_max_bytes) throw new Error(`A file exceeds ${limits.file_max_bytes} bytes.`);
    bytes += file.size;
    if (bytes > limits.release_max_bytes) throw new Error(`The directory exceeds ${limits.release_max_bytes} bytes.`);
    files.set(path, file);
  }
  if (!files.has('index.html')) throw new Error('Choose the output folder containing index.html at its root.');
  const manifest: HostingManifest = { files: [], spa_fallback: spa };
  for (const [path, file] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    signal.throwIfAborted();
    // Hash one bounded file at a time; never buffer the entire release.
    const data = await file.arrayBuffer();
    if (data.byteLength !== file.size) throw new Error('A selected file changed. Select the output folder again.');
    const digest = await crypto.subtle.digest('SHA-256', data);
    signal.throwIfAborted();
    const contentType = mime[path.split('.').pop()!.toLowerCase()] ||
      (/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.type) ? file.type : 'application/octet-stream');
    if (contentType.length > limits.content_type_max_bytes) throw new Error('A file content type exceeds the hosting limit.');
    manifest.files.push({ path, size: file.size, content_type: contentType,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') });
    progress(manifest.files.length, selected.length);
  }
  if (new TextEncoder().encode(JSON.stringify(manifest)).length > limits.manifest_max_bytes) throw new Error('The file manifest exceeds the hosting limit.');
  return { manifest, files, bytes };
}

function uploadHeaders(grant: HostingUpload, file: HostingFile, url: URL): Headers {
  const headers = new Headers({ 'Content-Type': file.content_type });
  for (const [key, values] of Object.entries(grant.headers)) {
    // Host and Content-Length are forbidden request headers in browsers.
    // The browser supplies them from the URL and immutable File body.
    if (key.toLowerCase() === 'host' && values.length === 1 && values[0] === url.host) continue;
    if (key.toLowerCase() === 'content-length' && values.length === 1 && values[0] === String(file.size)) continue;
    if (key.toLowerCase() === 'content-type' && values.length === 1 && values[0] === file.content_type) continue;
    throw new Error('The upload grant requires unsupported headers.');
  }
  return headers;
}

export function validateHostingGrants(response: HostingUploadResponse, site: string, release: string, prepared: PreparedHostingFiles, limits: HostingCapabilities): Map<string, { url: string; headers: Headers }> {
  if (response.release.id !== release || response.release.site_id !== site || response.release.state !== 'pending' || response.uploads.length !== prepared.files.size) throw new Error('The upload grants do not match this release.');
  const base = new URL(limits.upload_base_url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid hosting upload destination.');
  const grants = new Map<string, { url: string; headers: Headers }>();
  const manifest = new Map(prepared.manifest.files.map((file) => [file.path, file]));
  for (const grant of response.uploads) {
    const file = manifest.get(grant.path);
    if (!file || grants.has(grant.path)) throw new Error('The upload grants contain duplicate or unexpected paths.');
    const url = new URL(grant.url);
    const expectedPath = `${base.pathname.replace(/\/$/, '')}/hosting/staging/${site}/${release}/${file.path}`;
    if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash || decodeURIComponent(url.pathname) !== expectedPath) throw new Error('The upload grant is outside this release staging directory.');
    grants.set(file.path, { url: grant.url, headers: uploadHeaders(grant, file, url) });
  }
  return grants;
}

export async function deployHostingDirectory(
  site: HostingSite, selected: readonly File[], spa: boolean, limits: HostingCapabilities,
  signal: AbortSignal, onProgress: (progress: HostingDeployProgress) => void,
): Promise<HostingSite> {
  let releaseID: string | undefined;
  let verified = false;
  let phase: HostingDeployProgress['phase'] = 'hashing';
  try {
    onProgress({ phase, completed: 0, total: selected.length, bytes: 0, totalBytes: 0 });
    const prepared = await prepareHostingFiles(selected, spa, limits, signal, (completed, total) => onProgress({ phase, completed, total, bytes: 0, totalBytes: 0 }));
    const report = (next: HostingDeployProgress['phase'], completed = 0, bytes = 0) => {
      phase = next;
      onProgress({ phase, completed, total: selected.length, bytes, totalBytes: prepared.bytes, releaseID });
    };
    report('creating');
    const release = await createHostingRelease(site.id, prepared.manifest, signal);
    releaseID = release.id;
    report('uploading');
    let grants: ReturnType<typeof validateHostingGrants> | undefined;
    let issuedAt = 0;
    let completed = 0;
    let bytes = 0;
    for (const [path, file] of prepared.files) {
      signal.throwIfAborted();
      if (!grants || performance.now() - issuedAt >= limits.upload_ttl_seconds * 500) {
        // Renew the whole grant set before half the TTL has elapsed; do not
        // reupload completed files or create another release on expiry.
        issuedAt = performance.now();
        grants = validateHostingGrants(await getHostingUploads(site.id, releaseID, signal), site.id, releaseID, prepared, limits);
      }
      const grant = grants.get(path)!;
      let response: Response;
      try {
        response = await fetch(grant.url, {
          method: 'PUT', body: file, headers: grant.headers, mode: 'cors',
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([signal, AbortSignal.timeout(limits.storage_timeout_seconds * 1000)]),
        });
      } catch {
        signal.throwIfAborted();
        // Never surface provider exceptions: they can include signed URLs.
        throw new Error('Upload could not finish. Check the connection and dashboard upload configuration.');
      }
      if (!response.ok) throw new Error(`Upload rejected (HTTP ${response.status}).`);
      report('uploading', ++completed, bytes += file.size);
    }
    report('verifying', completed, bytes);
    await finalizeHostingRelease(site.id, releaseID, limits, signal);
    verified = true;
    report('promoting', completed, bytes);
    // Use the revision visible when deployment began. Never overwrite a
    // concurrent promotion/suspension by silently fetching a fresh revision.
    const updated = await promoteHostingRelease(site.id, releaseID, site.revision, signal);
    report('accepted', completed, bytes);
    return updated;
  } catch (error) {
    const message = signal.aborted ? 'Deployment stopped. Refresh releases to see any completed server work.' :
      error instanceof Error ? error.message : 'Deployment failed.';
    const hint = releaseID ? (verified ? ' The verified release is retained; refresh before publishing it.' : ' The release is retained; refresh to verify or retire it.') : '';
    throw new HostingDeployError(message + hint, releaseID);
  }
}
