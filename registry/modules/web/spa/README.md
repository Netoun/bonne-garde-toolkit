# web/spa

A React Router SPA shell at `apps/spa`: Vite+, Tailwind, a root with an error boundary, the theme
and query providers, and, when the project has the API, an Eden client for it. It has no auth and no feature pages: those
arrive as items ([030](../../../../docs/specs/030-ui-registry.md)). Extracted from the legacy
`apps/spa` ([080](../../../../docs/specs/080-existing-code-migration.md)), and it replaces the
`spa-react-router` item.

```bash
bunx bg add web/spa
```

## Peers and variants

| Peer       | Allow-list | Why                                                                                                                      |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `provider` | any        | the SPA is deployed differently on each: a Pages config, or the container that serves `build/client`                     |
| `config`   | `branding` | `features/home/pages/home-page.tsx` reads `branding`, and `root.tsx` imports the favicons from `{{SCOPE}}/config/assets` |
| `ui`       | `shadcn`   | `root.tsx` imports `{{SCOPE}}/ui/globals.css`                                                                            |

`api` (`elysia`) is an optional peer (035): a variant's `match` names it. With it, the variant copies
`lib/api.ts`, which types the Eden client with `type App` from `{{SCOPE}}/api/app` and declares
`VITE_API_URL`, and `.env.test`, which gives the tests that address; it depends on `@elysiajs/eden`
and `{{SCOPE}}/api`, and on `cloudflare` writes `API_URL` into `wrangler.jsonc` with `jsonc.merge`.
Without it (`bg create --apps spa`, spec 040), none of that is written.

A variant per provider, with the API, which list the same files except `wrangler.jsonc`, and differ in
what `scripts.merge` (spec 060) adds to the vendored `apps/spa/package.json`; and on `cloudflare` one
more per provider, `cloudflare-without-api` and `dockerfile-without-api`, matched on the provider alone:

| Variant                  | Extra file                | `scripts.merge` on `apps/spa/package.json`                                | Extra dependency |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `cloudflare`             | `apps/spa/wrangler.jsonc` | `dev`: `react-router dev`, `deploy`: `wrangler pages deploy build/client` | `wrangler` (dev) |
| `dockerfile`             | none                      | `dev`: `react-router dev`                                                 | none             |
| `cloudflare-without-api` | `apps/spa/wrangler.jsonc` | as `cloudflare`                                                           | `wrangler` (dev) |
| `dockerfile-without-api` | none                      | as `dockerfile`                                                           | none             |

The `dockerfile` provider serves `apps/spa/build/client` from the API's origin, or alone when the
project has no API (its container starts `packages/api-runtime/src/main.ts`, which picks), so neither
variant has a deploy script of its own. The package.json the module vendors carries no `dev` and no `deploy`:
a patch is computed on the template, so a script already in it would be reported `skipped` on the
first install. The dependency maps come from the variant (spec 035), pinned exactly.

## What it writes

Everything under `apps/spa`, which is its home (035):

- `AGENTS.md`: the recipes a coding agent follows in this app (add a page, call the API, build UI,
  done-signal). The root `AGENTS.md` of `templates/base` sends agents to it: Claude Code does not
  load an `AGENTS.md` from a subfolder by itself. A contract test checks what it cites.
- `package.json`, `tsconfig.json`, `react-router.config.ts` (`ssr: false`), `vite.config.ts`.
- `src/root.tsx`: `Layout`, the providers, the loader and the error boundary.
- `src/routes.ts`, which composes the routes of the features (see below), `src/routes.test.ts`, and
  `src/features/home/pages/home-page.tsx` with its test: the index route until a feature takes it over.
- `src/lib/{api,utils}.ts`, `src/providers/query-provider.tsx`, `src/stores/{theme-store,ui.store}.ts`,
  `src/hooks/{use-init-theme,use-load-app}.ts`, `src/components/{app-loader,client-only}.tsx`.
- `testing/{frontend.setup.ts,matchers.d.ts}`: the Vitest setup, with the `jest-dom` matchers.
- `wrangler.jsonc` on `cloudflare`, a Pages config: `my-app-spa` and the `*.my-app.com` URLs are the
  legacy app's placeholders, replaced by hand. `bg add` renders `{{SCOPE}}` and nothing else.

`env` adds `VITE_API_URL` to `.env.example`. `bun run test` runs `features/home/pages/home-page.test.tsx`
and `routes.test.ts`, which holds for whatever features are installed (below).

## Features declare their routes

A feature item ([030](../../../../docs/specs/030-ui-registry.md)) ships `src/features/<feature>/routes.ts`: a
default export of route entries (`route`, `index`, `layout` from `@react-router/dev/routes`), with
paths relative to `src`. `src/routes.ts` globs `./features/*/routes.ts` and composes every one, so
adding a feature adds its pages and `routes.ts` is not edited, not by the item and not by you. This is
why `routes.ts` carries no region and `bg doctor` has nothing to say about it.

- **The index route.** The shell's `home-page.tsx` is the index until a fragment declares an `index`, which
  replaces it: `spa-backoffice` takes `/` for its redirect to the dashboard. The home page stays on disk,
  and is yours to keep or delete.
- **Only `features/<feature>/routes.ts`.** The glob is one level deep. A `routes.ts` anywhere else under
  `features/` is an ordinary file, as the `structure/route-modules` rule of `tooling/vite-plus` reads it.
- **`bun run test`** checks the composed table whatever is installed: one index route, every file it
  names exists, none twice. A fragment left pointing at a page you deleted fails there.
- **`react-router dev` picks up a fragment added while it runs.** Checked on React Router 8.3 and Vite+
  0.2.8: a new `features/<feature>/routes.ts` and its page were in the client route manifest 0.3 s after
  they were written, with no restart. `bun run typecheck` runs `typegen` first, so it sees a fragment too.

## What changed from the legacy `apps/spa`

- `root.tsx` loses `useSession` and `useAuthRedirect`, which need the auth client, and calls
  `useLoadApp(false)`: the shell has no session to wait for, and stays so. The session guard is in the
  two layouts of the feature items, `auth-layout` and `layout-app-layout`, which call
  `useAuthRedirect`. A signed-out visitor on a URL no route matches sees the 404 page, where the legacy
  root sent them to the login page.
- `routes.ts` loses every route, all of which are features: it composes their fragments, and keeps the
  home page as the index until one takes it over.
- `lib/api.ts` exports `api`, not `apiV1`: the shell has no `/v1` group, so `.v1` would not
  typecheck. The group comes with the first module that mounts a route under it.
- The favicons are `{{SCOPE}}/config/assets/favicons/…` and the stylesheet is
  `{{SCOPE}}/ui/globals.css`, the paths the two packages export. The `tsconfig` `paths` into
  other trees are gone: `{{SCOPE}}/api` is reached through its `exports`.
- The `vite.config.ts` points Vitest at `./testing/frontend.setup.ts`, inside the app.

## Left out

`features/*`, `lib/auth.ts` and `hooks/{use-auth-redirect,use-session}.ts` are the feature items'
(`spa-auth`, `spa-backoffice`), which need the `auth` module. `components/theme-toggle.tsx` imports the
`button` and `dropdown-menu` items, and a module never depends on an item: a `dockerfile` project
installs no item, so it would not typecheck. It is `spa-auth`'s. The dependencies of those files
(`better-auth`, `zod`, `react-hook-form`, the TanStack form, table, virtual and pacer packages, and
`{{SCOPE}}/auth`) are the items' too: `bg add` writes each into `apps/spa/package.json`
([030](../../../../docs/specs/030-ui-registry.md)), and this module pins none of them.
