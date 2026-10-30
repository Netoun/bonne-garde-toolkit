# web/spa

A React Router SPA shell at `apps/spa`: Vite+, Tailwind, a root with an error boundary, the theme
and query providers, and an Eden client for the API. It has no auth and no feature pages: those
arrive as items ([030](../../../../docs/specs/030-ui-registry.md)). Extracted from the legacy
`apps/spa` ([080](../../../../docs/specs/080-existing-code-migration.md)), and it replaces the
`spa-react-router` item.

```bash
bunx bg add web/spa
```

## Peers and variants

| Peer       | Allow-list | Why                                                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `provider` | any        | the SPA is deployed differently on each: a Pages config, or the container that serves `build/client`   |
| `config`   | `branding` | `routes/home.tsx` reads `branding`, and `root.tsx` imports the favicons from `{{SCOPE}}/config/assets` |
| `api`      | `elysia`   | `lib/api.ts` types the Eden client with `type App` from `{{SCOPE}}/api/app`                            |
| `ui`       | `shadcn`   | `root.tsx` imports `{{SCOPE}}/ui/globals.css`                                                          |

One variant per provider, which list the same files except `wrangler.jsonc`, and differ in what
`scripts.merge` (spec 060) adds to the vendored `apps/spa/package.json`:

| Variant      | Extra file                | `scripts.merge` on `apps/spa/package.json`                                | Extra dependency |
| ------------ | ------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `cloudflare` | `apps/spa/wrangler.jsonc` | `dev`: `react-router dev`, `deploy`: `wrangler pages deploy build/client` | `wrangler` (dev) |
| `dockerfile` | none                      | `dev`: `react-router dev`                                                 | none             |

The `dockerfile` provider serves `apps/spa/build/client` from the API's origin, so this variant has
no deploy script of its own. The package.json the module vendors carries no `dev` and no `deploy`:
a patch is computed on the template, so a script already in it would be reported `skipped` on the
first install. The dependency maps come from the variant (spec 035), pinned exactly.

## What it writes

Everything under `apps/spa`, which is its home (035):

- `package.json`, `tsconfig.json`, `react-router.config.ts` (`ssr: false`), `vite.config.ts`.
- `src/root.tsx`: `Layout`, the providers, the loader and the error boundary.
- `src/routes.ts` and `src/routes/home.tsx`: one index route, and its test.
- `src/lib/{api,utils}.ts`, `src/providers/query-provider.tsx`, `src/stores/{theme-store,ui.store}.ts`,
  `src/hooks/{use-init-theme,use-load-app}.ts`, `src/components/{app-loader,client-only}.tsx`.
- `testing/{frontend.setup.ts,matchers.d.ts}`: the Vitest setup, with the `jest-dom` matchers.
- `wrangler.jsonc` on `cloudflare`, a Pages config: `my-app-spa` and the `*.my-app.com` URLs are the
  legacy app's placeholders, replaced by hand. `bg add` renders `{{SCOPE}}` and nothing else.

`env` adds `VITE_API_URL` to `.env.example`. `bun run test` runs one test, `routes/home.test.tsx`.

## What changed from the legacy `apps/spa`

- `root.tsx` loses `useSession` and `useAuthRedirect`, which need the auth client, and calls
  `useLoadApp(false)`: the shell has no session to wait for. `routes.ts` loses every route, all of
  which are features, and keeps the item's index route. The auth module's wiring puts both back.
- `lib/api.ts` exports `api`, not `apiV1`: the shell has no `/v1` group, so `.v1` would not
  typecheck. The group comes with the first module that mounts a route under it.
- The favicons are `{{SCOPE}}/config/assets/favicons/…` and the stylesheet is
  `{{SCOPE}}/ui/globals.css`, the paths the two packages export. The `tsconfig` `paths` into
  other trees are gone: `{{SCOPE}}/api` is reached through its `exports`.
- The `vite.config.ts` points Vitest at `./testing/frontend.setup.ts`, inside the app.

## Left out

`features/*`, `lib/auth.ts` and `hooks/{use-auth-redirect,use-session}.ts` wait for the `auth`
module and the feature items. `components/theme-toggle.tsx` imports the `button` and
`dropdown-menu` items, and a module never depends on an item: a `dockerfile` project installs no
item, so it would not typecheck. Its only consumers are feature pages. The dependencies of those
files (`better-auth`, `zod`, `react-hook-form`, the TanStack form, table, virtual and pacer
packages) go with them.
