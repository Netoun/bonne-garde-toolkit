# Environment Variables

Source of truth: `apps/*/.env.example` and `apps/api/.dev.vars.example`. This file documents conventions only, not variable values.

## Conventions

| Rule           |                                                                |
| -------------- | -------------------------------------------------------------- |
| Secrets        | `.dev.vars` (API) / `.env` (fronts) — **never committed**      |
| Public vars    | `wrangler.jsonc` → `vars` (dev) / `env.production.vars` (prod) |
| Client-exposed | `VITE_` prefix mandatory for SPA                               |
| Prod secrets   | `wrangler secret put <NAME>` from the app directory            |

CI uses public localhost URLs explicitly; it never runs the interactive init wizard, creates production secrets or seeds the demo admin. Local `bun run build` requires the front `.env` files created by init (or equivalent exported variables).

Deployment is manual by default (`.github/workflows/deploy.yml`). Before deploying, provision your own D1/R2 resources, replace example resource IDs/domains in Wrangler config, and configure the GitHub `cloudflare` environment. Production migrations must target `--env production`; never run the local demo seed against production.

## Secret generation

```bash
cd apps/api && bun run auth:secret     # BETTER_AUTH_SECRET
openssl rand -base64 32                # generic
```
