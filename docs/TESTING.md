# Tests — Patterns & Setup

> Agents: start from [`AGENTS.md`](../AGENTS.md). General TDD rules → [`RULES.md`](./RULES.md#2-tdd--test-driven-development).

---

## Stack

| App           | Runner               | Env                    | HTTP Mock      | Command                |
| ------------- | -------------------- | ---------------------- | -------------- | ---------------------- |
| `apps/api`    | `bun:test` (native)  | `bun:sqlite` in-memory | None (real DB) | `bun test`             |
| `apps/spa`    | Vite+ (Vitest) + RTL | `jsdom`                | MSW            | `bun run test`         |
| `apps/ssr`    | Vite+ (Vitest) + RTL | `jsdom`                | MSW            | `bun run test`         |
| `apps/static` | Vite+ (Vitest) + RTL | `jsdom`                | MSW            | `bun run test`         |
| `scripts`     | `bun:test`           | Temporary directories  | None           | `bun run test:scripts` |

From root: `bun run test` runs scripts first, then all workspace test scripts in parallel. `bun run verify` is the full CI gate (check, typecheck, test, build).

---

## API — Elysia + Drizzle + SQLite in-memory

**Runner**: `bun:test`.

### Principle

- **Real DB** via `bun:sqlite` (memory) — never mock Drizzle.
- Drizzle migrations run at test startup → schema always in sync with prod.
- Routes tested via `treaty(app)` (Eden) **without** starting an HTTP server.
- One `createTestDb()` per `beforeEach` → total test isolation.

### Shared Setup

File: `apps/api/src/modules/test/db.test.ts`

```typescript
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as authSchema from "../db/schemas/db.auth-schema";

const schema = { ...authSchema };

export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  const migrationsDir = new URL("../db/migrations", import.meta.url).pathname;
  migrate(db, { migrationsFolder: migrationsDir });
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
```

### Route E2E Pattern

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { createTestDb, type TestDb } from "../test/db.test";
import { OrganizationService } from "./organizations.service";

describe("Organizations API (E2E)", () => {
  let db: TestDb;
  let api: ReturnType<typeof treaty>;

  beforeEach(async () => {
    db = createTestDb();

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

Shared setup: `testing/frontend.setup.ts`. It extends matchers, cleans up React renders, resets MSW handlers after each test and stops the server at the end. Import lifecycle/assertion APIs from `vite-plus/test`.

```typescript
import { beforeAll, afterEach, afterAll } from "vite-plus/test";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### MSW Handler

Register endpoint handlers in a test via `server.use(...)` (`testing/server.ts`). No default catch-all handler: unexpected HTTP calls fail.

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

Set `cloudflareContext` on the provider when the loader needs Worker bindings. The runnable example in `apps/ssr/src/lib/api.server.test.ts` verifies URL resolution and cookie forwarding through the real Eden client and MSW. The snippet above illustrates a future resource route; no such domain route is shipped.

### Front Checklist

- [ ] User interactions tested (not implementation)
- [ ] MSW handler for each endpoint called
- [ ] Loaders (SSR): nominal case + errors
- [ ] No `vi.mock('module')` — MSW only
- [ ] No snapshot tests

---

## Package

`packages/config` and `packages/emails` have Bun unit tests. `packages/ui` has no dedicated suite yet; its components can be covered through frontend behavior tests. For additional packages:

- Use `bun:test` for unit/utility packages
- Use Vitest + RTL for UI components
- Keep the same prohibitions: no `vi.mock()`, no snapshots, no implementation detail tests

---

## Commands

```bash
# All (from root)
bun run test

# Per app
bun run --filter @acme/api test
bun run --filter @acme/spa test
bun run --filter @acme/ssr test
bun run --filter @acme/static test
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
