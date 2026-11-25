# launch/waitlist

A launch stage and a waiting list, for the dockerfile provider: `GET /launch` says whether the project is
`waiting` or `launched`, a `{ launched: true }` route option keeps a route shut until it is, and
`POST /launch/waitlist` collects email addresses. A module of its own in the `launch` category; the Cloudflare
variant comes next (BG-52), so `launch/waitlist` is refused on Cloudflare for now (`launch/waitlist accepts only dockerfile for provider`).

```bash
bunx bonne-garde add provider/dockerfile config/branding api/elysia db/libsql orm/drizzle auth/better-auth launch/waitlist
```

## Peers

| Peer       | Allow-list    | Why                                                                                          |
| ---------- | ------------- | -------------------------------------------------------------------------------------------- |
| `provider` | `dockerfile`  | `readRuntimeEnv` and `clientIpHeaders` from `{{SCOPE}}/api-runtime`                          |
| `db`       | `libsql`      | `readLibsql()` from `{{SCOPE}}/db/libsql`: the tables live in the project's SQLite file      |
| `orm`      | `drizzle`     | `createDB` from `{{SCOPE}}/db` and the test database from `{{SCOPE}}/db/testing`             |
| `auth`     | `better-auth` | not imported yet: the invitations that let a listed address in are issued against its tables |

## Environment

| Name                           | Required | Notes                                                                           |
| ------------------------------ | -------- | ------------------------------------------------------------------------------- |
| `LAUNCH_STAGE`                 | yes      | `waiting` or `launched`. Anything else, or nothing, makes the routes answer 500 |
| `LAUNCH_WAITLIST_MAX_PER_HOUR` | no       | Joins per client address per hour, a positive whole number (default 5)          |

Both are read when a request is made, not at import: the API shell still boots and answers `/health` without them.

## Routes

- `GET /launch` → `{ stage }`, public.
- `POST /launch/waitlist` `{ email }` → `{ status: "listed" }`. The address is trimmed and lowercased; joining twice
  keeps one row and answers the same. Open whatever the stage. A string that is not an email address answers 422
  `INVALID_EMAIL`.
- Over the limit → 429 `WAITLIST_RATE_LIMITED` with `Retry-After` (seconds until the oldest join leaves the hour). A
  refused request is not counted; a repeated address is (the limit is on requests).

The client address is the first of the provider's `clientIpHeaders` that is present (`x-client-ip`, which the runtime
fills itself and which a client cannot set). A request with none shares one bucket with every other such request.

## The macro

```ts
import { launchMacro } from "@app/launch";

new Elysia().use(launchMacro).get("/members", handler, { launched: true });
```

While the stage is `waiting`, the route answers 403 `{ code: "LAUNCH_WAITING" }`.

## Tables

`waitlist_entry` (`id`, `email` unique, `createdAt`, `invitedAt` nullable) and `waitlist_join` (`id`, `ip`,
`createdAt`: one row per accepted join, which the limit counts; rows older than an hour are deleted by the next join).
Both are re-exported by `packages/db`'s schema barrel: run `vp run db:generate` after installing.

## Not here

- **Inviting listed people** and the sign-up gate: `auth/better-auth` (`AUTH_SIGNUP`) and a later task of BG-52.
- **Counting across modules.** The contact form (BG-51) will keep a limit table of its own; they are merged once both ship.
