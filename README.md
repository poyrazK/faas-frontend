# Gregale Operations Console

The operator console for **Gregale**, a scale-to-zero Firecracker MicroVM
Serverless Platform. Customer-facing pages live in the separate `faas-web`
project and are deployed at `https://gregale.dev`.

## Deployment boundary

This repository is the operator-only `faas-frontend` application. Its Vercel
project is connected to `poyrazK/faas-frontend`, uses `main` as the production
branch, and owns [operations.gregale.dev](https://operations.gregale.dev).

The customer console is a separate application in
[`poyrazK/faas-web`](https://github.com/poyrazK/faas-web), deployed by the
`faas-web` Vercel project at [gregale.dev](https://gregale.dev). Customer
dashboard routes must not be added to this repository's operations host.

The operator host exposes runtime configuration, fleet and capacity views,
tenant inspection, recovery controls, anomaly and rate-limit views, billing
operations, and the global audit trail. Clean operator URLs are mapped to the
`/operations/*` route tree by middleware.

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
