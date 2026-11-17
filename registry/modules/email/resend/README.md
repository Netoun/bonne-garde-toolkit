# email/resend

Transactional email over the project's provider: the React templates auth needs (verification and
password reset), a `memory` adapter for tests, and Resend over its HTTP API. It is the legacy
`packages/emails` and `apps/api/src/lib/email.ts` extracted into `packages/email`.

```bash
bunx bonne-garde add provider/cloudflare config/branding api/elysia db/d1 orm/drizzle auth/better-auth email/resend
```

## Peers and variants

| Peer       | Allow-list | Why                                                                                 |
| ---------- | ---------- | ----------------------------------------------------------------------------------- |
| `provider` | any        | `readRuntimeEnv` from `{{SCOPE}}/api-runtime` reads the key; the provider owns that |
| `config`   | `branding` | `branding.legalName` and `formatEmailFrom` from `{{SCOPE}}/config`, for the sender  |

Resend is plain HTTP, so it works under both providers and the module has no variant per provider (the
settled decision of 07: an SMTP module would be the provider-bound one). **It does not peer on `auth`.**
035 has no optional peer, and an email module that refused to install without auth would be an email
module for one consumer. It has two variants instead, and the installed peers pick one (050 step 7):

| Variant       | `match`                   | What it adds                                                                        |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `default`     | `{}`                      | the package, and nothing else: no patch, no intention                               |
| `better-auth` | `{ auth: "better-auth" }` | the package, two patches into `packages/auth`, and the intention that finishes them |

The two write the same files, with the same dependencies and env key (a contract test pins that). A
project without auth (golden's `dockerfile` configuration has none, no database) installs `default`,
and `bonne-garde doctor --strict` is green as it is.

## What it writes

Everything in `packages/email`, from explicit paths:

| File                                       | What it is                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `package.json`                             | `{{SCOPE}}/email`: the `.` and `./testing` exports, the scripts                                       |
| `src/types.ts`, `render.ts`, `send.ts`     | `EmailMessage`, `EmailProvider`, `renderEmailTemplate` and `sendEmail`, as `packages/emails` had them |
| `src/templates/*.template.ts`              | `VerifyEmailEmail`, `ResetPasswordEmail` and `WelcomeTemplate`, carried over as they were             |
| `src/providers/memory.provider.ts`         | `createMemoryEmailProvider(store)`: keeps what it is asked to send, sends nothing                     |
| `src/providers/resend.provider.ts`         | `createResendEmailProvider({ apiKey, from?, baseUrl? })`: `POST /emails`, plain `fetch`               |
| `src/env.ts`                               | `resolveEmailEnv`: `RESEND_API_KEY`, read from `readRuntimeEnv()`                                     |
| `src/runtime.ts`                           | `emailProvider`: the adapter the runtime sends through, chosen at the first email                     |
| `src/auth-mailer.ts`                       | `createAuthMailer` and `emailMailer`: auth's two emails, rendered and sent                            |
| `src/testing.ts`                           | `outbox` and `clearOutbox`: what the memory adapter holds under test                                  |
| `src/*.test.ts`, `src/providers/*.test.ts` | the tests that travel, and the new ones: no mock of `fetch`, no snapshot                              |

Dependencies are exact: `@react-email/render`, `react` and `react-dom` (`react-dom` is a peer of the
renderer), and the project's `api-runtime` and `config` as workspaces. `@types/react` is the dev one.

## Resend, and why not the SDK

The legacy API sent through the `resend` SDK with `react: <element>`, and the SDK renders it. This
package renders to `html` itself (`@react-email/render`, as `packages/emails` already did) and posts
`{ from, to, subject, html }` to `https://api.resend.com/emails` with `fetch`. That is the whole of
what the project used, it has no SDK to bundle for Workers, and it can be tested against a real HTTP
server: `resend.provider.test.ts` starts a `Bun.serve` that answers as Resend does and points
`baseUrl` at it. A `User-Agent` is set explicitly, because Resend answers 403 without one and `fetch` on
Workers sends none. A non-2xx answer is thrown as `Email send failed: <status> <Resend's message>`; the
key is never in it.

**The sender.** `from` defaults to what the legacy code used: the brand's legal name at
`noreply@example.com`, an address Resend will not deliver from until a domain is verified. A deployed
project passes its own, `createResendEmailProvider({ apiKey, from })`; there is no env key for it
(the legacy code had none, and adding one is a feature, not an extraction).

## Which adapter, and what a missing key does

`emailProvider` is chosen when the first email is asked for, not at import:

- under `NODE_ENV=test` it is the memory adapter, writing to `outbox` from `{{SCOPE}}/email/testing`;
  nothing reaches the network, and the environment is not read;
- anywhere else it is Resend, with the key from `readRuntimeEnv()`. **A missing key throws, naming
  `RESEND_API_KEY`**, and never falls back to memory: a production project would send nothing and say so
  nowhere.

So the project boots with no key (the legacy API exited at import without it) and the first email fails
loudly. A failed read is not remembered: set the key and the next email finds it.

| Provider     | Where the key comes from                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `cloudflare` | `.dev.vars` in `apps/api` for `wrangler dev`, `wrangler secret put RESEND_API_KEY` when deployed |
| `dockerfile` | `RESEND_API_KEY` in the project's `.env`, which `compose.yaml` passes to the container           |

The module declares `RESEND_API_KEY` (`required`) in `.env.example`. A key belongs to the module that
reads it (035), so neither provider declares it any more, and a contract test refuses a second
declarer.

On `dockerfile`, `compose.yaml` names no module's key. It reads the project's `.env` through `env_file`
(Compose 2.24 or later), so the key has to be in that file, copied from `.env.example`: one exported only
in the host's shell does not reach the container, and `docker compose run -e` or `docker run -e` passes it
by hand ([`provider/dockerfile`](../../provider/dockerfile/README.md#compose-and-the-projects-env)).

## Wiring into auth (060, 065)

Email comes after auth in 035's order, so it wires itself into auth and auth never imports it first.
Auth owns the `AuthMailer` interface and exports `mailer`, documented as the one place an `email` module
wires itself in. The `better-auth` variant does it in two steps:

1. **One patch** (tier 2), which `bonne-garde add` applies: `package.dependencies` declares `{{SCOPE}}/email` in
   `packages/auth/package.json`.
2. **One intention** (tier 3), `email/resend/wire-email-into-auth`, which `bonne-garde add` stages in
   `.bg/add/` and which is pending until `bonne-garde record`: make `mailer` `emailMailer`, importing it from
   `{{SCOPE}}/email` in place of the `apiLogger` import only the old initializer used. This is the first
   intention a module ships: no patch of 060's closed catalog replaces the initializer of an exported
   constant, and an import patch on its own would sit unused, and fail `bun run check`, until the
   initializer is replaced. So `bonne-garde add` writes nothing into `mailer.ts`, and there is no lint-red window
   between `bonne-garde add` and `bonne-garde record`.

**What `bonne-garde record` does to `mailer.ts`.** It is auth's tier-1 file, with its sha256 recorded, and the edit
changes it: `bonne-garde doctor` would report it user-modified, a warning that `--strict` fails on. The intention
declares `mailer.ts` as an `adapt` Reference Path, so `bonne-garde record` records `intent[email/resend/wire-email-into-auth]`,
owned by email, on it. A file with recorded regions is checked by region (060), so `doctor` reads it as the
project's, and re-adding auth keeps the edit and reports it, even when auth's template changed. Auth's
recorded sha is not replaced by the edited file's: that would make auth's re-add see an untouched file
and overwrite the edit. Re-adding email skips its patch and stages nothing. `bonne-garde record --skip` records no
region. Golden checks all of it: no region before the record, the region after it, `doctor --strict`
green, and each module added again changing nothing.

What the executor does, and what golden does, the same way: read `.bg/add/session.md`, apply the edit the
document describes, run its Validation (`typecheck`, `test`, `check`, and a test that signs a user up
through `createTestAuth({ mailer })` and reads the `outbox`), then `bonne-garde record
email/resend/wire-email-into-auth`. Until then `mailer` is auth's own, which sends nothing and says so, and
the module's `checks` are withheld (050 step 15).

**Installed in the other order.** `bunx bonne-garde add auth/better-auth` after email is installed wires it all the
same: auth's install knows nothing of email, but `bonne-garde add` selects the variants of the installed modules
again (050 step 7), finds that the `better-auth` variant of email now matches, and plans email in the same
call as a re-add. It reports it (`bonne-garde: email/resend, installed on variant default, is planned again on
variant better-auth, which matches auth/better-auth`, and `reselected` in the JSON), applies the patch and
stages the intention, as one call naming both would. A project that is already in that state, from before
`bonne-garde add` did this, is fixed by `bunx bonne-garde add email/resend`. Golden installs auth first in its configurations, and
checks the other order in a project of its own.

## Not here

- **The Cloudflare `EMAIL`-binding adapter** (`createCloudflareEmailProvider`). AGENTS.md forbids
  Cloudflare APIs outside `DB` and `BUCKET`, and Resend works under both providers (settled in 07). It
  would come back only as a variant with `peers.provider: ["cloudflare"]`, amending AGENTS.md with it.
- **The `resend` SDK** and `apps/api/src/lib/email.ts`, which `apps/api` keeps while the legacy tree stands.
- **A use for `WelcomeTemplate`.** Nothing sends it; it is carried over with its test, as extracted.
- **An env key for the sender address**, or an SMTP adapter.
