# Tests — Patterns & Setup

> Agents: start from [`AGENTS.md`](../AGENTS.md). General TDD rules → [`RULES.md`](./RULES.md#2-tdd--test-driven-development).
>
> The API and front sections describe the code the registry ships, in the paths of a project `bonne-garde` generated (`apps/api` from `api/elysia`, `apps/spa` from `web/spa`, `{{SCOPE}}` the project's npm scope). That code runs under `bun run golden`, not under this repository's `bun run test`.

---

## Stack

| Code                             | Runner               | Env                    | HTTP Mock      | Command                |
| -------------------------------- | -------------------- | ---------------------- | -------------- | ---------------------- |
| `apps/api` (generated)           | `bun:test` (native)  | `bun:sqlite` in-memory | None (real DB) | `bun test`             |
| `apps/spa` (generated)           | Vite+ (Vitest) + RTL | `jsdom`                | MSW            | `bun run test`         |
| `packages/{cli,registry,schema}` | `bun:test`           | Temporary directories  | None           | `bun run test`         |
| `scripts`                        | `bun:test`           | Temporary directories  | None           | `bun run test:scripts` |

From root: `bun run test` runs scripts first, then all workspace test scripts in parallel. `bun run verify` is the repo gate (check, knip, typecheck, test, intentions lint, registry build); CI then runs `bun run golden`, which scaffolds a fresh project from the packed CLI, installs its modules and items, and runs the quality gate (`bun run check`, then each module's `checks`) in it; for the `dockerfile` configuration it then builds the image, runs the container and asks it for `/health`, `/`, a hashed asset and a client route, and says so when `docker` is unavailable and skips it, unless `GOLDEN_REQUIRE_DOCKER` is set, as in CI, where an unavailable `docker` fails the run; it needs npm.

---

## API — Elysia + Drizzle + SQLite in-memory

**Runner**: `bun:test`.

### Principle

- **Real DB** via `bun:sqlite` (memory) — never mock Drizzle.
- `createTestDb()` builds the tables from the schema barrel at test startup, so a test never waits for `bun run db:generate`.
- Routes tested via `treaty(app)` (Eden) **without** starting an HTTP server.
- One `createTestDb()` per `beforeEach` → total test isolation.

### Shared Setup

File: `packages/db/src/testing.ts` (the `orm/drizzle` module), imported as `{{SCOPE}}/db/testing`. It returns a fresh in-memory `bun:sqlite` database, which is what D1 is, with the tables of the project's schema barrel, or of the schema a test passes in.

```typescript
import { createTestDb } from "{{SCOPE}}/db/testing";

const db = await createTestDb();
```

### Route E2E Pattern

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { createTestDb, type TestDb } from "{{SCOPE}}/db/testing";
import { OrganizationService } from "./organizations.service";

describe("Organizations API (E2E)", () => {
  let db: TestDb;
  let api: ReturnType<typeof treaty>;

  beforeEach(async () => {
    db = await createTestDb();

    // minimal seed (user + session)
    await db.insert(user).values({/* ... */});

    const app = new Elysia()
      .decorate("db", db)
      .use(OrganizationService)
      .get("/v1/organizations", ({ organizationService }) =>
        organizationService.getUserOrganizations("user-1"),
      );

    api = treaty(app);
  });

  it("returns 200 with orgs", async () => {
    const { data, error } = await api.v1.organizations.get();
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});
```

### Checklist

- [ ] All status codes covered (200, 400, 401, 403, 404)
- [ ] Happy path + edge cases
- [ ] `beforeEach` that recreates DB (isolation)
- [ ] No Drizzle mock, ever
- [ ] No `fetch` — use `treaty(app)`

### tsconfig

`apps/api/tsconfig.test.json` inherits the production paths and strictness but selects Bun types. Cloudflare types needed by binding fixtures are referenced explicitly. `bun run typecheck` checks both projects; tests are not excluded from verification.

---

## Front — Vitest + RTL + MSW

**Runner**: Vitest provided by Vite+ (`vp test`). **Env**: `jsdom`. **Mock**: MSW (`onUnhandledRequest: 'error'`). Keep Vite+; do not add a separate Vitest or oxlint/oxfmt toolchain.

Applies to all three fronts. Each app's `vite.config.ts` contains the test block; React Router and Cloudflare build plugins are disabled in test mode so component tests do not start Workers or require generated route manifests.

### Setup

Setup: each web module ships its own `apps/<front>/testing/frontend.setup.ts`, which extends matchers and cleans up React renders. `web/ssr` also ships `testing/server.ts`, and its setup resets MSW handlers after each test and stops the server at the end; `web/spa` and `web/static` ship no MSW server. Import lifecycle/assertion APIs from `vite-plus/test`.

```typescript
import { beforeAll, afterEach, afterAll } from "vite-plus/test";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### MSW Handler

Register endpoint handlers in a test via `server.use(...)` (`apps/ssr/testing/server.ts`). No default catch-all handler: unexpected HTTP calls fail.

```typescript
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("http://localhost:5172/v1/organizations", () =>
    HttpResponse.json([{ id: "org-1", slug: "acme", name: "ACME" }]),
  ),
];
```

**Rule**: one handler per endpoint, override in test via `server.use(...)` to simulate errors.

### Component Pattern

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vite-plus/test'

describe('LoginForm', () => {
  it('submits credentials and shows success', async () => {
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email/i), 'a@b.co')
    await user.type(screen.getByLabelText(/password/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/welcome/i)).toBeInTheDocument()
  })
})
```

**Rule**: test what the user sees/does — never internal state.

### Loader Pattern (SSR only)

```typescript
import { describe, it, expect } from "vite-plus/test";
import { RouterContextProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { server } from "../../../../testing/server";
import { loader } from "./resource-page";
import type { Route } from "./+types/resource-page";

describe("loader — /resources/:slug", () => {
  const args: Route.LoaderArgs = {
    params: { slug: "foo" },
    request: new Request("http://localhost/resources/foo"),
    context: new RouterContextProvider(),
  };

  it("returns resource data on success", async () => {
    const response = await loader(args);
    expect(response).toMatchObject({ slug: "foo" });
  });

  it("throws 404 when not found", async () => {
    server.use(http.get("*/v1/resources/foo", () => new HttpResponse(null, { status: 404 })));
    await expect(loader(args)).rejects.toThrow();
  });
});
```

Cover: **nominal case + all error cases** (404, 401, 500…).

Set `cloudflareContext` on the provider when the loader needs Worker bindings. The runnable example in the `web/ssr` module (`registry/modules/web/ssr/template/apps/ssr/src/lib/api.server.test.ts`, which golden runs) verifies URL resolution and cookie forwarding through the real Eden client and MSW. The snippet above illustrates a future resource route; no such domain route is shipped.

### Front Checklist

- [ ] User interactions tested (not implementation)
- [ ] MSW handler for each endpoint called
- [ ] Loaders (SSR): nominal case + errors
- [ ] No `vi.mock('module')` — MSW only
- [ ] No snapshot tests

---

## Package

The packages the modules ship (`packages/auth`, `packages/storage`, `packages/email`, `packages/db`, `packages/config`, `packages/api-runtime`) have Bun unit tests; `packages/ui` has no dedicated suite, its components are covered through frontend behavior tests. For additional packages:

- Use `bun:test` for unit/utility packages
- Use Vitest + RTL for UI components
- Keep the same prohibitions: no `vi.mock()`, no snapshots, no implementation detail tests

---

## Commands

```bash
# All (from root; in a generated project it runs every workspace)
bun run test

# Per app
bun run --filter {{SCOPE}}/api test
bun run --filter {{SCOPE}}/spa test
bun run test:scripts

# Watch mode (from the app)
cd apps/api && bun run test:watch
cd apps/spa && bun run test:watch
```

---

## Prohibitions — Reminder

- ❌ Mock Drizzle / `bun:sqlite`
- ❌ `vi.mock()` on a business module — refactor for dependency injection instead
- ❌ Snapshot tests
- ❌ Manually mocked `fetch` — MSW only on front
- ❌ Testing via a launched HTTP server on API side — use `treaty(app)`
- ❌ Testing component implementation details (internal state, methods)
