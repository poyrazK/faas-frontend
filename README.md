# Gregale Operations Console

The operator console for **Gregale**, a scale-to-zero Firecracker MicroVM
Serverless Platform. Customer-facing pages live in the separate `faas-web`
project and are deployed at `https://gregale.dev`.

---

## 🚀 Live Production Deployment

- **Operations Console**: [https://operations.gregale.dev](https://operations.gregale.dev)
- **Automatic CI/CD**: Every push to `main` branch automatically deploys to Vercel.

---

## 🛠️ Local Development Setup

```bash
# Install dependencies
npm install

# Run dev server
npm run dev
```

Open [http://operations.localhost:3000](http://operations.localhost:3000) to view
the operator console locally.

## Internal frontend hosting pilot

The hosting dashboard is default-off. Build an internal operations deployment
with `NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED=true` and `APID_BACKEND_URL` set to
the dedicated pilot API. The public flag is compiled by Next.js: changing it
requires a new build. The link is hidden and `/operations/hosting` returns 404 when
it is unset, false, or any value other than lowercase `true`. On the operations
host, `/hosting` is the clean URL.

Apid must contain the hosting capability endpoint and migrations from
`codex/internal-static-hosting` in `poyrazK/faas`, have private providers
configured, and independently enable `frontend_hosting_enabled`. All reads
and writes remain protected by apid's operator allowlist, session MFA, scopes,
and account ownership. There is no tenant impersonation in this page: projects,
environments, and sites belong to the signed-in account (or its existing active
organization context). The API runtime flag immediately rejects new operations;
the dashboard notices it on its 30-second access refresh. Site serving retains
the backend's separate Worker/leased/durable switch semantics.

Use the backend Terraform module's `dashboard_upload_origins` for exact HTTPS
operations origins. The bucket stays private. The operations origin must also
pass apid's session-write origin guard, normally `operations.<apps-domain>`;
an arbitrary Vercel preview hostname is not enough. Keep development previews
on a dedicated pilot API. Follow the backend
[hosting runbook](https://github.com/poyrazK/faas/blob/codex/internal-static-hosting/docs/internal-frontend-hosting.md)
and its browser-upload section before enabling the pilot.

Create a site in a registered project/environment, choose one prebuilt output
folder containing `index.html`, and deploy. The browser reads and hashes one
bounded file at a time, then uploads directly to signed private staging grants
without Gregale cookies, headers, or referrers. Progress counts completed files
and bytes; the browser refreshes grants before half their lifetime elapses.
Upload limits come from the guarded backend capability response.

Deployments verify uploaded bytes before promotion and use the revision shown
when deployment starts. Conflicts require refresh and review; the UI never
automatically promotes with a newer revision. Cancellation and uncertain
network responses retain server-side releases. Refresh the release list to
verify an uploaded release, publish a verified one, or retire an incomplete
one before retrying. Retired/deleting resources remain counted until safe
cleanup completes. Durable sites also support suspend/resume.

Publication status confirms storage of a routing generation; edge locations
may lag up to 60 seconds, and it is not a serving-health result. Legacy leased
sites explicitly show untracked publication. Site visits require a separate
Cloudflare Access sign-in. No build service, custom domains, SSR, or customer
hosting entitlement is enabled by this dashboard.

Validation: `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`. Upload tests cover manifest bounds, digest/MIME handling,
staging-only destinations, forbidden-header handling, credential isolation,
grant renewal, optimistic revisions, cancellation, and retained failures.
