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

### Internal custom domains

Custom domains require the additional build flag
`NEXT_PUBLIC_FRONTEND_HOSTING_DOMAINS_ENABLED=true` and the backend's independent
`frontend_hosting_domains_enabled` runtime setting. The default is off even
when the hosting dashboard is enabled. The backend capability response supplies
domain controls and limits; no Cloudflare token is sent to the browser.

Durable sites can add five DNS-only CNAME subdomains, up to 64 normalized ASCII
bytes each. The dashboard shows ownership/certificate DNS records, last observed
TLS state, routing publication, retry information, and removal progress. Access
sign-in is required separately on each domain. The domain's DNS must be external
to the SaaS provider's Cloudflare account. Apex/wildcard domains and hostname
reassignment are outside this internal pilot.

Removal uses the reviewed revision, publishes a disabled alias, waits for edge
cache safety, then removes provider resources. A removing row counts against
the quota until cleanup finishes. Removed names stay reserved. Use the backend
[domain runbook](https://github.com/poyrazK/faas/blob/codex/internal-static-hosting/docs/internal-frontend-hosting-domains.md)
for provider setup, independent flags, failure recovery, and live qualification.
The backend uses standard Cloudflare for SaaS APIs without Enterprise custom metadata.
An uncertain hostname-create result requires explicit operator recovery using a reviewed
provider hostname ID; Gregale never automatically adopts a hostname match.


### Hosting account storage

The internal hosting dashboard shows account-wide reserved storage, ready release
payload, pending upload slots and bytes awaiting cleanup. The backend enforces a
1 GiB reservation cap and four pending releases across all projects/environments.
Reservations cover staging and published copies plus a maximum manifest; rollback
reuses them and retirement retains them until cleanup succeeds. The dashboard
marks failed usage reads unavailable rather than reporting zero.

An expandable calculator estimates hypothetical monthly R2/Worker usage costs.
It uses operator-entered operations, requests and CPU counts and assumes current
reserved storage is held for a full month. It uses integer USD millicents and
public rates checked 2026-10-16, including R2 billing-unit rounding before allowances. It
excludes the shared Workers base and other provider/platform charges. It is not
measured traffic, billing or a customer price. Existing flags remain default-off.
See the backend [storage runbook](https://github.com/poyrazK/faas/blob/codex/internal-static-hosting/docs/internal-frontend-hosting-usage.md).


### Hosting traffic observations

Build with `NEXT_PUBLIC_FRONTEND_HOSTING_ANALYTICS_ENABLED=true` as well as the
main hosting flag to opt into the per-site traffic panel. The backend must also
advertise `analytics_enabled`; it independently enforces runtime flags, MFA,
operator/read scope and account/site ownership. Flags default off.

The panel shows approximate authorized Worker requests, expected payload, file
cache hits/misses, hourly trends and recent failure groups. Sampling, drops and
provider lag prevent using these as billing or uptime counters. HEAD/304 have
zero payload; payload is not confirmed visitor delivery. Provider query failure
is shown as unavailable, not zero traffic, and does not disable deployment
controls. Empty results prompt collection verification. No visitor IPs, emails,
paths, URLs or headers are collected. CPU/provider charges remain separate.
See the backend [traffic runbook](https://github.com/poyrazK/faas/blob/codex/internal-static-hosting/docs/internal-frontend-hosting-traffic.md).
