import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

if (process.env.NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED === 'true') {
  throw new Error('Customer release verification requires the hosting build flag to be off');
}

const root = path.resolve('.next/static');
const markers = ['Frontend Hosting', '/v1/internal/hosting', 'frontend_hosting_', 'HostingDashboard'];
let checked = 0;
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:js|map)$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  const body = await readFile(file, 'utf8');
  for (const marker of markers) {
    if (body.includes(marker)) throw new Error(`Hosting implementation marker ${marker} in ${path.relative(root, file)}`);
  }
  checked++;
}
if (!checked) throw new Error('No production JavaScript found; run the production build first');
console.log(`Verified hosting is absent from ${checked} public JavaScript/source map files`);
