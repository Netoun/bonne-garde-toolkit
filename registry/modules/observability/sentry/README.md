# observability/sentry

Error reporting to Sentry, or GlitchTip (self-hosted, same DSN protocol), in `packages/observability`. It
adds an Elysia plugin, `observabilityModule`, that `apps/api` mounts before its own `onError`.

```bash
bunx bonne-garde add provider/dockerfile config/branding api/elysia observability/sentry
bunx bonne-garde add provider/cloudflare config/branding api/elysia observability/sentry
```

## Peers and variants

| Peer       | Allow-list | Why                                                        |
| ---------- | ---------- | ---------------------------------------------------------- |
| `provider` | any        | the variant is chosen on it: each provider has its own SDK |
| `api`      | `elysia`   | the plugin is an Elysia plugin, mounted by `ts.elysiaUse`  |

Two variants at their own paths, the package's `.` export pointed at the one installed through
`jsonc.merge`, both exporting `observabilityModule`:

- `dockerfile`: `@sentry/node`, at `src/node.ts`.
- `cloudflare`: `@sentry/cloudflare`, at `src/workers.ts`. On Workers a Sentry client lives for one
  request and is flushed through `ctx.waitUntil`, which only the server entry sees. The variant registers
  a request wrapper with `api-runtime`'s `wrapRequests` at import, so `apps/api/src/index.ts` is not
  edited. It depends on `{{SCOPE}}/api-runtime` for that.

## Behaviour

- No `SENTRY_DSN` (or a blank one): no `Sentry.init`, no client, no request wrapper, the plugin registers
  nothing. Both variants read it once at import: `process.env` on dockerfile, `readRuntimeEnv()` on
  Workers.
- With a DSN, on dockerfile: `Sentry.init` once, at import. On Workers: `wrapRequestHandler` opens a client
  per request around the app and flushes it after the response. A global `onError` captures an error whose status is 500 or
  more (the rule of the app's own handler: the `code` of a thrown `status(...)`, the `status` of Elysia's
  errors, 500 otherwise) and returns nothing, so the app's `onError`, registered after, writes the response.
  A 404, a validation error or a thrown `status(4xx)` is never captured.
- `SENTRY_ENVIRONMENT` is the Sentry environment tag. Both keys are optional in `.env.example`.
- Events still in flight when the container stops are lost: `provider/dockerfile` exits at once on
  `SIGTERM`, and nothing flushes first.

`createObservability(env, options?)` is the factory, over a plain record; `options` is Sentry's options,
there for tests (`beforeSend`, `transport`). On dockerfile it returns the plugin; on Workers
`{ plugin, wrapper }`, the wrapper `undefined` without a DSN.

## What it writes

| File                          | What it is                                        |
| ----------------------------- | ------------------------------------------------- |
| `package.json`                | generated: the `.` export, `typecheck` and `test` |
| `src/node.ts`, `node.test.ts` | dockerfile: the plugin and its tests, no mock     |
| `src/workers.ts`, `.test.ts`  | cloudflare: plugin, wrapper, tests, no mock       |
| `tsconfig*.json`              | the package's and its tests'                      |

Plus, in `apps/api`: the `{{SCOPE}}/observability` dependency, the import, and `.use(observabilityModule)`.

## Not here

Langfuse and OpenTelemetry: they belong to the LLM modules.
