# storage/r2

Media uploads over an R2 bucket, for the project's API: image upload, a public file route, a record per
upload with its author and organization, and delete with an ownership check. It is the legacy
`apps/api/src/lib/r2.ts` and `apps/api/src/modules/media` extracted into their own package,
`packages/storage`, which `apps/api` mounts.

```bash
bunx bonne-garde add provider/cloudflare config/branding api/elysia db/d1 orm/drizzle auth/better-auth storage/r2
```

## Peers and variant

| Peer       | Allow-list    | Why                                                                                              |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `provider` | `cloudflare`  | `readRuntimeEnv` from `{{SCOPE}}/api-runtime` reads the `BUCKET` binding; R2 is Cloudflare's     |
| `db`       | `d1`          | `bindD1()` from `{{SCOPE}}/db/d1`: the media record lives in the project's D1                    |
| `orm`      | `drizzle`     | `createDB` from `{{SCOPE}}/db` and the test database from `{{SCOPE}}/db/testing`                 |
| `auth`     | `better-auth` | the `auth` macro guards the routes, and `medias` has foreign keys onto `user` and `organization` |

One variant, `cloudflare`, selected on the provider (035: `storage` MUST declare `peers.provider`). A
project on the `dockerfile` provider has no R2 bucket and no `db`, so it cannot install this module:
`bunx bonne-garde add storage/r2` there is refused with `storage/r2 accepts only cloudflare for provider, but
provider/dockerfile is present`.

**It names no `api` peer.** No source of the package reaches the shell's `lib/*`, and a project that can
install `auth` already has an `api`. The patches below target `apps/api`; without one they would fail
into pending intentions, but `auth` makes that case unreachable.

## What it writes

Everything in `packages/storage`, from explicit paths:

| File                    | What it is                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `package.json`          | `{{SCOPE}}/storage`: the `.` and `./schema` exports, the `typecheck` and `test` scripts                                  |
| `src/r2.ts`             | `R2Error`, `detectImageType`, `validateFile`, `validateKey`, `generateKey`, `publicUrlFor`, `uploadToR2`, `deleteFromR2` |
| `src/bucket.ts`         | `bindR2(env)` and `readR2()`: the `BUCKET` binding, or `undefined` (see below)                                           |
| `src/env.ts`            | `resolveStorageEnv`: `R2_PUBLIC_URL`, read from `readRuntimeEnv()`, and its default in development                       |
| `src/schema.ts`         | the `medias` table and its relations                                                                                     |
| `src/media.contract.ts` | the Elysia body and params of the routes                                                                                 |
| `src/media.service.ts`  | `createMediaService(context)` and the plugin that puts `mediaService` on a route's context                               |
| `src/media.routes.ts`   | the routes, guarded by an `auth` macro they are given                                                                    |
| `src/media.module.ts`   | `mediaModule`, which `apps/api` mounts, and `resolveRuntimeStorage()`, what a request runs against                       |
| `src/index.ts`          | what `apps/api` imports                                                                                                  |
| `src/testing.ts`        | `startTestBucket()` and `createTestStorage()`, for this package's tests                                                  |
| `src/*.test.ts`         | 82 tests: the legacy ones that travel, and the new ones                                                                  |

Dependencies are exact: `drizzle-orm` and `elysia` at the releases `auth` and `orm/drizzle` pin (a
contract test compares them), the project's `api-runtime`, `auth` and `db` as workspaces, and, for the
tests, `miniflare`, `@cloudflare/workers-types` (the same releases `db/d1` pins) and `@elysiajs/eden`.

## Where it is served

Under `/v1/media`, as the legacy API did, and the `/v1` is the module's: `mediaModule` is an
`Elysia({ prefix: "/v1" })` over routes with a `/media` prefix. The API shell has no `/v1` group, and the
module does not wait for one, because the path is stored: `medias.url` is `<R2_PUBLIC_URL>/<key>`, and
`R2_PUBLIC_URL` defaults, in development only, to `<API_URL>/v1/media/file` (see [Environment](#environment)).
Moving the routes would break every url already written to a database. A front calls them through
Eden as `api.v1.media`.

| Route                  | Auth    | Does                                                                                                                                     |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/media/file/*` | none    | serves an object by key, cached for a year, with `X-Content-Type-Options: nosniff`; `400 INVALID_KEY` for an unsafe key                  |
| `POST /v1/media`       | session | uploads an image (jpeg, png, webp, gif, 10 MB at most) and records it; `400 INVALID_FILE_TYPE` if its bytes are not the type it declares |
| `DELETE /v1/media/:id` | session | deletes the object and the record, for its author or an admin or owner of its organization                                               |
| `GET /v1/media/:id`    | session | the record, with its author and organization                                                                                             |

An upload is checked on its content, not on the type the client declares: `validateFile` reads the first bytes
(hand-written signatures for JPEG, PNG, GIF and WebP, so the same code runs on Workers and Node) and refuses, with
`INVALID_FILE_TYPE` (`400`), a file that is none of them or whose type is not the declared one. The detected type is
what `medias.mime_type` and the object's content type hold. The key is `medias/<folder>/<uuid>.<ext>`, with no
trace of the client's filename (it stays in `medias.name`), and the file route sends `nosniff`.

The routes are given the `auth` macro: `mediaModule` is built with `authMacro` from `{{SCOPE}}/auth`, and
`mediaPlugin(resolveStorage, macro)` takes another, which is how the tests run the real routes behind a real
Better Auth session.

## The bucket binding

`bindR2(env)` returns the `BUCKET` binding, **or `undefined`**, and does not stand in a bucket that fails
on first use the way `db/d1` does for D1. The legacy service branches on a missing bucket, and 080 says to
keep behaviour: an upload and a file request answer `500 BUCKET_NOT_CONFIGURED`, and a delete still removes
the record of a media. A string var named `BUCKET` is not taken for the binding: it has to have `put`,
`get`, `delete`, `head` and `list`.

`BUCKET` is one of the two bindings AGENTS.md allows to be Cloudflare-specific; the module's one `jsonc.merge`
declares it, in the default environment and in `production`:

```jsonc
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "my-app-media" }],
// and under env.production: the same binding, and
"vars": { "R2_PUBLIC_URL": "https://api.my-app.com/v1/media/file" }
```

The default environment has no `R2_PUBLIC_URL`: a value there would win over the one the module derives in
development (see [Environment](#environment)).

`my-app-media` and `api.my-app.com` are the placeholders the other modules use for the project's names
(`bonne-garde add` renders `{{SCOPE}}` and nothing else): replace them by hand. The bucket itself is created with
`wrangler r2 bucket create <name>` (in `apps/api`); `wrangler dev` runs against a local one.

## Environment

The module declares `R2_PUBLIC_URL` (`required`, with a blank example) and reads it through
`readRuntimeEnv()`, never through the shell's `app.config.ts`. A key belongs to the module that reads it
(035), so neither provider nor `api/elysia` declares it, and the shell boots, and answers `/health`, without
this module. The value is read **per request**, not at import, and what a missing one does depends on the
`NODE_ENV` the code runs under. `wrangler` replaces `process.env.NODE_ENV` in the bundle it builds
(`"production"` for `wrangler deploy`, `"development"` for `wrangler dev`, unless the shell that runs it sets
one), and `resolveStorageEnv` is given that value:

| `NODE_ENV`    | `R2_PUBLIC_URL` unset or empty                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `development` | `<API_URL>/v1/media/file`, the origin the API was given (`http://localhost:5172` when it has none)        |
| `test`        | `http://localhost:5172/v1/media/file`, whatever `API_URL` holds, so a test needs nothing set              |
| anything else | the request that needs it fails, naming the key (`Missing required environment variables: R2_PUBLIC_URL`) |

Anything else is `production`, a deployed Worker, and a value nobody set: only `"development"` opens the
default, so an unknown value stays strict. A media url is stored (`medias.url`), so one derived where it should
have been written down would outlive the deploy that wrote it. The default is the API's origin and not the
origin of the request: a `Host` or `X-Forwarded-*` header is the client's to set, and the API's `API_URL` is not.

The consequence for a launcher is that it tells storage nothing. `dev/portless` gives the API its `API_URL`
like any app and this module follows it, so `https://api.my-app.localhost` serves `https://api.my-app.localhost/v1/media/file`
with no storage key in the launcher. In production, set `R2_PUBLIC_URL` in `env.production.vars` of the
Worker's `wrangler.jsonc` (the module writes the placeholder there).

The `dockerfile` runtime does not derive it: that provider has no bucket and this module has no variant for it,
so nothing reads the value there, and a provider fills only the keys of the container itself (the origins, and
the secret it generates).

## The `medias` table

`schema.ts` is the legacy `medias` table and `mediasRelations`, byte for byte but for the import of the auth
tables from `{{SCOPE}}/auth/schema`. `coreSchema`, the legacy aggregate, is not shipped: the barrel gathers the
tables. The file imports nothing of the project but that, and runs nothing when it loads, because
`packages/db`'s schema barrel re-exports it and an import back into the project would be a module cycle.

`organization_id` cascades on delete; **`author_id` does not**. A media of an organization goes when the
organization is deleted, but one with no organization (the column is nullable) stops the delete of its
author: `DELETE FROM "user"` fails on that foreign key. This module adds no step to a reset, and needs none:
`vp run db:reset` is `orm/drizzle`'s, it empties every table the barrel exports, and `medias` is in the barrel
because this module re-exports it, so the table is emptied before the `user` and `organization` it points at.
`media.e2e.test.ts` runs the reset's statements over a media with an author and no organization (and one with
both) on real SQLite with foreign keys on, and golden puts the first in the local D1 before it runs `db:reset`.

## Wiring (060)

The module writes nothing outside `packages/storage` by copy. It reaches the rest of the project through six
patches on four known seams, each with the sentence a failure turns into a pending intention:

| Type                   | File                              | Regions                                                                                              |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `jsonc.merge`          | `apps/api/wrangler.jsonc`         | `r2_buckets`, `vars.R2_PUBLIC_URL`, `env.production.r2_buckets`, `env.production.vars.R2_PUBLIC_URL` |
| `package.dependencies` | `apps/api/package.json`           | `dependencies.{{SCOPE}}/storage`                                                                     |
| `ts.addImport`         | `apps/api/src/app.ts`             | `imports[{{SCOPE}}/storage]`                                                                         |
| `ts.elysiaUse`         | `apps/api/src/app.ts`             | `elysia[app].use[mediaModule]`                                                                       |
| `package.dependencies` | `packages/db/package.json`        | `dependencies.{{SCOPE}}/storage`                                                                     |
| `ts.addNamedExport`    | `packages/db/src/schema/index.ts` | `exports[{{SCOPE}}/storage/schema]`                                                                  |

`.use(mediaModule)` lands after `.use(authModule)`. The export is `medias` and `mediasRelations` (a contract test
compares it with `schema.ts`), so `vp run db:generate` in `packages/db` writes `medias` into the project's one
migration, and `createDB` sees it. The wiring adds a `db` and `storage` workspace cycle (the barrel re-exports
storage's table, storage reads `createDB`), like the one `auth` has; bun and pnpm, `tsc` and Vitest resolve it.

## Tests

82 tests in the project, against what is real: an R2 bucket from Miniflare (workerd's own, not a stand-in), an
in-memory SQLite that has the auth and media tables, and a Better Auth instance for the sessions (`createTestAuth` of
`{{SCOPE}}/auth/testing`, given the media tables: storage keeps no sign-in flow of its own). Nothing is
mocked. The legacy ones travel: `r2.test.ts`, the file route of `media.routes.test.ts`, and the service cases
of `media.e2e.test.ts`, which now go through the real routes at `/v1/media` where the legacy file re-implemented
the handlers in the test. New: `bucket.test.ts` (the binding, and a variable that is not one), `env.test.ts`,
`media.module.test.ts` (what `apps/api` mounts, with no Worker: `BUCKET_NOT_CONFIGURED`, `401`, and the public url in development and in production), `exports.test.ts`
(the subpaths the project imports), and in `media.e2e.test.ts` the `401` of each guarded route, an admin deleting
a member's media, `404` of `GET /v1/media/:id`, and the reset's statements over media rows.

They import `{{SCOPE}}/…` packages that exist only in a project, so `test:scripts` skips this directory and
golden is where they run, with a floor on the count.

## Not here

- **`lib/env.ts`'s `BUCKET` and `R2_PUBLIC_URL`, and `app.config.ts`'s requirement of the second.** The shell
  never had them; this module reads its own.
- **`mediaFileParams`, `mediaResponse`, `errorResponse`** and their types in the legacy contract: nothing used them.
- **A `dockerfile` variant.** The container has no bucket; a storage module for it (a volume, S3) is a new module
  with its own `peers.provider`.
- **`checkMediaReferences`** still returns an empty list, as in the legacy service: it is the seam where a
  resource that holds a media would block its deletion (`409 MEDIA_IN_USE`), and nothing holds one yet.
