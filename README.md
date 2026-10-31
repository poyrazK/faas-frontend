# Gregale Operations Console

The operator console for **Gregale**, a scale-to-zero Firecracker microVM
platform. Operators use it to watch the fleet and to act on customers'
accounts, apps and infrastructure. Customer-facing pages live in the separate
`faas-web` project (`https://gregale.dev`); this app serves only the operator
tree, on every host.

- Production: <https://operations.gregale.dev> (Vercel, deploys on push to `main`)
- Backend: `apid` in [`poyrazK/faas`](https://github.com/poyrazK/faas)

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
```

`/v1/*`, `/healthz` and the sign-in aliases are proxied to
`APID_BACKEND_URL` (default `https://api.gregale.dev`), so the session cookie
is first-party. Sign in with an account on the backend's operator allowlist
(`FAAS_ADMIN_EMAILS`) that has MFA enrolled.

Writes from a local origin are rejected by apid's same-origin check unless the
backend trusts that origin; reads work.

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Next dev server                 |
| `npm run build`     | Production build                |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint                          |
| `npm test`          | Vitest (node environment)       |
| `npm run e2e`       | Playwright end-to-end tests against a mock apid |
| `npm run contract -- --backend <faas checkout>` | Check API types against apid |

CI runs typecheck, lint, tests and a production build on every PR, and the
end-to-end suite in a separate job.

### End-to-end tests

`npm run e2e` starts `e2e/mock-apid.mjs` (a local stand-in for apid on
:3199), builds the console against it and drives it in Chromium: step-up and
enrollment, session expiry, deep links, the jump box, in-place instance
actions, stale-deployment repair, the release check, the incident bundle and
session sign-out. Run `npx playwright install chromium` once first.
`E2E_DEV=1 npm run e2e` uses the dev server instead of a build, which starts
faster while writing tests. Add fixtures for new endpoints to the mock; any
route without one answers `503 mock_unavailable`.

## How it is put together

- **Routes** — `src/lib/routes.ts` is the single list of pages. The sidebar
  renders it and `src/proxy.ts` maps each clean URL (`/tenants`) onto its
  route folder (`src/app/operations/tenants`). To add a page, add an entry and
  create the folder.
- **Customers** — `/tenants/<account id>` is the customer workspace (overview,
  apps, deployments, job runs, billing, flags, activity timeline). Link to it
  with `tenantHref(id, tab?)` from `src/lib/routes.ts`, or `<TenantLink>`.
- **API client** — `src/lib/api.ts` holds the shared transport and the core
  operator types; area clients live in `src/lib/ops/*`. Operator routes are
  not in apid's OpenAPI spec, so types are written by hand against the Go
  structs in `faas` and tagged `@go pkg.Type`. The contract guard
  (`npm run contract`, run in CI on every PR and daily) fails when they drift;
  see `scripts/contract/README.md`.
- **Writes** — every write goes through `OperatorActionDialog`: it states the
  impact, requires an audited reason (apid's lifecycle endpoints accept only
  `[a-z0-9_]{1,64}` codes), can require typed confirmation, blocks double
  submits, and keeps one `Idempotency-Key` per request so retries replay
  instead of applying twice.
- **Step-up MFA** — apid requires a TOTP check less than five minutes old for
  every `/v1/admin/*` write. The transport catches `403 step_up_required`,
  `StepUpProvider` asks for a code, and the request is replayed with its
  original idempotency key.
- **Async actions** — node lifecycle changes and recovery actions return
  operator intents. `OperatorIntentsProvider` follows them to a terminal state
  across pages and reloads; the header shows what is still running.
