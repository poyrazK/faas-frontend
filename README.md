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
