# Architecture

<!-- GEN:START -->

> Auto-generated from `package.json` files. Regenerate: `bun run gen:architecture`. Last: 2026-10-02.

## Overview

My App is a Bun monorepo with 4 apps and 3 packages, deployed on Cloudflare.

### Apps

| App           | Framework       | Mode      | Platform |
| ------------- | --------------- | --------- | -------- |
| `apps/api`    | Elysia          | CF Worker | Workers  |
| `apps/spa`    | React Router v8 | SPA       | Pages    |
| `apps/ssr`    | React Router v8 | SSR       | Workers  |
| `apps/static` | React Router v8 | SPA       | Pages    |

### Packages

| Package           | Role                                 |
| ----------------- | ------------------------------------ |
| `packages/config` | Shared branding / white-label config |
| `packages/emails` | React-Email templates                |
| `packages/ui`     | shadcn/ui + global CSS               |

<!-- GEN:END -->

## Communication

All front apps communicate with the API via **Eden Treaty**, a type-safe HTTP client inferred directly from Elysia types:

```typescript
// lib/api.ts
export const api = treaty<App>("https://api.example.com");
const { data } = await api.scenarios({ slug }).get();
```

- **SPA apps**: Eden calls from the browser, session via HTTP-only cookie
- **SSR apps**: Eden calls in React Router loaders server-side, cookie forwarded from the request

Auth is handled by Better-auth. Sessions are in HTTP-only cookies in all cases.

## API — Module Pattern

The API follows a layered module convention where each file has a single responsibility:

```
contract(s)  →  service  →  routes  →  module  →  app.ts
(schemas)       (logic)     (HTTP)     (compose)
```

### Naming convention (Elysia plugin names)

- `*.module` for module composition plugins
- `*.routes` for HTTP route plugins
- `*.service` for business logic plugins (`derive`)
- `*.macro` / `*.guard` for auth and access-control layers

### Canonical feature layout

```
modules/<feature>/
├── <feature>.module.ts
├── <feature>.routes.ts
├── <feature>.service.ts          # optional if routes are thin-only
└── contracts/
    └── <feature>.contract.ts
```

### Domain-oriented submodules (example: `play`)

When a feature has multiple bounded subdomains, each subfolder keeps the same pattern:

```
modules/play/
├── play.module.ts
├── play.routes.ts                # composition only
├── auth/
│   ├── play-auth.macro.ts
│   └── play-auth.service.ts
├── scan/
│   ├── play-scan.contract.ts
│   ├── play-scan.routes.ts
│   ├── play-scan-token.service.ts
│   └── play-scan.e2e.test.ts
├── session/
│   ├── play-session.contract.ts
│   ├── play-session.routes.ts
│   └── play-session.e2e.test.ts
├── solo/
│   ├── play-solo.contract.ts
│   ├── play-solo.routes.ts
│   └── play-solo.service.ts
└── team/
    ├── play-team.contract.ts
    ├── play-team.routes.ts
    └── play-team.service.ts
```

### Condensed example: `scenarios`

```typescript
// service — business logic injected into Elysia context
export const ScenarioService = new Elysia({ name: "scenarios.service" })
  .use(dbService)
  .derive({ as: "scoped" }, ({ db }) => ({
    getAll: () => db.select().from(scenarios),
    getBySlug: (slug: string) => db.select().from(scenarios).where(eq(scenarios.slug, slug)),
  }));

// routes — HTTP, guarded auth
export const scenariosRoutes = new Elysia({ name: "scenarios.routes", prefix: "/scenarios" })
  .use(AuthMacro)
  .use(ScenarioService)
  .guard({ auth: true })
  .get("/", ({ scenarioService }) => scenarioService.getAll())
  .get("/:slug", ({ params, scenarioService }) => scenarioService.getBySlug(params.slug));

// module — wired into app.ts
export const scenariosModule = new Elysia({ name: "scenarios.module" }).use(scenariosRoutes);
```

Types from all modules bubble up into `App` and are exposed via Eden Treaty.
