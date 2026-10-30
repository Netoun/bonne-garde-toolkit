# web/ssr

A React Router SSR app at `apps/ssr`, run as a Cloudflare Worker: the Worker entry, a request context
that carries the API URL, a server-side Eden client that forwards the request's cookie, and a home
page. Extracted from the legacy `apps/ssr` ([080](../../../../docs/specs/080-existing-code-migration.md)).

```bash
bunx bg add web/ssr
```

## Peers and variants

| Peer       | Allow-list   | Why                                                                                       |
| ---------- | ------------ | ----------------------------------------------------------------------------------------- |
| `provider` | `cloudflare` | `workers/app.ts` is a Worker, `vite.config.ts` loads `@cloudflare/vite-plugin`: see below |
| `config`   | `branding`   | `root.tsx`, the home page and the test read `branding`; the favicons are in its package   |
| `api`      | `elysia`     | `lib/api.server.ts` types the Eden client with `type App` from `{{SCOPE}}/api/app`        |
| `ui`       | `shadcn`     | `root.tsx` imports `{{SCOPE}}/ui/globals.css`                                             |

One variant, `cloudflare`, which copies `wrangler.jsonc` and adds `dev` (`react-router dev`) and
`deploy` (`wrangler deploy`) to the vendored `apps/ssr/package.json` with `scripts.merge` (spec 060).
`wrangler`, `@cloudflare/vite-plugin` and `@cloudflare/workers-types` are dev dependencies.

**Why `cloudflare` only** (080, step 3): the app is a Worker, and the `dockerfile` provider has no
SSR shell. Its `serve()` answers from `apps/spa/build/client` and its image starts the API alone.
Running this app as a second service is a new feature, and so is a second variant. `bg add web/ssr`
on a `dockerfile` project fails naming the provider.

## What it writes

Everything under `apps/ssr`, which is its home (035). The legacy app's 20 files are each here, apart
from `README.md` (placeholder text) and `.env.example`, which `env` replaces with `API_URL`:

- `package.json`, `tsconfig.json`, `react-router.config.ts` (`ssr: true`), `vite.config.ts`,
  `wrangler.jsonc`, `public/robots.txt`.
- `workers/app.ts`: the Worker entry. It hands the `env` and `ctx` of the request to the loaders
  through `cloudflareContext`.
- `src/root.tsx`, `src/routes.ts`, `src/entry.server.tsx`, `src/vite-env.d.ts`.
- `src/lib/{api.server,cloudflare-context,utils}.ts`, `src/components/client-only.tsx`.
- `src/features/home/pages/home-page.tsx`.
- Four tests: `home-page.test.tsx`, and the three of `lib/api.server.test.ts`.
- `testing/{frontend.setup.ts,matchers.d.ts,server.ts}`: the Vitest setup, the `jest-dom` matchers
  and the MSW server the tests of `api.server.ts` register handlers on. Legacy kept them in a `testing/`
  at the repo root, shared by the three fronts.

`bun run test` in `apps/ssr` runs the four tests.

## What changed from the legacy `apps/ssr`

Each file is the legacy one with `@acme` rendered as `{{SCOPE}}`, except:

- `root.tsx` imports the favicons from `{{SCOPE}}/config/assets/favicons/…`, and the stylesheet as
  `{{SCOPE}}/ui/globals.css`: the paths the two packages export.
- `lib/api.server.ts` returns `treaty<App>(…)`, not `treaty<App>(…).v1`, and
  `lib/api.server.test.ts` calls `api.health.get()` where it called `api.media({ id }).get()`. The API
  shell has neither a `/v1` group nor a `media` route (that is the `storage` module's), so both
  would fail to typecheck. The three tests keep their names and what they assert: the typed Worker
  context, the cookie forwarded through Eden, and the `API_URL` rules.
- The test imports `../../testing/server`, the copy inside the app, and `vite.config.ts` points
  Vitest at `./testing/frontend.setup.ts`.
- `tsconfig.json` loses the `paths` into other trees: they are reached through `exports`. It keeps
  `+types/*` and the app's own alias.
- The dependency maps come from the variant: what the code imports, and the toolchain. The legacy
  maps also listed 20 `@tiptap/*` packages, `@react-router/cloudflare`, `lucide-react` and `zustand`,
  which no file imports; they are not carried.

`wrangler.jsonc` keeps the legacy placeholders (`my-app-ssr`, `ssr.my-app.com`, `api.my-app.com`),
replaced by hand.
