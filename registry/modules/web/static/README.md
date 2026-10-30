# web/static

A React Router static site at `apps/static`, built to `build/client` and deployed to Cloudflare
Pages: a marketing front with a header, a footer and a home page. Extracted from the legacy
`apps/static` ([080](../../../../docs/specs/080-existing-code-migration.md)).

```bash
bunx bg add web/static
```

## Peers and variants

| Peer       | Allow-list   | Why                                                                                    |
| ---------- | ------------ | -------------------------------------------------------------------------------------- |
| `provider` | `cloudflare` | see below                                                                              |
| `config`   | `branding`   | the header, the footer, the home page and `root.tsx` read `branding`, and the favicons |
| `api`      | `elysia`     | `lib/api.ts` types the Eden client with `type App` from `{{SCOPE}}/api/app`            |
| `ui`       | `shadcn`     | `app.css` imports `{{SCOPE}}/ui/globals.css`: the legacy `package.json` did not say so |

One variant, `cloudflare`, which copies `wrangler.jsonc` and adds `dev` and `deploy` to the vendored
`apps/static/package.json` with `scripts.merge` (spec 060), with `wrangler` as a dev dependency.

**Why not `dockerfile`.** The `dockerfile` provider runs one container: its `serve()` answers from
`apps/spa/build/client` and nothing else, and the image's command starts the API alone. A static site
installed under it would be built into the image and never served; serving a second app is a change
to the provider, which is a new feature and not part of this extraction. So `static` declares
`peers.provider: ["cloudflare"]`, as `web/ssr` does, and `bg add web/static` on a `dockerfile`
project fails naming the provider.

## What it writes

Everything under `apps/static`, which is its home (035). The legacy app's 18 files are each here,
apart from `.env.example`, which `env` replaces:

- `package.json`, `tsconfig.json`, `react-router.config.ts` (`ssr: false`), `vite.config.ts`,
  `wrangler.jsonc`, `public/robots.txt`.
- `src/root.tsx`, `src/routes.ts`, `src/app.css`, `src/vite-env.d.ts`.
- `src/components/{client-only,layout-footer,layout-header,layout-root}.tsx` and the footer's test.
- `src/features/home/pages/home-page.tsx`, `src/lib/api.ts`.
- `testing/{frontend.setup.ts,matchers.d.ts}`: the Vitest setup with the `jest-dom` matchers. Legacy
  shared `testing/` at the repo root with `server.ts` (MSW), which this site's one test does not use.

`env` adds `VITE_APP_URL` and `VITE_API_URL` to `.env.example`. `bun run test` runs one test.

## What changed from the legacy `apps/static`

Each file is the legacy one with `@acme` rendered as `{{SCOPE}}`, except:

- `root.tsx` imports the favicons from `{{SCOPE}}/config/assets/favicons/…`, not `@acme/assets/…`.
- `app.css` imports `{{SCOPE}}/ui/globals.css`, not `../../../packages/ui/src/styles/globals.css`:
  a path into another package's `src` is not something 035 lets a module write.
- `lib/api.ts` exports `api`, not `apiV1`: the API shell has no `/v1` group, so `.v1` would not
  typecheck.
- `vite.config.ts` points Vitest at `./testing/frontend.setup.ts`, inside the app.
- `tsconfig.json` loses the `paths` into other trees: they are reached through `exports`.
  `@cloudflare/workers-types` is not a type or a dependency: nothing here uses it.
- The dependency maps come from the variant: what the code imports, and the toolchain. The legacy
  `@react-router/node` entry is not carried: the build's default entry resolves without it.

`wrangler.jsonc` keeps the legacy placeholders (`my-app-static`, `*.my-app.com`), replaced by hand.
Its `pages_build_output_dir` is `build/client`, where `react-router build` writes, and the `deploy`
script deploys the same directory; the legacy `apps/static` said `dist`, which the build never
writes. The contract test ties the three.
