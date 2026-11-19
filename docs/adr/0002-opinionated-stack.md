# 2. An opinionated stack, with a module per choice

Status: accepted

## Context

An arbitrary stack matrix cannot be tested. Asking which library fills a slot multiplies the combinations the platform must keep working.

## Decision

The stack is fixed: Elysia, Drizzle, Better Auth, React Router, shadcn/ui. The two real choices are modules of their own category: the runtime and deploy target (`provider`: Cloudflare, or one container) and the package manager (`pm`: Bun or pnpm). `create` asks what a project has (apps, features), never which library fills a slot. Scripts and tests run on Node under both package managers.

## Consequences

- Every supported combination is built by `bun run golden`.
- A new choice is a new module of a category, never a free-form option.
- Provider technology (D1, R2, wrangler) lives in the provider's modules and variants, not in category definitions.
