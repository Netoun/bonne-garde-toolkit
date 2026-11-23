# observability/sentry

Error reporting to Sentry, or GlitchTip (self-hosted, same DSN protocol), in `packages/observability`. It
adds an Elysia plugin, `observabilityModule`, that `apps/api` mounts before its own `onError`.

```bash
bunx bonne-garde add provider/dockerfile config/branding api/elysia observability/sentry
```

## Peers and variants

| Peer       | Allow-list | Why                                                        |
| ---------- | ---------- | ---------------------------------------------------------- |
| `provider` | any        | the variant is chosen on it: each provider has its own SDK |
| `api`      | `elysia`   | the plugin is an Elysia plugin, mounted by `ts.elysiaUse`  |

One variant for now, `dockerfile` (`@sentry/node`), at `src/node.ts`; the package's `.` export points at it
through `jsonc.merge`. On `cloudflare` the module is refused at planning: no variant matches. The Workers
variant (`@sentry/cloudflare`, at its own path) comes with the registration API of `api-runtime` it needs.

## Behaviour

- No `SENTRY_DSN` (or a blank one): no `Sentry.init`, no client, the plugin registers nothing.
- With a DSN: `Sentry.init` once, at import. A global `onError` captures an error whose status is 500 or
  more (the rule of the app's own handler: the `code` of a thrown `status(...)`, the `status` of Elysia's
  errors, 500 otherwise) and returns nothing, so the app's `onError`, registered after, writes the response.
  A 404, a validation error or a thrown `status(4xx)` is never captured.
- `SENTRY_ENVIRONMENT` is the Sentry environment tag. Both keys are optional in `.env.example`.
- Events still in flight when the container stops are lost: `provider/dockerfile` exits at once on
  `SIGTERM`, and nothing flushes first.

`createObservability(env, options?)` is the plugin's factory, over a plain record; `options` is Sentry's
`NodeOptions`, there for tests (`beforeSend`, `transport`).

## What it writes

| File                          | What it is                                        |
| ----------------------------- | ------------------------------------------------- |
| `package.json`                | generated: the `.` export, `typecheck` and `test` |
| `src/node.ts`, `node.test.ts` | the plugin and its tests: no mock of `@sentry/*`  |
| `tsconfig*.json`              | the package's and its tests'                      |

Plus, in `apps/api`: the `{{SCOPE}}/observability` dependency, the import, and `.use(observabilityModule)`.

## Not here

Langfuse and OpenTelemetry: they belong to the LLM modules.
