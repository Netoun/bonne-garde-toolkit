# Rules — Clean Code, TDD, Types

> Deep engineering rules for the monorepo. Agents: start from [`AGENTS.md`](../AGENTS.md), then open this file when the task needs detail.
> Test patterns → [`TESTING.md`](./TESTING.md). Multi-tool agent wiring → [`AGENTING.md`](./AGENTING.md).

---

## 1. Clean Code — The Systematic Filter

Before **and** after writing, ask yourself:

- **Algo** — good approach? Simplest possible?
- **Archi** — right place? Separation of concerns respected?
- **Naming** — do functions, variables, files say exactly what they do?
- **Complexity** — can indirection be removed without losing clarity?
- **Volume** — does every line have a reason to exist? No dead code, no premature abstraction.

**Prefer simple and explicit to clever and implicit.**

If a choice seems architecturally questionable → raise it **before** implementing, not after.

---

## 2. TDD — Test-Driven Development

**Absolute rule**: no production code without a preceding test.

```
For each feature:
1. Red test (fails or doesn't compile)
2. Minimum code to pass green
3. Refactor if needed (stays green)
4. Next
```

### Minimum Coverage

| Type        | Cases to cover                                           |
| ----------- | -------------------------------------------------------- |
| API Routes  | All status codes (200, 400, 401, 403, 404)               |
| Forms       | Client validation + successful submission + server error |
| SSR Loaders | Nominal case + all error cases                           |

### Hard Rules

- Real SQLite DB in API tests (`bun:sqlite` in-memory) — **never** mock Drizzle
- Elysia routes tested via `treaty(app)` (or `app.handle` for raw transport assertions) — no HTTP server
- Components tested by user interactions (RTL) — not internal implementation
- **No snapshot tests**
- **No module mocking** — MSW only for intercepting HTTP

Details per app → [`TESTING.md`](./TESTING.md).

---

## 3. Types — Strict Prohibitions

- ❌ **Never `any`** — use `unknown` with type guard, or type explicitly.
- ❌ **Never `as`** to bypass an Eden Treaty type — if the type doesn't match, fix the **server-side API contract**.
- ❌ **Never `// @ts-ignore`** / `// @ts-expect-error` without justification in comment.

### Eden Treaty Dynamic Routes

For dynamic routes, **normalize the API** (same parameter name everywhere) rather than forcing with `as`.

### Nested Routes Pattern (games under scenarios, nodes under scenarios...)

Always reuse the existing pattern:

```typescript
// ✅ CORRECT — reuse existing API type chain
export type GameDetail = EdenResponse<ApiRoute<ScenariosDetailApi["games"]>["get"]>;
export type GameInput = EdenBody<ScenariosDetailApi["games"]["post"]>;

// ❌ WRONG — never recreate gamesDetailApi from scratch
export const gamesDetailApi = (slug: string) => api.games({ slug });
```

Prefer extending existing API route types rather than re-declaring contracts.

---

## 4. Product Conventions — Non-Negotiable

| Domain       | Rule                                                             |
| ------------ | ---------------------------------------------------------------- |
| API Types    | Always via **Eden Treaty**, never manual fetch                   |
| Auth         | Better-auth on API side only — fronts use better-auth client     |
| Routing      | File-based React Router v8 (SPA / SSR / static)                  |
| Components   | **shadcn via CLI** (`bunx shadcn add ...`), never copied by hand |
| Styles       | Tailwind utilities + `packages/ui/src/styles/globals.css` tokens |
| Server state | Loaders/actions (SSR) or Eden + TanStack Query (SPA)             |
| Client state | **Zustand** only (UI/client non-server)                          |
| Validation   | **Zod** client-side + **TypeBox** API-side (Elysia input)        |
| Emails       | React-Email for templates, Resend as provider                    |
| Media        | R2, signed URLs for private access                               |

### Composition first

Shared primitives belong in `packages/ui`; feature behavior belongs in the app. Prefer `ReactNode` slots (`actions`, `leading`, `description`) and compound components over growing sets of flags such as `showIcon` or `showActions`. Configuration props are appropriate for leaf primitives, not whole pages.

Component files use kebab-case, and named component exports use PascalCase. Declare workspace dependencies in `package.json`, even when TypeScript aliases already resolve them.

SSR loaders receive `RouterContextProvider`. Read Worker bindings from `cloudflareContext` and use `createApi(context, request)` to forward authentication cookies. Do not reintroduce the v7 `AppLoadContext` object.

Editors, maps and QR generation are optional product capabilities, not requirements for every project created from this starter.

---

## 5. Scope & Tasks

- **Read before writing**: [`AGENTS.md`](../AGENTS.md) + the task + legacy code (via `git show main:<path>`) + relevant existing code.
- **Do not exceed the scope** of the assigned task — a task is not a pretext to refactor elsewhere.
- **Mark task Done**: add `## ✅ Done` at the end of the task file when finished.
- If a choice is not in `AGENTS.md` → **ask the question**, don't improvise.

---

## 6. Tools & Commands — Prohibitions

- ❌ **`npm` / `yarn` / `pnpm` / `npx` / `node`** — only `bun` / `bunx`.
- ❌ Reinvent a command already scripted in a `package.json` — use the script.
- ❌ Use a Cloudflare proprietary API outside declared bindings (`DB`, `BUCKET`) — see [platform agnosticism](../AGENTS.md#platform-agnosticism).
- ❌ `git commit --no-verify`, `git reset --hard`, `git push --force` without explicit request.
- ❌ Add an unplanned dependency without justification.

Complete list of scripts → [`COMMANDS.md`](./COMMANDS.md) (generated).

---

## 7. Checklist Before Rendering a Task

- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes (API + concerned fronts)
- [ ] `bun run check` passes (Vite+ formatting + lint)
- [ ] `bun run build` passes for affected apps
- [ ] No `any`, no `as` Eden
- [ ] Eden types up to date if API changed
- [ ] New env vars → corresponding `.example` file(s)
- [ ] No files outside scope modified
- [ ] Issue/PR annotated with outcome
