# Environment Variables

Source of truth: the `.env.example` of a generated project, which `bg add` writes from the `env` entries of each module (one line per key, owned by the module that declares it). This file documents conventions only, not variable values.

## Conventions

| Rule           |                                                                |
| -------------- | -------------------------------------------------------------- |
| Secrets        | `.dev.vars` (API) / `.env` (fronts) — **never committed**      |
| Public vars    | `wrangler.jsonc` → `vars` (dev) / `env.production.vars` (prod) |
| Client-exposed | `VITE_` prefix mandatory for SPA                               |
| Prod secrets   | `wrangler secret put <NAME>` from the app directory            |

This repository's CI sets no variables, creates no production secrets and seeds no demo admin: `bun run golden` builds a generated project with the variables its modules give it. In a project, `bun run build` reads the front variables (`VITE_API_URL`) from the front's `.env` or from exported variables.

Deployment is manual by default: the `deploy/cloudflare-actions` module writes `.github/workflows/deploy.yml` (`workflow_dispatch` only) into a project. Before deploying, provision your own D1/R2 resources, replace example resource IDs/domains in Wrangler config, and configure the GitHub `cloudflare` environment. Production migrations must target `--env production`; never run the local demo seed against production.

## Secret generation

```bash
cd packages/auth && bun run auth:secret   # BETTER_AUTH_SECRET (auth/better-auth)
openssl rand -base64 32                # generic
```
