import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { deployHostingDirectory, prepareHostingFiles, validateHostingGrants, HostingDeployError } from './hosting-upload';
import { hostingSiteURL, type HostingCapabilities, type HostingManifest, type HostingSite, type HostingUploadResponse } from './hosting';

const limits: HostingCapabilities = {
  upload_base_url: 'https://private.r2.example/bucket', files_max: 1000, file_max_bytes: 32 << 20,
  release_max_bytes: 100 << 20, manifest_max_bytes: 512 << 10, path_max_bytes: 512,
  content_type_max_bytes: 128, name_max_bytes: 48, sites_per_account: 25, releases_per_site: 10,
  upload_ttl_seconds: 300, storage_timeout_seconds: 30, finalize_timeout_seconds: 120,
};
const site: HostingSite = {
  id: '11111111-1111-4111-8111-111111111111', account_id: 'account', project_id: 'project', environment: 'staging',
  name: 'portal', hostname: 'portal.hosting.example', status: 'active', active_release_id: 'previous',
  revision: 7, durable_routing: true, suspended: false, created_at: '2026-10-15T12:00:00Z',
};
const releaseID = '22222222-2222-4222-8222-222222222222';
function file(path: string, body = '<h1>Hello</h1>') {
  const selected = new File([body], path.split('/').pop()!);
  Object.defineProperty(selected, 'webkitRelativePath', { value: `dist/${path}` });
  return selected;
}
function grants(manifest: HostingManifest): HostingUploadResponse {
  return {
    release: { id: releaseID, site_id: site.id, state: 'pending', manifest, created_at: site.created_at },
    uploads: manifest.files.map((item) => ({ path: item.path,
      url: `${limits.upload_base_url}/hosting/staging/${site.id}/${releaseID}/${item.path}?signature=private-test-grant`,
      headers: { Host: ['private.r2.example'], 'Content-Length': [String(item.size)] },
    })),
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('bounded output-directory manifests', () => {
  it('hashes bytes and preserves framework paths, empty files, and MIME types', async () => {
    const selected = [file('index.html'), file('_next/static/app.js', 'alert(1)'), file('empty.txt', '')];
    const prepared = await prepareHostingFiles(selected, true, limits, new AbortController().signal);
    expect(prepared.manifest.spa_fallback).toBe(true);
    expect(prepared.manifest.files.find((item) => item.path === '_next/static/app.js')).toMatchObject({ content_type: 'text/javascript', sha256: createHash('sha256').update('alert(1)').digest('hex') });
    expect(prepared.manifest.files.find((item) => item.path === 'empty.txt')?.size).toBe(0);
    expect(prepared.files.get('index.html')).toBe(selected[0]);
  });

  it.each(['../x', 'assets/a b.js', 'a//b', 'a%2fb', '_gregale/releases/x', '/absolute'])('rejects ambiguous path %s', async (path) => {
    await expect(prepareHostingFiles([file('index.html'), file(path)], false, limits, new AbortController().signal)).rejects.toThrow('unsupported URL paths');
  });

  it('rejects missing root index, duplicate paths, and mixed directories', async () => {
    const signal = new AbortController().signal;
    await expect(prepareHostingFiles([file('nested/index.html')], false, limits, signal)).rejects.toThrow('index.html');
    await expect(prepareHostingFiles([file('index.html'), file('index.html')], false, limits, signal)).rejects.toThrow('duplicate');
    const other = new File([''], 'x');
    Object.defineProperty(other, 'webkitRelativePath', { value: 'other/x' });
    await expect(prepareHostingFiles([file('index.html'), other], false, limits, signal)).rejects.toThrow('one built output directory');
  });

  it('checks all byte/count/manifest limits before creating a server release', async () => {
    const signal = new AbortController().signal;
    const selected = [file('index.html'), file('app.js')];
    for (const smaller of [{ files_max: 1 }, { file_max_bytes: 1 }, { release_max_bytes: 20 }, { manifest_max_bytes: 1 }]) {
      await expect(prepareHostingFiles(selected, false, { ...limits, ...smaller }, signal)).rejects.toThrow();
    }
    const controller = new AbortController(); controller.abort();
    await expect(prepareHostingFiles(selected, false, limits, controller.signal)).rejects.toThrow();
  });
});

describe('private staging grants', () => {
  it.each(['published', 'foreign-origin', 'other-site', 'credentials', 'duplicate', 'header', 'release'])('rejects %s grants before sending file bytes', async (mode) => {
    const prepared = await prepareHostingFiles([file('index.html'), file('app.js')], false, limits, new AbortController().signal);
    const response = grants(prepared.manifest);
    if (mode === 'published') response.uploads[0].url = response.uploads[0].url.replace('/staging/', '/published/');
    if (mode === 'foreign-origin') response.uploads[0].url = response.uploads[0].url.replace('private.r2.example', 'elsewhere.example');
    if (mode === 'other-site') response.uploads[0].url = response.uploads[0].url.replace(site.id, 'other');
    if (mode === 'credentials') response.uploads[0].url = response.uploads[0].url.replace('https://', 'https://name:password@');
    if (mode === 'duplicate') response.uploads[1] = response.uploads[0];
    if (mode === 'header') response.uploads[0].headers.Authorization = ['never-forward'];
    if (mode === 'release') response.release.id = 'other';
    expect(() => validateHostingGrants(response, site.id, releaseID, prepared, limits)).toThrow();
  });

  it('renders site links only as validated HTTPS hostnames', () => {
    expect(hostingSiteURL('x.hosting.example')).toBe('https://x.hosting.example');
    for (const value of ['javascript:alert(1)', 'x.example/path', 'user@x.example', 'x.example:80']) expect(hostingSiteURL(value)).toBeNull();
  });
});

function deploymentServer(options: { fail?: 'upload' | 'finalize' | 'promote'; afterUpload?: () => void; signal?: AbortController } = {}) {
  let manifest: HostingManifest;
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    if (path.endsWith('/releases')) {
      manifest = JSON.parse(init.body as string);
      return json({ ...grants(manifest).release });
    }
    if (path.endsWith('/uploads')) return json(grants(manifest));
    if (path.startsWith('https://private.r2.example/')) {
      if (options.signal) { options.signal.abort(); throw new Error('provider error including private-test-grant'); }
      if (options.fail === 'upload') throw new Error('provider error including private-test-grant');
      options.afterUpload?.();
      return new Response('', { status: 200 });
    }
    if (path.endsWith('/finalize')) return options.fail === 'finalize' ? json({ detail: 'Verification unavailable' }, 503) : json({ ...grants(manifest).release, state: 'ready' });
    if (path.endsWith('/promotions')) return options.fail === 'promote' ? json({ code: 'hosting_release_conflict', detail: 'Hosting state changed' }, 409) : json({ ...site, active_release_id: releaseID, revision: 8 });
    throw new Error('Unexpected API call');
  }));
  return calls;
}

describe('directory deployment lifecycle', () => {
  it('uploads without cookies or API headers, then verifies and uses the starting revision', async () => {
    const calls = deploymentServer();
    const progress: string[] = [];
    const result = await deployHostingDirectory(site, [file('index.html'), file('app.js')], true, limits, new AbortController().signal, (p) => progress.push(p.phase));
    expect(result.active_release_id).toBe(releaseID);
    const uploads = calls.filter((call) => call.path.startsWith('https://'));
    expect(uploads).toHaveLength(2);
    for (const { init } of uploads) {
      expect(init).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors' });
      expect([...new Headers(init.headers).keys()]).toEqual(['content-type']);
      expect(init.body).toBeInstanceOf(File);
    }
    const apiCalls = calls.filter((call) => !call.path.startsWith('https://'));
    expect(apiCalls.every((call) => call.init.credentials === 'include')).toBe(true);
    expect(new Set(apiCalls.map((call) => new Headers(call.init.headers).get('Idempotency-Key'))).size).toBe(apiCalls.length);
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ release_id: releaseID, expected_revision: 7 });
    expect(progress).toContain('verifying'); expect(progress.at(-1)).toBe('accepted');
  });

  it('refreshes expiring grants without creating another release or reuploading completed files', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const calls = deploymentServer({ afterUpload: () => { now += 151000; } });
    await deployHostingDirectory(site, [file('index.html'), file('app.js')], false, limits, new AbortController().signal, () => {});
    expect(calls.filter((call) => call.path.endsWith('/uploads'))).toHaveLength(2);
    expect(calls.filter((call) => call.path.endsWith('/releases'))).toHaveLength(1);
    expect(calls.filter((call) => call.path.startsWith('https://'))).toHaveLength(2);
  });

  it.each(['upload', 'finalize', 'promote'] as const)('retains release identity after %s failure and never silently retries', async (fail) => {
    const calls = deploymentServer({ fail });
    const result = await deployHostingDirectory(site, [file('index.html')], false, limits, new AbortController().signal, () => {}).then(
      () => { throw new Error('Expected deployment failure'); },
      (error) => error as HostingDeployError,
    );
    expect(result).toBeInstanceOf(HostingDeployError);
    expect(result.releaseID).toBe(releaseID);
    expect(result.message).not.toContain('private-test-grant');
    expect(calls.filter((call) => call.path.endsWith('/promotions'))).toHaveLength(fail === 'promote' ? 1 : 0);
    if (fail === 'promote') expect(result.message).toContain('verified release is retained');
  });

  it('cancels without finalizing, promoting, or discarding server-side cleanup state', async () => {
    const controller = new AbortController();
    const calls = deploymentServer({ signal: controller });
    await expect(deployHostingDirectory(site, [file('index.html')], false, limits, controller.signal, () => {})).rejects.toMatchObject({ releaseID, message: expect.stringContaining('Deployment stopped') });
    expect(calls.some((call) => /\/(finalize|promotions)$/.test(call.path))).toBe(false);
  });
});
